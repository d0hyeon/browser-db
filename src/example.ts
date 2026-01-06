/**
 * Example usage of the IDB wrapper library (Schema-based API)
 */

import { openDB, defineStore, field, deleteDB } from './index.js';
import type { InferStore } from './index.js';

// ============================================================================
// 1. Define Stores with Drizzle/Zod-style schema
// ============================================================================

// Native enum example
enum UserRole {
  Admin = 'admin',
  User = 'user',
  Guest = 'guest',
}

const usersStore = defineStore('users', {
  id: field.string().primaryKey(),
  name: field.string().index(),
  email: field.string().index({ unique: true }),
  age: field.number().optional().default(0).index(),
  
  // Object with schema (Zod style)
  address: field.object(t => ({
    detail: t.string(),
    post: t.string(),
    zipCode: t.number().optional(),
  })).optional().default({ detail: '', post: '' }),
  
  // Array (Zod style: .array() at the end)
  tags: field.string().array().optional(),
  
  // Tuple
  coordinate: field.tuple(t => [t.number(), t.number()]).optional(),
  
  // Enum
  status: field.enum(['active', 'inactive', 'pending'] as const).default('active'),
  
  // Native Enum
  role: field.nativeEnum(UserRole).default(UserRole.User),
});

const postsStore = defineStore('posts', {
  id: field.number().primaryKey(),
  title: field.string(),
  content: field.string(),
  authorId: field.string().index(),
  createdAt: field.date().default(new Date()),
})

// ============================================================================
// 2. Type Inference from Store
// ============================================================================

// 간단하게 타입 추출!
type User = InferStore<typeof usersStore>;
type Post = InferStore<typeof postsStore>;

// ============================================================================
// 3. Create Database & Usage
// ============================================================================

async function main() {
  alert('하이')
  await deleteDB('ExampleApp');

  const db = await openDB({
    name: 'ExampleApp',
    version: 1,
    stores: [usersStore, postsStore] as const,
  });

  console.log(`Database "${db.name}" v${db.version} opened`);

  // --- CRUD Operations ---

  await db.users.put({
    id: 'u1',
    name: 'Kim',
    email: 'kim@test.com',
    // optional 필드들 생략 가능 - default 적용됨
  });

  await db.users.put({
    id: 'u2',
    name: 'Lee',
    email: 'lee@test.com',
    age: 25,
    tags: ['developer', 'designer'],
    coordinate: [37.5665, 126.9780],  // tuple
    status: 'active',
    role: UserRole.Admin,
  });

  await db.users.put({
    id: 'u3',
    name: 'Kim Junior',
    email: 'kimjr@test.com',
    age: 18,
    address: {
      detail: 'Seoul',
      post: '12345',
      zipCode: 12345,
    },
  });

  // Get user - default 적용됨
  const user = await db.users.get('u1');
  if (user) {
    console.log('User:', user);
    console.log('Age (default):', user.age);  // 0
    console.log('Status (default):', user.status);  // 'active'
    console.log('Role (default):', user.role);  // UserRole.User
  }

  // Posts
  await db.posts.put({
    id: 1,
    title: 'Hello World',
    content: 'First post!',
    authorId: 'u1',
  });

  // ================================
  // Query API
  // ================================

  // Object 스타일 - index와 where 분리
  const youngUsers = await db.users.query({
    index: 'age',
    where: { lte: 30, },
    orderBy: 'asc',
    limit: 5,
    offset: 10
  });
  console.log('Young users:', youngUsers);

  // Builder 스타일
  const adultUsers = await db.users
    .query()
    .index('age')
    .gte(20)
    .orderBy('desc')
    .limit(10)
    .findAll();
  console.log('Adult users:', adultUsers);

  // 단일 조회
  const firstKim = await db.users
    .query()
    .index('name')
    .startsWith('Kim')
    .offset(100)
    .limit(100)
    .find();
  console.log('First Kim:', firstKim);

  // Prefix 검색
  const kimUsers = await db.users.query({
    index: 'email',
    where: { startsWith: 'Kim' },
  });
  console.log('Users starting with Kim:', kimUsers);

  // ================================
  // Transaction (multi-store atomic operations)
  // ================================

  // 트랜잭션 시작 - 사용할 스토어 명시
  const tx = db.startTransaction(['users', 'posts'], { 
    mode: 'write',
  });

  // 동기적으로 요청 쌓기 (await 없이!)
  tx.users.put({
    id: 'u4',
    name: 'Park',
    email: 'park@test.com',
  });
  tx.posts.put({
    id: 2,
    title: 'Second Post',
    content: 'Hello from Park',
    authorId: 'u4',
  });

  // 모든 요청 완료 대기
  await tx.commit();
  console.log('Transaction committed!');

  // 확인
  const newUser = await db.users.get('u4');
  console.log('New user from transaction:', newUser);

  db.close();
  console.log('Done!');
}

export { main };
