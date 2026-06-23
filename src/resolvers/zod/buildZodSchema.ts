import { z, type ZodObject, type ZodRawShape } from 'zod';
import type { FieldDef, StoreSchema } from '../../field.js';
import { toZodType } from './toZodType.js';

export function buildZodSchema(schema: StoreSchema): ZodObject<ZodRawShape> {
  const shape: Record<string, ReturnType<typeof toZodType>> = {};
  for (const [name, builder] of Object.entries(schema)) {
    shape[name] = toZodType((builder as { _def: FieldDef })._def);
  }
  return z.object(shape as ZodRawShape);
}
