import type { WriteChain, StoreDefinition } from './types.js';
import { promisifyTransaction } from './utils.js';

/**
 * Internal chain implementation type
 */
interface WriteChainImpl {
  put(storeName: string, value: unknown, key?: IDBValidKey): WriteChainImpl;
  add(storeName: string, value: unknown, key?: IDBValidKey): WriteChainImpl;
  delete(storeName: string, key: IDBValidKey | IDBKeyRange): WriteChainImpl;
  clear(storeName: string): WriteChainImpl;
  execute(): Promise<void>;
}

/**
 * Cast internal chain implementation to typed WriteChain
 * Centralizes the type assertion for chain creation
 */
function toWriteChain<TStores extends readonly StoreDefinition[]>(
  chain: WriteChainImpl
): WriteChain<TStores> {
  return chain as WriteChain<TStores>;
}

type WriteOperation =
  | { type: 'put'; storeName: string; value: unknown; key?: IDBValidKey }
  | { type: 'add'; storeName: string; value: unknown; key?: IDBValidKey }
  | { type: 'delete'; storeName: string; key: IDBValidKey | IDBKeyRange }
  | { type: 'clear'; storeName: string };

/**
 * Creates a write transaction chain
 */
export function createWriteChain<TStores extends readonly StoreDefinition[]>(
  db: IDBDatabase,
  storeNames: string[]
): WriteChain<TStores> {
  const operations: WriteOperation[] = [];

  const chain = {
    put(storeName: string, value: unknown, key?: IDBValidKey) {
      operations.push({ type: 'put', storeName, value, key });
      return chain;
    },

    add(storeName: string, value: unknown, key?: IDBValidKey) {
      operations.push({ type: 'add', storeName, value, key });
      return chain;
    },

    delete(storeName: string, key: IDBValidKey | IDBKeyRange) {
      operations.push({ type: 'delete', storeName, key });
      return chain;
    },

    clear(storeName: string) {
      operations.push({ type: 'clear', storeName });
      return chain;
    },

    async execute(): Promise<void> {
      if (operations.length === 0) {
        return;
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

      const tx = db.transaction(storeNames, 'readwrite');

      for (const op of operations) {
        const store = tx.objectStore(op.storeName);

        switch (op.type) {
          case 'put':
            store.put(op.value, op.key);
            break;
          case 'add':
            store.add(op.value, op.key);
            break;
          case 'delete':
            store.delete(op.key);
            break;
          case 'clear':
            store.clear();
            break;
        }
      }

      await promisifyTransaction(tx);
    },
  };

  return toWriteChain<TStores>(chain);
}
