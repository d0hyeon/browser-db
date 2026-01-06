/**
 * defineStore 테스트
 *
 * API 명세:
 * - defineStore(name, schema, options?): 스토어 정의 생성
 *   - name: 스토어 이름 (필수)
 *   - schema: 필드 스키마 객체 (field 빌더 사용)
 *   - options.migrations: 마이그레이션 배열 (선택)
 *
 * 스키마 정의:
 * - 최소 하나의 필드에 primaryKey()가 있어야 함
 * - index()가 있는 필드는 자동으로 IndexedDB 인덱스로 생성됨
 * - default()가 있는 필드는 조회 시 기본값이 적용됨
 *
 * 반환값 (SchemaStoreBuilder):
 * - name: 스토어 이름
 * - schema: 원본 스키마
 * - keyPath: 기본 키 필드 이름
 * - indexes: 인덱스 정의 배열
 * - migrations: 마이그레이션 배열
 * - defaults: 기본값 객체
 * - addMigration(name, fn): 마이그레이션 추가 (체이닝)
 * - _input: 입력 타입 (phantom)
 * - _output: 출력 타입 (phantom)
 * - _keyType: 키 타입 (phantom)
 */
import { describe, it, expect } from 'vitest';
import { defineStore } from '../src/schema.js';
import { field } from '../src/field.js';

describe('defineStore', () => {
  describe('기본 스토어 생성', () => {
    it('기본 스토어를 생성할 수 있어야 함', () => {
      const store = defineStore('users', {
        id: field.string().primaryKey(),
        name: field.string(),
      });

      expect(store.name).toBe('users');
      expect(store.keyPath).toBe('id');
      expect(store.indexes).toEqual([]);
      expect(store.migrations).toEqual([]);
    });

    it('스키마에서 keyPath를 올바르게 추출해야 함', () => {
      const store = defineStore('posts', {
        postId: field.number().primaryKey(),
        title: field.string(),
        content: field.string(),
      });

      expect(store.keyPath).toBe('postId');
    });

    it('여러 필드가 있는 스토어를 생성할 수 있어야 함', () => {
      const store = defineStore('products', {
        sku: field.string().primaryKey(),
        name: field.string(),
        price: field.number(),
        inStock: field.boolean(),
        createdAt: field.date(),
      });

      expect(store.name).toBe('products');
      expect(store.keyPath).toBe('sku');
    });
  });

  describe('인덱스 생성', () => {
    it('index()가 있는 필드는 인덱스로 생성되어야 함', () => {
      const store = defineStore('users', {
        id: field.string().primaryKey(),
        email: field.string().index(),
        name: field.string(),
      });

      expect(store.indexes).toHaveLength(1);
      expect(store.indexes[0]).toEqual({
        name: 'email',
        keyPath: 'email',
        unique: undefined,
        multiEntry: undefined,
      });
    });

    it('unique 인덱스를 생성할 수 있어야 함', () => {
      const store = defineStore('users', {
        id: field.string().primaryKey(),
        email: field.string().index({ unique: true }),
      });

      expect(store.indexes[0].unique).toBe(true);
    });

    it('multiEntry 인덱스를 생성할 수 있어야 함', () => {
      const store = defineStore('posts', {
        id: field.string().primaryKey(),
        tags: field.string().array().index({ multiEntry: true }),
      });

      expect(store.indexes[0].multiEntry).toBe(true);
    });

    it('여러 인덱스를 생성할 수 있어야 함', () => {
      const store = defineStore('users', {
        id: field.string().primaryKey(),
        email: field.string().index({ unique: true }),
        name: field.string().index(),
        age: field.number().index(),
      });

      expect(store.indexes).toHaveLength(3);

      const indexNames = store.indexes.map(i => i.name);
      expect(indexNames).toContain('email');
      expect(indexNames).toContain('name');
      expect(indexNames).toContain('age');
    });
  });

  describe('기본값 처리', () => {
    it('default()가 있는 필드의 기본값을 추출해야 함', () => {
      const store = defineStore('users', {
        id: field.string().primaryKey(),
        name: field.string(),
        age: field.number().default(0),
        active: field.boolean().default(true),
      });

      expect(store.defaults).toEqual({
        age: 0,
        active: true,
      });
    });

    it('객체 기본값을 처리할 수 있어야 함', () => {
      const store = defineStore('users', {
        id: field.string().primaryKey(),
        address: field.object(t => ({
          city: t.string(),
          zipCode: t.string(),
        })).default({ city: '', zipCode: '' }),
      });

      expect(store.defaults.address).toEqual({ city: '', zipCode: '' });
    });

    it('기본값이 없으면 defaults가 비어 있어야 함', () => {
      const store = defineStore('users', {
        id: field.string().primaryKey(),
        name: field.string(),
      });

      expect(store.defaults).toEqual({});
    });
  });

  describe('마이그레이션', () => {
    it('options에서 마이그레이션을 설정할 수 있어야 함', () => {
      const store = defineStore('users', {
        id: field.string().primaryKey(),
        name: field.string(),
      }, {
        migrations: [
          { name: '001-seed-data', up: () => {} },
        ],
      });

      expect(store.migrations).toHaveLength(1);
      expect(store.migrations[0].name).toBe('001-seed-data');
    });

    it('addMigration()으로 마이그레이션을 추가할 수 있어야 함', () => {
      const store = defineStore('users', {
        id: field.string().primaryKey(),
        name: field.string(),
      }).addMigration('001-seed-admin', () => {});

      expect(store.migrations).toHaveLength(1);
      expect(store.migrations[0].name).toBe('001-seed-admin');
    });

    it('addMigration()을 체이닝할 수 있어야 함', () => {
      const store = defineStore('users', {
        id: field.string().primaryKey(),
        name: field.string(),
      })
        .addMigration('001-first', () => {})
        .addMigration('002-second', () => {});

      expect(store.migrations).toHaveLength(2);
    });

    it('마이그레이션은 이름순으로 정렬되어야 함', () => {
      const store = defineStore('users', {
        id: field.string().primaryKey(),
      })
        .addMigration('003-third', () => {})
        .addMigration('001-first', () => {})
        .addMigration('002-second', () => {});

      expect(store.migrations[0].name).toBe('001-first');
      expect(store.migrations[1].name).toBe('002-second');
      expect(store.migrations[2].name).toBe('003-third');
    });
  });

  describe('유효성 검사', () => {
    it('스토어 이름이 없으면 에러를 던져야 함', () => {
      expect(() => {
        defineStore('', {
          id: field.string().primaryKey(),
        });
      }).toThrow('Store name is required');
    });

    it('primaryKey가 없으면 에러를 던져야 함', () => {
      expect(() => {
        defineStore('users', {
          id: field.string(),
          name: field.string(),
        });
      }).toThrow('must have a primary key');
    });

    it('중복된 primaryKey가 있으면 에러를 던져야 함', () => {
      expect(() => {
        defineStore('users', {
          id: field.string().primaryKey(),
          secondId: field.string().primaryKey(),
        });
      }).toThrow('Multiple primary keys');
    });

    it('중복된 마이그레이션 이름이 있으면 에러를 던져야 함', () => {
      expect(() => {
        defineStore('users', {
          id: field.string().primaryKey(),
        }, {
          migrations: [
            { name: 'same-name', up: () => {} },
            { name: 'same-name', up: () => {} },
          ],
        });
      }).toThrow('Duplicate migration name');
    });

    it('addMigration()에 중복된 이름을 추가하면 에러를 던져야 함', () => {
      expect(() => {
        defineStore('users', {
          id: field.string().primaryKey(),
        })
          .addMigration('same-name', () => {})
          .addMigration('same-name', () => {});
      }).toThrow('Duplicate migration name');
    });

    it('빈 마이그레이션 이름은 에러를 던져야 함', () => {
      expect(() => {
        defineStore('users', {
          id: field.string().primaryKey(),
        }).addMigration('', () => {});
      }).toThrow('Migration name is required');
    });
  });

  describe('불변성', () => {
    it('addMigration()은 새로운 스토어 정의를 반환해야 함', () => {
      const original = defineStore('users', {
        id: field.string().primaryKey(),
      });

      const withMigration = original.addMigration('001-test', () => {});

      expect(original.migrations).toHaveLength(0);
      expect(withMigration.migrations).toHaveLength(1);
    });
  });

  describe('타입 추론 (phantom types)', () => {
    it('_input, _output, _keyType이 존재해야 함', () => {
      const store = defineStore('users', {
        id: field.string().primaryKey(),
        name: field.string(),
        age: field.number().optional(),
      });

      // phantom types가 존재하는지 확인 (런타임에는 빈 객체)
      expect(store).toHaveProperty('_input');
      expect(store).toHaveProperty('_output');
      expect(store).toHaveProperty('_keyType');
    });
  });
});
