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
