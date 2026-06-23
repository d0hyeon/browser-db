import type { SchemaStoreDefinition } from './schema.js';

/**
 * 검증 리졸버 확장 지점. 코어는 이 추상만 알고 Zod 등 구현은 모른다.
 * createValidator는 record를 받아 검증하고, 실패 시 throw하는 함수를 만든다.
 */
export interface StoreResolver {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createValidator(store: SchemaStoreDefinition<any, string>): (record: unknown) => void;
}
