import type { StoreAccessor, GetAllOptions } from './types.js';
import { promisifyTransaction } from './utils.js';
import { createQueryFunction, type QueryOptions, type QueryBuilder } from './query.js';

/**
 * Execute store operation and get typed result
 * Centralizes type assertion in one place for maintainability
 */
async function getResult<T>(tx: IDBTransaction, request: IDBRequest): Promise<T> {
  await promisifyTransaction(tx);
  return request.result as T;
}

/**
 * 쓰기 시 누락된 필드에 default 값을 채운다.
 * 함수 default는 매 호출마다 실행된다.
 */
function applyWriteDefaults<T>(value: T, defaults: Record<string, unknown>): T {
  if (Object.keys(defaults).length === 0) return value;
  const out = { ...(value as Record<string, unknown>) };
  for (const [k, d] of Object.entries(defaults)) {
    if (out[k] === undefined) {
      out[k] = typeof d === 'function' ? (d as () => unknown)() : d;
    }
  }
  return out as T;
}

/**
 * Extended store accessor with query support
 */
export interface StoreAccessorWithQuery<T, K extends IDBValidKey> extends StoreAccessor<T, K> {
  query(options: QueryOptions): Promise<T[]>;
  query(): QueryBuilder<T, K>;
}

/**
 * Creates a store accessor for the shorthand API
 */
export function createStoreAccessor<T, K extends IDBValidKey>(
  db: IDBDatabase,
  storeName: string,
  defaults: Record<string, unknown> = {}
): StoreAccessorWithQuery<T, K> {
  const queryFn = createQueryFunction<T, K>(db, storeName, defaults as Partial<T>);

  return {
    async get(key: K): Promise<T | undefined> {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      return getResult<T | undefined>(tx, store.get(key));
    },

    async getAll(options?: GetAllOptions): Promise<T[]> {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      return getResult<T[]>(tx, store.getAll(options?.query, options?.count));
    },

    async getBy(
      indexName: string,
      query: IDBKeyRange | IDBValidKey
    ): Promise<T | undefined> {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      return getResult<T | undefined>(tx, index.get(query));
    },

    async getAllBy(
      indexName: string,
      query?: IDBKeyRange | IDBValidKey
    ): Promise<T[]> {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      return getResult<T[]>(tx, index.getAll(query));
    },

    async put(value: T, key?: K): Promise<K> {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      return getResult<K>(tx, store.put(applyWriteDefaults(value, defaults), key));
    },

    async add(value: T, key?: K): Promise<K> {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      return getResult<K>(tx, store.add(applyWriteDefaults(value, defaults), key));
    },

    async delete(key: K | IDBKeyRange): Promise<void> {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.delete(key);
      await promisifyTransaction(tx);
    },

    async clear(): Promise<void> {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.clear();
      await promisifyTransaction(tx);
    },

    async count(query?: IDBKeyRange | IDBValidKey): Promise<number> {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const request = store.count(query);
      await promisifyTransaction(tx);
      return request.result;
    },

    async raw<R>(fn: (store: IDBObjectStore) => IDBRequest<R>): Promise<R> {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      const request = fn(store);
      await promisifyTransaction(tx);
      return request.result;
    },

    // Query API
    query: queryFn as StoreAccessorWithQuery<T, K>['query'],
  };
}
