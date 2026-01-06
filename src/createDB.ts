import type {
  StoreDefinition,
  DatabaseConfig,
  Database,
  DatabaseWithStores,
  Migration,
} from './types.js';
import { openDatabase, promisifyTransaction } from './utils.js';
import { createReadChain } from './readChain.js';
import { createWriteChain } from './writeChain.js';
import { createStoreAccessor } from './storeAccessor.js';

/**
 * Collect all migrations from stores and sort by name
 */
function collectMigrations(stores: readonly StoreDefinition[]): Migration[] {
  const allMigrations: Migration[] = [];
  const seenNames = new Set<string>();

  for (const store of stores) {
    for (const migration of store.migrations) {
      if (seenNames.has(migration.name)) {
        throw new Error(`Duplicate migration name "${migration.name}" found across stores`);
      }
      seenNames.add(migration.name);
      allMigrations.push(migration);
    }
  }

  return allMigrations.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Build database object with store accessors
 * Centralizes the type assertion for database creation
 */
function buildDatabaseWithStores<TStores extends readonly StoreDefinition[]>(
  database: Database<TStores>,
  idb: IDBDatabase,
  stores: TStores
): DatabaseWithStores<TStores> {
  const dbWithStores: Record<string, unknown> = { ...database };

  for (const store of stores) {
    dbWithStores[store.name] = createStoreAccessor(idb, store.name);
  }

  return dbWithStores as DatabaseWithStores<TStores>;
}

/**
 * Handle initial schema creation and migrations
 */
function handleUpgrade(
  db: IDBDatabase,
  tx: IDBTransaction,
  oldVersion: number,
  stores: readonly StoreDefinition[],
  migrations: Migration[]
): void {
  // If this is a fresh database (oldVersion === 0), create all stores
  if (oldVersion === 0) {
    for (const store of stores) {
      const objectStore = db.createObjectStore(store.name, {
        keyPath: store.keyPath,
        autoIncrement: store.autoIncrement,
      });

      for (const index of store.indexes) {
        objectStore.createIndex(index.name, index.keyPath, {
          unique: index.unique ?? false,
          multiEntry: index.multiEntry ?? false,
        });
      }
    }
  }

  // Run all migrations (name-based, always run on upgrade)
  // Note: For legacy API, we run all migrations on every upgrade
  // The schema-based API (createSchemaDB) has proper migration tracking
  for (const migration of migrations) {
    try {
      const result = migration.up(db, tx);

      if (result instanceof Promise) {
        result.catch((err) => {
          console.error(`Migration "${migration.name}" failed:`, err);
          tx.abort();
        });
      }
    } catch (err) {
      console.error(`Migration "${migration.name}" failed:`, err);
      tx.abort();
      throw err;
    }
  }
}

/**
 * Create a database instance with the given configuration.
 *
 * @example
 * ```ts
 * const db = await openDB({
 *   name: 'MyApp',
 *   version: 1,
 *   stores: [usersStore, postsStore] as const,
 * });
 *
 * // Shorthand API
 * const user = await db.users.get('u1');
 * await db.users.put({ id: 'u1', name: 'Kim' });
 *
 * // Read chain
 * const [user, posts] = await db.read(['users', 'posts'])
 *   .get('users', 'u1')
 *   .getAllByIndex('posts', 'authorId', 'u1')
 *   .execute();
 *
 * // Write chain
 * await db.write(['users', 'posts'])
 *   .put('users', { id: 'u1', name: 'Kim' })
 *   .delete('posts', 1)
 *   .execute();
 * ```
 */
export async function openDB<const TStores extends readonly StoreDefinition[]>(
  config: DatabaseConfig<TStores>
): Promise<DatabaseWithStores<TStores>> {
  const {
    name,
    version: explicitVersion,
    versionStrategy = 'explicit',
    stores,
    onBlocked,
    onVersionChange,
  } = config;

  // Validate stores
  const storeNames = new Set<string>();
  for (const store of stores) {
    if (storeNames.has(store.name)) {
      throw new Error(`Duplicate store name: "${store.name}"`);
    }
    storeNames.add(store.name);
  }

  // Determine version
  let version: number;
  if (versionStrategy === 'auto') {
    // For legacy API with auto versioning, use version 1
    // Schema-based API (createSchemaDB) handles auto versioning properly
    version = 1;
  } else {
    if (explicitVersion === undefined) {
      throw new Error('Version is required when versionStrategy is "explicit"');
    }
    version = explicitVersion;
  }

  // Collect migrations
  const migrations = collectMigrations(stores);

  // Open database
  const idb = await openDatabase(
    name,
    version,
    (db, tx, oldVersion) => {
      handleUpgrade(db, tx, oldVersion, stores, migrations);
    },
    onBlocked
  );

  // Set up version change handler
  if (onVersionChange) {
    idb.onversionchange = onVersionChange;
  }

  // Create base database object
  const database: Database<TStores> = {
    get name() {
      return idb.name;
    },

    get version() {
      return idb.version;
    },

    get raw() {
      return idb;
    },

    close() {
      idb.close();
    },

    read(storeNames: string[]) {
      return createReadChain<TStores>(idb, storeNames);
    },

    write(storeNames: string[]) {
      return createWriteChain<TStores>(idb, storeNames);
    },

    async transaction(storeNames: string[], mode: IDBTransactionMode, fn) {
      const tx = idb.transaction(storeNames, mode);
      const result = fn(tx);

      if (result instanceof Promise) {
        await result;
      }

      await promisifyTransaction(tx);
    },
  };

  // Add store accessors
  return buildDatabaseWithStores(database, idb, stores);
}
