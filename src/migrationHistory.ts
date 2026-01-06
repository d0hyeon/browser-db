/**
 * Migration history management
 *
 * Tracks applied migrations in a special __schema_history__ store
 */

// ============================================================================
// Constants
// ============================================================================

export const SCHEMA_HISTORY_STORE = '__schema_history__';
export const SCHEMA_HISTORY_KEY = 'migrations';

// ============================================================================
// Types
// ============================================================================

export interface SchemaHistoryRecord {
  id: typeof SCHEMA_HISTORY_KEY;
  appliedMigrations: string[];
  lastUpdated: string;
}

// ============================================================================
// Store Management
// ============================================================================

/**
 * Ensure the __schema_history__ store exists in the database
 * Called during upgrade transaction
 */
export function ensureSchemaHistoryStore(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(SCHEMA_HISTORY_STORE)) {
    db.createObjectStore(SCHEMA_HISTORY_STORE, { keyPath: 'id' });
  }
}

/**
 * Read applied migrations from the history store
 */
export async function getAppliedMigrations(db: IDBDatabase): Promise<string[]> {
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(SCHEMA_HISTORY_STORE)) {
      resolve([]);
      return;
    }

    const tx = db.transaction(SCHEMA_HISTORY_STORE, 'readonly');
    const store = tx.objectStore(SCHEMA_HISTORY_STORE);
    const request = store.get(SCHEMA_HISTORY_KEY);

    request.onsuccess = () => {
      const record = request.result as SchemaHistoryRecord | undefined;
      resolve(record?.appliedMigrations ?? []);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Record a migration as applied in the history store
 * Called within the upgrade transaction
 */
export function recordMigrationApplied(
  tx: IDBTransaction,
  migrationName: string,
  currentApplied: string[]
): void {
  const store = tx.objectStore(SCHEMA_HISTORY_STORE);

  const newApplied = [...currentApplied, migrationName].sort();

  const record: SchemaHistoryRecord = {
    id: SCHEMA_HISTORY_KEY,
    appliedMigrations: newApplied,
    lastUpdated: new Date().toISOString(),
  };

  store.put(record);
}

/**
 * Initialize the history record if it doesn't exist
 */
export function initializeSchemaHistory(tx: IDBTransaction): void {
  const store = tx.objectStore(SCHEMA_HISTORY_STORE);
  const request = store.get(SCHEMA_HISTORY_KEY);

  request.onsuccess = () => {
    if (!request.result) {
      const record: SchemaHistoryRecord = {
        id: SCHEMA_HISTORY_KEY,
        appliedMigrations: [],
        lastUpdated: new Date().toISOString(),
      };
      store.put(record);
    }
  };
}

