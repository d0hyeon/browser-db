/**
 * Field Builder 테스트
 *
 * API 명세:
 * - field.string(): 문자열 필드 생성
 * - field.number(): 숫자 필드 생성
 * - field.boolean(): 불리언 필드 생성
 * - field.date(): 날짜 필드 생성
 * - field.object(schema): 객체 필드 생성 (중첩 스키마 지원)
 * - field.tuple(schema): 튜플 필드 생성
 * - field.enum(values): 열거형 필드 생성
 * - field.nativeEnum(enumObj): TypeScript 네이티브 열거형 필드 생성
 *
 * 체인 메서드:
 * - .optional(): 필드를 선택적으로 만듦 (undefined 허용)
 * - .default(value): 기본값 설정
 * - .primaryKey(): 기본 키로 지정
 * - .index(options?): 인덱스 생성 (unique, multiEntry 옵션)
 * - .array(): 배열 타입으로 변환
 */
import { describe, it, expect } from 'vitest';
import { field } from '../src/field.js';

describe('Field Builder', () => {
  describe('기본 타입 필드', () => {
    it('field.string()은 문자열 필드를 생성해야 함', () => {
      const f = field.string();
      expect(f._def._optional).toBe(false);
      expect(f._def._hasDefault).toBe(false);
      expect(f._def._isPrimaryKey).toBe(false);
      expect(f._def._isIndexed).toBe(false);
    });

    it('field.number()는 숫자 필드를 생성해야 함', () => {
      const f = field.number();
      expect(f._def._optional).toBe(false);
      expect(f._def._hasDefault).toBe(false);
    });

    it('field.boolean()은 불리언 필드를 생성해야 함', () => {
      const f = field.boolean();
      expect(f._def._optional).toBe(false);
    });

    it('field.date()는 날짜 필드를 생성해야 함', () => {
      const f = field.date();
      expect(f._def._optional).toBe(false);
    });
  });

  describe('체인 메서드 - optional()', () => {
    it('optional()은 필드를 선택적으로 만들어야 함', () => {
      const f = field.string().optional();
      expect(f._def._optional).toBe(true);
      expect(f._def._hasDefault).toBe(false);
    });

    it('optional()은 원본 필드를 변경하지 않아야 함', () => {
      const original = field.string();
      const optional = original.optional();

      expect(original._def._optional).toBe(false);
      expect(optional._def._optional).toBe(true);
    });
  });

  describe('체인 메서드 - default()', () => {
    it('default()는 기본값을 설정해야 함', () => {
      const f = field.string().default('hello');
      expect(f._def._hasDefault).toBe(true);
      expect(f._def._default).toBe('hello');
    });

    it('default()는 숫자 기본값을 지원해야 함', () => {
      const f = field.number().default(42);
      expect(f._def._hasDefault).toBe(true);
      expect(f._def._default).toBe(42);
    });

    it('optional()과 default()를 함께 사용할 수 있어야 함', () => {
      const f = field.number().optional().default(0);
      expect(f._def._optional).toBe(true);
      expect(f._def._hasDefault).toBe(true);
      expect(f._def._default).toBe(0);
    });
  });

  describe('체인 메서드 - primaryKey()', () => {
    it('primaryKey()는 필드를 기본 키로 지정해야 함', () => {
      const f = field.string().primaryKey();
      expect(f._def._isPrimaryKey).toBe(true);
    });

    it('primaryKey()는 원본 필드를 변경하지 않아야 함', () => {
      const original = field.string();
      const pk = original.primaryKey();

      expect(original._def._isPrimaryKey).toBe(false);
      expect(pk._def._isPrimaryKey).toBe(true);
    });
  });

  describe('체인 메서드 - index()', () => {
    it('index()는 기본 인덱스를 생성해야 함', () => {
      const f = field.string().index();
      expect(f._def._isIndexed).toBe(true);
      expect(f._def._indexOptions).toBeUndefined();
    });

    it('index({ unique: true })는 유니크 인덱스를 생성해야 함', () => {
      const f = field.string().index({ unique: true });
      expect(f._def._isIndexed).toBe(true);
      expect(f._def._indexOptions?.unique).toBe(true);
    });

    it('index({ multiEntry: true })는 멀티엔트리 인덱스를 생성해야 함', () => {
      const f = field.string().index({ multiEntry: true });
      expect(f._def._isIndexed).toBe(true);
      expect(f._def._indexOptions?.multiEntry).toBe(true);
    });

    it('index()는 unique와 multiEntry 둘 다 설정할 수 있어야 함', () => {
      const f = field.string().index({ unique: true, multiEntry: true });
      expect(f._def._indexOptions?.unique).toBe(true);
      expect(f._def._indexOptions?.multiEntry).toBe(true);
    });
  });

  describe('체인 메서드 - array()', () => {
    it('array()는 배열 타입으로 변환해야 함', () => {
      const f = field.string().array();
      expect(f._def._optional).toBe(false);
    });

    it('array()와 optional()을 함께 사용할 수 있어야 함', () => {
      const f = field.string().array().optional();
      expect(f._def._optional).toBe(true);
    });
  });

  describe('복합 타입 - object()', () => {
    it('field.object()는 중첩 스키마를 지원해야 함', () => {
      const f = field.object({
        name: field.string(),
        age: field.number().optional(),
      });

      expect(f._def._optional).toBe(false);
      expect(f._def._hasDefault).toBe(false);
    });

    it('field.object()에 default를 설정할 수 있어야 함', () => {
      const f = field.object({
        name: field.string(),
        age: field.number(),
      }).default({ name: '', age: 0 });

      expect(f._def._hasDefault).toBe(true);
      expect(f._def._default).toEqual({ name: '', age: 0 });
    });

    it('field.object()를 optional로 만들 수 있어야 함', () => {
      const f = field.object({
        city: field.string(),
        zipCode: field.string(),
      }).optional();

      expect(f._def._optional).toBe(true);
    });
  });

  describe('복합 타입 - tuple()', () => {
    it('field.tuple()은 튜플 타입을 생성해야 함', () => {
      const f = field.tuple([field.number(), field.number()]);
      expect(f._def._optional).toBe(false);
    });

    it('field.tuple()에 optional을 적용할 수 있어야 함', () => {
      const f = field.tuple([field.string(), field.number()]).optional();
      expect(f._def._optional).toBe(true);
    });
  });

  describe('복합 타입 - enum()', () => {
    it('field.enum()은 문자열 리터럴 열거형을 생성해야 함', () => {
      const f = field.enum(['active', 'inactive', 'pending'] as const);
      expect(f._def._optional).toBe(false);
    });

    it('field.enum()에 default를 설정할 수 있어야 함', () => {
      const f = field.enum(['active', 'inactive'] as const).default('active');
      expect(f._def._hasDefault).toBe(true);
      expect(f._def._default).toBe('active');
    });
  });

  describe('복합 타입 - nativeEnum()', () => {
    it('field.nativeEnum()은 TypeScript enum을 지원해야 함', () => {
      enum Status {
        Active = 'active',
        Inactive = 'inactive',
      }

      const f = field.nativeEnum(Status);
      expect(f._def._optional).toBe(false);
    });

    it('field.nativeEnum()에 default를 설정할 수 있어야 함', () => {
      enum Role {
        User = 0,
        Admin = 1,
      }

      const f = field.nativeEnum(Role).default(Role.User);
      expect(f._def._hasDefault).toBe(true);
      expect(f._def._default).toBe(Role.User);
    });
  });

  describe('field.object - 객체 직접(콜백 없음)', () => {
    it('객체를 직접 받아 object 필드를 생성한다', () => {
      const f = field.object({
        detail: field.string(),
        zip: field.number().optional(),
      });
      expect(f._def._optional).toBe(false);
      expect(f._def._isPrimaryKey).toBe(false);
    });

    it('object는 중첩될 수 있다', () => {
      const f = field.object({
        inner: field.object({ id: field.string() }),
      });
      expect(f._def._optional).toBe(false);
    });
  });

  describe('field.tuple - 배열 직접(콜백 없음)', () => {
    it('배열을 직접 받아 tuple 필드를 생성한다', () => {
      const f = field.tuple([field.number(), field.number()]);
      expect(f._def._optional).toBe(false);
    });
  });

  describe('체인 조합', () => {
    it('여러 체인 메서드를 조합할 수 있어야 함', () => {
      const f = field.string().optional().default('test').index({ unique: true });

      expect(f._def._optional).toBe(true);
      expect(f._def._hasDefault).toBe(true);
      expect(f._def._default).toBe('test');
      expect(f._def._isIndexed).toBe(true);
      expect(f._def._indexOptions?.unique).toBe(true);
    });

    it('primaryKey와 다른 메서드를 조합할 수 있어야 함', () => {
      const f = field.number().primaryKey();
      expect(f._def._isPrimaryKey).toBe(true);
    });

    it('array와 index를 조합할 수 있어야 함', () => {
      const f = field.string().array().index({ multiEntry: true });
      expect(f._def._isIndexed).toBe(true);
      expect(f._def._indexOptions?.multiEntry).toBe(true);
    });
  });

  describe('field.default - 값 또는 팩토리', () => {
    it('값을 default로 보존한다', () => {
      const f = field.number().default(0);
      expect(f._def._hasDefault).toBe(true);
      expect(f._def._default).toBe(0);
    });

    it('팩토리 함수를 default로 보존한다(평가하지 않음)', () => {
      const fn = () => new Date();
      const f = field.date().default(fn);
      expect(f._def._hasDefault).toBe(true);
      expect(f._def._default).toBe(fn); // 함수 참조 그대로, 호출 안 함
    });
  });

  describe('FieldDef 런타임 메타 _kind', () => {
    it('primitive는 _kind를 보존한다', () => {
      expect(field.string()._def._kind).toBe('string');
      expect(field.number()._def._kind).toBe('number');
      expect(field.boolean()._def._kind).toBe('boolean');
      expect(field.date()._def._kind).toBe('date');
    });

    it('enum은 _enumValues를 보존한다', () => {
      const f = field.enum(['active', 'inactive'] as const);
      expect(f._def._kind).toBe('enum');
      expect(f._def._enumValues).toEqual(['active', 'inactive']);
    });

    it('object는 _shape에 중첩 FieldDef를 보존한다', () => {
      const f = field.object({ id: field.string(), age: field.number() });
      expect(f._def._kind).toBe('object');
      expect(f._def._shape?.id?._kind).toBe('string');
      expect(f._def._shape?.age?._kind).toBe('number');
    });

    it('tuple은 _items에 위치별 FieldDef를 보존한다', () => {
      const f = field.tuple([field.number(), field.string()]);
      expect(f._def._kind).toBe('tuple');
      expect(f._def._items?.[0]?._kind).toBe('number');
      expect(f._def._items?.[1]?._kind).toBe('string');
    });

    it('array()는 _kind=array와 _element를 보존한다', () => {
      const f = field.string().array();
      expect(f._def._kind).toBe('array');
      expect(f._def._element?._kind).toBe('string');
    });
  });
});
