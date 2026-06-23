# Runtime Validation Resolver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** field 빌더를 단일화하고 `FieldDef`에 런타임 타입 메타를 보존해, `schema-idb/resolvers/zod` 리졸버가 get 시 데이터를 검증하고, default를 쓰기 시 주입하도록 만든다.

**Architecture:** 코어는 `FieldDef`에 `_kind`/`_shape`/`_items`/`_enumValues`/`_element` 런타임 메타를 보존만 한다(검증·Zod 의존성 없음). 검증은 `StoreResolver` 확장 지점으로 분리하고 `.use(resolver)`로 결합한다. `src/resolvers/zod/`가 `FieldDef`를 순회해 Zod 스키마를 자동 생성하고 get류에서 `parse`한다. default는 get 후처리에서 put/add 주입으로 전환한다.

**Tech Stack:** TypeScript 5.9, vitest 4, fake-indexeddb 6, IndexedDB. Zod는 `resolvers/zod`의 optional peerDependency.

## Global Constraints

- Node.js >= 18.0.0. 테스트는 `pnpm test:run` (vitest run), 빌드는 `pnpm build` (tsc + esbuild minify).
- `tsconfig`의 `rootDir: "./src"`, `include: ["src/**/*"]` — **모든 소스는 `src/` 안에 있어야 빌드된다.** 따라서 리졸버는 `src/resolvers/zod/`에 둔다 (출력: `dist/resolvers/zod/`).
- 코어(`src/**` 중 resolvers 제외)는 `zod`/`src/resolvers/**`를 **절대 import하지 않는다.** 의존성은 `resolvers/zod → core` 한 방향만.
- 타입 추론(`InferInput`/`InferOutput` 등)은 `_type`(제네릭)에 의존 — `_type`에 런타임 문자열을 넣지 않는다. 런타임 분기는 `_kind`만 사용.
- 검증 미사용자에게 zod는 설치·번들 모두 불필요해야 한다 (서브패스 export + optional peerDep).
- 기존 빌더 불변성 유지: 체인 메서드는 새 빌더를 반환하고 원본을 변경하지 않는다.

---

## File Structure

| 파일 | 책임 |
| --- | --- |
| `src/field.ts` (修) | `TypeBuilder`/`type`/`TypeDef` 폐기, `field` 단일화. `FieldDef`에 `_kind` 등 메타 추가. `object`/`tuple` 콜백→객체/배열. `default(T \| () => T)`. |
| `src/schema.ts` (修) | `SchemaStoreDefinition.resolvers`, `SchemaStoreBuilder.use()`. default 팩토리를 `defaults`에 그대로 보존(평가 안 함). |
| `src/resolver.ts` (新) | `StoreResolver` 인터페이스 — 코어 확장 지점, Zod 무관. |
| `src/storeAccessor.ts` (修) | put/add에서 default 주입, get류에서 validate 후크. get 후처리 default 제거. |
| `src/query.ts` (修) | query 결과 반환 지점에 validate 후크. get측 default 적용 제거. |
| `src/createSchemaDB.ts` (修) | resolvers를 accessor까지 전달 (defaults와 동일 경로). |
| `src/index.ts` (修) | `StoreResolver` 타입 export. |
| `src/resolvers/zod/index.ts` (新) | `zodResolver()` 팩토리. |
| `src/resolvers/zod/toZodType.ts` (新) | `FieldDef` → `ZodType` (base + modifier). |
| `src/resolvers/zod/buildZodSchema.ts` (新) | store schema → `z.object(...)`. |
| `package.json` (修) | `exports`에 `./resolvers/zod` 서브패스, `zod` optional peerDep. |

각 Task는 위 파일 중 응집된 한 묶음을 다루며 독립 테스트 가능한 산출물로 끝난다.

---

## Task 1: field 빌더 단일화 + object/tuple 객체화

`TypeBuilder`/`type`/`TypeDef`를 폐기하고 `field` 하나로 통일한다. `field.object`/`field.tuple`은 콜백 대신 객체/배열을 직접 받는다. (이 Task는 런타임 메타 보존 전 단계 — 시그니처/구조 변경만.)

**Files:**
- Modify: `src/field.ts` (25-94 `TypeBuilder`/`type` 제거, 322-340 object/tuple 시그니처)
- Test: `tests/field.test.ts`

**Interfaces:**
- Produces:
  - `field.object(shape: Record<string, FieldBuilder<...>>): FieldBuilder<InferObjectType<...>>`
  - `field.tuple(items: readonly FieldBuilder<...>[]): FieldBuilder<InferTupleType<...>>`
  - `field.string/number/boolean/date/enum/nativeEnum` 시그니처 불변.
  - `type` export 제거됨 (소비처 없음 — 콜백으로만 쓰였음).

- [ ] **Step 1: Write the failing test**

`tests/field.test.ts`에 추가:

```ts
describe('field.object - 객체 직접(콜백 없음)', () => {
  it('객체를 직접 받아 object 필드를 생성한다', () => {
    const f = field.object({
      detail: field.string(),
      zip: field.number().optional(),
    });
    expect(f._def._optional).toBe(false);
    expect(f._def._isPrimaryKey).toBe(false);
  });

  it('object는 중첩될 수 있다', () => {
    const f = field.object({
      inner: field.object({ id: field.string() }),
    });
    expect(f._def._optional).toBe(false);
  });
});

describe('field.tuple - 배열 직접(콜백 없음)', () => {
  it('배열을 직접 받아 tuple 필드를 생성한다', () => {
    const f = field.tuple([field.number(), field.number()]);
    expect(f._def._optional).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/field.test.ts -t "콜백 없음"`
Expected: FAIL — 현재 `field.object`는 함수를 기대하므로 `schema(type)` 호출에서 `schema is not a function` 또는 타입 에러.

- [ ] **Step 3: Implement — TypeBuilder 제거 및 object/tuple 객체화**

`src/field.ts`에서 `TypeDef`(25-34), `TypeBuilder`(36-51), `createTypeBuilder`(53-83), `type`(86-94), `TypeFactory`(94)를 제거한다. `InferObjectType`/`InferTupleType`/`ObjectSchema`/`TupleSchema`가 `TypeBuilder`를 참조하던 부분을 `FieldBuilder` 기반으로 교체한다:

```ts
// ObjectSchema/TupleSchema를 FieldBuilder 기반으로
type AnyFieldBuilder = FieldBuilder<unknown, boolean, boolean, boolean, boolean, boolean>;
type ObjectSchema = Record<string, AnyFieldBuilder>;
type TupleSchema = readonly AnyFieldBuilder[];

// Infer는 FieldBuilder의 _def 기반 (기존 _optional/_hasDefault 규칙 유지)
type InferFieldBuilderType<T> = T extends FieldBuilder<infer U, infer Optional, infer HasDefault, boolean, boolean, boolean>
  ? HasDefault extends true ? U : Optional extends true ? U | undefined : U
  : never;

type ObjectRequiredKeys<S extends ObjectSchema> = {
  [K in keyof S]: S[K] extends FieldBuilder<unknown, false, false, boolean, boolean, boolean> ? K : never;
}[keyof S];
type ObjectOptionalKeys<S extends ObjectSchema> = Exclude<keyof S, ObjectRequiredKeys<S>>;

type InferObjectType<S extends ObjectSchema> = Prettify<
  { [K in ObjectRequiredKeys<S>]: InferFieldBuilderType<S[K]> } &
  { [K in ObjectOptionalKeys<S>]?: InferFieldBuilderType<S[K]> }
>;

type InferTupleType<T extends TupleSchema> = {
  [K in keyof T]: T[K] extends FieldBuilder<infer U, boolean, boolean, boolean, boolean, boolean> ? U : never;
};
```

`field.object`/`field.tuple` 시그니처를 콜백→직접으로 교체:

```ts
object: <S extends ObjectSchema>(shape: S): FieldBuilder<InferObjectType<S>> => {
  return createFieldBuilder<InferObjectType<S>>();
},
tuple: <T extends TupleSchema>(items: T): FieldBuilder<InferTupleType<T>> => {
  return createFieldBuilder<InferTupleType<T>>();
},
```

(런타임 메타 `_shape`/`_items` 보존은 Task 3에서 추가. 이 Task는 시그니처/구조만.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/field.test.ts`
Expected: PASS (신규 테스트 + 기존 field 테스트 통과)

- [ ] **Step 5: Update existing callers — 콜백 형태 제거**

`tests/` 전체에서 `field.object(t => ...)` / `field.tuple(t => ...)` 호출과 `import { type }`을 객체/배열 형태로 수정한다. `playground/src/App.tsx`도 동일하게 수정한다.

Run: `grep -rn "field.object(\|field.tuple(\|{ type }\|, type }" tests/ src/example.ts playground/src/`
각 매치를 객체/배열 직접 형태로 변환.

- [ ] **Step 6: Run full type + test**

Run: `pnpm typecheck && pnpm vitest run`
Expected: PASS, 타입 에러 0.

- [ ] **Step 7: Commit**

```bash
git add src/field.ts tests/ src/example.ts playground/src/App.tsx
git commit -m "refactor: field 빌더 단일화, object/tuple 콜백→객체

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: default 값/팩토리 인터페이스

`default()`가 값 또는 팩토리 함수를 받도록 시그니처를 확장한다. 보존만 — 주입 시점 변경은 Task 5.

**Files:**
- Modify: `src/field.ts` (`default` 메서드 시그니처 141, 191-193, 251)
- Test: `tests/field.test.ts`

**Interfaces:**
- Produces: `default(value: T | (() => T)): FieldBuilder<T, Optional, true, ...>`. `_def._default`에 값 또는 함수가 그대로 저장된다.

- [ ] **Step 1: Write the failing test**

```ts
describe('field.default - 값 또는 팩토리', () => {
  it('값을 default로 보존한다', () => {
    const f = field.number().default(0);
    expect(f._def._hasDefault).toBe(true);
    expect(f._def._default).toBe(0);
  });

  it('팩토리 함수를 default로 보존한다(평가하지 않음)', () => {
    const fn = () => new Date();
    const f = field.date().default(fn);
    expect(f._def._hasDefault).toBe(true);
    expect(f._def._default).toBe(fn); // 함수 참조 그대로, 호출 안 함
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/field.test.ts -t "값 또는 팩토리"`
Expected: FAIL — 현재 `default(value: T)`는 함수 인자에서 타입 에러(또는 `_default`가 함수가 아님).

- [ ] **Step 3: Implement**

`FieldBuilder` 인터페이스(141)와 구현(191-193)의 `default` 시그니처를 변경:

```ts
// 인터페이스
default(value: T | (() => T)): FieldBuilder<T, Optional, true, IsIndexed, AutoIncrement, IsPrimaryKey>;

// 구현 (191)
default(value: T | (() => T)) {
  return createFieldBuilder({ ...this._def, _hasDefault: true as true, _default: value as T });
},
```

`FieldDef._default?: T`는 그대로 두되, 주석으로 "값 또는 `() => T` 팩토리" 명시.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/field.test.ts -t "값 또는 팩토리"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/field.ts tests/field.test.ts
git commit -m "feat: default()가 값 또는 팩토리 함수 허용

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: FieldDef에 런타임 메타(_kind 등) 보존

`FieldDef`에 `_kind`와 구조 메타를 추가하고, 팩토리가 이를 채우도록 한다. 타입 추론은 `_type`을 계속 사용 — 회귀 없음.

**Files:**
- Modify: `src/field.ts` (`FieldDef` 100-116, `createFieldBuilder` 175-182, 팩토리 301-363)
- Test: `tests/field.test.ts`

**Interfaces:**
- Produces: `FieldDef`에 다음 필드 추가 (Task 6 `toZodType`이 소비):
  - `_kind: FieldKind`
  - `_shape?: Record<string, FieldDef>` (object)
  - `_items?: FieldDef[]` (tuple)
  - `_enumValues?: readonly (string | number)[]` (enum/nativeEnum)
  - `_element?: FieldDef` (array)
  - `type FieldKind = 'string'|'number'|'boolean'|'date'|'object'|'tuple'|'enum'|'nativeEnum'|'array'|'custom'`

- [ ] **Step 1: Write the failing test**

```ts
describe('FieldDef 런타임 메타 _kind', () => {
  it('primitive는 _kind를 보존한다', () => {
    expect(field.string()._def._kind).toBe('string');
    expect(field.number()._def._kind).toBe('number');
    expect(field.boolean()._def._kind).toBe('boolean');
    expect(field.date()._def._kind).toBe('date');
  });

  it('enum은 _enumValues를 보존한다', () => {
    const f = field.enum(['active', 'inactive'] as const);
    expect(f._def._kind).toBe('enum');
    expect(f._def._enumValues).toEqual(['active', 'inactive']);
  });

  it('object는 _shape에 중첩 FieldDef를 보존한다', () => {
    const f = field.object({ id: field.string(), age: field.number() });
    expect(f._def._kind).toBe('object');
    expect(f._def._shape?.id._kind).toBe('string');
    expect(f._def._shape?.age._kind).toBe('number');
  });

  it('tuple은 _items에 위치별 FieldDef를 보존한다', () => {
    const f = field.tuple([field.number(), field.string()]);
    expect(f._def._kind).toBe('tuple');
    expect(f._def._items?.[0]._kind).toBe('number');
    expect(f._def._items?.[1]._kind).toBe('string');
  });

  it('array()는 _kind=array와 _element를 보존한다', () => {
    const f = field.string().array();
    expect(f._def._kind).toBe('array');
    expect(f._def._element?._kind).toBe('string');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/field.test.ts -t "런타임 메타"`
Expected: FAIL — `_kind`가 `undefined`.

- [ ] **Step 3: Implement — FieldDef 확장 + 기본 메타**

`FieldDef`(100-116)에 메타 필드 추가:

```ts
export type FieldKind =
  | 'string' | 'number' | 'boolean' | 'date'
  | 'object' | 'tuple' | 'enum' | 'nativeEnum' | 'array' | 'custom';

export interface FieldDef<...> {
  _type: T;
  _optional: Optional;
  _hasDefault: HasDefault;
  _isIndexed: IsIndexed;
  _autoIncrement: AutoIncrement;
  _isPrimaryKey: IsPrimaryKey;
  _default?: T;            // 값 또는 () => T 팩토리
  _indexOptions?: IndexOptions;
  _kind: FieldKind;
  _shape?: Record<string, FieldDef>;
  _items?: FieldDef[];
  _enumValues?: readonly (string | number)[];
  _element?: FieldDef;
}
```

`createFieldBuilder`의 기본 `resolvedDef`(175-182)에 `_kind`를 받도록 한다. 시그니처상 `def`가 항상 넘어오므로, 기본값 객체에는 `_kind: 'custom'`을 두고 각 팩토리가 명시적으로 덮어쓴다.

`createFieldBuilder`의 `array()`(209-211)를 메타 보존하도록 수정:

```ts
array(): any {
  return createFieldBuilder<T[]>({
    ...defaultDef<T[]>(),
    _kind: 'array',
    _element: this._def as unknown as FieldDef,
  });
},
```

- [ ] **Step 4: Implement — 팩토리가 _kind 주입**

`field` 팩토리(301-363) 각 항목이 `_kind`/구조 메타를 채우도록:

```ts
string: () => createFieldBuilder<string>({ ...defaultDef<string>(), _kind: 'string' }),
number: () => createFieldBuilder<number>({ ...defaultDef<number>(), _kind: 'number' }),
boolean: () => createFieldBuilder<boolean>({ ...defaultDef<boolean>(), _kind: 'boolean' }),
date: () => createFieldBuilder<Date>({ ...defaultDef<Date>(), _kind: 'date' }),

object: <S extends ObjectSchema>(shape: S): FieldBuilder<InferObjectType<S>> => {
  const _shape: Record<string, FieldDef> = {};
  for (const [k, v] of Object.entries(shape)) {
    _shape[k] = (v as AnyFieldBuilder)._def as unknown as FieldDef;
  }
  return createFieldBuilder<InferObjectType<S>>({ ...defaultDef(), _kind: 'object', _shape });
},
tuple: <T extends TupleSchema>(items: T): FieldBuilder<InferTupleType<T>> => {
  const _items = items.map(i => (i as AnyFieldBuilder)._def as unknown as FieldDef);
  return createFieldBuilder<InferTupleType<T>>({ ...defaultDef(), _kind: 'tuple', _items });
},
enum: <const T extends readonly string[]>(values: T): FieldBuilder<T[number]> =>
  createFieldBuilder<T[number]>({ ...defaultDef(), _kind: 'enum', _enumValues: values }),
nativeEnum: <T extends Record<string, string | number>>(enumObj: T): FieldBuilder<T[keyof T]> =>
  createFieldBuilder<T[keyof T]>({ ...defaultDef(), _kind: 'nativeEnum', _enumValues: Object.values(enumObj) }),
```

`defaultDef<T>()`는 `_type: undefined as T` 외 모든 boolean 플래그 false를 채우는 헬퍼로 추출한다(기존 175-182 객체 재사용).

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/field.test.ts`
Expected: PASS (런타임 메타 + 기존 전부)

- [ ] **Step 6: Verify type inference 회귀 없음**

Run: `pnpm typecheck && pnpm vitest run tests/defineStore.test.ts tests/crud.test.ts`
Expected: PASS — `InferInput`/`InferOutput`이 `_type` 기반 그대로 동작.

- [ ] **Step 7: Commit**

```bash
git add src/field.ts tests/field.test.ts
git commit -m "feat: FieldDef에 _kind 런타임 메타 보존

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: StoreResolver 확장 지점 + .use() 결합

코어에 `StoreResolver` 인터페이스와 `.use()` 체이닝을 추가한다. Zod는 모른다.

**Files:**
- Create: `src/resolver.ts`
- Modify: `src/schema.ts` (`SchemaStoreDefinition` 55-71, `SchemaStoreBuilder` 22-49, `createStoreBuilder` 126-156, `defineStore` 222-233)
- Modify: `src/index.ts` (export)
- Test: `tests/resolver.test.ts` (新)

**Interfaces:**
- Consumes: `SchemaStoreDefinition` (Task 1~3의 schema/field).
- Produces:
  - `interface StoreResolver { name: string; createValidator(store: SchemaStoreDefinition<any>): (record: unknown) => void }`
  - `SchemaStoreDefinition.resolvers: StoreResolver[]`
  - `SchemaStoreBuilder.use(resolver: StoreResolver): SchemaStoreBuilder<S, TName>`

- [ ] **Step 1: Write the failing test**

`tests/resolver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { defineStore } from '../src/schema.js';
import { field } from '../src/field.js';
import type { StoreResolver } from '../src/resolver.js';

describe('StoreResolver .use()', () => {
  it('use()는 resolver를 누적하고 새 빌더를 반환한다', () => {
    const calls: unknown[] = [];
    const spy: StoreResolver = {
      name: 'spy',
      createValidator: () => (r) => { calls.push(r); },
    };
    const store = defineStore('users', { id: field.string().primaryKey() }).use(spy);
    expect(store.resolvers).toHaveLength(1);
    expect(store.resolvers[0].name).toBe('spy');
  });

  it('use()는 원본을 변경하지 않는다', () => {
    const base = defineStore('users', { id: field.string().primaryKey() });
    const r: StoreResolver = { name: 'r', createValidator: () => () => {} };
    base.use(r);
    expect(base.resolvers).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/resolver.test.ts`
Expected: FAIL — `src/resolver.js` 없음, `.use` 없음, `resolvers` 없음.

- [ ] **Step 3: Create `src/resolver.ts`**

```ts
import type { StoreSchema } from './field.js';
import type { SchemaStoreDefinition } from './schema.js';

/**
 * 검증 리졸버 확장 지점. 코어는 이 추상만 알고 Zod 등 구현은 모른다.
 * createValidator는 record를 받아 검증하고, 실패 시 throw하는 함수를 만든다.
 */
export interface StoreResolver {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createValidator(store: SchemaStoreDefinition<any, string>): (record: unknown) => void;
}
```

- [ ] **Step 4: Implement — schema.ts에 resolvers/use()**

`SchemaStoreDefinition`(55-71)에 추가:
```ts
resolvers: StoreResolver[];
```
`SchemaStoreBuilder`(22-49)에 추가:
```ts
use(resolver: StoreResolver): SchemaStoreBuilder<S, TName>;
```
`createStoreBuilder`(129-153)에 `use` 구현(불변, `addMigration` 패턴):
```ts
use(resolver: StoreResolver): SchemaStoreBuilder<S, TName> {
  return createStoreBuilder({
    ...definition,
    resolvers: [...definition.resolvers, resolver],
  });
},
```
`defineStore`(222-233) `definition`에 `resolvers: []` 초기화. `schema.ts` 상단에 `import type { StoreResolver } from './resolver.js';`.

- [ ] **Step 5: Export from index.ts**

`src/index.ts`에 추가:
```ts
export type { StoreResolver } from './resolver';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run tests/resolver.test.ts && pnpm typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/resolver.ts src/schema.ts src/index.ts tests/resolver.test.ts
git commit -m "feat: StoreResolver 확장 지점과 .use() 결합

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: default 쓰기 주입 + get 후처리 제거

put/add 시 누락된 default 필드를 채워 DB에 저장한다. 팩토리는 매 쓰기 호출. get 후처리 default는 제거한다.

**Files:**
- Modify: `src/storeAccessor.ts` (`applyDefaults`/`applyDefaultsToArray` 제거, put/add 주입, get류 정리)
- Modify: `src/query.ts` (get측 default 적용 제거 — 221, 244-246)
- Modify: `src/createSchemaDB.ts` (defaults 전달은 유지하되 write용으로)
- Test: `tests/crud.test.ts`

**Interfaces:**
- Consumes: `store.defaults`(값 또는 팩토리 보존, Task 2/3).
- Produces:
  - `applyWriteDefaults<T>(value: T, defaults: Record<string, unknown>): T` — 누락 키만 채움, 함수면 호출.
  - put/add가 저장 전 `applyWriteDefaults`를 적용.
  - get/getAll/getBy/getAllBy/query는 default 후처리를 하지 않는다.

- [ ] **Step 1: Write the failing test**

`tests/crud.test.ts`에 추가:

```ts
describe('default 쓰기 주입', () => {
  it('put 시 누락된 default 값을 DB에 저장한다', async () => {
    const users = defineStore('u', {
      id: field.string().primaryKey(),
      role: field.string().default('member'),
    });
    const db = openDB({ name: 'def-write', version: 1, stores: [users] as const });
    await db.waitForReady();
    await db.u.put({ id: 'a' } as any);
    const raw = await db.u.raw(s => s.get('a'));
    expect((raw as any).role).toBe('member'); // DB에 실제 저장됨
    db.close();
  });

  it('팩토리 default는 레코드마다 호출되어 다른 값을 만든다', async () => {
    let n = 0;
    const items = defineStore('i', {
      id: field.string().primaryKey(),
      seq: field.number().default(() => ++n),
    });
    const db = openDB({ name: 'def-factory', version: 1, stores: [items] as const });
    await db.waitForReady();
    await db.i.put({ id: 'a' } as any);
    await db.i.put({ id: 'b' } as any);
    const a = await db.i.get('a');
    const b = await db.i.get('b');
    expect(a!.seq).not.toBe(b!.seq); // 1 vs 2
    db.close();
  });

  it('같은 레코드를 두 번 get해도 default 필드가 동일하다', async () => {
    const items = defineStore('i2', {
      id: field.string().primaryKey(),
      at: field.date().default(() => new Date()),
    });
    const db = openDB({ name: 'def-stable', version: 1, stores: [items] as const });
    await db.waitForReady();
    await db.i2.put({ id: 'a' } as any);
    const a1 = await db.i2.get('a');
    const a2 = await db.i2.get('a');
    expect((a1!.at as Date).getTime()).toBe((a2!.at as Date).getTime());
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/crud.test.ts -t "쓰기 주입"`
Expected: FAIL — 현재 default는 get 후처리라 DB(raw)에는 없고, get마다 새 값.

- [ ] **Step 3: Implement — storeAccessor write 주입**

`src/storeAccessor.ts`에서 `applyDefaults`/`applyDefaultsToArray`(17-36)를 제거하고 write용 헬퍼 추가:

```ts
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
```

`put`/`add`(94-104)를 주입하도록:
```ts
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
```

get류(58-92)에서 `hasDefaults ? applyDefaults(...) : result` 분기를 제거하고 `result`를 그대로 반환. `hasDefaults` 변수 제거. `defaults`는 `applyWriteDefaults`가 계속 사용하므로 시그니처 유지.

- [ ] **Step 4: Implement — query.ts default 후처리 제거**

`src/query.ts`에서 `hasDefaults` 적용 두 곳 제거:
- 221: `results.push(hasDefaults ? { ...this.defaults, ...value } : value);` → `results.push(value);`
- 244-246: `if (hasDefaults) { results = results.map(...) }` 블록 제거.
- 188 `const hasDefaults = ...` 제거. (query는 읽기이므로 default 미적용)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/crud.test.ts tests/query.test.ts`
Expected: PASS. 기존 default 관련 테스트가 get 후처리를 기대했다면 쓰기 주입 기준으로 수정한다.

- [ ] **Step 6: Run full suite**

Run: `pnpm typecheck && pnpm vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/storeAccessor.ts src/query.ts tests/crud.test.ts tests/query.test.ts
git commit -m "feat: default를 쓰기(put/add) 시 주입, get 후처리 제거

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: resolvers/zod — toZodType 변환기

`FieldDef`를 Zod 타입으로 변환한다. base(`_kind`) + modifier(`_optional`)를 한 함수에서 처리한다.

**Files:**
- Create: `src/resolvers/zod/toZodType.ts`
- Create: `src/resolvers/zod/buildZodSchema.ts`
- Test: `tests/resolvers-zod.test.ts` (新)

**Interfaces:**
- Consumes: `FieldDef`의 `_kind`/`_shape`/`_items`/`_enumValues`/`_element`/`_optional` (Task 3).
- Produces:
  - `toZodType(def: FieldDef): ZodTypeAny`
  - `buildZodSchema(schema: StoreSchema): ZodObject<...>` — store 전체를 `z.object`로.

- [ ] **Step 1: Write the failing test**

`tests/resolvers-zod.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { field } from '../src/field.js';
import { buildZodSchema } from '../src/resolvers/zod/buildZodSchema.js';

describe('buildZodSchema', () => {
  it('primitive를 검증한다', () => {
    const s = buildZodSchema({ id: field.string(), age: field.number() } as any);
    expect(() => s.parse({ id: 'a', age: 1 })).not.toThrow();
    expect(() => s.parse({ id: 'a', age: 'x' })).toThrow();
  });

  it('optional 필드는 누락을 허용한다', () => {
    const s = buildZodSchema({ id: field.string(), age: field.number().optional() } as any);
    expect(() => s.parse({ id: 'a' })).not.toThrow();
  });

  it('default 필드는 필수로 취급한다(누락 시 throw)', () => {
    const s = buildZodSchema({ id: field.string(), role: field.string().default('x') } as any);
    expect(() => s.parse({ id: 'a' })).toThrow();
    expect(() => s.parse({ id: 'a', role: 'x' })).not.toThrow();
  });

  it('enum 허용값을 검증한다', () => {
    const s = buildZodSchema({ st: field.enum(['on', 'off'] as const) } as any);
    expect(() => s.parse({ st: 'on' })).not.toThrow();
    expect(() => s.parse({ st: 'mid' })).toThrow();
  });

  it('중첩 object/array를 검증한다', () => {
    const s = buildZodSchema({
      addr: field.object({ zip: field.number() }),
      tags: field.string().array(),
    } as any);
    expect(() => s.parse({ addr: { zip: 1 }, tags: ['a'] })).not.toThrow();
    expect(() => s.parse({ addr: { zip: 'x' }, tags: ['a'] })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/resolvers-zod.test.ts`
Expected: FAIL — `buildZodSchema` 없음.

- [ ] **Step 3: Create `src/resolvers/zod/toZodType.ts`**

```ts
import { z, type ZodTypeAny } from 'zod';
import type { FieldDef } from '../../field.js';

function baseFromKind(def: FieldDef): ZodTypeAny {
  switch (def._kind) {
    case 'string': return z.string();
    case 'number': return z.number();
    case 'boolean': return z.boolean();
    case 'date': return z.date();
    case 'enum':
    case 'nativeEnum':
      return z.enum((def._enumValues ?? []) as [string, ...string[]]);
    case 'object': {
      const shape: Record<string, ZodTypeAny> = {};
      for (const [k, v] of Object.entries(def._shape ?? {})) {
        shape[k] = toZodType(v);
      }
      return z.object(shape);
    }
    case 'tuple':
      return z.tuple((def._items ?? []).map(toZodType) as [ZodTypeAny, ...ZodTypeAny[]]);
    case 'array':
      return z.array(def._element ? toZodType(def._element) : z.any());
    case 'custom':
    default:
      return z.any();
  }
}

export function toZodType(def: FieldDef): ZodTypeAny {
  let schema = baseFromKind(def);
  if (def._optional) schema = schema.optional();
  // _hasDefault는 쓰기 주입되므로 필수 — .optional() 붙이지 않음
  return schema;
}
```

- [ ] **Step 4: Create `src/resolvers/zod/buildZodSchema.ts`**

```ts
import { z, type ZodObject, type ZodRawShape } from 'zod';
import type { StoreSchema } from '../../field.js';
import { toZodType } from './toZodType.js';

export function buildZodSchema(schema: StoreSchema): ZodObject<ZodRawShape> {
  const shape: ZodRawShape = {};
  for (const [name, builder] of Object.entries(schema)) {
    shape[name] = toZodType((builder as { _def: FieldDef })._def);
  }
  return z.object(shape);
}
```

(`FieldDef` import는 `buildZodSchema.ts` 상단에 type-only로 추가.)

- [ ] **Step 5: Install zod (dev) for tests**

Run: `pnpm add -D zod`
(테스트 실행에 필요. 배포 시엔 optional peerDep — Task 7.)

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run tests/resolvers-zod.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/resolvers/zod/toZodType.ts src/resolvers/zod/buildZodSchema.ts tests/resolvers-zod.test.ts package.json pnpm-lock.yaml
git commit -m "feat: resolvers/zod FieldDef→Zod 변환기

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: zodResolver() 팩토리 + 검증 결선 + 번들 설정

`zodResolver()`를 완성하고, resolver의 validator가 get류에서 실행되도록 결선한다. 서브패스 export와 optional peerDep을 설정한다.

**Files:**
- Create: `src/resolvers/zod/index.ts`
- Modify: `src/storeAccessor.ts` (validators 받아 get류에서 실행)
- Modify: `src/query.ts` (validators 받아 결과 검증)
- Modify: `src/createSchemaDB.ts` (resolvers→validators 생성, accessor 전달)
- Modify: `package.json` (exports 서브패스, peerDep)
- Test: `tests/resolver-integration.test.ts` (新)

**Interfaces:**
- Consumes: `StoreResolver`(Task 4), `buildZodSchema`(Task 6), `store.resolvers`(Task 4).
- Produces:
  - `zodResolver(): StoreResolver` (`name: 'zod'`)
  - `createStoreAccessor(db, name, defaults, validate?)` — `validate?: (record: unknown) => void` 추가 인자.
  - get/getAll/getBy/getAllBy/query 결과 반환 전 `validate` 실행.

- [ ] **Step 1: Write the failing test**

`tests/resolver-integration.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { defineStore, openDB, field } from '../src/index.js';
import { zodResolver } from '../src/resolvers/zod/index.js';

describe('zodResolver get 검증', () => {
  it('정상 데이터는 통과한다', async () => {
    const users = defineStore('u', {
      id: field.string().primaryKey(),
      age: field.number(),
    }).use(zodResolver());
    const db = openDB({ name: 'rz-ok', version: 1, stores: [users] as const });
    await db.waitForReady();
    await db.u.put({ id: 'a', age: 1 });
    await expect(db.u.get('a')).resolves.toMatchObject({ id: 'a', age: 1 });
    db.close();
  });

  it('스키마 불일치(마이그레이션 누락) 데이터를 get하면 throw한다', async () => {
    const users = defineStore('u', {
      id: field.string().primaryKey(),
      age: field.number(),
    }).use(zodResolver());
    const db = openDB({ name: 'rz-bad', version: 1, stores: [users] as const });
    await db.waitForReady();
    // age 누락된 구버전 레코드를 raw로 강제 삽입
    await db.u.raw(s => s.put({ id: 'a' }));
    await expect(db.u.get('a')).rejects.toThrow();
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/resolver-integration.test.ts`
Expected: FAIL — `zodResolver` 없음, 검증 결선 없음.

- [ ] **Step 3: Create `src/resolvers/zod/index.ts`**

```ts
import type { StoreResolver } from '../../resolver.js';
import { buildZodSchema } from './buildZodSchema.js';

export function zodResolver(): StoreResolver {
  return {
    name: 'zod',
    createValidator(store) {
      const schema = buildZodSchema(store.schema);
      return (record: unknown) => { schema.parse(record); };
    },
  };
}
```

- [ ] **Step 4: Implement — storeAccessor validate 결선**

`createStoreAccessor`(49-53)에 `validate?` 인자 추가:
```ts
export function createStoreAccessor<T, K extends IDBValidKey>(
  db: IDBDatabase,
  storeName: string,
  defaults: Partial<T> = {},
  validate?: (record: unknown) => void,
): StoreAccessorWithQuery<T, K> {
```
get/getBy(단건)는 반환 전 `if (validate && result !== undefined) validate(result);`. getAll/getAllBy(배열)는 `if (validate) result.forEach(validate);`. `queryFn`에도 `validate`를 넘긴다(다음 스텝).

- [ ] **Step 5: Implement — query validate 결선**

`createQueryFunction`/`QueryBuilderImpl`(query.ts 124, 267, 339, 464)에 `validate?` 전달. `executeQuery`의 두 반환 지점(207 resolve(results), 253 resolve(results)) 직전에 `if (validate) results.forEach(validate);`. 단건 `find`도 동일.

- [ ] **Step 6: Implement — createSchemaDB resolvers→validate**

`createSchemaDB.ts`에서 store별로 resolver들을 합성한 validate를 만들어 accessor에 전달:
```ts
// store 단위 1회 생성
function buildValidate(store: AnySchemaStore): ((r: unknown) => void) | undefined {
  if (!store.resolvers?.length) return undefined;
  const validators = store.resolvers.map(r => r.createValidator(store));
  return (record) => { for (const v of validators) v(record); };
}
```
`createLazyStoreAccessor`(144)와 `createLazyQueryBuilder`(190)에 `validate`를 추가 인자로 흘려, `createStoreAccessor(state.idb, storeName, defaults, validate)`로 전달. `buildSchemaDatabase`(273-280)에서 `store`별 `buildValidate(store)`를 한 번 계산해 넘긴다.

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm vitest run tests/resolver-integration.test.ts`
Expected: PASS (정상 통과 + 누락 데이터 throw)

- [ ] **Step 8: package.json — 서브패스 + optional peerDep**

```jsonc
{
  "exports": {
    ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" },
    "./resolvers/zod": {
      "types": "./dist/resolvers/zod/index.d.ts",
      "import": "./dist/resolvers/zod/index.js"
    }
  },
  "peerDependencies": { "zod": "^3.0.0 || ^4.0.0" },
  "peerDependenciesMeta": { "zod": { "optional": true } }
}
```
`tsconfig`는 `include: ["src/**/*"]`라 `src/resolvers/**`가 자동 포함되어 `dist/resolvers/zod/`로 출력됨 — 추가 설정 불필요. (확인만)

- [ ] **Step 9: Build + 코어 독립성 검증**

Run: `pnpm build`
Expected: `dist/resolvers/zod/index.js` 생성. 빌드 성공.

Run: `grep -rn "resolvers/zod\|from 'zod'\|from \"zod\"" src/ --include="*.ts" | grep -v "src/resolvers/"`
Expected: 출력 없음 (코어가 zod/resolver를 import하지 않음 — 번들 분리 보장).

- [ ] **Step 10: Commit**

```bash
git add src/resolvers/zod/index.ts src/storeAccessor.ts src/query.ts src/createSchemaDB.ts package.json tests/resolver-integration.test.ts
git commit -m "feat: zodResolver get 검증 결선 + 번들 분리 설정

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: 문서 경로 보정 + 전체 검증

설계 문서의 `resolvers/zod`(루트) 경로를 `src/resolvers/zod`로 보정하고, README/예제에 신규 API를 반영한다. 전체 스위트로 마무리.

**Files:**
- Modify: `docs/superpowers/specs/2026-06-22-runtime-validation-plugin-design.md` (디렉토리 경로)
- Modify: `src/example.ts` (신규 API 예시)
- Test: 전체

**Interfaces:**
- Consumes: 전 Task 산출물.
- Produces: 없음(문서/검증).

- [ ] **Step 1: 설계 문서 경로 보정**

스펙 §8 파일구조의 `resolvers/`(루트)를 `src/resolvers/`로 수정하고, "별도 패키지 불필요 + `rootDir` 제약상 `src/` 내부" 한 줄을 §7.3에 추가한다.

- [ ] **Step 2: example.ts 갱신**

`src/example.ts`에 `.use(zodResolver())`와 `default(() => new Date())` 예시를 추가(주석 포함). 콜백 object/tuple 잔재가 있으면 객체/배열로 수정.

- [ ] **Step 3: 전체 타입체크 + 테스트**

Run: `pnpm typecheck && pnpm vitest run`
Expected: 전부 PASS.

- [ ] **Step 4: 빌드 + 산출물 확인**

Run: `pnpm build && ls dist/resolvers/zod/`
Expected: `index.js`, `toZodType.js`, `buildZodSchema.js` 존재.

- [ ] **Step 5: Commit**

```bash
git add docs/ src/example.ts
git commit -m "docs: resolver 경로 보정 및 예제 갱신

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **Spec coverage**: §4 빌더 단일화→Task 1, §4.1 _kind→Task 3, §5 .use()→Task 4, §6 get 검증→Task 7, §7.1 toZodType+modifier→Task 6, §7.3 번들 분리→Task 7 Step 8-9, §11 default→Task 2+5. 전 항목 매핑됨.
- **Type consistency**: `StoreResolver.createValidator` 반환 `(record: unknown) => void`가 Task 4→6→7에서 일관. `buildZodSchema`/`toZodType` 시그니처 Task 6 정의→Task 7 소비 일치. `applyWriteDefaults` Task 5 정의·사용 일치.
- **알려진 조정**: 스펙의 `resolvers/zod`(루트) → 실제 `src/resolvers/zod`(`rootDir` 제약). Task 8에서 문서 보정.
- **위험**: query.ts 반환 경로 2곳(cursor 207 / getAll 253) + find 단건 — Task 7 Step 5에서 모두 후크. 누락 시 일부 query만 미검증되므로 통합 테스트에 query 케이스 추가 권장.
