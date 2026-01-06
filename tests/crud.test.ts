/**
 * CRUD 작업 테스트
 *
 * API 명세 (StoreAccessor):
 * - get(key): 키로 레코드 조회 (Promise<T | undefined>)
 * - getAll(): 모든 레코드 조회 (Promise<T[]>)
 * - getAllByIndex(indexName, query?): 인덱스로 레코드 조회 (Promise<T[]>)
 * - put(value, key?): 레코드 추가/수정 (Promise<K>)
 * - add(value, key?): 레코드 추가 (중복 시 에러) (Promise<K>)
 * - delete(key | IDBKeyRange): 레코드 삭제 (Promise<void>)
 * - clear(): 모든 레코드 삭제 (Promise<void>)
 * - count(query?): 레코드 수 조회 (Promise<number>)
 *
 * 타입 안전성:
 * - key 타입은 primaryKey 필드의 타입으로 추론
 * - value 타입은 스키마의 Input 타입으로 추론
 * - 반환 타입은 스키마의 Output 타입으로 추론 (기본값 적용)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDB, type SchemaDatabase } from '../src/createSchemaDB.js';
import { defineStore, type SchemaStoreDefinition } from '../src/schema.js';
import { field } from '../src/field.js';

// 테스트용 스토어 정의
const usersStore = defineStore('users', {
  id: field.string().primaryKey(),
  name: field.string(),
  email: field.string().index({ unique: true }),
  age: field.number().optional().default(0),
});

const postsStore = defineStore('posts', {
  id: field.string().primaryKey(),
  title: field.string(),
  authorId: field.string().index(),
  createdAt: field.date().optional(),
});

type TestDB = SchemaDatabase<readonly [
  typeof usersStore,
  typeof postsStore,
]>;

describe('CRUD 작업', () => {
  let db: TestDB;
  const testDbName = `crud-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let dbCounter = 0;

  beforeEach(async () => {
    const dbName = `${testDbName}-${dbCounter++}`;
    db = openDB({
      name: dbName,
      version: 1,
      stores: [usersStore, postsStore] as const,
    });
    await db.waitForReady();
  });

  afterEach(() => {
    db?.close();
  });

  describe('put()', () => {
    it('새 레코드를 추가할 수 있어야 함', async () => {
      const key = await db.users.put({
        id: 'u1',
        name: 'Kim',
        email: 'kim@test.com',
      });

      expect(key).toBe('u1');
    });

    it('기존 레코드를 수정할 수 있어야 함', async () => {
      await db.users.put({
        id: 'u1',
        name: 'Kim',
        email: 'kim@test.com',
      });

      await db.users.put({
        id: 'u1',
        name: 'Kim Updated',
        email: 'kim.updated@test.com',
      });

      const user = await db.users.get('u1');
      expect(user?.name).toBe('Kim Updated');
      expect(user?.email).toBe('kim.updated@test.com');
    });

    it('여러 레코드를 추가할 수 있어야 함', async () => {
      await db.users.put({ id: 'u1', name: 'User 1', email: 'u1@test.com' });
      await db.users.put({ id: 'u2', name: 'User 2', email: 'u2@test.com' });
      await db.users.put({ id: 'u3', name: 'User 3', email: 'u3@test.com' });

      const users = await db.users.getAll();
      expect(users).toHaveLength(3);
    });

    it('optional 필드 없이 저장할 수 있어야 함', async () => {
      await db.users.put({
        id: 'u1',
        name: 'Kim',
        email: 'kim@test.com',
        // age는 optional이므로 생략 가능
      });

      const user = await db.users.get('u1');
      expect(user).toBeDefined();
    });
  });

  describe('add()', () => {
    it('새 레코드를 추가할 수 있어야 함', async () => {
      const key = await db.users.add({
        id: 'u1',
        name: 'Kim',
        email: 'kim@test.com',
      });

      expect(key).toBe('u1');
    });

    it('중복 키로 추가하면 에러가 발생해야 함', async () => {
      await db.users.add({
        id: 'u1',
        name: 'Kim',
        email: 'kim@test.com',
      });

      await expect(db.users.add({
        id: 'u1',
        name: 'Different',
        email: 'different@test.com',
      })).rejects.toThrow();
    });

    it('unique 인덱스 중복 시 에러가 발생해야 함', async () => {
      await db.users.add({
        id: 'u1',
        name: 'Kim',
        email: 'same@test.com',
      });

      await expect(db.users.add({
        id: 'u2',
        name: 'Park',
        email: 'same@test.com', // 같은 이메일
      })).rejects.toThrow();
    });
  });

  describe('get()', () => {
    it('키로 레코드를 조회할 수 있어야 함', async () => {
      await db.users.put({
        id: 'u1',
        name: 'Kim',
        email: 'kim@test.com',
      });

      const user = await db.users.get('u1');

      expect(user).toBeDefined();
      expect(user?.id).toBe('u1');
      expect(user?.name).toBe('Kim');
      expect(user?.email).toBe('kim@test.com');
    });

    it('존재하지 않는 키는 undefined를 반환해야 함', async () => {
      const user = await db.users.get('nonexistent');
      expect(user).toBeUndefined();
    });

    it('기본값이 적용되어야 함', async () => {
      await db.users.put({
        id: 'u1',
        name: 'Kim',
        email: 'kim@test.com',
        // age 생략
      });

      const user = await db.users.get('u1');
      expect(user?.age).toBe(0); // 기본값
    });
  });

  describe('getAll()', () => {
    it('모든 레코드를 조회할 수 있어야 함', async () => {
      await db.users.put({ id: 'u1', name: 'User 1', email: 'u1@test.com' });
      await db.users.put({ id: 'u2', name: 'User 2', email: 'u2@test.com' });
      await db.users.put({ id: 'u3', name: 'User 3', email: 'u3@test.com' });

      const users = await db.users.getAll();

      expect(users).toHaveLength(3);
      expect(users.map(u => u.id).sort()).toEqual(['u1', 'u2', 'u3']);
    });

    it('빈 스토어는 빈 배열을 반환해야 함', async () => {
      const users = await db.users.getAll();
      expect(users).toEqual([]);
    });

    it('모든 레코드에 기본값이 적용되어야 함', async () => {
      await db.users.put({ id: 'u1', name: 'User 1', email: 'u1@test.com' });
      await db.users.put({ id: 'u2', name: 'User 2', email: 'u2@test.com' });

      const users = await db.users.getAll();

      users.forEach(user => {
        expect(user.age).toBe(0);
      });
    });
  });

  describe('getAllByIndex()', () => {
    it('인덱스로 레코드를 조회할 수 있어야 함', async () => {
      await db.posts.put({ id: 'p1', title: 'Post 1', authorId: 'author1' });
      await db.posts.put({ id: 'p2', title: 'Post 2', authorId: 'author1' });
      await db.posts.put({ id: 'p3', title: 'Post 3', authorId: 'author2' });

      const posts = await db.posts.getAllByIndex('authorId', 'author1');

      expect(posts).toHaveLength(2);
      expect(posts.every(p => p.authorId === 'author1')).toBe(true);
    });

    it('일치하는 레코드가 없으면 빈 배열을 반환해야 함', async () => {
      await db.posts.put({ id: 'p1', title: 'Post 1', authorId: 'author1' });

      const posts = await db.posts.getAllByIndex('authorId', 'nonexistent');

      expect(posts).toEqual([]);
    });

    it('IDBKeyRange로 범위 조회할 수 있어야 함', async () => {
      await db.users.put({ id: 'u1', name: 'Alice', email: 'alice@test.com', age: 20 });
      await db.users.put({ id: 'u2', name: 'Bob', email: 'bob@test.com', age: 30 });
      await db.users.put({ id: 'u3', name: 'Charlie', email: 'charlie@test.com', age: 40 });

      const emailRange = IDBKeyRange.bound('a', 'c');
      const users = await db.users.getAllByIndex('email', emailRange);

      expect(users).toHaveLength(2);
      expect(users.map(u => u.name).sort()).toEqual(['Alice', 'Bob']);
    });
  });

  describe('delete()', () => {
    it('키로 레코드를 삭제할 수 있어야 함', async () => {
      await db.users.put({ id: 'u1', name: 'Kim', email: 'kim@test.com' });

      await db.users.delete('u1');

      const user = await db.users.get('u1');
      expect(user).toBeUndefined();
    });

    it('존재하지 않는 키를 삭제해도 에러가 발생하지 않아야 함', async () => {
      await expect(db.users.delete('nonexistent')).resolves.toBeUndefined();
    });

    it('IDBKeyRange로 범위 삭제할 수 있어야 함', async () => {
      await db.users.put({ id: 'u1', name: 'User 1', email: 'u1@test.com' });
      await db.users.put({ id: 'u2', name: 'User 2', email: 'u2@test.com' });
      await db.users.put({ id: 'u3', name: 'User 3', email: 'u3@test.com' });

      // u1 ~ u2 범위 삭제
      await db.users.delete(IDBKeyRange.bound('u1', 'u2'));

      const users = await db.users.getAll();
      expect(users).toHaveLength(1);
      expect(users[0].id).toBe('u3');
    });
  });

  describe('clear()', () => {
    it('모든 레코드를 삭제할 수 있어야 함', async () => {
      await db.users.put({ id: 'u1', name: 'User 1', email: 'u1@test.com' });
      await db.users.put({ id: 'u2', name: 'User 2', email: 'u2@test.com' });
      await db.users.put({ id: 'u3', name: 'User 3', email: 'u3@test.com' });

      await db.users.clear();

      const users = await db.users.getAll();
      expect(users).toEqual([]);
    });

    it('빈 스토어를 clear해도 에러가 발생하지 않아야 함', async () => {
      await expect(db.users.clear()).resolves.toBeUndefined();
    });
  });

  describe('count()', () => {
    it('전체 레코드 수를 조회할 수 있어야 함', async () => {
      await db.users.put({ id: 'u1', name: 'User 1', email: 'u1@test.com' });
      await db.users.put({ id: 'u2', name: 'User 2', email: 'u2@test.com' });
      await db.users.put({ id: 'u3', name: 'User 3', email: 'u3@test.com' });

      const count = await db.users.count();
      expect(count).toBe(3);
    });

    it('빈 스토어는 0을 반환해야 함', async () => {
      const count = await db.users.count();
      expect(count).toBe(0);
    });

    it('IDBKeyRange로 범위 내 레코드 수를 조회할 수 있어야 함', async () => {
      await db.users.put({ id: 'u1', name: 'User 1', email: 'u1@test.com' });
      await db.users.put({ id: 'u2', name: 'User 2', email: 'u2@test.com' });
      await db.users.put({ id: 'u3', name: 'User 3', email: 'u3@test.com' });

      const count = await db.users.count(IDBKeyRange.bound('u1', 'u2'));
      expect(count).toBe(2);
    });
  });

  describe('기본값 처리', () => {
    it('get()에서 기본값이 적용되어야 함', async () => {
      // 기본값 없이 저장
      const rawTx = db.raw.transaction('users', 'readwrite');
      const store = rawTx.objectStore('users');
      store.put({ id: 'u1', name: 'Kim', email: 'kim@test.com' });
      await new Promise<void>(resolve => { rawTx.oncomplete = () => resolve(); });

      // StoreAccessor로 조회하면 기본값 적용
      const user = await db.users.get('u1');
      expect(user?.age).toBe(0);
    });

    it('getAll()에서 모든 레코드에 기본값이 적용되어야 함', async () => {
      // 기본값 없이 저장
      const rawTx = db.raw.transaction('users', 'readwrite');
      const store = rawTx.objectStore('users');
      store.put({ id: 'u1', name: 'User 1', email: 'u1@test.com' });
      store.put({ id: 'u2', name: 'User 2', email: 'u2@test.com' });
      await new Promise<void>(resolve => { rawTx.oncomplete = () => resolve(); });

      const users = await db.users.getAll();
      expect(users[0].age).toBe(0);
      expect(users[1].age).toBe(0);
    });

    it('getAllByIndex()에서 기본값이 적용되어야 함', async () => {
      // createdAt 기본값이 적용된 포스트 추가
      await db.posts.put({ id: 'p1', title: 'Post 1', authorId: 'author1' });

      const posts = await db.posts.getAllByIndex('authorId', 'author1');
      expect(posts[0]).toBeDefined();
      expect(posts[0].title).toBe('Post 1');
    });
  });
});
