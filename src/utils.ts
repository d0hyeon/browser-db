/**
 * Utility functions for working with IndexedDB
 */

/**
 * Wrap an IDBRequest in a Promise
 */
export function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Execute a store operation and return typed result
 * This avoids explicit type assertions by using the generic parameter
 */
export async function executeStoreOperation<T>(
  tx: IDBTransaction,
  request: IDBRequest<T>
): Promise<T> {
  await promisifyTransaction(tx);
  return request.result;
}

/**
 * Wrap an IDBTransaction in a Promise that resolves on complete
 */
export function promisifyTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new Error('Transaction aborted'));
  });
}

/**
 * Wrap indexedDB.open in a Promise
 */
export function openDatabase(
  name: string,
  version: number,
  onUpgradeNeeded?: (db: IDBDatabase, tx: IDBTransaction, oldVersion: number, newVersion: number) => void,
  onBlocked?: () => void
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const tx = request.transaction!;
      const oldVersion = event.oldVersion;
      const newVersion = event.newVersion ?? version;
      onUpgradeNeeded?.(db, tx, oldVersion, newVersion);
    };

    request.onblocked = () => {
      onBlocked?.();
    };
  });
}

/**
 * Delete a database
 */
export function deleteDB(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

/**
 * Check if IndexedDB is available
 */
export function isIndexedDBAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}
