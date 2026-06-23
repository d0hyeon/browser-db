/**
 * Field builder for Drizzle/Zod-style schema definition
 */

// ============================================================================
// Index Options
// ============================================================================

export interface IndexOptions {
  unique?: boolean;
  multiEntry?: boolean;
}

/**
 * Primary key options - autoIncrement only available for number type
 */
export type PrimaryKeyOptions<T> = T extends number
  ? { autoIncrement?: boolean }
  : Record<string, never>;

// ============================================================================
// Field Definition Types
// ============================================================================

export type FieldKind =
  | 'string' | 'number' | 'boolean' | 'date'
  | 'object' | 'tuple' | 'enum' | 'nativeEnum' | 'array' | 'custom';

export interface FieldDef<
  T = unknown,
  Optional extends boolean = false,
  HasDefault extends boolean = false,
  IsIndexed extends boolean = false,
  AutoIncrement extends boolean = false,
  IsPrimaryKey extends boolean = false
> {
  _type: T;
  _optional: Optional;
  _hasDefault: HasDefault;
  _isIndexed: IsIndexed;
  _autoIncrement: AutoIncrement;
  _isPrimaryKey: IsPrimaryKey;
  /** 값 또는 `() => T` 팩토리 함수 */
  _default?: T | (() => T);
  _indexOptions?: IndexOptions;
  /** 런타임 필드 종류 식별자 */
  _kind: FieldKind;
  /** object 필드의 중첩 스키마 */
  _shape?: Record<string, FieldDef>;
  /** tuple 필드의 위치별 FieldDef */
  _items?: FieldDef[];
  /** enum/nativeEnum 필드의 값 목록 */
  _enumValues?: readonly (string | number)[];
  /** array 필드의 원소 FieldDef */
  _element?: FieldDef;
}

// ============================================================================
// Field Builder Interface
// ============================================================================

/**
 * Unified field builder interface
 * - autoIncrement option is only available when T extends number
 * - Uses conditional types for type-safe primaryKey options
 */
export interface FieldBuilder<
  T,
  Optional extends boolean = false,
  HasDefault extends boolean = false,
  IsIndexed extends boolean = false,
  AutoIncrement extends boolean = false,
  IsPrimaryKey extends boolean = false
> {
  _def: FieldDef<T, Optional, HasDefault, IsIndexed, AutoIncrement, IsPrimaryKey>;

  /** Mark field as optional (can be undefined) */
  optional(): FieldBuilder<T, true, HasDefault, IsIndexed, AutoIncrement, IsPrimaryKey>;

  /** Set default value or factory function */
  default(value: T | (() => T)): FieldBuilder<T, Optional, true, IsIndexed, AutoIncrement, IsPrimaryKey>;

  /** Create an index on this field */
  index(options?: IndexOptions): FieldBuilder<T, Optional, HasDefault, true, AutoIncrement, IsPrimaryKey>;

  /** Convert to array type */
  array(): FieldBuilder<T[], Optional, HasDefault, IsIndexed, false, false>;

  /**
   * Mark as primary key
   * - For number type: supports { autoIncrement: boolean } option
   * - For other types: no options allowed
   */
  primaryKey<Options extends PrimaryKeyOptions<T>>(
    options?: Options
  ): Options extends { autoIncrement: true }
    ? FieldBuilder<T, true, HasDefault, IsIndexed, true, true>
    : FieldBuilder<T, Optional, HasDefault, IsIndexed, false, true>
}

// ============================================================================
// Field Builder Implementation
// ============================================================================

/** 기본 FieldDef 객체를 생성하는 헬퍼 (각 팩토리가 _kind를 덮어씀) */
function defaultDef<T>(): FieldDef<T> {
  return {
    _type: undefined as T,
    _optional: false,
    _hasDefault: false,
    _isIndexed: false,
    _autoIncrement: false,
    _isPrimaryKey: false,
    _kind: 'custom',
  };
}

function createFieldBuilder<
  T,
  Optional extends boolean = false,
  HasDefault extends boolean = false,
  IsIndexed extends boolean = false,
  AutoIncrement extends boolean = false,
  IsPrimaryKey extends boolean = false,
>(
  def?: FieldDef<T, Optional, HasDefault, IsIndexed, AutoIncrement, IsPrimaryKey>
): FieldBuilder<T, Optional, HasDefault, IsIndexed, AutoIncrement, IsPrimaryKey> {
  const resolvedDef = (def ?? defaultDef<T>()) as FieldDef<T, Optional, HasDefault, IsIndexed, AutoIncrement, IsPrimaryKey>;

  const builder: FieldBuilder<T, Optional, HasDefault, IsIndexed, AutoIncrement, IsPrimaryKey> = {
    _def: resolvedDef,

    optional() {
      return createFieldBuilder({ ...this._def, _optional: true as true });
    },

    default(value: T | (() => T)) {
      return createFieldBuilder({ ...this._def, _hasDefault: true as true, _default: value as T });
    },

    primaryKey(options?: { autoIncrement?: boolean }): any {
      const autoIncrement = options?.autoIncrement ?? false;
      return createFieldBuilder({
        ...this._def,
        _isPrimaryKey: true as true,
        _autoIncrement: autoIncrement,
        _optional: autoIncrement ? true : this._def._optional,
      });
    },

    index(options?: IndexOptions) {
      return createFieldBuilder({ ...this._def, _isIndexed: true as true, _indexOptions: options });
    },

    array(): any {
      return createFieldBuilder<T[]>({
        ...defaultDef<T[]>(),
        _kind: 'array',
        _element: this._def as unknown as FieldDef,
      });
    },
  };

  return builder;
}

// ============================================================================
// Type Utilities
// ============================================================================

/**
 * Forces TypeScript to fully expand/resolve a type for better IDE display
 */
type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

// ============================================================================
// Infer Object Schema Type
// ============================================================================

/** FieldBuilder 기반 object/tuple 스키마 타입 */
type AnyFieldBuilder = FieldBuilder<unknown, boolean, boolean, boolean, boolean, boolean>;
type ObjectSchema = Record<string, AnyFieldBuilder>;
type TupleSchema = readonly AnyFieldBuilder[];

/** FieldBuilder에서 타입 추출 (_optional/_hasDefault 규칙 유지) */
type InferFieldBuilderType<T> = T extends FieldBuilder<infer U, infer Optional, infer HasDefault, boolean, boolean, boolean>
  ? HasDefault extends true
    ? U
    : Optional extends true
      ? U | undefined
      : U
  : never;

// Required keys: _optional=false, _hasDefault=false
type ObjectRequiredKeys<S extends ObjectSchema> = {
  [K in keyof S]: S[K] extends FieldBuilder<unknown, false, false, boolean, boolean, boolean> ? K : never;
}[keyof S];

// Optional keys
type ObjectOptionalKeys<S extends ObjectSchema> = Exclude<keyof S, ObjectRequiredKeys<S>>;

type InferObjectType<S extends ObjectSchema> = Prettify<
  { [K in ObjectRequiredKeys<S>]: InferFieldBuilderType<S[K]> } &
  { [K in ObjectOptionalKeys<S>]?: InferFieldBuilderType<S[K]> }
>;

// ============================================================================
// Infer Tuple Type
// ============================================================================

type InferTupleType<T extends TupleSchema> = {
  -readonly [K in keyof T]: T[K] extends FieldBuilder<infer U, boolean, boolean, boolean, boolean, boolean> ? U : never;
};

// ============================================================================
// Field Factory
// ============================================================================

/**
 * Field type builders for schema definition
 *
 * @example
 * ```ts
 * const usersStore = defineStore('users', {
 *   id: field.string().primaryKey(),
 *   name: field.string().index(),
 *   email: field.string().index({ unique: true }),
 *   
 *   // Array (Zod style)
 *   tags: field.string().array(),
 *   
 *   // Object with schema
 *   address: field.object({
 *     detail: field.string(),
 *     post: field.string(),
 *     zipCode: field.number().optional(),
 *   }).optional().default({ detail: '', post: '' }),
 *
 *   // Tuple
 *   coordinate: field.tuple([field.number(), field.number()]),
 *   
 *   // Enum
 *   status: field.enum(['active', 'inactive'] as const),
 *   
 *   // Native Enum
 *   role: field.nativeEnum(UserRole),
 *
 *   // Custom type
 *   metadata: field.custom<Record<string, unknown>>(),
 * });
 * ```
 */
export const field = {
  /** String field */
  string: () => createFieldBuilder<string>({ ...defaultDef<string>(), _kind: 'string' }),

  /** Number field (supports autoIncrement for primary key) */
  number: () => createFieldBuilder<number>({ ...defaultDef<number>(), _kind: 'number' }),

  /** Boolean field */
  boolean: () => createFieldBuilder<boolean>({ ...defaultDef<boolean>(), _kind: 'boolean' }),

  /** Date field */
  date: () => createFieldBuilder<Date>({ ...defaultDef<Date>(), _kind: 'date' }),

  /**
   * Custom typed field
   * @example
   * field.custom<MyType>()
   */
  custom: <T>() => createFieldBuilder<T>({ ...defaultDef<T>(), _kind: 'custom' }),

  /**
   * Object field with schema definition
   * @example
   * field.object({
   *   name: field.string(),
   *   age: field.number().optional(),
   * })
   */
  object: <S extends ObjectSchema>(shape: S): FieldBuilder<InferObjectType<S>> => {
    const _shape: Record<string, FieldDef> = {};
    for (const [k, v] of Object.entries(shape)) {
      _shape[k] = (v as AnyFieldBuilder)._def as unknown as FieldDef;
    }
    return createFieldBuilder<InferObjectType<S>>({ ...defaultDef(), _kind: 'object', _shape });
  },

  /**
   * Tuple field
   * @example
   * field.tuple([field.number(), field.number()])  // [number, number]
   */
  tuple: <const T extends TupleSchema>(items: T): FieldBuilder<InferTupleType<T>> => {
    const _items = items.map(i => (i as AnyFieldBuilder)._def as unknown as FieldDef);
    return createFieldBuilder<InferTupleType<T>>({ ...defaultDef(), _kind: 'tuple', _items });
  },

  /**
   * Enum field from string literals
   * @example
   * field.enum(['active', 'inactive', 'pending'] as const)
   */
  enum: <const T extends readonly string[]>(
    values: T
  ): FieldBuilder<T[number]> => {
    return createFieldBuilder<T[number]>({ ...defaultDef(), _kind: 'enum', _enumValues: values });
  },

  /**
   * Native TypeScript enum
   * @example
   * enum Status { Active, Inactive }
   * field.nativeEnum(Status)
   */
  nativeEnum: <T extends Record<string, string | number>>(
    enumObj: T
  ): FieldBuilder<T[keyof T]> => {
    return createFieldBuilder<T[keyof T]>({ ...defaultDef(), _kind: 'nativeEnum', _enumValues: Object.values(enumObj) });
  },
};

// ============================================================================
// Schema Type Inference
// ============================================================================

/** Schema definition type */
export type StoreSchema = Record<string, FieldBuilder<unknown, boolean, boolean, boolean, boolean, boolean>>;

/** Extract required input keys (not optional, no default, not autoIncrement) */
type RequiredInputKeys<S extends StoreSchema> = {
  [K in keyof S]: S[K] extends { _def: { _optional: false; _hasDefault: false; _autoIncrement: false } } ? K : never;
}[keyof S];

/** Extract optional input keys (optional OR has default OR autoIncrement) */
type OptionalInputKeys<S extends StoreSchema> = Exclude<keyof S, RequiredInputKeys<S>>;

/**
 * Infer input type from schema (for put/add operations)
 */
export type InferInput<S extends StoreSchema> =
  { [K in RequiredInputKeys<S>]: S[K] extends { _def: { _type: infer T } } ? T : never } &
  { [K in OptionalInputKeys<S>]?: S[K] extends { _def: { _type: infer T } } ? T : never };

/**
 * Infer output field type
 * _hasDefault does NOT affect output type: defaults are write-time injected
 * and do not guarantee presence on read (raw writes / migrated records may omit them).
 * Output type is decided solely by _autoIncrement (IDB engine always fills it)
 * and _optional (field may be absent on read).
 */
type InferOutputField<F> =
  F extends { _def: { _type: infer T; _optional: infer Optional; _autoIncrement: infer AutoInc } }
    ? AutoInc extends true
      ? T
      : Optional extends true
        ? T | undefined
        : T
    : never;

/**
 * Infer output type from schema (for get operations)
 */
export type InferOutput<S extends StoreSchema> = Prettify<{
  [K in keyof S]: InferOutputField<S[K]>;
}>;

/**
 * Extract primary key field name from schema
 */
export type PrimaryKeyField<S extends StoreSchema> = {
  [K in keyof S]: S[K] extends { _def: { _isPrimaryKey: true } } ? K : never;
}[keyof S];

/**
 * Extract primary key type from schema
 */
export type PrimaryKeyType<S extends StoreSchema> =
  S[PrimaryKeyField<S>] extends { _def: { _type: infer T } } ? T : never;

/**
 * Check if schema has autoIncrement primary key
 */
export type HasAutoIncrement<S extends StoreSchema> =
  S[PrimaryKeyField<S>] extends { _def: { _autoIncrement: true } } ? true : false;

// ============================================================================
// Index Field Extraction
// ============================================================================

/**
 * Extract field names that have indexes
 */
export type IndexedFields<S extends StoreSchema> = {
  [K in keyof S]: S[K] extends { _def: { _isIndexed: true } } ? K : never;
}[keyof S];

/**
 * Map of index field names to their types
 */
export type IndexFieldTypes<S extends StoreSchema> = {
  [K in IndexedFields<S>]: S[K] extends { _def: { _type: infer T } } ? T : never;
};

/**
 * Get field type by field name
 */
export type FieldType<S extends StoreSchema, K extends keyof S> =
  S[K] extends { _def: { _type: infer T } } ? T : never;

// ============================================================================
// Store Type Inference
// ============================================================================

/**
 * Infer data type from store definition
 * @example
 * const usersStore = defineStore('users', { ... });
 * type User = InferStore<typeof usersStore>;
 */
export type InferStore<TStore> = TStore extends { schema: infer S }
  ? S extends StoreSchema
    ? InferOutput<S>
    : never
  : never;

/**
 * Constrains a schema so that each field's _type matches the corresponding property of T.
 * Used as the schema argument type in defineStore<T>() for type-first definitions.
 *
 * @example
 * interface User { id: number; name: string; age?: number; }
 *
 * defineStore<User>('users', {
 *   id: field.number().primaryKey(),  // ✅ _type: number matches User['id']
 *   name: field.string(),             // ✅ _type: string matches User['name']
 *   age: field.number().optional(),   // ✅ _type: number matches User['age']
 *   email: field.string(),            // ❌ 'email' does not exist in User → error here
 * });
 */
/**
 * Type constraint for type-first store definitions
 * Use with `satisfies` to validate schema against a pre-defined type
 *
 * @example
 * interface User {
 *   id: string;
 *   name: string;
 *   age?: number;
 * }
 *
 * const usersStore = defineStore('users', {
 *   id: field.string().primaryKey(),
 *   name: field.string(),
 *   age: field.number().optional(),
 * }) satisfies DefinedStore<User>;
 */
export interface DefinedStore<T> {
  _output: T;
  name: string;
  schema: StoreSchema;
  keyPath: string;
  autoIncrement: boolean;
  indexes: readonly unknown[];
  migrations: readonly unknown[];
  defaults: Partial<T>;
}
