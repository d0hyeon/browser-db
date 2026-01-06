import type { ReadChain, StoreDefinition, GetAllOptions } from './types.js';
import { promisifyTransaction } from './utils.js';

/**
 * Internal chain implementation type
 */
interface ReadChainImpl {
  get(storeName: string, key: IDBValidKey): ReadChainImpl;
  getAll(storeName: string, options?: GetAllOptions): ReadChainImpl;
  getAllByIndex(storeName: string, indexName: string, query?: IDBKeyRange | IDBValidKey): ReadChainImpl;
  count(storeName: string, query?: IDBKeyRange | IDBValidKey): ReadChainImpl;
  execute(): Promise<unknown[]>;
}

/**
 * Cast internal chain implementation to typed ReadChain
 * Centralizes the type assertion for chain creation
 */
function toReadChain<TStores extends readonly StoreDefinition[]>(
  chain: ReadChainImpl
): ReadChain<TStores, []> {
  return chain as unknown as ReadChain<TStores, []>;
}

type ReadOperation =
  | { type: 'get'; storeName: string; key: IDBValidKey }
  | { type: 'getAll'; storeName: string; query?: IDBKeyRange | IDBValidKey; count?: number }
  | { type: 'getAllByIndex'; storeName: string; indexName: string; query?: IDBKeyRange | IDBValidKey }
  | { type: 'count'; storeName: string; query?: IDBKeyRange | IDBValidKey };

/**
 * Creates a read transaction chain
 */
export function createReadChain<TStores extends readonly StoreDefinition[]>(
  db: IDBDatabase,
  storeNames: string[]
): ReadChain<TStores, []> {
  const operations: ReadOperation[] = [];

  const chain = {
    get(storeName: string, key: IDBValidKey) {
      operations.push({ type: 'get', storeName, key });
      return chain;
    },

    getAll(storeName: string, options?: GetAllOptions) {
      operations.push({
        type: 'getAll',
        storeName,
        query: options?.query,
        count: options?.count,
      });
      return chain;
    },

    getAllByIndex(storeName: string, indexName: string, query?: IDBKeyRange | IDBValidKey) {
      operations.push({ type: 'getAllByIndex', storeName, indexName, query });
      return chain;
    },

    count(storeName: string, query?: IDBKeyRange | IDBValidKey) {
      operations.push({ type: 'count', storeName, query });
      return chain;
    },

    async execute(): Promise<unknown[]> {
      if (operations.length === 0) {
        return [];
      }

      const usedStores = [...new Set(operations.map((op) => op.storeName))];

      for (const store of usedStores) {
        if (!storeNames.includes(store)) {
          throw new Error(
            `Store "${store}" is not in the transaction scope. ` +
            `Available stores: ${storeNames.join(', ')}`
          );
        }
      }

      const tx = db.transaction(storeNames, 'readonly');
      const requests: IDBRequest[] = [];

      for (const op of operations) {
        const store = tx.objectStore(op.storeName);

        switch (op.type) {
          case 'get':
            requests.push(store.get(op.key));
            break;
          case 'getAll':
            requests.push(store.getAll(op.query, op.count));
            break;
          case 'getAllByIndex':
            requests.push(store.index(op.indexName).getAll(op.query));
            break;
          case 'count':
            requests.push(store.count(op.query));
            break;
        }
      }

      await promisifyTransaction(tx);

      return requests.map((r) => r.result);
    },
  };

  return toReadChain<TStores>(chain);
}
