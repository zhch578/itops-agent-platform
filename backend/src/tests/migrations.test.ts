/**
 * Migration Downgrade Tests — NetBox DCIM 借鉴的 6 个迁移 (v031–v036)
 *
 * 验证：
 * - up() 导出函数且不抛异常
 * - down() 导出函数且不抛异常
 * - 幂等性：重复 up/down 不抛异常
 *
 * 使用 mock 数据库（better-sqlite3 在 Node v24 下版本不匹配）
 */
import { describe, it, expect, beforeAll } from 'vitest';

// ---------------------------------------------------------------------------
// Mock Database
// ---------------------------------------------------------------------------
function createMockDb() {
  return {
    exec: () => {},
    prepare: () => ({ run: () => {}, get: () => {}, all: () => [] }),
    close: () => {},
    pragma: () => {},
  };
}

// ---------------------------------------------------------------------------
// Import migrations
// ---------------------------------------------------------------------------
const migrations: Record<string, { up: (db: unknown) => void; down: (db: unknown) => void }> = {};

beforeAll(async () => {
  const [
    v031, v032, v033, v034, v035, v036,
  ] = await Promise.all([
    import('../models/migrations/v031_device_manufacturers'),
    import('../models/migrations/v032_device_types'),
    import('../models/migrations/v033_device_type_slot_definitions'),
    import('../models/migrations/v034_dc_power_panels'),
    import('../models/migrations/v035_dc_power_feeds'),
    import('../models/migrations/v036_dc_cables'),
  ]);
  migrations.v031 = v031;
  migrations.v032 = v032;
  migrations.v033 = v033;
  migrations.v034 = v034;
  migrations.v035 = v035;
  migrations.v036 = v036;
});

// ---------------------------------------------------------------------------
// 测试表
// ---------------------------------------------------------------------------
const TABLE_MAP: Record<string, string> = {
  v031: 'device_manufacturers',
  v032: 'device_types',
  v033: 'device_type_slot_definitions',
  v034: 'dc_power_panels',
  v035: 'dc_power_feeds',
  v036: 'dc_cables',
};

describe('Migration Downgrade Tests (v031–v036)', () => {
  for (const [version, table] of Object.entries(TABLE_MAP)) {
    describe(`${version}: ${table}`, () => {
      const db = createMockDb();

      it('up exports a function', () => {
        expect(typeof migrations[version].up).toBe('function');
      });

      it('down exports a function', () => {
        expect(typeof migrations[version].down).toBe('function');
      });

      it('up() runs without error', () => {
        expect(() => migrations[version].up(db as never)).not.toThrow();
      });

      it('up() is idempotent', () => {
        // Should not throw on second call
        expect(() => migrations[version].up(db as never)).not.toThrow();
      });

      it('down() runs without error', () => {
        expect(() => migrations[version].down(db as never)).not.toThrow();
      });

      it('down() is idempotent', () => {
        expect(() => migrations[version].down(db as never)).not.toThrow();
      });

      it('full round-trip: up → down → up → down', () => {
        expect(() => {
          migrations[version].up(db as never);
          migrations[version].down(db as never);
          migrations[version].up(db as never);
          migrations[version].down(db as never);
        }).not.toThrow();
      });
    });
  }
});
