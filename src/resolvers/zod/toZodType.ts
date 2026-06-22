import { z, type ZodTypeAny } from 'zod';
import type { FieldDef } from '../../field.js';

function baseFromKind(def: FieldDef): ZodTypeAny {
  switch (def._kind) {
    case 'string': return z.string();
    case 'number': return z.number();
    case 'boolean': return z.boolean();
    case 'date': return z.date();
    case 'enum':
    case 'nativeEnum':
      return z.enum((def._enumValues ?? []) as [string, ...string[]]);
    case 'object': {
      const shape: Record<string, ZodTypeAny> = {};
      for (const [k, v] of Object.entries(def._shape ?? {})) {
        shape[k] = toZodType(v);
      }
      return z.object(shape);
    }
    case 'tuple':
      return z.tuple((def._items ?? []).map(toZodType) as [ZodTypeAny, ...ZodTypeAny[]]);
    case 'array':
      return z.array(def._element ? toZodType(def._element) : z.any());
    case 'custom':
    default:
      return z.any();
  }
}

export function toZodType(def: FieldDef): ZodTypeAny {
  let schema = baseFromKind(def);
  if (def._optional) schema = schema.optional();
  // validation은 _optional 여부만으로 결정한다. _hasDefault는 쓰기 주입이므로 유효성 검사와 무관하다.
  return schema;
}
