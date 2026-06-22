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

  it('query 경로에서도 스키마 불일치 데이터를 throw한다', async () => {
    const users = defineStore('u', {
      id: field.string().primaryKey(),
      age: field.number(),
    }).use(zodResolver());
    const db = openDB({ name: 'rz-query', version: 1, stores: [users] as const });
    await db.waitForReady();
    // 정상 레코드 하나 + 불일치 레코드 하나
    await db.u.put({ id: 'ok', age: 1 });
    await db.u.raw(s => s.put({ id: 'bad' }));
    await expect(db.u.query().findAll()).rejects.toThrow();
    db.close();
  });

  it('query find() 경로에서도 스키마 불일치 데이터를 throw한다', async () => {
    const users = defineStore('u', {
      id: field.string().primaryKey(),
      age: field.number(),
    }).use(zodResolver());
    const db = openDB({ name: 'rz-find', version: 1, stores: [users] as const });
    await db.waitForReady();
    await db.u.raw(s => s.put({ id: 'bad' }));
    await expect(db.u.query().find()).rejects.toThrow();
    db.close();
  });
});
