/**
 * Vitest 테스트 셋업
 * fake-indexeddb를 전역으로 설정하여 Node.js 환경에서 IndexedDB API 사용 가능하게 함
 */
import 'fake-indexeddb/auto';

/**
 * 각 테스트 후 IndexedDB 클린업
 * 테스트 간 데이터 격리를 위해 모든 데이터베이스 삭제
 */
afterEach(async () => {
  // fake-indexeddb의 databases API를 사용하여 모든 DB 삭제
  if (typeof indexedDB !== 'undefined' && indexedDB.databases) {
    try {
      const databases = await indexedDB.databases();
      for (const db of databases) {
        if (db.name) {
          indexedDB.deleteDatabase(db.name);
        }
      }
    } catch {
      // databases() API가 지원되지 않을 경우 무시
    }
  }
});
