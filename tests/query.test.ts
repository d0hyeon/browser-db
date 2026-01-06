/**
 * Query Builder 테스트
 *
 * API 명세:
 *
 * Object 스타일 쿼리:
 * - query(options): Promise<T[]>
 *   - options.index: 인덱스 이름
 *   - options.where: WhereCondition 객체
 *   - options.orderBy: 'asc' | 'desc'
 *   - options.limit: 결과 수 제한
 *   - options.offset: 건너뛸 레코드 수
 *
 * Builder 스타일 쿼리:
 * - query(): QueryBuilder
 * - query().index(name): IndexQueryBuilder
 * - query().key(): IndexQueryBuilder (기본 키로 조회)
 *
 * IndexQueryBuilder 메서드:
 * - equals(value): 같은 값 조회
 * - gt(value): 초과
 * - gte(value): 이상
 * - lt(value): 미만
 * - lte(value): 이하
 * - between(lower, upper): 범위 조회
 * - startsWith(prefix): 접두사 조회 (문자열)
 *
 * FinalQueryBuilder 메서드:
 * - orderBy(order): 정렬 ('asc' | 'desc')
 * - limit(count): 결과 수 제한
 * - offset(count): 건너뛸 레코드 수
 * - findAll(): Promise<T[]> (모든 결과)
 * - find(): Promise<T | undefined> (첫 번째 결과)
 * - count(): Promise<number> (결과 수)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDB, type SchemaDatabase } from '../src/createSchemaDB.js';
import { defineStore } from '../src/schema.js';
import { field } from '../src/field.js';

// 테스트용 스토어 정의
const productsStore = defineStore('products', {
  id: field.string().primaryKey(),
  name: field.string().index(),
  category: field.string().index(),
  price: field.number().index(),
  stock: field.number().default(0),
});

type TestDB = SchemaDatabase<readonly [typeof productsStore]>;

describe('Query Builder', () => {
  let db: TestDB;
  let dbCounter = 0;

  beforeEach(async () => {
    const dbName = `query-test-${Date.now()}-${dbCounter++}`;
    db = openDB({
      name: dbName,
      version: 1,
      stores: [productsStore] as const,
    });
    await db.waitForReady();

    // 테스트 데이터 삽입
    await db.products.put({ id: 'p1', name: 'Apple', category: 'fruit', price: 100, stock: 10 });
    await db.products.put({ id: 'p2', name: 'Banana', category: 'fruit', price: 50, stock: 20 });
    await db.products.put({ id: 'p3', name: 'Carrot', category: 'vegetable', price: 30, stock: 30 });
    await db.products.put({ id: 'p4', name: 'Donut', category: 'snack', price: 200, stock: 5 });
    await db.products.put({ id: 'p5', name: 'Egg', category: 'dairy', price: 80, stock: 15 });
  });

  afterEach(() => {
    db?.close();
  });

  describe('Object 스타일 쿼리', () => {
    it('인덱스로 필터링할 수 있어야 함', async () => {
      const fruits = await db.products.query({
        index: 'category',
        where: { eq: 'fruit' },
      });

      expect(fruits).toHaveLength(2);
      expect(fruits.every(p => p.category === 'fruit')).toBe(true);
    });

    it('범위 조건으로 필터링할 수 있어야 함', async () => {
      const affordable = await db.products.query({
        index: 'price',
        where: { lte: 80 },
      });

      expect(affordable.length).toBeGreaterThanOrEqual(3);
      expect(affordable.every(p => p.price <= 80)).toBe(true);
    });

    it('limit으로 결과 수를 제한할 수 있어야 함', async () => {
      const limited = await db.products.query({
        limit: 2,
      });

      expect(limited).toHaveLength(2);
    });

    it('offset으로 결과를 건너뛸 수 있어야 함', async () => {
      const all = await db.products.query({});
      const skipped = await db.products.query({ offset: 2 });

      expect(skipped).toHaveLength(all.length - 2);
    });

    it('orderBy로 정렬할 수 있어야 함', async () => {
      const asc = await db.products.query({
        index: 'price',
        orderBy: 'asc',
      });

      const desc = await db.products.query({
        index: 'price',
        orderBy: 'desc',
      });

      expect(asc[0].price).toBeLessThanOrEqual(asc[1].price);
      expect(desc[0].price).toBeGreaterThanOrEqual(desc[1].price);
    });
  });

  describe('Builder 스타일 - index()', () => {
    it('index().equals()로 정확히 일치하는 레코드를 조회해야 함', async () => {
      const fruits = await db.products.query()
        .index('category')
        .equals('fruit')
        .findAll();

      expect(fruits).toHaveLength(2);
      expect(fruits.every(p => p.category === 'fruit')).toBe(true);
    });

    it('index().gt()로 초과하는 레코드를 조회해야 함', async () => {
      const expensive = await db.products.query()
        .index('price')
        .gt(100)
        .findAll();

      expect(expensive.every(p => p.price > 100)).toBe(true);
    });

    it('index().gte()로 이상인 레코드를 조회해야 함', async () => {
      const result = await db.products.query()
        .index('price')
        .gte(100)
        .findAll();

      expect(result.every(p => p.price >= 100)).toBe(true);
      expect(result.some(p => p.price === 100)).toBe(true);
    });

    it('index().lt()로 미만인 레코드를 조회해야 함', async () => {
      const cheap = await db.products.query()
        .index('price')
        .lt(80)
        .findAll();

      expect(cheap.every(p => p.price < 80)).toBe(true);
    });

    it('index().lte()로 이하인 레코드를 조회해야 함', async () => {
      const result = await db.products.query()
        .index('price')
        .lte(80)
        .findAll();

      expect(result.every(p => p.price <= 80)).toBe(true);
      expect(result.some(p => p.price === 80)).toBe(true);
    });

    it('index().between()으로 범위 내 레코드를 조회해야 함', async () => {
      const range = await db.products.query()
        .index('price')
        .between(50, 100)
        .findAll();

      expect(range.every(p => p.price >= 50 && p.price <= 100)).toBe(true);
    });

    it('index().startsWith()로 접두사가 일치하는 레코드를 조회해야 함', async () => {
      const result = await db.products.query()
        .index('name')
        .startsWith('A')
        .findAll();

      expect(result.every(p => p.name.startsWith('A'))).toBe(true);
    });
  });

  describe('Builder 스타일 - key()', () => {
    it('key().equals()로 기본 키로 조회해야 함', async () => {
      const result = await db.products.query()
        .key()
        .equals('p1')
        .findAll();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('p1');
    });

    it('key().between()으로 키 범위를 조회해야 함', async () => {
      const result = await db.products.query()
        .key()
        .between('p1', 'p3')
        .findAll();

      expect(result).toHaveLength(3);
      expect(result.every(p => p.id >= 'p1' && p.id <= 'p3')).toBe(true);
    });
  });

  describe('Builder 스타일 - 체이닝', () => {
    it('orderBy().findAll()로 정렬된 결과를 조회해야 함', async () => {
      const asc = await db.products.query()
        .index('price')
        .gte(0)
        .orderBy('asc')
        .findAll();

      for (let i = 1; i < asc.length; i++) {
        expect(asc[i].price).toBeGreaterThanOrEqual(asc[i - 1].price);
      }
    });

    it('limit().findAll()로 결과 수를 제한해야 함', async () => {
      const limited = await db.products.query()
        .index('price')
        .gte(0)
        .limit(2)
        .findAll();

      expect(limited).toHaveLength(2);
    });

    it('offset().findAll()로 결과를 건너뛰어야 함', async () => {
      const all = await db.products.query().findAll();
      const skipped = await db.products.query()
        .index('price')
        .gte(0)
        .offset(2)
        .findAll();

      expect(skipped.length).toBeLessThan(all.length);
    });

    it('orderBy().limit().offset()을 조합해야 함', async () => {
      const result = await db.products.query()
        .index('price')
        .gte(0)
        .orderBy('desc')
        .limit(2)
        .offset(1)
        .findAll();

      expect(result).toHaveLength(2);
      // 가격 내림차순으로 1개 건너뛴 후 2개
    });
  });

  describe('Builder 스타일 - find()', () => {
    it('find()로 첫 번째 결과만 조회해야 함', async () => {
      const first = await db.products.query()
        .index('category')
        .equals('fruit')
        .find();

      expect(first).toBeDefined();
      expect(first?.category).toBe('fruit');
    });

    it('결과가 없으면 undefined를 반환해야 함', async () => {
      const result = await db.products.query()
        .index('category')
        .equals('nonexistent')
        .find();

      expect(result).toBeUndefined();
    });

    it('orderBy()와 함께 사용하면 정렬된 첫 번째 결과를 반환해야 함', async () => {
      const cheapest = await db.products.query()
        .index('price')
        .gte(0)
        .orderBy('asc')
        .find();

      expect(cheapest?.price).toBe(30); // Carrot (가장 저렴)
    });
  });

  describe('Builder 스타일 - count()', () => {
    it('count()로 결과 수를 조회해야 함', async () => {
      const count = await db.products.query()
        .index('category')
        .equals('fruit')
        .count();

      expect(count).toBe(2);
    });

    it('조건에 맞는 레코드가 없으면 0을 반환해야 함', async () => {
      const count = await db.products.query()
        .index('category')
        .equals('nonexistent')
        .count();

      expect(count).toBe(0);
    });
  });

  describe('기본값 적용', () => {
    it('query 결과에 기본값이 적용되어야 함', async () => {
      // stock 없이 저장
      const rawTx = db.raw.transaction('products', 'readwrite');
      const store = rawTx.objectStore('products');
      store.put({ id: 'p6', name: 'Fig', category: 'fruit', price: 120 });
      await new Promise<void>(resolve => { rawTx.oncomplete = () => resolve(); });

      const result = await db.products.query()
        .index('name')
        .equals('Fig')
        .find();

      expect(result?.stock).toBe(0); // 기본값
    });
  });

  describe('직접 조건 메서드', () => {
    it('query().equals()로 직접 키 조건을 사용할 수 있어야 함', async () => {
      const result = await db.products.query()
        .equals('p1')
        .findAll();

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('p1');
    });

    it('query().between()으로 직접 키 범위를 사용할 수 있어야 함', async () => {
      const result = await db.products.query()
        .between('p2', 'p4')
        .findAll();

      expect(result.every(p => p.id >= 'p2' && p.id <= 'p4')).toBe(true);
    });

    it('query().startsWith()로 직접 접두사 조건을 사용할 수 있어야 함', async () => {
      const result = await db.products.query()
        .startsWith('p')
        .findAll();

      expect(result.every(p => p.id.startsWith('p'))).toBe(true);
    });
  });

  describe('query().findAll() 직접 호출', () => {
    it('query().findAll()로 모든 레코드를 조회해야 함', async () => {
      const all = await db.products.query().findAll();

      expect(all).toHaveLength(5);
    });
  });
});
