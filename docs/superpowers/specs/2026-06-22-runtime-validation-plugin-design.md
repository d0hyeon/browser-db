# 런타임 검증 리졸버 설계 (resolvers/zod)

작성일: 2026-06-22

## 1. 배경 / 문제

`field.object` / `field.tuple` / `field.enum` / `field.nativeEnum`은 `schema`·`values` 인자를
받지만 결과를 버린다 (`src/field.ts:322-363`). 또한 `FieldDef._type`은 `undefined as T`
(`src/field.ts:177`) — **타입 추론 전용**이고 컴파일 후 사라져 런타임에 읽을 수 없다.

결과적으로 현재 라이브러리는 **타입-온리**다. 런타임 검증이 전혀 없어서,
**테이블 구조 변경 후 마이그레이션을 누락하면** 구버전 데이터가 현재 스키마와
어긋나도 아무도 잡지 못한다. 이게 실제로 겪은 문제이며 이 작업의 동기다.

## 2. 목표 / 비목표

### 목표
- 코어가 런타임 검증에 필요한 정보를 **보존**한다 (검증 로직은 코어에 넣지 않는다).
- 검증은 **리졸버**으로 분리한다: `schema-idb/resolvers/zod`.
- 리졸버은 코어가 보존한 정보로 Zod 스키마를 **자동 생성**한다 (사용자는 스키마를 한 번만 정의).
- 검증은 **읽기(get) 시점**에 동작해 마이그레이션 누락 데이터를 잡는다.

### 비목표
- 쓰기(put/add) 시 **검증** — 이번 범위 아님 (TS 타입을 신뢰). *(단, default 주입은 쓰기 시 수행 — §11 참고. 검증과 별개)*
- 코어에 Zod 의존성 추가 — 절대 안 함. Zod는 리졸버에만.
- 전면 강제 검증(Zod 스타일) — opt-in으로만.
- `field.string().email()` 같은 필드별 세밀 제약 — 이번 범위 아님 (`_kind` 수준의 타입 검증만).

### 동반 변경 (이 작업과 함께 진행)
- §4: 중첩 빌더(`TypeBuilder`/`type`) 폐기 → `field` 단일 팩토리, 콜백 → 객체/배열 직접.
- §11: `default()`를 값/팩토리 함수 모두 허용 + **쓰기(put/add) 시 주입**으로 전환.

## 3. 핵심 결정 사항

| 항목 | 결정 |
| --- | --- |
| 정보 출처 | 코어 `FieldDef`에 런타임 태그 보존 → 리졸버이 순회해 Zod 자동 생성 |
| 결합 방식 | `defineStore(...).use(resolver)` 체이닝 (`addMigration` 패턴 재사용) |
| 검증 시점 | get류: `get` / `getAll` / `getBy` / `getAllBy` / `query` |
| 실패 처리 | throw (즉시 에러) |

### 왜 `_type`을 못 쓰고 `_kind`가 필요한가
`_type`은 제네릭 `T`로 **타입 추론**에 쓰인다 (`InferOutput` 등 모든 추론이
`_def: { _type: infer T }`에 의존). 여기에 `'string'` 같은 런타임 문자열을 넣으면
`T`가 `'string'` 리터럴로 추론돼 `get()` 반환 타입이 망가진다.
타입 추론용 값과 런타임 분기용 값은 양립 불가하므로 **별도 필드 `_kind`** 가 필요하다.

## 4. 코어 변경 (검증 로직 없음, 정보 보존 + 빌더 단일화)

### 4.0 중첩 빌더 단일화 — `TypeBuilder`/`type` 폐기

현재 중첩용 `type`/`TypeBuilder`/`TypeDef`(`src/field.ts:25-94`)는 콜백으로 주입되어
`field.object(t => ({ inner: t.object(t2 => ({ ... })) }))`처럼 중첩마다 콜백·인자(`t`/`t2`)가
늘어난다. 콜백의 본래 목적은 "중첩에서 `index`/`primaryKey` 비노출"이었으나,
이는 콜백이 아니라 **반환 타입**으로 달성되는 것이다.

**결정**: `TypeBuilder`/`type`/`TypeDef`를 폐기하고 `field` 단일 팩토리로 통일한다.
중첩은 콜백 없이 객체/배열을 직접 받는다.

```ts
// before — 콜백 주입, 중첩마다 t/t2
field.object(t => ({
  inner: t.object(t2 => ({ id: t2.string() }))
}))

// after — field 단일, 객체 직접
field.object({
  inner: field.object({ id: field.string() })
})
```

- 중첩에서 `index`/`primaryKey`는 타입상 노출되나 **런타임에서 무시**된다
  (`parseSchema`는 최상위 필드만 순회 — `src/schema.ts:88`). 의도된 트레이드오프.
  → API를 2개(`field`+`shape`)로 늘려 막을 실익보다 단일 API의 단순함이 크다.
- `field.tuple`도 콜백 → 배열 직접: `field.tuple([field.number(), field.number()])`.

### 4.1 `FieldDef`에 런타임 메타 추가

빌더가 `field` 하나로 단일화되므로 메타도 `FieldDef` **한 곳**에만 둔다 (이원화 해소).
`_kind`는 `field.ts`의 `resolvedDef` 객체(`src/field.ts:175`)에 실제 문자열 값으로 박는다.

```ts
type FieldKind =
  | 'string' | 'number' | 'boolean' | 'date'
  | 'object' | 'tuple' | 'enum' | 'nativeEnum' | 'array' | 'custom';

// FieldDef에 추가되는 런타임 메타 (별도 구조체 아님 — FieldDef에 직접 합침)
interface FieldDefRuntimeMeta {
  _kind: FieldKind;
  _shape?: Record<string, FieldDef>;            // object: 키별 중첩 정의
  _items?: FieldDef[];                          // tuple: 위치별 중첩 정의
  _enumValues?: readonly (string | number)[];   // enum / nativeEnum 허용값
  _element?: FieldDef;                           // array: 원소 정의
}
```

### 4.2 팩토리가 정보를 흘려보낸다

```ts
// before — 정보 버림 + 콜백
string: () => createFieldBuilder<string>(),
object: (schema) => { const _shape = schema(type); return createFieldBuilder(); },
enum:   (values) => createFieldBuilder<T[number]>(),

// after — 객체 직접 + _kind/구조 정보 전달
string: () => createFieldBuilder<string>({ ...base, _kind: 'string' }),
object: (shape) => createFieldBuilder({ ...base, _kind: 'object', _shape: toDefMap(shape) }),
enum:   (values) => createFieldBuilder({ ...base, _kind: 'enum', _enumValues: values }),
```

- `_shape`/`_items`는 전달받은 빌더들의 `_def`를 추출해 새 객체로 보존(원본 불변).
- `array()`는 `_kind: 'array'` + `_element`에 원본 정의 보존.
- `custom()`은 `_kind: 'custom'` — 리졸버은 검증 불가로 보고 통과(z.any) 처리.
- 타입 추론(`InferOutput` 등)은 `_type`을 계속 사용 — **변경 없음**.

### 4.3 비용
- 빌더 단일화: `TypeBuilder` 관련 코드 제거(-) + 객체 시그니처(콜백 실행 제거, -).
  순수 코드량은 오히려 감소. 단 기존 `field.object(t => ...)` 호출부는 breaking (0.0.x라 감당).
- 메타 보존: 검증 미사용자에겐 `_kind` 문자열 + (해당 시) 구조 메타 몇 바이트가 전부.
  `sideEffects: false`와 트리 셰이킹에 영향 없음. Zod는 코어 번들에 들어가지 않는다.

## 5. 리졸버 결합 — `.use()`

### 5.1 리졸버 인터페이스 (코어가 정의)

코어는 "검증 함수"라는 **확장 지점**만 정의한다. Zod는 모른다.

```ts
// src/resolver.ts (코어)
export interface StoreResolver<S extends StoreSchema = StoreSchema> {
  name: string;
  // store 정의를 받아 read 후처리용 validator를 만든다
  createValidator(store: SchemaStoreDefinition<S>): (record: unknown) => void; // 실패 시 throw
}
```

### 5.2 체이닝

`addMigration`과 동일하게 불변 빌더로 누적 (`src/schema.ts:131-152` 패턴 재사용).

```ts
const usersStore = defineStore('users', { ... })
  .use(zodResolver());   // SchemaStoreBuilder 반환, validators 누적
```

`SchemaStoreDefinition`에 `validators: StoreResolver[]` 필드 추가.

### 5.3 검증자가 accessor까지 흐르는 경로

`defaults`와 **동일 경로**를 탄다 (이미 검증된 결선):

```
store.validators
  → buildSchemaDatabase: createLazyStoreAccessor(state, name, defaults, validators)   // createSchemaDB.ts:276
  → createStoreAccessor(idb, name, defaults, validators)                              // createSchemaDB.ts:157
  → get류 메서드에서 DB 결과 반환 직전 validate(record) 호출                            // storeAccessor.ts
```

리졸버 자체(`zodResolver`)는 `openDB` 시 `store.validators`를 순회해
`createValidator(store)`로 record-validator를 1회 생성, accessor에 주입한다.

## 6. 검증 적용 지점 (storeAccessor.ts)

get류에서 DB 결과를 반환하기 **직전** validator를 통과시킨다.
put/add/delete/clear/count는 미적용. (§11에서 default 주입이 쓰기로 옮겨가므로
get 경로의 `applyDefaults`는 §11의 결정에 따라 제거되거나 보조로만 남는다.)

```ts
async get(key) {
  const result = await getResult(tx, store.get(key));
  if (result !== undefined) validate(result);   // 실패 시 throw
  return result;
}
```

- `getAll` / `getAllBy`: 배열 각 원소 검증.
- `query`: `query.ts`의 결과 반환 지점에 동일 후크 (findAll/find).
- validator가 없으면(리졸버 미사용) 후크는 no-op — 오버헤드 0.

### 실패 동작
검증 실패 시 throw. 에러 메시지는 store 이름 + 키 + Zod 이슈를 포함해
**어떤 마이그레이션이 누락됐는지** 추적 가능하게 한다.

## 7. 리졸버 구현 — resolvers/zod

별도 진입점 `schema-idb/resolvers/zod`. Zod는 이 패키지의 peerDependency.

### 7.1 변환기 (FieldDef → ZodType)

base 타입 생성(`_kind` switch)과 modifier 적용을 **한 함수**에서 순서대로 한다.
modifier가 누락되면 정상 데이터를 막는 **오탐**이 생기므로 반드시 반영한다.

```ts
// resolvers/zod/toZodType.ts
function baseFromKind(def: FieldDef): ZodType {
  switch (def._kind) {
    case 'string':  return z.string();
    case 'number':  return z.number();
    case 'boolean': return z.boolean();
    case 'date':    return z.date();
    case 'enum':
    case 'nativeEnum': return z.enum(def._enumValues as [string, ...string[]]);
    case 'object':  return z.object(mapValues(def._shape, toZodType));
    case 'tuple':   return z.tuple(def._items.map(toZodType));
    case 'array':   return z.array(toZodType(def._element));
    case 'custom':  return z.any();
  }
}

function toZodType(def: FieldDef): ZodType {
  let schema = baseFromKind(def);
  if (def._optional) schema = schema.optional();   // undefined 허용
  // _hasDefault는 의도적으로 .optional()을 붙이지 않는다 (아래 규칙 참고)
  return schema;
}
```

**modifier 반영 규칙**:

| FieldDef 플래그 | Zod 반영 | 이유 |
| --- | --- | --- |
| `_optional: true` | `.optional()` | 값 없음(undefined) 허용 |
| `_hasDefault: true` | **필수 (반영 안 함)** | default는 쓰기 시 주입(§11)되므로 DB엔 항상 존재해야 함. 비어 있으면 마이그레이션 누락 신호 → throw |
| (둘 다 아님) | 필수 | — |

- 중첩 필드(object의 `_shape`, tuple의 `_items`, array의 `_element`)도 동일 `toZodType`을
  재귀적으로 타므로 modifier가 자동 반영된다.
- store 전체는 `z.object(shape)`로 감싼다.

### 7.2 리졸버 팩토리

```ts
export function zodResolver(): StoreResolver {
  return {
    name: 'zod',
    createValidator(store) {
      const zodSchema = buildZodSchema(store.schema);  // FieldDef 순회
      return (record) => { zodSchema.parse(record); }; // 실패 시 ZodError throw
    },
  };
}
```

### 7.3 번들 분리 — 안 쓰면 부담 0

세 가지 층위를 조합해 "검증 미사용자에겐 zod가 설치도 번들도 안 되게" 만든다.
(패키지는 **1개** 유지. 별도 패키지 불필요.)

**(a) 서브패스 export로 진입점 분리** — 코어와 리졸버을 다른 진입점으로.
```jsonc
// package.json
{
  "exports": {
    ".":                    { "types": "./dist/index.d.ts",
                              "import": "./dist/index.js" },
    "./resolvers/zod":  { "types": "./dist/resolvers/zod/index.d.ts",
                              "import": "./dist/resolvers/zod/index.js" }
  }
}
```
코어를 import하는 사용자는 `resolvers/zod`/`zod`를 트리에 끌어오지 않는다.

**(b) optional peerDependency로 설치 분리** — zod를 번들에 넣지 않고 사용자 것을 빌려 쓰되,
검증 미사용자는 설치조차 불필요.
```jsonc
{
  "peerDependencies":     { "zod": "^3.0.0 || ^4.0.0" },
  "peerDependenciesMeta": { "zod": { "optional": true } }
}
```

**의존성 방향 단속(필수 전제)**: 코어(`src/**`)는 `resolvers/zod`/`zod`를 **절대 import하지 않는다.**
의존성은 `resolvers/zod → core` 한 방향만. 코어가 리졸버를 한 번이라도 import하면 (a)가 깨진다.

| 원하는 것 | 수단 |
| --- | --- |
| 코어만 쓰면 zod 번들 0 | (a) 서브패스 + 트리셰이킹 |
| 검증 안 쓰면 zod 설치 불필요 | (b) optional peerDep |

> 런타임 가드(zod 미설치 시 안내 에러)는 **비범위**. zod 없이 리졸버를 import하면
> 표준 모듈 해석 에러가 나며, 별도 친절 메시지는 제공하지 않는다.

## 8. 파일 구조

```
src/
  field.ts          # TypeBuilder 폐기 → field 단일화, FieldDef에 _kind 등 추가, default(T | () => T)
  schema.ts         # SchemaStoreDefinition.validators, SchemaStoreBuilder.use(), defaults에 팩토리 보존
  resolver.ts       # (신규) StoreResolver 인터페이스 — 코어 확장 지점, Zod 무관
  storeAccessor.ts  # get류에 validate 후크 + put/add에서 default 주입
  query.ts          # query 결과 반환 지점에 validate 후크
  createSchemaDB.ts # validators를 accessor까지 전달 (defaults와 동일 경로)
  index.ts          # StoreResolver 타입 export

resolvers/
  zod/
    index.ts        # zodResolver() 팩토리
    buildZodSchema.ts
    toZodType.ts    # FieldDef → ZodType (base + modifier)

package.json        # exports에 "./resolvers/zod" 서브패스, zod를 optional peerDep
```

빌드: `tsc`가 `resolvers/`도 `dist/resolvers/`로 출력하도록 `tsconfig`/`include` 확인.
서브패스가 `dist/resolvers/zod/index.js`를 가리키므로 빌드 출력 경로 정합 필요.

소유 주체 기준: 검증 정보 보존은 field의 책임이므로 `field.ts`,
리졸버 확장 지점은 코어 공용이므로 `resolver.ts`, Zod 변환은 리졸버 내부에만 응집.

## 9. 단계별 작업 순서

1. 빌더 단일화: `TypeBuilder`/`type`/`TypeDef` 폐기, `field.object`/`tuple` 콜백→객체/배열.
2. 코어 정보 보존: `FieldDef`에 `_kind` 등 추가, 팩토리가 전달. (타입 추론 회귀 없음 확인)
3. default 전환(§11): `default(T | () => T)` 시그니처, 쓰기 시 주입, get 후처리 정리.
4. 코어 확장 지점: `resolver.ts` `StoreResolver`, `schema.ts` `.use()` + `validators`.
5. validator 결선: `createSchemaDB.ts` → `storeAccessor.ts` → `query.ts` get류 후크.
6. 리졸버: `resolvers/zod` 변환기(+modifier 반영) + 팩토리.
   `package.json` 서브패스 export + optional peerDep, `tsconfig` 빌드 출력 경로 확인.
7. 테스트: 마이그레이션 누락 시나리오(구버전 record가 get에서 throw), default 팩토리(레코드별 다른 Date), modifier 오탐 없음.

## 10. 위험 / 확인 필요

- `query.ts`의 반환 경로가 여러 갈래(findAll/find/cursor)라 후크 지점 누락 주의.
- enum 런타임 보존 시 `as const` 없이 들어온 값의 타입 좁힘 — 보존 자체는 영향 없음.
- `_shape` 보존 시 중첩 빌더의 불변성을 깨지 않도록 새 객체로 생성.
- **modifier 누락 오탐**: `toZodType`이 `_optional`을 빠뜨리면 정상(undefined) 데이터를 막는다. §7.1 규칙 준수.
- **default 쓰기 주입의 하위호환**: 기존 get 후처리에 의존하던 구버전 레코드는 이제 default가
  안 채워진다. 마이그레이션으로 채우거나, 검증 리졸버이 누락으로 잡도록 둔다 (의도된 동작).

## 11. default 값/팩토리 + 쓰기 주입 전환

### 11.1 현재 결함
- `default(new Date())`의 `new Date()`가 **정의 시점 1회** 평가되어 `_default`에 저장
  (`src/field.ts:251`) → `parseSchema`가 그 인스턴스를 `defaults`에 박음(`src/schema.ts:112`)
  → `applyDefaults`가 `{ ...defaults, ...value }`로 **모든 레코드에 동일 인스턴스 spread**.
- default가 **get 후처리에만** 적용(`storeAccessor.ts` get류)되어 DB엔 저장되지 않음.
  같은 레코드를 두 번 get하면 `createdAt`이 매번 달라지는 버그.

### 11.2 변경
**(a) 인터페이스** — 값 또는 팩토리 함수 허용:
```ts
// before
default(value: T): FieldBuilder<...>
// after
default(value: T | (() => T)): FieldBuilder<...>
```
- 값 → 모든 레코드가 그 값 재사용.
- 함수 → 쓰기마다 호출(`typeof raw === 'function' ? raw() : raw`).
- 함수는 저장값이 될 수 없으므로(IndexedDB 직렬화 불가) 함수 인자는 **항상 팩토리**로 해석.

**(b) 적용 시점** — get 후처리 → **쓰기(put/add) 주입**으로 전환 (Drizzle `$defaultFn`,
Prisma/Mongoose 관례). default 필드가 누락된 입력에 한해, 저장 직전 값을 채운다:
```ts
async add(value, key) {
  const filled = applyWriteDefaults(value, defaults);  // 누락 필드만 채움, 함수면 호출
  return getResult(tx, store.add(filled, key));
}
```
- get 경로의 `applyDefaults`/`applyDefaultsToArray`는 제거 (검증이 그 자리에 들어옴 §6).
- `query.ts`의 get측 defaults 적용도 함께 정리.

### 11.3 시맨틱 결과
```ts
createdAt: field.date().default(() => new Date())

await db.users.add({ id: 'u1', name: 'Kim' });  // createdAt = add 시각 저장
const a = await db.users.get('u1');  // 고정
const b = await db.users.get('u1');  // a와 동일 ✅ (기존 버그 해소)
```
```
