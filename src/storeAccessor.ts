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
 * Apply default values to a record
 */
function applyDefaults<T>(
  value: T | undefined,
  defaults: Partial<T>
): T | undefined {
  if (value === undefined) return undefined;
  
  // Merge defaults with value (value takes precedence)
  return { ...defaults, ...value };
}

/**
 * Apply defaults to an array of records
 */
function applyDefaultsToArray<T>(
  values: T[],
  defaults: Partial<T>
): T[] {
  if (Object.keys(defaults).length === 0) return values;
  return values.map((v) => ({ ...defaults, ...v }));
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
  defaults: Partial<T> = {}
): StoreAccessorWithQuery<T, K> {
  const hasDefaults = Object.keys(defaults).length > 0;
  const queryFn = createQueryFunction<T, K>(db, storeName, defaults);

  return {
    async get(key: K): Promise<T | undefined> {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const result = await getResult<T | undefined>(tx, store.get(key));
      return hasDefaults ? applyDefaults(result, defaults) : result;
    },

    async getAll(options?: GetAllOptions): Promise<T[]> {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const result = await getResult<T[]>(tx, store.getAll(options?.query, options?.count));
      return hasDefaults ? applyDefaultsToArray(result, defaults) : result;
    },

    async getBy(
      indexName: string,
      query: IDBKeyRange | IDBValidKey
    ): Promise<T | undefined> {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const result = await getResult<T | undefined>(tx, index.get(query));
      return hasDefaults ? applyDefaults(result, defaults) : result;
    },

    async getAllBy(
      indexName: string,
      query?: IDBKeyRange | IDBValidKey
    ): Promise<T[]> {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      const result = await getResult<T[]>(tx, index.getAll(query));
      return hasDefaults ? applyDefaultsToArray(result, defaults) : result;
    },

    async put(value: T, key?: K): Promise<K> {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      return getResult<K>(tx, store.put(value, key));
    },

    async add(value: T, key?: K): Promise<K> {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      return getResult<K>(tx, store.add(value, key));
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
