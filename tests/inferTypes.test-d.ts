/**
 * Type-level tests for schema inference surface (vitest typecheck mode).
 *
 * Covers everything EXCEPT InferOutput, which lives in inferOutput.test-d.ts:
 *   - field builder _type per kind (string/number/boolean/date/enum/nativeEnum/custom/array)
 *   - chain modifiers (optional/default/array) on _type and flags
 *   - InferInput (required vs optional-to-supply: optional | default | autoIncrement)
 *   - PrimaryKeyField / PrimaryKeyType / HasAutoIncrement
 *   - IndexedFields / IndexFieldTypes / FieldType
 *   - nested InferObjectType (required/optional keys) via field.object
 *   - InferTupleType via field.tuple
 *
 * expectTypeOf mismatches become compile errors reported as test failures.
 */
import { describe, it, expectTypeOf } from 'vitest';
import { defineStore } from '../src/schema.js';
import { field } from '../src/field.js';
import type {
  InferInput,
  PrimaryKeyField,
  PrimaryKeyType,
  HasAutoIncrement,
  IndexedFields,
  IndexFieldTypes,
  FieldType,
} from '../src/field.js';

// ============================================================================
// Field builder _type per kind
// ============================================================================

enum Role {
  Admin = 'admin',
  User = 'user',
}

describe('field builder _type — 종류별 기본 타입', () => {
  it('primitive 종류는 각 _type을 가진다', () => {
    expectTypeOf(field.string()._def._type).toEqualTypeOf<string>();
    expectTypeOf(field.number()._def._type).toEqualTypeOf<number>();
    expectTypeOf(field.boolean()._def._type).toEqualTypeOf<boolean>();
    expectTypeOf(field.date()._def._type).toEqualTypeOf<Date>();
  });

  it('custom은 제네릭 타입을 그대로 가진다', () => {
    expectTypeOf(field.custom<{ a: number }>()._def._type).toEqualTypeOf<{ a: number }>();
  });

  it('enum은 리터럴 유니온 타입을 가진다', () => {
    expectTypeOf(field.enum(['on', 'off'] as const)._def._type).toEqualTypeOf<'on' | 'off'>();
  });

  it('nativeEnum은 enum 값 유니온 타입을 가진다', () => {
    expectTypeOf(field.nativeEnum(Role)._def._type).toEqualTypeOf<Role>();
  });

  it('array()는 원소 배열 타입을 가진다', () => {
    expectTypeOf(field.string().array()._def._type).toEqualTypeOf<string[]>();
    expectTypeOf(field.number().array()._def._type).toEqualTypeOf<number[]>();
  });
});

// ============================================================================
// Chain modifiers — flag 타입 전이
// ============================================================================

describe('chain modifiers — flag 타입', () => {
  it('optional()은 _optional 플래그를 true로 만든다', () => {
    expectTypeOf(field.string().optional()._def._optional).toEqualTypeOf<true>();
  });

  it('default()는 _hasDefault 플래그를 true로 만든다', () => {
    expectTypeOf(field.string().default('x')._def._hasDefault).toEqualTypeOf<true>();
  });

  it('index()는 _isIndexed 플래그를 true로 만든다', () => {
    expectTypeOf(field.string().index()._def._isIndexed).toEqualTypeOf<true>();
  });

  it('primaryKey()는 _isPrimaryKey 플래그를 true로 만든다', () => {
    expectTypeOf(field.string().primaryKey()._def._isPrimaryKey).toEqualTypeOf<true>();
  });

  it('number primaryKey({ autoIncrement: true })는 _autoIncrement를 true로 만든다', () => {
    expectTypeOf(
      field.number().primaryKey({ autoIncrement: true })._def._autoIncrement
    ).toEqualTypeOf<true>();
  });
});

// ============================================================================
// InferInput — 입력 타입 (put/add)
// ============================================================================

const inputStore = defineStore('input', {
  id: field.string().primaryKey(),
  required: field.number(),
  optional: field.string().optional(),
  withDefault: field.number().default(0),
  autoInc: field.number(), // 일반 필드 (autoIncrement 아님)
});
type Input = InferInput<typeof inputStore['schema']>;

describe('InferInput — 입력 타입', () => {
  it('required 필드는 필수 키다', () => {
    expectTypeOf<Input['required']>().toEqualTypeOf<number>();
    // required 키는 undefined를 허용하지 않는다
    expectTypeOf<undefined extends Input['required'] ? true : false>().toEqualTypeOf<false>();
  });

  it('optional 필드는 입력에서 생략 가능하다', () => {
    expectTypeOf<Input>().toMatchTypeOf<{ optional?: string }>();
  });

  it('default 필드는 입력에서 생략 가능하다', () => {
    expectTypeOf<Input>().toMatchTypeOf<{ withDefault?: number }>();
  });

  it('pk(string) 필드는 입력에 필수로 존재한다', () => {
    expectTypeOf<Input['id']>().toEqualTypeOf<string>();
  });
});

describe('InferInput — autoIncrement pk는 입력 생략 가능', () => {
  const autoStore = defineStore('auto', {
    id: field.number().primaryKey({ autoIncrement: true }),
    name: field.string(),
  });
  type AutoInput = InferInput<typeof autoStore['schema']>;

  it('autoIncrement pk는 입력에서 생략 가능하다', () => {
    expectTypeOf<AutoInput>().toMatchTypeOf<{ name: string; id?: number }>();
  });
});

// ============================================================================
// PrimaryKey 추론
// ============================================================================

const pkStringStore = defineStore('pkStr', {
  id: field.string().primaryKey(),
  name: field.string(),
});
const pkNumberStore = defineStore('pkNum', {
  id: field.number().primaryKey({ autoIncrement: true }),
  name: field.string(),
});

describe('PrimaryKey 추론', () => {
  it('PrimaryKeyField는 pk 필드명을 추론한다', () => {
    expectTypeOf<PrimaryKeyField<typeof pkStringStore['schema']>>().toEqualTypeOf<'id'>();
  });

  it('PrimaryKeyType은 string pk 타입을 추론한다', () => {
    expectTypeOf<PrimaryKeyType<typeof pkStringStore['schema']>>().toEqualTypeOf<string>();
  });

  it('PrimaryKeyType은 number pk 타입을 추론한다', () => {
    expectTypeOf<PrimaryKeyType<typeof pkNumberStore['schema']>>().toEqualTypeOf<number>();
  });

  it('HasAutoIncrement는 autoIncrement pk일 때 true', () => {
    expectTypeOf<HasAutoIncrement<typeof pkNumberStore['schema']>>().toEqualTypeOf<true>();
  });

  it('HasAutoIncrement는 일반 pk일 때 false', () => {
    expectTypeOf<HasAutoIncrement<typeof pkStringStore['schema']>>().toEqualTypeOf<false>();
  });
});

// ============================================================================
// Index 추론
// ============================================================================

const indexStore = defineStore('idx', {
  id: field.string().primaryKey(),
  email: field.string().index({ unique: true }),
  age: field.number().index(),
  name: field.string(), // 인덱스 없음
});

describe('Index 추론', () => {
  it('IndexedFields는 인덱스 필드명만 추론한다', () => {
    expectTypeOf<IndexedFields<typeof indexStore['schema']>>().toEqualTypeOf<'email' | 'age'>();
  });

  it('IndexFieldTypes는 인덱스 필드의 타입 맵을 만든다', () => {
    expectTypeOf<IndexFieldTypes<typeof indexStore['schema']>>().toEqualTypeOf<{
      email: string;
      age: number;
    }>();
  });

  it('FieldType은 필드명으로 타입을 추론한다', () => {
    expectTypeOf<FieldType<typeof indexStore['schema'], 'age'>>().toEqualTypeOf<number>();
    expectTypeOf<FieldType<typeof indexStore['schema'], 'email'>>().toEqualTypeOf<string>();
  });
});

// ============================================================================
// 중첩 object 추론 (InferObjectType via field.object)
// ============================================================================

describe('중첩 object 추론', () => {
  it('object는 required/optional 키를 구분해 추론한다', () => {
    const f = field.object({
      detail: field.string(),
      zip: field.number().optional(),
    });
    expectTypeOf(f._def._type).toEqualTypeOf<{ detail: string; zip?: number }>();
  });

  it('object 중첩의 default 키는 입력 생략 가능하다 (optional 키)', () => {
    const f = field.object({
      a: field.string(),
      b: field.number().default(0),
    });
    expectTypeOf(f._def._type).toMatchTypeOf<{ a: string; b?: number }>();
  });

  it('object는 중첩될 수 있다', () => {
    const f = field.object({
      inner: field.object({ id: field.string() }),
    });
    expectTypeOf(f._def._type).toEqualTypeOf<{ inner: { id: string } }>();
  });
});

// ============================================================================
// tuple 추론 (InferTupleType via field.tuple)
// ============================================================================

describe('tuple 추론', () => {
  it('tuple은 위치별 타입을 보존한다', () => {
    const f = field.tuple([field.number(), field.string()]);
    expectTypeOf(f._def._type).toEqualTypeOf<[number, string]>();
  });

  it('tuple은 동일 타입 반복도 추론한다', () => {
    const f = field.tuple([field.number(), field.number()]);
    expectTypeOf(f._def._type).toEqualTypeOf<[number, number]>();
  });
});
