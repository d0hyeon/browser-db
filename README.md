# IDB Wrapper

Type-safe IndexedDB wrapper with Drizzle/Zod-style schema definition.

## Features

- **Drizzle/Zod-style Schema** - 타입과 설정을 한 곳에서 정의
- **Full Type Inference** - Input/Output 타입 자동 추론
- **Default Values** - 스키마 진화 시 기존 데이터 자동 보정
- **관심사 분리** - 스토어를 별도 파일로 정의, 나중에 조합

## Installation

```bash
npm install idb-wrapper
```

## Quick Start

```ts
import { createDB, defineStore, field } from 'idb-wrapper';

// 1. 스키마 정의 (Drizzle/Zod 스타일)
const usersStore = defineStore('users', {
  id: field.string().primaryKey(),
  name: field.string(),
  email: field.string().index({ unique: true }),
  age: field.number().optional().default(0),
});

// 2. 데이터베이스 생성
const db = await createDB({
  name: 'MyApp',
  version: 1,
  stores: [usersStore] as const,
});

// 3. 사용
await db.users.put({ id: 'u1', name: 'Kim', email: 'kim@test.com' });
const user = await db.users.get('u1');
console.log(user.age);  // 0 (default 적용)
```

## API

### field

필드 타입을 정의하는 빌더.

```ts
// 기본 타입
field.string()    // string
field.number()    // number
field.boolean()   // boolean
field.date()      // Date

// Array (Zod 스타일)
field.string().array()    // string[]
field.number().array()    // number[]

// Object with schema
field.object(t => ({
  detail: t.string(),
  post: t.string(),
  zipCode: t.number().optional(),
}))

// Tuple
field.tuple(t => [t.number(), t.number()])  // [number, number]

// Enum
field.enum(['active', 'inactive', 'pending'] as const)

// Native TypeScript Enum
enum Status { Active, Inactive }
field.nativeEnum(Status)

// Custom type (레거시)
field.custom<MyType>()
```

### Field Methods

```ts
field.string()
  .primaryKey()           // Primary key로 지정
  .index()                // 인덱스 생성
  .index({ unique: true }) // Unique 인덱스
  .optional()             // undefined 허용
  .default(value)         // 기본값 설정
  .array()                // 배열로 변환
```

### Type Inference

```ts
import type { InferStore } from 'idb-wrapper';

const usersStore = defineStore('users', { ... });

// 스토어에서 타입 추출
type User = InferStore<typeof usersStore>;
```

### defineStore(name, schema, options?)

스토어를 정의합니다.

```ts
enum UserRole { Admin = 'admin', User = 'user' }

const usersStore = defineStore('users', {
  // Primary key (필수)
  id: field.string().primaryKey(),
  
  // 필수 필드
  name: field.string(),
  
  // 인덱스 필드
  email: field.string().index({ unique: true }),
  
  // Optional with default
  age: field.number().optional().default(0),
  
  // Object with schema
  address: field.object(t => ({
    detail: t.string(),
    post: t.string(),
    zipCode: t.number().optional(),
  })).optional().default({ detail: '', post: '' }),
  
  // Array
  tags: field.string().array().optional(),
  
  // Tuple
  coordinate: field.tuple(t => [t.number(), t.number()]).optional(),
  
  // Enum
  status: field.enum(['active', 'inactive'] as const).default('active'),
  
  // Native Enum
  role: field.nativeEnum(UserRole).default(UserRole.User),
});

// 타입 추출
type User = InferStore<typeof usersStore>;
```

### createDB(config)

데이터베이스 인스턴스를 생성합니다.

```ts
const db = await createDB({
  name: 'MyApp',
  version: 1,
  stores: [usersStore, postsStore] as const,  // as const 필수!
});
```

### Store Operations

```ts
// CRUD
await db.users.put({ id: 'u1', name: 'Kim', email: 'kim@test.com' });
await db.users.add({ id: 'u2', name: 'Lee', email: 'lee@test.com' });
const user = await db.users.get('u1');
await db.users.delete('u1');
await db.users.clear();

// Query
const all = await db.users.getAll();
const byEmail = await db.users.getAllByIndex('email', 'kim@test.com');
const count = await db.users.count();
```

## Query API

두 가지 스타일로 쿼리할 수 있어요. IndexedDB 특성상 **인덱스 하나**만 사용 가능해요.

### Object 스타일

```ts
// index와 where를 명확히 분리
const adults = await db.users.query({
  index: 'age',           // 사용할 인덱스
  where: { gte: 20 },     // 조건
  orderBy: 'desc',
  limit: 10,
});

// 범위 조건
const range = await db.users.query({
  index: 'age',
  where: { gte: 20, lte: 30 },
});

// Prefix 검색
const kims = await db.users.query({
  index: 'name',
  where: { startsWith: 'Kim' },
});

// Pagination
const page2 = await db.users.query({
  index: 'age',
  where: { gte: 0 },
  limit: 10,
  offset: 10,
});
```

### Builder 스타일 (체이닝)

```ts
// 인덱스 지정 - 필드 자동완성 & 값 타입 추론
const users = await db.users
  .query()
  .index('age')          // 인덱스 필드 자동완성
  .between(20, 30)       // number 타입 추론
  .orderBy('desc')
  .limit(10)
  .findAll();            // T[]

// 단일 조회
const user = await db.users
  .query()
  .index('email')
  .equals('kim@test.com')
  .find();               // T | undefined

// 카운트
const count = await db.users
  .query()
  .index('age')
  .gte(20)
  .count();
```

### Where 조건

| 조건 | 설명 |
|------|------|
| `{ eq: value }` | 정확히 일치 |
| `{ gt: value }` | 초과 (>) |
| `{ gte: value }` | 이상 (>=) |
| `{ lt: value }` | 미만 (<) |
| `{ lte: value }` | 이하 (<=) |
| `{ between: [a, b] }` | 범위 (a <= x <= b) |
| `{ startsWith: 'prefix' }` | Prefix 검색 |

## Transaction

여러 스토어에 걸친 원자적 작업을 위한 트랜잭션:

```ts
// 트랜잭션 시작 - 사용할 스토어 명시
const tx = db.startTransaction(['users', 'posts'], { 
  mode: 'readwrite',     // 'readonly' | 'readwrite' (기본: 'readonly')
  durability: 'default', // 'default' | 'strict' | 'relaxed'
});

// 동기적으로 요청 쌓기 (await 없이!)
tx.users.put({ id: 'u1', name: 'Kim', email: 'kim@test.com' });
tx.users.delete('u2');
tx.posts.put({ id: 1, title: 'Hello', content: '...', authorId: 'u1' });

// 트랜잭션 완료 대기
await tx.commit();

// 또는 중단
tx.abort();
```

**주의:** 트랜잭션 내에서 `await`을 사용하면 트랜잭션이 자동 커밋될 수 있어요. 모든 요청을 동기적으로 쌓은 후 `commit()`을 호출하세요.

## Schema Evolution (스키마 진화)

새 필드를 추가할 때 `.default()`를 사용하면 기존 데이터도 자동으로 기본값이 적용됩니다.

```ts
// v1: 초기 스키마
const usersStore = defineStore('users', {
  id: field.string().primaryKey(),
  name: field.string(),
});

// v2: address 필드 추가
const usersStore = defineStore('users', {
  id: field.string().primaryKey(),
  name: field.string(),
  address: field.object<Address>().optional().default({ detail: '', post: '' }),
});

// 기존 데이터를 읽으면 address가 자동으로 기본값으로 채워짐
const oldUser = await db.users.get('old-user-id');
console.log(oldUser.address);  // { detail: '', post: '' }
```

## Migrations

스토어 구조 변경 (인덱스 추가 등)은 마이그레이션으로 처리합니다.

```ts
const usersStore = defineStore('users', {
  id: field.string().primaryKey(),
  name: field.string(),
  createdAt: field.date().index(),  // v2에서 추가된 인덱스
}, {
  migrations: [
    {
      version: 2,
      up: (db, tx) => {
        const store = tx.objectStore('users');
        store.createIndex('createdAt', 'createdAt');
      },
    },
  ],
});
```

## Project Structure Example

```
src/
├── db/
│   └── index.ts              # createDB 호출
├── stores/
│   ├── users.ts              # usersStore
│   └── posts.ts              # postsStore
```

## License

MIT
