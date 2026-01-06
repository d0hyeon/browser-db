import type {
  StoreDefinition,
  StoreKeyPath,
  ExtractKeyType,
  StoreOptionsWithKeyPath,
  StoreOptionsWithoutKeyPath,
  IndexDefinition,
  IndexOption,
  Migration,
} from './types.js';

/**
 * Convert IndexConfig object to IndexDefinition array
 */
function parseIndexConfig(
  indexes: Record<string, IndexOption> | undefined
): IndexDefinition[] {
  if (!indexes) return [];

  const result: IndexDefinition[] = [];

  for (const [name, option] of Object.entries(indexes)) {
    if (option === false) continue;  // 인덱스 안 함

    if (option === true) {
      result.push({ name, keyPath: name });
    } else {
      result.push({
        name,
        keyPath: name,  // keyPath는 항상 name과 동일
        unique: option.unique,
        multiEntry: option.multiEntry,
      });
    }
  }

  return result;
}

/**
 * Define an ObjectStore with schema and configuration.
 * Uses currying to enable proper type inference for store name and key type.
 *
 * @example Basic usage with keyPath (key type auto-inferred)
 * ```ts
 * interface User {
 *   id: string;
 *   name: string;
 *   email: string;
 *   age: number;
 * }
 *
 * const usersStore = defineStore<User>()('users', {
 *   keyPath: 'id',  // Key type inferred as string from User['id']
 *   indexes: {
 *     name: false,              // 인덱스 안 함
 *     email: { unique: true },  // unique 인덱스
 *     age: true,                // 일반 인덱스
 *   },
 * });
 * ```
 *
 * @example With autoIncrement (no keyPath)
 * ```ts
 * interface Post {
 *   id?: number;
 *   title: string;
 *   authorId: string;
 * }
 *
 * const postsStore = defineStore<Post>()('posts', {
 *   autoIncrement: true,
 *   keyType: 0 as number,  // Explicit key type
 *   indexes: {
 *     id: false,
 *     title: false,
 *     authorId: true,
 *   },
 * });
 * ```
 *
 * @example With compound key
 * ```ts
 * const orderItemsStore = defineStore<OrderItem>()('orderItems', {
 *   keyPath: ['orderId', 'productId'] as const,  // Compound key
 * });
 * ```
 *
 * @example With migrations
 * ```ts
 * const usersStore = defineStore<User>()('users', {
 *   keyPath: 'id',
 *   indexes: {
 *     name: false,
 *     email: { unique: true },
 *     age: true,
 *   },
 *   migrations: [
 *     {
 *       name: '001-add-createdAt-index',
 *       up: (db, tx) => {
 *         const store = tx.objectStore('users');
 *         store.createIndex('createdAt', 'createdAt');
 *       },
 *     },
 *   ],
 * });
 * ```
 */
export function defineStore<T>() {
  /**
   * With keyPath - key type is inferred from schema
   */
  function createStore<
    const TName extends string,
    const KP extends StoreKeyPath<T>
  >(
    name: TName,
    options: StoreOptionsWithKeyPath<T, KP>
  ): StoreDefinition<T, ExtractKeyType<T, KP>, TName>;

  /**
   * Without keyPath - key type must be explicitly provided or defaults to IDBValidKey
   */
  function createStore<
    const TName extends string,
    K extends IDBValidKey = IDBValidKey
  >(
    name: TName,
    options?: StoreOptionsWithoutKeyPath<T, K>
  ): StoreDefinition<T, K, TName>;

  // Implementation
  function createStore<const TName extends string>(
    name: TName,
    options: StoreOptionsWithKeyPath<T, StoreKeyPath<T>> | StoreOptionsWithoutKeyPath<T, IDBValidKey> = {}
  ): StoreDefinition<T, unknown, TName> {
    const {
      keyPath,
      autoIncrement = false,
      indexes,
      migrations = [],
    } = options as {
      keyPath?: string | readonly string[];
      autoIncrement?: boolean;
      indexes?: Record<string, IndexOption>;
      migrations?: Migration[];
    };

    // Parse index config to IndexDefinition array
    const parsedIndexes = parseIndexConfig(indexes);

    // Validate store name
    if (!name || typeof name !== 'string') {
      throw new Error('Store name is required and must be a string');
    }

    // Validate migrations (name-based)
    const migrationNames = new Set<string>();
    for (const migration of migrations) {
      if (!migration.name || typeof migration.name !== 'string') {
        throw new Error(
          `Invalid migration name in store "${name}": must be a non-empty string`
        );
      }
      if (migrationNames.has(migration.name)) {
        throw new Error(
          `Duplicate migration name "${migration.name}" in store "${name}"`
        );
      }
      migrationNames.add(migration.name);
    }

    return {
      name,
      keyPath: keyPath as string | string[] | undefined,
      autoIncrement,
      indexes: parsedIndexes,
      migrations: [...migrations].sort((a, b) => a.name.localeCompare(b.name)),
      _schema: {} as T,
      _keyType: {} as unknown,
    };
  }

  return createStore;
}
