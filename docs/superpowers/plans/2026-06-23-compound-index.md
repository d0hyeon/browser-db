# Compound Index & Compound Where Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 여러 필드를 묶는 복합 인덱스를 스토어 레벨에서 선언하고, 그 인덱스로 **eq 전용** 복합 조회(완전일치)와 다중 필드 정렬을 타입 안전하게 지원한다.

**Architecture:** 단일 인덱스(필드 결합형 `field.x().index()`)는 그대로 둔다. 복합 인덱스는 `defineStore`의 빌더 체인에 `.compoundIndex(name, keys)`를 추가해 **스토어 레벨**에서 선언한다(필드의 관심사가 아니라 스토어의 관심사). 런타임은 IndexedDB의 `createIndex(name, [k1,k2])`와 `index.get([v1,v2])`에 그대로 매핑되며, 코어의 `IndexDefinition.keyPath`가 이미 `string | string[]`라 토대가 깔려 있다. where는 **모든 키가 등호(eq)인 경우만** 허용하고(객체→배열 변환), 범위 조건은 의도적으로 제공하지 않는다.

**Tech Stack:** TypeScript 5.9, vitest 4 (typecheck 모드 활성화됨), fake-indexeddb 6, IndexedDB.

## Global Constraints

- Node >= 18. 테스트: `pnpm test:run` (vitest run — 런타임 + `.test-d.ts` 타입 테스트 둘 다 실행). 타입체크: `pnpm typecheck`. 빌드: `pnpm build`.
- `tsconfig` `rootDir: "./src"`, `include: ["src/**/*"]` — 모든 소스는 `src/` 안.
- **단일 인덱스 API(`field.x().index()`)는 절대 변경하지 않는다.** 복합은 순수 추가(additive)다.
- **복합 where는 eq(완전일치) 전용.** 범위(gt/gte/lt/lte/between/startsWith)는 복합 인덱스에 제공하지 않는다 — IndexedDB의 배열 키 정렬 제약(앞 필드 eq + 마지막만 범위)이 API 표면에 새는 것을 막기 위함. 이 제약은 설계 결론이며 "편의를 위해" 완화하지 말 것.
- 타입 추론(`InferInput`/`InferOutput`/인덱스 타입)은 기존 `_type` 기반 규칙을 따른다. 복합 키 타입은 keyPath 배열을 각 필드의 `_type` 튜플/객체로 매핑한다.
- 빌더 불변성: `.compoundIndex()`는 새 빌더를 반환하고 원본을 변경하지 않는다 (`addMigration`/`use` 패턴).
- 코드 스타일은 주변과 일치(한국어 doc 주석 유지).

---

## 초안 결정 사항 (DRAFT DECISIONS — 사용자 부재 중 합의된 결론 기반으로 정함, 뒤집기 쉬움)

아래는 자리 비운 동안 진행을 막지 않으려고 **내가 추천안으로 못박은 결정**들이다. 각 항목은 격리되어 있어 나중에 한 곳만 바꾸면 된다. 구현 시 이 표를 먼저 확인하고, 사용자가 다른 의견을 주면 해당 Task만 조정한다.

| # | 결정 항목 | 초안 결정 | 근거 / 대안 |
| --- | --- | --- | --- |
| D1 | 복합 인덱스 선언 위치 | **스토어 레벨 빌더 체인** `.compoundIndex(name, keys)` | 대화 결론: 복합은 필드가 아니라 스토어의 관심사. `addMigration`/`use`와 같은 체인 패턴 재사용. 대안: `defineStore` 3번째 인자 옵션 객체 — 체인이 기존 패턴과 일관되어 우선. |
| D2 | 메서드 이름 | **`compoundIndex`** | 명시적이고 단일 `index()`와 혼동 없음. 대안: `index(name, [...])` 오버로드(단일과 충돌 위험), `addIndex`(addMigration과 결은 맞지만 단일 index와 비대칭). |
| D3 | keys 인자 형태 | **필드명 배열** `['city', 'age']` (`as const` 불필요하게) | `<const K extends ...>` 제네릭으로 위치 보존(tuple 버그 교훈). 대안: 객체 `{ city: 'asc' }` — 정렬 방향까지 담을 수 있으나 YAGNI(방향은 query에서 orderBy로 충분). |
| D4 | 복합 조회 메서드 | 기존 **`getBy`/`getAllBy`를 복합 인덱스 이름으로 확장** | 새 메서드 안 만들고 인덱스 이름으로 분기. 복합 인덱스면 query 인자가 객체. 대안: 별도 `getByCompound` — API 표면 늘어 비추천. |
| D5 | 복합 where 키 입력 형태 | **객체** `{ city: 'Seoul', age: 30 }` (전 키 eq) | 위치 기억 불필요, 가독성 좋음. 런타임에서 keyPath 순서대로 배열로 변환. 대안: 배열 `['Seoul', 30]` — 순서 의존적이라 객체가 우선. |
| D6 | 복합 where 연산자 | **eq 전용** (객체의 각 값이 곧 등호) | Global Constraint. 범위는 미제공. 부분 키(prefix) 조회도 **이번 범위 제외**(YAGNI; 필요 시 후속). |
| D7 | query 빌더 복합 지원 | **`query({ index: 'city_age', where: { city, age } })` 객체 스타일만** | 빌더 체인(`.index().equals()`)은 단일 값 전제라 복합엔 객체 스타일이 자연스러움. 빌더 체인 복합 지원은 이번 범위 제외. 대안: `.compound()` 체인 — 복잡도 대비 YAGNI. |
| D8 | 정렬 | 복합 인덱스로 `query({ index, orderBy })` 시 **키 순서대로 정렬** (부산물) | IndexedDB가 복합 키를 사전식 정렬하므로 자동. where 없이 정렬만도 허용. |
| D9 | 중복 인덱스 이름 검증 | 단일 인덱스와 **이름 공간 공유**, 중복 시 throw | 한 스토어에 같은 이름의 인덱스 둘 금지. parseSchema 검증에 합류. |

---

## File Structure

| 파일 | 책임 | 변경 |
| --- | --- | --- |
| `src/schema.ts` | `SchemaStoreBuilder.compoundIndex()`, `SchemaStoreDefinition.compoundIndexes`, parseSchema 병합·검증 | 修 |
| `src/field.ts` | 복합 인덱스 타입 추론: `CompoundIndexKeyObject`, 복합 인덱스 이름→키 매핑 타입 | 修 |
| `src/types.ts` | (필요 시) 복합 인덱스 정의 타입. 기존 `IndexDefinition.keyPath: string|string[]` 재사용 가능 | 修 가능 |
| `src/createSchemaDB.ts` | `SchemaStoreAccessor.getBy/getAllBy`가 복합 인덱스 이름일 때 객체 키 받도록 오버로드, `query` 옵션 타입 확장, upgrade 시 복합 인덱스 createIndex | 修 |
| `src/storeAccessor.ts` | 복합 키 객체→배열 변환 후 `index.get/getAll` | 修 |
| `src/query.ts` | `TypedQueryOptions`가 복합 인덱스 이름 + 객체 where 허용, executeQuery에서 복합 키 변환 | 修 |
| `tests/compoundIndex.test.ts` | 런타임 동작 (선언/조회/정렬/검증) | 新 |
| `tests/compoundIndex.test-d.ts` | 타입 추론 (복합 키 객체 타입, 잘못된 키 거부) | 新 |
| `docs/.../README` | 복합 인덱스 섹션 + Limitations 갱신(복합 where는 eq 전용) | 修 (Task 8) |

---

## Task 1: `.compoundIndex()` 빌더 + 정의 보존 (런타임 선언만)

스토어 빌더에 `.compoundIndex(name, keys)`를 추가하고, 정의를 `SchemaStoreDefinition`에 보존한다. 이 Task는 **선언/보존만** — 조회·타입추론은 후속.

**Files:**
- Modify: `src/schema.ts` (`SchemaStoreBuilder`, `SchemaStoreDefinition`, `createStoreBuilder`, `defineStore`, `parseSchema`)
- Test: `tests/compoundIndex.test.ts`

**Interfaces:**
- Produces:
  - `SchemaStoreDefinition.compoundIndexes: CompoundIndexDef[]` where `interface CompoundIndexDef { name: string; keyPath: string[]; unique?: boolean }`
  - `SchemaStoreBuilder.compoundIndex<const K extends readonly (keyof S & string)[]>(name: string, keys: K, options?: { unique?: boolean }): SchemaStoreBuilder<S, TName>`

- [ ] **Step 1: Write the failing test**

`tests/compoundIndex.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { defineStore } from '../src/schema.js';
import { field } from '../src/field.js';

describe('compoundIndex 선언', () => {
  it('compoundIndex는 정의를 누적하고 새 빌더를 반환한다', () => {
    const store = defineStore('users', {
      id: field.string().primaryKey(),
      city: field.string(),
      age: field.number(),
    }).compoundIndex('city_age', ['city', 'age']);

    expect(store.compoundIndexes).toHaveLength(1);
    expect(store.compoundIndexes[0]).toEqual({ name: 'city_age', keyPath: ['city', 'age'] });
  });

  it('compoundIndex는 원본을 변경하지 않는다', () => {
    const base = defineStore('users', {
      id: field.string().primaryKey(),
      city: field.string(),
    });
    base.compoundIndex('c', ['city']);
    expect(base.compoundIndexes).toHaveLength(0);
  });

  it('unique 옵션을 보존한다', () => {
    const store = defineStore('u', {
      id: field.string().primaryKey(),
      a: field.string(),
      b: field.string(),
    }).compoundIndex('a_b', ['a', 'b'], { unique: true });
    expect(store.compoundIndexes[0].unique).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/compoundIndex.test.ts`
Expected: FAIL — `compoundIndex` 메서드 없음, `compoundIndexes` 없음.

- [ ] **Step 3: Add `CompoundIndexDef` type and definition field**

`src/schema.ts` 상단(또는 `src/types.ts`)에:
```ts
export interface CompoundIndexDef {
  name: string;
  keyPath: string[];
  unique?: boolean;
}
```
`SchemaStoreDefinition`에 추가:
```ts
compoundIndexes: CompoundIndexDef[];
```

- [ ] **Step 4: Add `compoundIndex` to builder interface + impl**

`SchemaStoreBuilder`에:
```ts
/** 복합 인덱스를 스토어 레벨에서 선언한다. 불변 — 새 빌더 반환. */
compoundIndex<const K extends readonly (keyof S & string)[]>(
  name: string,
  keys: K,
  options?: { unique?: boolean }
): SchemaStoreBuilder<S, TName>;
```
`createStoreBuilder`에 구현 (불변, `addMigration` 패턴):
```ts
compoundIndex(name, keys, options) {
  // 중복 이름 검증 (단일 인덱스 + 기존 복합 인덱스와 공유 네임스페이스)
  const existing = new Set([
    ...definition.indexes.map(i => i.name),
    ...definition.compoundIndexes.map(c => c.name),
  ]);
  if (existing.has(name)) {
    throw new Error(`Duplicate index name "${name}" in store "${definition.name}"`);
  }
  return createStoreBuilder({
    ...definition,
    compoundIndexes: [
      ...definition.compoundIndexes,
      { name, keyPath: [...keys], unique: options?.unique },
    ],
  });
},
```
`defineStore`의 `definition` 객체에 `compoundIndexes: []` 초기화.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/compoundIndex.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/schema.ts src/types.ts tests/compoundIndex.test.ts
git commit -m "feat: compoundIndex 스토어 레벨 선언 빌더

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: 데이터베이스 업그레이드 시 복합 인덱스 생성

`openDB`/스키마 업그레이드 경로에서 복합 인덱스를 실제 `createIndex(name, [k1,k2])`로 만든다.

**Files:**
- Modify: `src/createSchemaDB.ts` (`handleUpgrade`의 store 생성 루프 ~line 372-390)
- Test: `tests/compoundIndex.test.ts`

**Interfaces:**
- Consumes: `store.compoundIndexes` (Task 1).
- Produces: 데이터베이스에 복합 인덱스 물리 생성. `db.raw`로 `objectStore.indexNames`에 이름 존재 확인 가능.

- [ ] **Step 1: Write the failing test**

`tests/compoundIndex.test.ts`에 추가:
```ts
import { openDB } from '../src/createSchemaDB.js';

describe('compoundIndex 물리 생성', () => {
  it('openDB 시 복합 인덱스가 생성된다', async () => {
    const users = defineStore('users', {
      id: field.string().primaryKey(),
      city: field.string(),
      age: field.number(),
    }).compoundIndex('city_age', ['city', 'age']);

    const db = openDB({ name: 'ci-create', version: 1, stores: [users] as const });
    await db.waitForReady();

    const tx = db.raw.transaction('users', 'readonly');
    const idx = tx.objectStore('users').index('city_age');
    expect(Array.from(idx.keyPath as DOMStringList)).toEqual(['city', 'age']);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/compoundIndex.test.ts -t "물리 생성"`
Expected: FAIL — `index('city_age')`가 없어 throw.

- [ ] **Step 3: Create compound indexes during upgrade**

`src/createSchemaDB.ts` `handleUpgrade`의 fresh-store 생성 루프(각 `store`에 대해 `db.createObjectStore` 후 단일 인덱스 생성하는 곳)에 복합 인덱스 생성 추가:
```ts
for (const ci of store.compoundIndexes ?? []) {
  objectStore.createIndex(ci.name, ci.keyPath, {
    unique: ci.unique ?? false,
    // 복합 인덱스는 multiEntry 불가 (IndexedDB 제약: 배열 keyPath + multiEntry는 에러)
  });
}
```
NOTE: `auto` versionStrategy의 schema-diff 경로(`schemaDetection.ts`)는 이번 범위에서 **신규 store 생성 시 복합 인덱스 생성만** 보장한다. 기존 store에 복합 인덱스를 나중에 추가하는 auto-migration은 후속 작업으로 두고, 이 Task의 테스트는 fresh DB(version 1)만 검증한다. (스코프 경계를 테스트 주석에 명시.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/compoundIndex.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/createSchemaDB.ts tests/compoundIndex.test.ts
git commit -m "feat: 업그레이드 시 복합 인덱스 createIndex

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: 복합 키 타입 추론 (CompoundIndexKeyObject)

복합 인덱스 이름으로부터 "키 객체 타입"을 추론한다. `'city_age'` → `{ city: string; age: number }`.

**Files:**
- Modify: `src/field.ts` (또는 `src/schema.ts`의 타입 영역) — 복합 인덱스 타입 유틸
- Test: `tests/compoundIndex.test-d.ts`

**Interfaces:**
- Consumes: `SchemaStoreDefinition.compoundIndexes`, `StoreSchema`, 필드 `_type`.
- Produces (정확한 이름/시그니처 — 후속 Task가 사용):
  - `CompoundIndexNames<CI>` — 복합 인덱스 이름 유니온 = `CI[number]['name']`.
  - `CompoundKeyPathOf<CI, N>` — 인덱스 이름 N의 keyPath = `Extract<CI[number], { name: N }>['keyPath']`.
  - `CompoundIndexKeyObject<S, KP extends readonly string[]>` — `{ [K in KP[number]]: FieldType<S, K & keyof S> }`.
  - 설계 노트: `compoundIndexes`가 런타임 배열이라 타입에서 이름→keyPath 매핑을 얻으려면 `defineStore`/builder가 `compoundIndexes`를 **타입 레벨에서도 보존**해야 한다. 즉 `SchemaStoreBuilder`/`SchemaStoreDefinition`에 phantom generic `CI extends readonly CompoundIndexDef[]`를 추가해 `.compoundIndex()` 호출마다 누적된 리터럴 타입을 전파한다. (Task 1의 빌더를 제네릭 `CI`로 확장 — 아래 Step에서 처리.)

- [ ] **Step 1: Write the failing type test**

`tests/compoundIndex.test-d.ts`:
```ts
import { describe, it, expectTypeOf } from 'vitest';
import { defineStore } from '../src/schema.js';
import { field } from '../src/field.js';

describe('복합 인덱스 키 타입 추론', () => {
  it('복합 인덱스 이름에서 키 객체 타입을 추론한다', () => {
    const store = defineStore('users', {
      id: field.string().primaryKey(),
      city: field.string(),
      age: field.number(),
    }).compoundIndex('city_age', ['city', 'age']);

    // getAllBy의 복합 키 인자가 { city: string; age: number } 여야 한다
    // (Task 4에서 getBy/getAllBy 오버로드가 이 타입을 쓴다)
    type Key = Parameters<typeof store['__compoundKeyProbe']>[0];
    expectTypeOf<Key>().toEqualTypeOf<{ city: string; age: number }>();
  });
});
```
NOTE: `__compoundKeyProbe`는 타입 검증용 phantom. Step 3에서 `SchemaStoreDefinition`에 `__compoundKeyProbe?: (k: CompoundIndexKeyObject<...>) => void` 같은 phantom을 추가하거나, 더 깔끔하게 Task 4의 실제 `getAllBy` 시그니처로 검증하도록 이 테스트를 Task 4와 병합해도 된다. **구현자 판단**: phantom이 지저분하면 이 type-test를 Task 4로 옮기고 실제 `getAllBy` 인자 타입으로 검증.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/compoundIndex.test-d.ts`
Expected: FAIL (type error) — 타입 유틸/phantom 없음.

- [ ] **Step 3: Add phantom generic CI + key-object type util**

`SchemaStoreBuilder`/`SchemaStoreDefinition`에 복합 인덱스 누적용 제네릭을 추가한다. 기존 시그니처를 깨지 않도록 **기본값** `CI extends readonly CompoundIndexDef[] = []`를 준다:
```ts
export interface SchemaStoreDefinition<
  S extends StoreSchema,
  TName extends string = string,
  CI extends readonly CompoundIndexDef[] = readonly []
> { /* ... compoundIndexes: CI ... */ }
```
`.compoundIndex(name, keys)`가 반환 타입에서 `CI`에 `{ name: Name; keyPath: K }`를 append 하도록(literal 보존):
```ts
compoundIndex<const Name extends string, const K extends readonly (keyof S & string)[]>(
  name: Name, keys: K, options?: { unique?: boolean }
): SchemaStoreBuilder<S, TName, readonly [...CI, { name: Name; keyPath: K; unique?: boolean }]>;
```
타입 유틸:
```ts
type CompoundIndexEntry<CI extends readonly CompoundIndexDef[], Name extends string> =
  Extract<CI[number], { name: Name }>;

export type CompoundIndexNames<CI extends readonly CompoundIndexDef[]> = CI[number]['name'];

export type CompoundIndexKeyObject<S extends StoreSchema, KP extends readonly string[]> = {
  [K in KP[number]]: FieldType<S, K & keyof S>;
};
```
(`FieldType<S, K>`는 이미 `src/field.ts`에 존재.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/compoundIndex.test-d.ts && pnpm typecheck`
Expected: PASS. 또한 `pnpm vitest run tests/inferTypes.test-d.ts tests/inferOutput.test-d.ts`로 기존 추론 회귀 없음 확인 (phantom generic 기본값 `[]`이 기존 호출을 안 깨는지).

- [ ] **Step 5: Commit**

```bash
git add src/schema.ts src/field.ts tests/compoundIndex.test-d.ts
git commit -m "feat: 복합 인덱스 키 객체 타입 추론

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `getBy`/`getAllBy` 복합 인덱스 조회 (eq 전용, 객체 키)

복합 인덱스 이름으로 `getBy`/`getAllBy`를 호출하면 **객체 키**를 받아 keyPath 순서대로 배열로 변환해 조회한다.

**Files:**
- Modify: `src/createSchemaDB.ts` (`SchemaStoreAccessor` 오버로드)
- Modify: `src/storeAccessor.ts` (복합 키 객체→배열 변환)
- Test: `tests/compoundIndex.test.ts`, `tests/compoundIndex.test-d.ts`

**Interfaces:**
- Consumes: `CompoundIndexNames`, `CompoundIndexKeyObject` (Task 3); `store.compoundIndexes` 런타임.
- Produces:
  - `getAllBy(compoundName, keyObject): Promise<InferOutput<S>[]>` (복합 인덱스 이름 오버로드)
  - `getBy(compoundName, keyObject): Promise<InferOutput<S> | undefined>`
  - 런타임 헬퍼: `toCompoundKeyArray(keyObject, keyPath): IDBValidKey[]` — keyPath 순서대로 값 추출.

- [ ] **Step 1: Write the failing test (runtime + type)**

`tests/compoundIndex.test.ts`:
```ts
describe('복합 인덱스 조회 (eq)', () => {
  it('getAllBy로 복합 키 완전일치 조회', async () => {
    const users = defineStore('users', {
      id: field.string().primaryKey(),
      city: field.string(),
      age: field.number(),
    }).compoundIndex('city_age', ['city', 'age']);
    const db = openDB({ name: 'ci-get', version: 1, stores: [users] as const });
    await db.waitForReady();
    await db.users.put({ id: 'a', city: 'Seoul', age: 30 });
    await db.users.put({ id: 'b', city: 'Seoul', age: 30 });
    await db.users.put({ id: 'c', city: 'Busan', age: 30 });

    const rows = await db.users.getAllBy('city_age', { city: 'Seoul', age: 30 });
    expect(rows.map(r => r.id).sort()).toEqual(['a', 'b']);
    db.close();
  });

  it('getBy로 복합 키 단건 조회', async () => {
    const users = defineStore('users', {
      id: field.string().primaryKey(),
      city: field.string(),
      age: field.number(),
    }).compoundIndex('city_age', ['city', 'age']);
    const db = openDB({ name: 'ci-getone', version: 1, stores: [users] as const });
    await db.waitForReady();
    await db.users.put({ id: 'a', city: 'Seoul', age: 30 });
    const row = await db.users.getBy('city_age', { city: 'Seoul', age: 30 });
    expect(row?.id).toBe('a');
    db.close();
  });
});
```
`tests/compoundIndex.test-d.ts`:
```ts
it('복합 인덱스 getAllBy는 객체 키만 받는다', () => {
  const store = defineStore('users', {
    id: field.string().primaryKey(),
    city: field.string(),
    age: field.number(),
  }).compoundIndex('city_age', ['city', 'age']);
  const db = openDB({ name: 'x', version: 1, stores: [store] as const });
  expectTypeOf(db.users.getAllBy).toBeCallableWith('city_age', { city: 'Seoul', age: 30 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/compoundIndex.test.ts -t "조회 (eq)"`
Expected: FAIL — 복합 인덱스 이름에 대한 오버로드 없음 / 객체 키가 배열로 변환 안 됨.

- [ ] **Step 3: Runtime — 복합 키 변환 + index.get**

`src/storeAccessor.ts`에 헬퍼 추가:
```ts
function toCompoundKeyArray(
  keyObject: Record<string, unknown>,
  keyPath: string[],
): IDBValidKey[] {
  return keyPath.map(k => keyObject[k] as IDBValidKey);
}
```
`createStoreAccessor`가 `compoundIndexes` 정보를 받아야 한다(현재는 안 받음). createSchemaDB에서 accessor 생성 시 `store.compoundIndexes`를 넘기도록 시그니처 확장. `getBy`/`getAllBy`에서 indexName이 복합 인덱스면 객체 키를 배열로 변환:
```ts
async getAllBy(indexName, query) {
  const compound = compoundIndexes.find(c => c.name === indexName);
  const resolvedQuery = compound && query && !(query instanceof IDBKeyRange)
    ? toCompoundKeyArray(query as Record<string, unknown>, compound.keyPath)
    : query;
  // ...기존 index.getAll(resolvedQuery)
}
```
(get/getBy도 동일 변환.)

- [ ] **Step 4: Type — getBy/getAllBy 오버로드**

`src/createSchemaDB.ts` `SchemaStoreAccessor`에 복합 인덱스 오버로드 추가(단일 인덱스 오버로드는 유지):
```ts
// 단일 인덱스 (기존)
getAllBy<I extends IndexedFields<S> & string>(indexName: I, query?: IDBKeyRange | IndexFieldTypes<S>[I]): Promise<InferOutput<S>[]>;
// 복합 인덱스 (신규)
getAllBy<N extends CompoundIndexNames<CI>>(indexName: N, query: CompoundIndexKeyObject<S, CompoundKeyPathOf<CI, N>>): Promise<InferOutput<S>[]>;
```
`SchemaStoreAccessor`가 `CI` 제네릭을 알아야 하므로, `SchemaDatabase`의 store accessor 타입이 `CI`까지 전달하도록 배선. `CompoundKeyPathOf<CI, N>` = `Extract<CI[number], { name: N }>['keyPath']`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/compoundIndex.test.ts tests/compoundIndex.test-d.ts && pnpm typecheck`
Expected: PASS. 기존 단일 인덱스 `getBy`/`getAllBy` 테스트도 통과 확인(`pnpm vitest run tests/crud.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/createSchemaDB.ts src/storeAccessor.ts tests/compoundIndex.test.ts tests/compoundIndex.test-d.ts
git commit -m "feat: 복합 인덱스 getBy/getAllBy 객체 키 조회

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: `query()` 복합 인덱스 — eq where + 정렬

`query({ index: 'city_age', where: { city, age } })`로 복합 eq 조회, `query({ index: 'city_age', orderBy })`로 복합 키 정렬.

**Files:**
- Modify: `src/query.ts` (`TypedQueryOptions` 복합 허용, executeQuery 복합 키 변환)
- Modify: `src/createSchemaDB.ts` (query 옵션 타입이 CI 전달)
- Test: `tests/compoundIndex.test.ts`, `tests/compoundIndex.test-d.ts`

**Interfaces:**
- Consumes: Task 3 타입, Task 4의 `toCompoundKeyArray`.
- Produces:
  - `query({ index: <compoundName>, where: <keyObject>, orderBy?, limit?, offset? })` — where의 모든 키 eq.
  - `query({ index: <compoundName>, orderBy })` — where 없이 정렬만.

- [ ] **Step 1: Write the failing test**

```ts
describe('복합 인덱스 query', () => {
  it('where 객체로 eq 조회', async () => {
    const users = defineStore('users', {
      id: field.string().primaryKey(),
      city: field.string(),
      age: field.number(),
    }).compoundIndex('city_age', ['city', 'age']);
    const db = openDB({ name: 'ci-q', version: 1, stores: [users] as const });
    await db.waitForReady();
    await db.users.put({ id: 'a', city: 'Seoul', age: 30 });
    await db.users.put({ id: 'b', city: 'Seoul', age: 25 });

    const rows = await db.users.query({ index: 'city_age', where: { city: 'Seoul', age: 30 } });
    expect(rows.map(r => r.id)).toEqual(['a']);
    db.close();
  });

  it('where 없이 복합 인덱스 정렬', async () => {
    const users = defineStore('users', {
      id: field.string().primaryKey(),
      city: field.string(),
      age: field.number(),
    }).compoundIndex('city_age', ['city', 'age']);
    const db = openDB({ name: 'ci-sort', version: 1, stores: [users] as const });
    await db.waitForReady();
    await db.users.put({ id: 'a', city: 'Seoul', age: 30 });
    await db.users.put({ id: 'b', city: 'Busan', age: 20 });

    const rows = await db.users.query({ index: 'city_age', orderBy: 'asc' });
    // 사전식: Busan < Seoul
    expect(rows.map(r => r.id)).toEqual(['b', 'a']);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/compoundIndex.test.ts -t "복합 인덱스 query"`
Expected: FAIL.

- [ ] **Step 3: Runtime — query가 복합 where를 키 배열로 변환**

`src/query.ts`의 옵션 처리에서, `index`가 복합 인덱스이고 `where`가 객체(eq 키들)면 `toCompoundKeyArray`로 `IDBKeyRange.only([v1, v2])`를 만들어 조회. where 없으면 range 없이 정렬만. query 빌더가 `compoundIndexes` 정보를 받도록 배선(`createQueryFunction`에 전달). 복합 where에 범위 연산자(gt 등)가 들어오면 **런타임 에러로 막기**(타입에서도 막지만 방어):
```ts
// 복합 where는 eq 전용 — 각 값은 그대로 키. 범위 객체 { gt: ... } 등이 오면 throw.
```

- [ ] **Step 4: Type — TypedQueryOptions 복합 분기**

`src/query.ts` `TypedQueryOptions<S, CI>`를 단일/복합 유니온으로:
```ts
type TypedQueryOptions<S, CI> =
  | { index: IndexedFields<S> & string; where?: TypedWhereCondition<...>; orderBy?; limit?; offset? }  // 단일 (기존)
  | { index: CompoundIndexNames<CI>; where?: CompoundIndexKeyObject<S, CompoundKeyPathOf<CI, ...>>; orderBy?: SortOrder; limit?: number; offset?: number };  // 복합 (eq 객체, 범위 없음)
```
복합 분기의 `where`는 **키 객체만** 허용(범위 연산자 타입 없음). `createSchemaDB.ts`가 `query` 시그니처에 `CI`를 전달.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/compoundIndex.test.ts tests/compoundIndex.test-d.ts && pnpm typecheck`
Expected: PASS. 기존 단일 query 테스트도 통과(`pnpm vitest run tests/query.test.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/query.ts src/createSchemaDB.ts tests/compoundIndex.test.ts tests/compoundIndex.test-d.ts
git commit -m "feat: 복합 인덱스 query (eq where + 정렬)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: 음성 타입 테스트 — 잘못된 사용 거부

타입 안전성을 "되는 것"만이 아니라 **"안 되는 것이 막히는지"**로 검증한다 (tuple 버그 교훈: 타입 테스트가 실제로 거부해야 의미 있음).

**Files:**
- Test: `tests/compoundIndex.test-d.ts`

**Interfaces:**
- Consumes: Task 3·4·5의 타입.

- [ ] **Step 1: Write deliberate-rejection type tests**

`tests/compoundIndex.test-d.ts`에 추가 (`// @ts-expect-error`로 거부 검증):
```ts
describe('복합 인덱스 타입 거부', () => {
  const store = defineStore('users', {
    id: field.string().primaryKey(),
    city: field.string(),
    age: field.number(),
  }).compoundIndex('city_age', ['city', 'age']);
  const db = openDB({ name: 'neg', version: 1, stores: [store] as const });

  it('복합 키에 잘못된 필드명은 거부', () => {
    // @ts-expect-error — 'country'는 복합 키에 없음
    db.users.getAllBy('city_age', { city: 'Seoul', country: 'KR' });
  });

  it('복합 키의 잘못된 타입은 거부', () => {
    // @ts-expect-error — age는 number여야 함
    db.users.getAllBy('city_age', { city: 'Seoul', age: 'thirty' });
  });

  it('존재하지 않는 인덱스 이름은 거부', () => {
    // @ts-expect-error — 'nope'는 인덱스 아님
    db.users.getAllBy('nope', { city: 'Seoul', age: 30 });
  });

  it('복합 where에 범위 연산자는 거부', () => {
    db.users.query({
      index: 'city_age',
      // @ts-expect-error — 복합 where는 eq 전용, 범위 객체 불가
      where: { city: 'Seoul', age: { gte: 20 } },
    });
  });
});
```
NOTE: `@ts-expect-error`는 vitest typecheck 모드에서 "그 줄에 에러가 **있어야** 통과"한다. 에러가 없으면(=거부 실패) 테스트가 빨개진다. 이게 핵심 — 제약이 진짜 작동하는지 증명.

- [ ] **Step 2: Run test — confirm rejections hold**

Run: `pnpm vitest run tests/compoundIndex.test-d.ts`
Expected: PASS (각 `@ts-expect-error` 줄에 실제로 타입 에러가 발생). 만약 어느 줄이 "unused @ts-expect-error"로 실패하면, 그 제약이 타입에서 안 막히는 것 → Task 3/4/5의 타입을 강화해야 함.

- [ ] **Step 3: Commit**

```bash
git add tests/compoundIndex.test-d.ts
git commit -m "test: 복합 인덱스 잘못된 사용 타입 거부 검증

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: 검증 — 복합 인덱스 정의 무결성

복합 인덱스 선언의 잘못된 입력을 런타임에서 막는다.

**Files:**
- Modify: `src/schema.ts` (parseSchema 또는 compoundIndex에서 검증)
- Test: `tests/compoundIndex.test.ts`

**Interfaces:**
- Consumes: Task 1.

- [ ] **Step 1: Write the failing test**

```ts
describe('복합 인덱스 검증', () => {
  it('빈 keys 배열은 에러', () => {
    expect(() =>
      defineStore('u', { id: field.string().primaryKey(), a: field.string() })
        .compoundIndex('empty', [] as never)
    ).toThrow();
  });

  it('단일/복합 인덱스 이름 중복은 에러', () => {
    expect(() =>
      defineStore('u', {
        id: field.string().primaryKey(),
        a: field.string().index(),  // 단일 인덱스 이름 'a'
        b: field.string(),
      }).compoundIndex('a', ['a', 'b'])  // 'a' 중복
    ).toThrow();
  });

  it('같은 복합 인덱스 이름 두 번은 에러', () => {
    expect(() =>
      defineStore('u', { id: field.string().primaryKey(), a: field.string(), b: field.string() })
        .compoundIndex('a_b', ['a', 'b'])
        .compoundIndex('a_b', ['b', 'a'])
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/compoundIndex.test.ts -t "복합 인덱스 검증"`
Expected: 일부 FAIL (빈 배열 검증 없음 등).

- [ ] **Step 3: Add validation**

`compoundIndex` 구현에 빈 배열 검증 추가 (중복 이름은 Task 1에서 이미 처리):
```ts
if (keys.length === 0) {
  throw new Error(`Compound index "${name}" must have at least one key in store "${definition.name}"`);
}
```
단일 인덱스 이름은 `parseSchema` 후 결정되므로, 단일 vs 복합 이름 충돌 검증을 `defineStore` 단계(parseSchema 결과 + compoundIndexes)에서 한 번 더 확인하도록 보강.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/compoundIndex.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/schema.ts tests/compoundIndex.test.ts
git commit -m "feat: 복합 인덱스 정의 검증 (빈 키/이름 중복)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: 문서화 + 전체 검증

README에 복합 인덱스 섹션 추가, Limitations 갱신(복합 where는 eq 전용임을 명시), 전체 스위트 검증.

**Files:**
- Modify: `README.md`
- Modify: `src/example.ts` (복합 인덱스 예시)
- Test: 전체

**Interfaces:**
- Consumes: 전 Task.

- [ ] **Step 1: README 복합 인덱스 섹션**

`README.md`의 Querying 섹션 뒤(또는 Indexes 근처)에 추가:
- `.compoundIndex(name, keys)` 선언 예시
- `getAllBy`/`query`로 eq 객체 조회 예시
- 정렬 부산물 설명
- **명시적 제약**: "복합 인덱스 where는 완전일치(eq)만 지원한다. 범위 조건은 IndexedDB의 복합 키 정렬 특성상 단일 인덱스에서만 제공된다." (왜인지 한 줄)

Limitations 섹션의 "Single-index queries — IndexedDB does not support compound queries"를 갱신: 복합 **eq** 인덱스는 지원하되, 복합 **범위** where는 미지원임을 정확히.

- [ ] **Step 2: example.ts 복합 인덱스 예시 추가**

`src/example.ts`에 `.compoundIndex('city_age', ['city', 'age'])` 선언 + `getAllBy`/`query` 사용 예시 추가.

- [ ] **Step 3: 전체 검증**

Run: `pnpm typecheck && pnpm test:run && pnpm build`
Expected: 전부 PASS. `dist/` 산출 정상.

- [ ] **Step 4: Commit**

```bash
git add README.md src/example.ts
git commit -m "docs: 복합 인덱스 사용법 + eq 전용 제약 문서화

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review Notes

- **결정 매핑**: D1·D2→Task 1, D3→Task 1·3, D4→Task 4, D5·D6→Task 4·5, D7→Task 5, D8→Task 5, D9→Task 1·7. 전 결정이 Task로 매핑됨.
- **타입 일관성**: `CompoundIndexDef`(Task 1) → 제네릭 `CI`(Task 3) → `CompoundIndexNames`/`CompoundIndexKeyObject`/`CompoundKeyPathOf`(Task 3·4·5)에서 일관 사용. `toCompoundKeyArray`(Task 4) → Task 5 재사용.
- **회귀 방지**: 각 Task가 기존 단일 인덱스 테스트(crud/query) 재실행을 포함. phantom generic `CI`의 기본값 `[]`로 기존 `defineStore` 호출 무손상 — Task 3 Step 4에서 명시 검증.
- **알려진 스코프 경계**: (a) 기존 store에 복합 인덱스를 나중에 추가하는 auto-migration은 이번 범위 제외(Task 2 NOTE). (b) prefix(부분 키) 조회 제외(D6). (c) 빌더 체인(`.index().equals()`)의 복합 지원 제외(D7) — 객체 스타일 query만.
- **위험**: 제네릭 `CI`를 `SchemaStoreBuilder`→`SchemaDatabase`→`SchemaStoreAccessor`까지 배선하는 게 타입 작업의 핵심 난점. Task 3에서 phantom 검증이 지저분하면 Task 4의 실제 시그니처로 검증 이전(구현자 판단 명시). `@ts-expect-error` 음성 테스트(Task 6)가 배선이 실제로 작동하는지 최종 증명.

## DRAFT DECISIONS 재확인 체크리스트 (사용자 복귀 시)

실행 전 사용자가 이 표만 훑으면 됨 — 바꾸고 싶은 결정이 있으면 해당 Task만 조정:

- [ ] D1: 복합 선언 = 스토어 체인 `.compoundIndex()` (vs defineStore 옵션)
- [ ] D2: 이름 = `compoundIndex` (vs index 오버로드 / addIndex)
- [ ] D3: keys = 배열 `['a','b']` (vs 방향 포함 객체)
- [ ] D4: 조회 = getBy/getAllBy 확장 (vs 새 메서드)
- [ ] D5: where 키 = 객체 (vs 배열)
- [ ] D6: 연산자 = eq 전용, prefix 제외 (vs prefix 허용)
- [ ] D7: query = 객체 스타일만 (vs 빌더 체인 복합)
- [ ] D8: 정렬 = 부산물 자동
- [ ] D9: 이름 = 단일과 공유 네임스페이스, 중복 throw
