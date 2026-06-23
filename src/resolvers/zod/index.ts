import type { StoreResolver } from '../../resolver.js';
import { buildZodSchema } from './buildZodSchema.js';

/**
 * Zod 기반 검증 리졸버 팩토리.
 * store의 스키마로 ZodObject를 한 번 생성하고,
 * 레코드 반환 전 parse()로 검증한다.
 */
export function zodResolver(): StoreResolver {
  return {
    name: 'zod',
    createValidator(store) {
      const schema = buildZodSchema(store.schema);
      return (record: unknown) => { schema.parse(record); };
    },
  };
}
