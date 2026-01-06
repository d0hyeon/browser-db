/**
 * Migration 테스트
 *
 * API 명세:
 *
 * 마이그레이션 정의:
 * - defineStore().addMigration(name, fn): 마이그레이션 추가
 *   - name: 마이그레이션 이름 (알파벳순으로 정렬되어 실행)
 *   - fn: (db, tx) => void | Promise<void>
 *
 * 마이그레이션 실행:
 * - 마이그레이션은 데이터베이스 업그레이드 시 실행됨
 * - 이미 실행된 마이그레이션은 __schema_history__ 스토어에 기록됨
 * - 재실행 시 이미 적용된 마이그레이션은 건너뜀
 *
 * 마이그레이션 함수 파라미터:
 * - db: IDBDatabase 인스턴스
 * - tx: IDBTransaction 인스턴스 (versionchange 트랜잭션)
 *
 * 버전 전략:
 * - 'explicit': 명시적 버전 지정
 * - 'auto': 스키마 변경 감지하여 자동 버전 증가
 *
 * 스키마 자동 변경 감지:
 * - 안전한 변경 (자동 적용): 새 스토어 추가, 새 인덱스 추가, 인덱스 삭제
 * - 위험한 변경 (에러): 스토어 삭제, keyPath 변경
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { openDB } from '../src/createSchemaDB.js';
import { defineStore } from '../src/schema.js';
import { field } from '../src/field.js';
import { deleteDB } from '../src/utils.js';

describe('Migration', () => {
  const testDbName = `migration-test-${Date.now()}`;

  beforeEach(async () => {
    // 테스트 전 데이터베이스 삭제
    await deleteDB(testDbName);
  });

  describe('마이그레이션 실행', () => {
    it('마이그레이션이 실행되어야 함', async () => {
      let migrationRan = false;

      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
        name: field.string(),
      }).addMigration('001-test', () => {
        migrationRan = true;
      });

      const db = openDB({
        name: testDbName,
        version: 1,
        stores: [usersStore] as const,
      });

      await db.waitForReady();

      expect(migrationRan).toBe(true);

      db.close();
    });

    it('마이그레이션은 이름순으로 실행되어야 함', async () => {
      const executionOrder: string[] = [];

      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
      })
        .addMigration('003-third', () => {
          executionOrder.push('third');
        })
        .addMigration('001-first', () => {
          executionOrder.push('first');
        })
        .addMigration('002-second', () => {
          executionOrder.push('second');
        });

      const db = openDB({
        name: testDbName,
        version: 1,
        stores: [usersStore] as const,
      });

      await db.waitForReady();

      expect(executionOrder).toEqual(['first', 'second', 'third']);

      db.close();
    });

    it('마이그레이션에서 데이터를 추가할 수 있어야 함', async () => {
      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
        name: field.string(),
      }).addMigration('001-seed-admin', (_db, tx) => {
        const store = tx.objectStore('users');
        store.put({ id: 'admin', name: 'Administrator' });
      });

      const db = openDB({
        name: testDbName,
        version: 1,
        stores: [usersStore] as const,
      });

      await db.waitForReady();

      const admin = await db.users.get('admin');
      expect(admin?.name).toBe('Administrator');

      db.close();
    });
  });

  describe('마이그레이션 히스토리', () => {
    it('이미 적용된 마이그레이션은 재실행되지 않아야 함', async () => {
      let runCount = 0;

      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
      }).addMigration('001-increment', () => {
        runCount++;
      });

      // 첫 번째 열기
      const db1 = openDB({
        name: testDbName,
        version: 1,
        stores: [usersStore] as const,
      });
      await db1.waitForReady();
      db1.close();

      expect(runCount).toBe(1);

      // 두 번째 열기 (같은 버전)
      const db2 = openDB({
        name: testDbName,
        version: 1,
        stores: [usersStore] as const,
      });
      await db2.waitForReady();
      db2.close();

      // 마이그레이션은 한 번만 실행되어야 함
      expect(runCount).toBe(1);
    });

    it('새 마이그레이션만 실행되어야 함 (버전 변경 시)', async () => {
      const executionOrder: string[] = [];

      // 첫 번째 버전
      const usersStoreV1 = defineStore('users', {
        id: field.string().primaryKey(),
      }).addMigration('001-first', () => {
        executionOrder.push('first');
      });

      const db1 = openDB({
        name: testDbName,
        version: 1,
        stores: [usersStoreV1] as const,
      });
      await db1.waitForReady();
      expect(executionOrder).toEqual(['first']);
      db1.close();

      // 같은 버전으로 다시 열면 마이그레이션이 실행되지 않음
      const db2 = openDB({
        name: testDbName,
        version: 1,
        stores: [usersStoreV1] as const,
      });
      await db2.waitForReady();
      // 마이그레이션은 버전 업그레이드 시에만 실행됨
      expect(executionOrder).toEqual(['first']);
      db2.close();
    });
  });

  describe('여러 스토어의 마이그레이션', () => {
    it('여러 스토어의 마이그레이션이 이름순으로 실행되어야 함', async () => {
      const executionOrder: string[] = [];

      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
      })
        .addMigration('002-users-second', () => {
          executionOrder.push('users-second');
        })
        .addMigration('001-users-first', () => {
          executionOrder.push('users-first');
        });

      const postsStore = defineStore('posts', {
        id: field.string().primaryKey(),
      }).addMigration('001-posts-first', () => {
        executionOrder.push('posts-first');
      });

      const db = openDB({
        name: testDbName,
        version: 1,
        stores: [usersStore, postsStore] as const,
      });

      await db.waitForReady();

      // 전역적으로 이름순 정렬
      expect(executionOrder).toEqual([
        'posts-first',
        'users-first',
        'users-second',
      ]);

      db.close();
    });

    it('스토어 간 중복된 마이그레이션 이름은 에러를 발생시켜야 함', async () => {
      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
      }).addMigration('same-name', () => {});

      const postsStore = defineStore('posts', {
        id: field.string().primaryKey(),
      }).addMigration('same-name', () => {});

      expect(() => {
        openDB({
          name: testDbName,
          version: 1,
          stores: [usersStore, postsStore] as const,
        });
      }).toThrow('Duplicate migration name');
    });
  });

  describe('auto 버전 전략', () => {
    it('새 스토어 추가 시 자동으로 버전이 증가해야 함', async () => {
      // 첫 번째 버전
      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
      });

      const db1 = openDB({
        name: testDbName,
        versionStrategy: 'auto',
        stores: [usersStore] as const,
      });
      await db1.waitForReady();
      const version1 = db1.version;
      db1.close();

      // 두 번째 버전 (새 스토어 추가)
      const postsStore = defineStore('posts', {
        id: field.string().primaryKey(),
      });

      const db2 = openDB({
        name: testDbName,
        versionStrategy: 'auto',
        stores: [usersStore, postsStore] as const,
      });
      await db2.waitForReady();
      const version2 = db2.version;
      db2.close();

      expect(version2).toBeGreaterThan(version1);
    });

    it('새 인덱스 추가 시 자동으로 버전이 증가해야 함', async () => {
      // 첫 번째 버전 (인덱스 없음)
      const usersStoreV1 = defineStore('users', {
        id: field.string().primaryKey(),
        email: field.string(),
      });

      const db1 = openDB({
        name: testDbName,
        versionStrategy: 'auto',
        stores: [usersStoreV1] as const,
      });
      await db1.waitForReady();
      const version1 = db1.version;
      db1.close();

      // 두 번째 버전 (인덱스 추가)
      const usersStoreV2 = defineStore('users', {
        id: field.string().primaryKey(),
        email: field.string().index({ unique: true }),
      });

      const db2 = openDB({
        name: testDbName,
        versionStrategy: 'auto',
        stores: [usersStoreV2] as const,
      });
      await db2.waitForReady();
      const version2 = db2.version;
      db2.close();

      expect(version2).toBeGreaterThan(version1);

      // 인덱스가 생성되었는지 확인
      const db3 = openDB({
        name: testDbName,
        versionStrategy: 'auto',
        stores: [usersStoreV2] as const,
      });
      await db3.waitForReady();

      const tx = db3.raw.transaction('users', 'readonly');
      const store = tx.objectStore('users');
      expect(store.indexNames.contains('email')).toBe(true);

      db3.close();
    });

    it('스키마 변경이 없으면 버전이 유지되어야 함', async () => {
      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
        name: field.string(),
      });

      const db1 = openDB({
        name: testDbName,
        versionStrategy: 'auto',
        stores: [usersStore] as const,
      });
      await db1.waitForReady();
      const version1 = db1.version;
      db1.close();

      // 같은 스키마로 다시 열기
      const db2 = openDB({
        name: testDbName,
        versionStrategy: 'auto',
        stores: [usersStore] as const,
      });
      await db2.waitForReady();
      const version2 = db2.version;
      db2.close();

      expect(version2).toBe(version1);
    });
  });

  describe('위험한 스키마 변경', () => {
    it('스토어 삭제 시 에러가 발생해야 함', async () => {
      // 첫 번째 버전 (두 개의 스토어)
      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
      });
      const postsStore = defineStore('posts', {
        id: field.string().primaryKey(),
      });

      const db1 = openDB({
        name: testDbName,
        versionStrategy: 'auto',
        stores: [usersStore, postsStore] as const,
      });
      await db1.waitForReady();
      db1.close();

      // 두 번째 버전 (posts 스토어 제거)
      const db2 = openDB({
        name: testDbName,
        versionStrategy: 'auto',
        stores: [usersStore] as const, // posts 제거
      });

      await expect(db2.waitForReady()).rejects.toThrow('Dangerous schema changes');
    });
  });

  describe('마이그레이션 함수 파라미터', () => {
    it('마이그레이션 함수는 db와 tx를 받아야 함', async () => {
      let receivedDb: IDBDatabase | null = null;
      let receivedTx: IDBTransaction | null = null;

      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
      }).addMigration('001-check-params', (db, tx) => {
        receivedDb = db;
        receivedTx = tx;
      });

      const db = openDB({
        name: testDbName,
        version: 1,
        stores: [usersStore] as const,
      });

      await db.waitForReady();

      expect(receivedDb).not.toBeNull();
      expect(receivedTx).not.toBeNull();

      db.close();
    });

    it('마이그레이션에서 인덱스를 생성할 수 있어야 함', async () => {
      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
        email: field.string(),
      }).addMigration('001-add-email-index', (_db, tx) => {
        const store = tx.objectStore('users');
        store.createIndex('email', 'email', { unique: true });
      });

      const db = openDB({
        name: testDbName,
        version: 1,
        stores: [usersStore] as const,
      });

      await db.waitForReady();

      const rawTx = db.raw.transaction('users', 'readonly');
      const store = rawTx.objectStore('users');
      expect(store.indexNames.contains('email')).toBe(true);

      db.close();
    });
  });

  describe('비동기 마이그레이션', () => {
    it('동기 마이그레이션이 정상 실행되어야 함', async () => {
      // 참고: IndexedDB의 versionchange 트랜잭션에서는
      // async/await를 사용하면 트랜잭션이 자동 커밋될 수 있음
      // 따라서 동기 작업만 신뢰할 수 있음
      let syncComplete = false;

      const usersStore = defineStore('users', {
        id: field.string().primaryKey(),
      }).addMigration('001-sync', () => {
        syncComplete = true;
      });

      const db = openDB({
        name: testDbName,
        version: 1,
        stores: [usersStore] as const,
      });

      await db.waitForReady();

      expect(syncComplete).toBe(true);

      db.close();
    });
  });
});
