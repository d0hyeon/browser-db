/**
 * Core type definitions for the IDB wrapper library
 */

// ============================================================================
// Schema & Store Definition Types
// ============================================================================

/**
 * Index definition for an ObjectStore (internal)
 */
export interface IndexDefinition {
  name: string;
  keyPath: string | string[];
  unique?: boolean;
  multiEntry?: boolean;
}

/**
 * Index options for a single field
 */
export interface IndexOptions {
  unique?: boolean;
  multiEntry?: boolean;
}

/**
 * Index configuration value: options object, true (basic index), or false (no index)
 */
export type IndexOption = IndexOptions | boolean;

/**
 * Index configuration object - requires all fields except keyPath
 */
export type IndexConfig<T, KP extends keyof T> = {
  [K in Exclude<keyof T, KP>]: IndexOption;
};

/**
 * Migration function signature (name-based)
 */
export type MigrationFn = (
  db: IDBDatabase,
  transaction: IDBTransaction
) => void | Promise<void>;

/**
 * Migration definition (name-based)
 *
 * Migrations are identified by name and sorted alphabetically for execution order.
 * Use naming convention like '001-initial', '002-add-email-index' for predictable ordering.
 */
export interface Migration {
  name: string;
  up: MigrationFn;
}

/**
 * Base store definition (internal)
 */
interface StoreDefinitionBase<T = unknown, K = unknown> {
  name: string;
  keyPath?: string | string[];
  autoIncrement?: boolean;
  indexes: IndexDefinition[];
  migrations: Migration[];
  _schema: T;
  _keyType: K;
}

/**
 * Store definition with literal name type
 */
export type StoreDefinition<
  T = unknown,
  K = unknown,
  TName extends string = string
> = StoreDefinitionBase<T, K> & { name: TName };

// ============================================================================
// KeyPath Type Utilities
// ============================================================================

/**
 * Valid keyPath values - single key or array of keys from schema
 */
export type StoreKeyPath<T> = (keyof T & string) | readonly (keyof T & string)[];

/**
 * Extract the key type from a keyPath
 * - Single key: T[keyPath]
 * - Array: tuple of T[each key]
 */
export type ExtractKeyType<T, KP> = 
  KP extends keyof T 
    ? T[KP] 
    : KP extends readonly (keyof T)[] 
      ? { [I in keyof KP]: KP[I] extends keyof T ? T[KP[I]] : never }
      : IDBValidKey;

// ============================================================================
// Store Options
// ============================================================================

/**
 * Options for defineStore - with keyPath (key type inferred)
 */
export interface StoreOptionsWithKeyPath<T, KP extends StoreKeyPath<T>> {
  keyPath: KP;
  autoIncrement?: boolean;
  indexes?: KP extends keyof T ? IndexConfig<T, KP> : never;
  migrations?: Migration[];
}

/**
 * Options for defineStore - without keyPath (autoIncrement or out-of-line keys)
 */
export interface StoreOptionsWithoutKeyPath<T, K extends IDBValidKey> {
  keyPath?: undefined;
  autoIncrement?: boolean;
  indexes?: IndexConfig<T, never>;  // 모든 필드 인덱스 가능
  migrations?: Migration[];
  /**
   * Explicitly specify key type when not using keyPath
   * Only needed for type inference, runtime value is ignored
   */
  keyType?: K;
}

// ============================================================================
// Database Configuration Types
// ============================================================================

export type VersionStrategy = 'explicit' | 'auto';

export interface DatabaseConfig<TStores extends readonly StoreDefinition[]> {
  name: string;
  version?: number;
  versionStrategy?: VersionStrategy;
  stores: TStores;
  onBlocked?: () => void;
  onVersionChange?: () => void;
}

// ============================================================================
// Utility Types for Type Inference
// ============================================================================

/**
 * Extract store names from store definitions array
 */
export type StoreNames<TStores extends readonly StoreDefinition[]> = 
  TStores[number]['name'];

/**
 * Extract schema type for a specific store name
 */
export type SchemaForStore<
  TStores extends readonly StoreDefinition[],
  TName extends string
> = Extract<TStores[number], { name: TName }>['_schema'];

/**
 * Extract key type for a specific store name
 */
export type KeyForStore<
  TStores extends readonly StoreDefinition[],
  TName extends string
> = Extract<TStores[number], { name: TName }>['_keyType'];

// ============================================================================
// Query Types
// ============================================================================

export interface GetAllOptions<T extends IDBValidKey = IDBValidKey> {
  query?: IDBKeyRange | T;
  count?: number;
}

// ============================================================================
// Transaction Chain Types
// ============================================================================

/**
 * Read transaction chain interface
 */
export interface ReadChain<TStores extends readonly StoreDefinition[], TResults extends unknown[]> {
  get<TName extends StoreNames<TStores>>(
    storeName: TName,
    key: KeyForStore<TStores, TName>
  ): ReadChain<TStores, [...TResults, SchemaForStore<TStores, TName> | undefined]>;

  getAll<TName extends StoreNames<TStores>>(
    storeName: TName,
    options?: GetAllOptions
  ): ReadChain<TStores, [...TResults, SchemaForStore<TStores, TName>[]]>;

  getAllByIndex<TName extends StoreNames<TStores>>(
    storeName: TName,
    indexName: string,
    query?: IDBKeyRange | IDBValidKey
  ): ReadChain<TStores, [...TResults, SchemaForStore<TStores, TName>[]]>;

  count<TName extends StoreNames<TStores>>(
    storeName: TName,
    query?: IDBKeyRange | IDBValidKey
  ): ReadChain<TStores, [...TResults, number]>;

  execute(): Promise<TResults>;
}

/**
 * Write transaction chain interface
 */
export interface WriteChain<TStores extends readonly StoreDefinition[]> {
  put<TName extends StoreNames<TStores>>(
    storeName: TName,
    value: SchemaForStore<TStores, TName>,
    key?: KeyForStore<TStores, TName>
  ): WriteChain<TStores>;

  add<TName extends StoreNames<TStores>>(
    storeName: TName,
    value: SchemaForStore<TStores, TName>,
    key?: KeyForStore<TStores, TName>
  ): WriteChain<TStores>;

  delete<TName extends StoreNames<TStores>>(
    storeName: TName,
    key: KeyForStore<TStores, TName> | IDBKeyRange
  ): WriteChain<TStores>;

  clear<TName extends StoreNames<TStores>>(storeName: TName): WriteChain<TStores>;

  execute(): Promise<void>;
}

// ============================================================================
// Store Accessor Types
// ============================================================================

/**
 * Store accessor for shorthand API (db.users.get(), etc.)
 */
export interface StoreAccessor<T, K> {
  get(key: K): Promise<T | undefined>;
  getAll(options?: GetAllOptions): Promise<T[]>;
  getAllByIndex(indexName: string, query?: IDBKeyRange | IDBValidKey): Promise<T[]>;
  put(value: T, key?: K): Promise<K>;
  add(value: T, key?: K): Promise<K>;
  delete(key: K | IDBKeyRange): Promise<void>;
  clear(): Promise<void>;
  count(query?: IDBKeyRange | IDBValidKey): Promise<number>;
  raw<R>(fn: (store: IDBObjectStore) => IDBRequest<R>): Promise<R>;
}

// ============================================================================
// Database Instance Types
// ============================================================================

/**
 * Main database interface
 */
export interface Database<TStores extends readonly StoreDefinition[]> {
  readonly name: string;
  readonly version: number;
  readonly raw: IDBDatabase;

  close(): void;

  read<TNames extends StoreNames<TStores>[]>(
    storeNames: [...TNames]
  ): ReadChain<TStores, []>;

  write<TNames extends StoreNames<TStores>[]>(
    storeNames: [...TNames]
  ): WriteChain<TStores>;

  transaction<TNames extends StoreNames<TStores>[]>(
    storeNames: [...TNames],
    mode: IDBTransactionMode,
    fn: (tx: IDBTransaction) => void | Promise<void>
  ): Promise<void>;
}

/**
 * Database with store accessors as properties
 */
export type DatabaseWithStores<TStores extends readonly StoreDefinition[]> = 
  Database<TStores> & {
    [K in TStores[number]['name']]: StoreAccessor<
      SchemaForStore<TStores, K>,
      KeyForStore<TStores, K>
    >;
  };
