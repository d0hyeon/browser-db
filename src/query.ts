/**
 * Query Builder for IndexedDB
 */

import type { StoreSchema, IndexedFields, IndexFieldTypes, FieldType } from './field.js';

// ============================================================================
// Type Helpers
// ============================================================================

/**
 * Type guard to check if condition is a WhereCondition object
 */
function isWhereConditionObject(condition: unknown): condition is WhereCondition<unknown> {
  return typeof condition === 'object' && condition !== null;
}

/**
 * Extract typed value from cursor
 * Centralizes the type assertion for cursor values
 */
function getCursorValue<T>(cursor: IDBCursorWithValue): T {
  return cursor.value as T;
}

/**
 * Create typed getAll request
 * Centralizes the type assertion for getAll operations
 */
function createGetAllRequest<T>(source: IDBObjectStore | IDBIndex, range?: IDBKeyRange): IDBRequest<T[]> {
  return source.getAll(range) as IDBRequest<T[]>;
}

// ============================================================================
// Types
// ============================================================================

export type SortOrder = 'asc' | 'desc';

/** Where condition (single index only) */
export interface WhereCondition<T = unknown> {
  eq?: T;
  gt?: T;
  gte?: T;
  lt?: T;
  lte?: T;
  between?: [T, T];
  startsWith?: string;  // Always string for prefix search
}

// ============================================================================
// Type-safe Where Condition (with operator restrictions)
// ============================================================================

/**
 * Type-safe where condition based on field type
 * - startsWith is only available for string fields
 * - Range operators (gt, gte, lt, lte, between) work with all comparable types
 */
export type TypedWhereCondition<T> = T extends string
  ? {
      eq?: T;
      gt?: T;
      gte?: T;
      lt?: T;
      lte?: T;
      between?: [T, T];
      startsWith?: string;
    }
  : {
      eq?: T;
      gt?: T;
      gte?: T;
      lt?: T;
      lte?: T;
      between?: [T, T];
    };

/** Generic query options (for non-schema use) */
export interface QueryOptions {
  index?: string;
  where?: WhereCondition;
  orderBy?: SortOrder;
  limit?: number;
  offset?: number;
}

/** Type-safe query options based on schema */
export type TypedQueryOptions<S extends StoreSchema> = {
  [I in IndexedFields<S>]: {
    index: I;
    where?: TypedWhereCondition<IndexFieldTypes<S>[I]>;
    orderBy?: SortOrder;
    limit?: number;
    offset?: number;
  };
}[IndexedFields<S>] | {
  index?: undefined;
  where?: WhereCondition<unknown>;
  orderBy?: SortOrder;
  limit?: number;
  offset?: number;
};

/** Internal query state */
interface QueryState {
  indexName?: string;
  useKey: boolean;
  range?: IDBKeyRange;
  order: SortOrder;
  limitCount?: number;
  offsetCount: number;
}

// ============================================================================
// Query Builder Classes
// ============================================================================

class FinalQueryBuilderImpl<T> {
  constructor(
    private db: IDBDatabase,
    private storeName: string,
    private state: QueryState,
    private defaults: Partial<T>
  ) {}

  orderBy(order: SortOrder): FinalQueryBuilderImpl<T> {
    return new FinalQueryBuilderImpl(
      this.db,
      this.storeName,
      { ...this.state, order },
      this.defaults
    );
  }

  limit(count: number): FinalQueryBuilderImpl<T> {
    return new FinalQueryBuilderImpl(
      this.db,
      this.storeName,
      { ...this.state, limitCount: count },
      this.defaults
    );
  }

  offset(count: number): FinalQueryBuilderImpl<T> {
    return new FinalQueryBuilderImpl(
      this.db,
      this.storeName,
      { ...this.state, offsetCount: count },
      this.defaults
    );
  }

  async findAll(): Promise<T[]> {
    return this.executeQuery();
  }

  async find(): Promise<T | undefined> {
    const results = await new FinalQueryBuilderImpl<T>(
      this.db,
      this.storeName,
      { ...this.state, limitCount: 1 },
      this.defaults
    ).executeQuery();
    return results[0];
  }

  async count(): Promise<number> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      
      let request: IDBRequest<number>;
      if (this.state.indexName) {
        const index = store.index(this.state.indexName);
        request = index.count(this.state.range);
      } else {
        request = store.count(this.state.range);
      }

      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
    });
  }

  private async executeQuery(): Promise<T[]> {
    const { indexName, range, order, limitCount, offsetCount } = this.state;
    const hasDefaults = Object.keys(this.defaults).length > 0;

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(this.storeName, 'readonly');
      const store = tx.objectStore(this.storeName);
      
      // offset이나 limit이 있으면 커서 사용
      if (offsetCount > 0 || limitCount !== undefined) {
        const results: T[] = [];
        let skipped = 0;
        let collected = 0;

        const source = indexName ? store.index(indexName) : store;
        const direction: IDBCursorDirection = order === 'desc' ? 'prev' : 'next';
        const request = source.openCursor(range, direction);

        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) {
            resolve(results);
            return;
          }

          // Skip offset
          if (skipped < offsetCount) {
            skipped++;
            cursor.continue();
            return;
          }

          // Collect until limit
          if (limitCount === undefined || collected < limitCount) {
            const value = getCursorValue<T>(cursor);
            results.push(hasDefaults ? { ...this.defaults, ...value } : value);
            collected++;
          }

          // Check if we have enough
          if (limitCount !== undefined && collected >= limitCount) {
            resolve(results);
            return;
          }

          cursor.continue();
        };

        tx.onerror = () => reject(tx.error);
      } else {
        // 단순 getAll
        const source = indexName ? store.index(indexName) : store;
        const request = createGetAllRequest<T>(source, range);

        tx.oncomplete = () => {
          let results = request.result;
          
          // Apply defaults
          if (hasDefaults) {
            results = results.map(v => ({ ...this.defaults, ...v }));
          }
          
          // Apply ordering for getAll (desc needs reverse)
          if (order === 'desc') {
            results.reverse();
          }
          
          resolve(results);
        };
        tx.onerror = () => reject(tx.error);
      }
    });
  }
}

class IndexQueryBuilderImpl<T> {
  constructor(
    private db: IDBDatabase,
    private storeName: string,
    private indexName: string | undefined,
    private useKey: boolean,
    private defaults: Partial<T>
  ) {}

  private createFinal(range?: IDBKeyRange): FinalQueryBuilderImpl<T> {
    return new FinalQueryBuilderImpl(
      this.db,
      this.storeName,
      {
        indexName: this.indexName,
        useKey: this.useKey,
        range,
        order: 'asc',
        offsetCount: 0,
      },
      this.defaults
    );
  }

  equals(value: unknown): FinalQueryBuilderImpl<T> {
    return this.createFinal(IDBKeyRange.only(value));
  }

  gt(value: unknown): FinalQueryBuilderImpl<T> {
    return this.createFinal(IDBKeyRange.lowerBound(value, true));
  }

  gte(value: unknown): FinalQueryBuilderImpl<T> {
    return this.createFinal(IDBKeyRange.lowerBound(value, false));
  }

  lt(value: unknown): FinalQueryBuilderImpl<T> {
    return this.createFinal(IDBKeyRange.upperBound(value, true));
  }

  lte(value: unknown): FinalQueryBuilderImpl<T> {
    return this.createFinal(IDBKeyRange.upperBound(value, false));
  }

  between(lower: unknown, upper: unknown): FinalQueryBuilderImpl<T> {
    return this.createFinal(IDBKeyRange.bound(lower, upper));
  }

  startsWith(prefix: string): FinalQueryBuilderImpl<T> {
    return this.createFinal(IDBKeyRange.bound(prefix, prefix + '\uffff'));
  }

  // 조건 없이 바로 체이닝
  orderBy(order: SortOrder): FinalQueryBuilderImpl<T> {
    return this.createFinal().orderBy(order);
  }

  limit(count: number): FinalQueryBuilderImpl<T> {
    return this.createFinal().limit(count);
  }

  offset(count: number): FinalQueryBuilderImpl<T> {
    return this.createFinal().offset(count);
  }

  findAll(): Promise<T[]> {
    return this.createFinal().findAll();
  }

  find(): Promise<T | undefined> {
    return this.createFinal().find();
  }
}

class QueryBuilderImpl<T, K> {
  constructor(
    private db: IDBDatabase,
    private storeName: string,
    private defaults: Partial<T>
  ) {}

  index(indexName: string): IndexQueryBuilderImpl<T> {
    return new IndexQueryBuilderImpl(
      this.db,
      this.storeName,
      indexName,
      false,
      this.defaults
    );
  }

  key(): IndexQueryBuilderImpl<T> {
    return new IndexQueryBuilderImpl(
      this.db,
      this.storeName,
      undefined,
      true,
      this.defaults
    );
  }

  findAll(): Promise<T[]> {
    return new IndexQueryBuilderImpl<T>(
      this.db,
      this.storeName,
      undefined,
      false,
      this.defaults
    ).findAll();
  }

  // Direct condition methods (uses primary key by default)
  private keyBuilder(): IndexQueryBuilderImpl<T> {
    return new IndexQueryBuilderImpl(
      this.db,
      this.storeName,
      undefined,
      true,
      this.defaults
    );
  }

  equals(value: unknown): FinalQueryBuilderImpl<T> {
    return this.keyBuilder().equals(value);
  }

  gt(value: unknown): FinalQueryBuilderImpl<T> {
    return this.keyBuilder().gt(value);
  }

  gte(value: unknown): FinalQueryBuilderImpl<T> {
    return this.keyBuilder().gte(value);
  }

  lt(value: unknown): FinalQueryBuilderImpl<T> {
    return this.keyBuilder().lt(value);
  }

  lte(value: unknown): FinalQueryBuilderImpl<T> {
    return this.keyBuilder().lte(value);
  }

  between(lower: unknown, upper: unknown): FinalQueryBuilderImpl<T> {
    return this.keyBuilder().between(lower, upper);
  }

  startsWith(prefix: string): FinalQueryBuilderImpl<T> {
    return this.keyBuilder().startsWith(prefix);
  }
}

// ============================================================================
// Query Function Factory
// ============================================================================

function parseWhereCondition(condition: WhereCondition<unknown> | unknown): IDBKeyRange | undefined {
  // Primitive value = equals
  if (!isWhereConditionObject(condition)) {
    return IDBKeyRange.only(condition);
  }

  const c = condition;

  if (c.eq !== undefined) {
    return IDBKeyRange.only(c.eq);
  }
  if (c.between !== undefined) {
    return IDBKeyRange.bound(c.between[0], c.between[1]);
  }
  if (c.startsWith !== undefined) {
    return IDBKeyRange.bound(c.startsWith, c.startsWith + '\uffff');
  }
  if (c.gte !== undefined && c.lte !== undefined) {
    return IDBKeyRange.bound(c.gte, c.lte);
  }
  if (c.gt !== undefined && c.lt !== undefined) {
    return IDBKeyRange.bound(c.gt, c.lt, true, true);
  }
  if (c.gte !== undefined && c.lt !== undefined) {
    return IDBKeyRange.bound(c.gte, c.lt, false, true);
  }
  if (c.gt !== undefined && c.lte !== undefined) {
    return IDBKeyRange.bound(c.gt, c.lte, true, false);
  }
  if (c.gt !== undefined) {
    return IDBKeyRange.lowerBound(c.gt, true);
  }
  if (c.gte !== undefined) {
    return IDBKeyRange.lowerBound(c.gte, false);
  }
  if (c.lt !== undefined) {
    return IDBKeyRange.upperBound(c.lt, true);
  }
  if (c.lte !== undefined) {
    return IDBKeyRange.upperBound(c.lte, false);
  }

  return undefined;
}

export function createQueryFunction<T, K>(
  db: IDBDatabase,
  storeName: string,
  defaults: Partial<T> = {}
): {
  (options: QueryOptions): Promise<T[]>;
  (): QueryBuilderImpl<T, K>;
} {
  function query(options: QueryOptions): Promise<T[]>;
  function query(): QueryBuilderImpl<T, K>;
  function query(options?: QueryOptions): Promise<T[]> | QueryBuilderImpl<T, K> {
    // Builder 스타일
    if (!options) {
      return new QueryBuilderImpl<T, K>(db, storeName, defaults);
    }

    // Object 스타일
    const { index, where, orderBy = 'asc', limit, offset = 0 } = options;

    // where 조건에서 range 추출
    const range = where ? parseWhereCondition(where) : undefined;

    const finalBuilder = new FinalQueryBuilderImpl<T>(
      db,
      storeName,
      {
        indexName: index,
        useKey: false,
        range,
        order: orderBy,
        limitCount: limit,
        offsetCount: offset,
      },
      defaults
    );

    return finalBuilder.findAll();
  }

  return query;
}

// ============================================================================
// Type-safe interfaces (for external use)
// ============================================================================

export interface QueryBuilder<T, K> {
  /** Query by index (type-safe when used with schema) */
  index(indexName: string): IndexQueryBuilder<T>;
  /** Query by primary key */
  key(): IndexQueryBuilder<T>;
  /** Get all records */
  findAll(): Promise<T[]>;
  
  // Direct condition methods (no index, uses cursor scan)
  equals(value: unknown): FinalQueryBuilder<T>;
  gt(value: unknown): FinalQueryBuilder<T>;
  gte(value: unknown): FinalQueryBuilder<T>;
  lt(value: unknown): FinalQueryBuilder<T>;
  lte(value: unknown): FinalQueryBuilder<T>;
  between(lower: unknown, upper: unknown): FinalQueryBuilder<T>;
  startsWith(prefix: string): FinalQueryBuilder<T>;
}

/** Type-safe QueryBuilder with schema awareness */
export interface TypedQueryBuilder<T, K, S extends StoreSchema> {
  /** Query by index with autocomplete */
  index<I extends IndexedFields<S> & string>(indexName: I): TypedIndexQueryBuilder<T, S, I>;
  /** Query by primary key */
  key(): IndexQueryBuilder<T>;
  /** Get all records */
  findAll(): Promise<T[]>;
  
  // Direct condition methods (no index, uses key-based cursor scan)
  equals(value: K): FinalQueryBuilder<T>;
  gt(value: K): FinalQueryBuilder<T>;
  gte(value: K): FinalQueryBuilder<T>;
  lt(value: K): FinalQueryBuilder<T>;
  lte(value: K): FinalQueryBuilder<T>;
  between(lower: K, upper: K): FinalQueryBuilder<T>;
  startsWith(prefix: string): FinalQueryBuilder<T>;
}

export interface IndexQueryBuilder<T> {
  equals(value: unknown): FinalQueryBuilder<T>;
  gt(value: unknown): FinalQueryBuilder<T>;
  gte(value: unknown): FinalQueryBuilder<T>;
  lt(value: unknown): FinalQueryBuilder<T>;
  lte(value: unknown): FinalQueryBuilder<T>;
  between(lower: unknown, upper: unknown): FinalQueryBuilder<T>;
  startsWith(prefix: string): FinalQueryBuilder<T>;
  orderBy(order: SortOrder): FinalQueryBuilder<T>;
  limit(count: number): FinalQueryBuilder<T>;
  offset(count: number): FinalQueryBuilder<T>;
  findAll(): Promise<T[]>;
  find(): Promise<T | undefined>;
}

/** Base methods available for all index types */
interface BaseIndexQueryBuilder<T, V> {
  equals(value: V): FinalQueryBuilder<T>;
  gt(value: V): FinalQueryBuilder<T>;
  gte(value: V): FinalQueryBuilder<T>;
  lt(value: V): FinalQueryBuilder<T>;
  lte(value: V): FinalQueryBuilder<T>;
  between(lower: V, upper: V): FinalQueryBuilder<T>;
  orderBy(order: SortOrder): FinalQueryBuilder<T>;
  limit(count: number): FinalQueryBuilder<T>;
  offset(count: number): FinalQueryBuilder<T>;
  findAll(): Promise<T[]>;
  find(): Promise<T | undefined>;
}

/** String-only methods (startsWith) */
interface StringIndexQueryBuilder<T> {
  startsWith(prefix: string): FinalQueryBuilder<T>;
}

/** Type-safe IndexQueryBuilder with value type inference
 * - For string indexes: includes startsWith method
 * - For other types: startsWith method is not available
 */
export type TypedIndexQueryBuilder<T, S extends StoreSchema, I extends IndexedFields<S>> =
  BaseIndexQueryBuilder<T, IndexFieldTypes<S>[I]> &
  (IndexFieldTypes<S>[I] extends string ? StringIndexQueryBuilder<T> : {});

export interface FinalQueryBuilder<T> {
  orderBy(order: SortOrder): FinalQueryBuilder<T>;
  limit(count: number): FinalQueryBuilder<T>;
  offset(count: number): FinalQueryBuilder<T>;
  findAll(): Promise<T[]>;
  find(): Promise<T | undefined>;
  count(): Promise<number>;
}
