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
