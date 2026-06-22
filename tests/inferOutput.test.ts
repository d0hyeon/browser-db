/**
 * Type-level tests for InferOutput
 *
 * These assertions are verified at runtime by vitest's expectTypeOf,
 * which checks structural type compatibility. They also serve as
 * documentation for the expected output type semantics:
 *
 *   - required field:              T
 *   - required + default:          T        (default is write-time only, not output-time)
 *   - optional field:              T | undefined
 *   - optional + default:          T | undefined  ← the bug this test guards
 *   - autoIncrement primary key:   T        (IDB engine always fills it)
 */
import { describe, it, expectTypeOf } from 'vitest';
import { defineStore } from '../src/schema.js';
import { field } from '../src/field.js';
import type { InferOutput } from '../src/field.js';

const testStore = defineStore('test', {
  id: field.number().primaryKey({ autoIncrement: true }),
  required: field.number(),
  requiredWithDefault: field.number().default(0),
  optional: field.number().optional(),
  optionalWithDefault: field.number().optional().default(0),
});

type Output = InferOutput<typeof testStore['schema']>;

describe('InferOutput 타입 추론', () => {
  it('autoIncrement primaryKey는 항상 number여야 함 (IDB 엔진이 보장)', () => {
    expectTypeOf<Output['id']>().toEqualTypeOf<number>();
  });

  it('required 필드는 number여야 함', () => {
    expectTypeOf<Output['required']>().toEqualTypeOf<number>();
  });

  it('required + default 필드는 number여야 함 (default는 output 타입 무관)', () => {
    expectTypeOf<Output['requiredWithDefault']>().toEqualTypeOf<number>();
  });

  it('optional 필드는 number | undefined여야 함', () => {
    expectTypeOf<Output['optional']>().toEqualTypeOf<number | undefined>();
  });

  it('optional + default 필드는 number | undefined여야 함 (default가 nullable을 없애지 않음)', () => {
    expectTypeOf<Output['optionalWithDefault']>().toEqualTypeOf<number | undefined>();
  });
});
