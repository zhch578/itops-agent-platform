/**
 * 使用 Node.js 内置 node:sqlite 运行数据库迁移
 * 避免 better-sqlite3 原生模块版本不兼容问题
 */
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.resolve(__dirname, '../data/app.db');
console.log('DB:', DB_PATH);

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL');
db.exec('PRAGMA foreign_keys=ON');

// ========== 迁移定义 ==========
const migrations = [
  // v031 设备制造商
  {
    version: 41, name: 'device_manufacturers',
    up: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS device_manufacturers (
          id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, slug TEXT NOT NULL UNIQUE,
          description TEXT DEFAULT '', logo_url TEXT DEFAULT '', sort_order INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime'))
        );
      `);
    }
  },
  // v032 设备型号
  {
    version: 42, name: 'device_types',
    up: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS device_types (
          id TEXT PRIMARY KEY, manufacturer_id TEXT NOT NULL, model TEXT NOT NULL, slug TEXT NOT NULL,
          part_number TEXT DEFAULT '', u_height REAL DEFAULT 1 CHECK(u_height > 0),
          is_full_depth INTEGER DEFAULT 1,
          subdevice_role TEXT DEFAULT NULL CHECK(subdevice_role IS NULL OR subdevice_role IN ('parent','child')),
          airflow TEXT DEFAULT 'front-to-rear', weight_kg REAL DEFAULT NULL, max_power_w REAL DEFAULT NULL,
          front_image_url TEXT DEFAULT '', rear_image_url TEXT DEFAULT '', description TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime')),
          FOREIGN KEY (manufacturer_id) REFERENCES device_manufacturers(id) ON DELETE RESTRICT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_device_types_manufacturer_model ON device_types(manufacturer_id, model);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_device_types_manufacturer_slug ON device_types(manufacturer_id, slug);
      `);
      // 幂等地添加 device_type_id 列
      const cols = db.prepare("SELECT name FROM pragma_table_info('dc_rack_slots')").all();
      if (!cols.find((c) => c.name === 'device_type_id')) {
        db.exec("ALTER TABLE dc_rack_slots ADD COLUMN device_type_id TEXT REFERENCES device_types(id) ON DELETE SET NULL");
      }
    }
  },
  // v033 设备槽位定义
  {
    version: 43, name: 'device_type_slot_definitions',
    up: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS device_type_slot_definitions (
          id TEXT PRIMARY KEY, device_type_id TEXT NOT NULL,
          slot_type TEXT NOT NULL CHECK(slot_type IN ('power_port','interface','console_port','console_server_port','power_outlet','module_bay','device_bay','front_port','rear_port','pdu_outlet')),
          slot_name TEXT NOT NULL, slot_label TEXT DEFAULT '', position_label TEXT DEFAULT '',
          u_position INTEGER DEFAULT 0, is_preferred INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now','localtime')),
          FOREIGN KEY (device_type_id) REFERENCES device_types(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_slot_defs_type ON device_type_slot_definitions(device_type_id);
      `);
    }
  },
  // v034 配电柜
  {
    version: 44, name: 'dc_power_panels',
    up: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS dc_power_panels (
          id TEXT PRIMARY KEY, room_id TEXT NOT NULL, name TEXT NOT NULL,
          location_label TEXT DEFAULT '', panel_type TEXT DEFAULT 'rpp',
          voltage REAL DEFAULT 220, amperage REAL DEFAULT 63, phase_count INTEGER DEFAULT 3,
          description TEXT DEFAULT '', sort_order INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime')),
          FOREIGN KEY (room_id) REFERENCES dc_rooms(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_dc_power_panels_room ON dc_power_panels(room_id);
      `);
    }
  },
  // v035 供电线路
  {
    version: 45, name: 'dc_power_feeds',
    up: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS dc_power_feeds (
          id TEXT PRIMARY KEY, power_panel_id TEXT NOT NULL, rack_id TEXT DEFAULT NULL,
          name TEXT NOT NULL, status TEXT DEFAULT 'active', feed_type TEXT DEFAULT 'primary', supply TEXT DEFAULT 'ac',
          voltage REAL DEFAULT 220, amperage REAL DEFAULT 16, max_utilization_pct REAL DEFAULT 80,
          current_load_w REAL DEFAULT 0, description TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime')),
          FOREIGN KEY (power_panel_id) REFERENCES dc_power_panels(id) ON DELETE RESTRICT,
          FOREIGN KEY (rack_id) REFERENCES dc_racks(id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_dc_power_feeds_panel ON dc_power_feeds(power_panel_id);
        CREATE INDEX IF NOT EXISTS idx_dc_power_feeds_rack ON dc_power_feeds(rack_id);
      `);
    }
  },
  // v036 线缆
  {
    version: 46, name: 'dc_cables',
    up: () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS dc_cables (
          id TEXT PRIMARY KEY, name TEXT DEFAULT '',
          cable_type TEXT DEFAULT 'cat6', cable_color TEXT DEFAULT '', length_m REAL DEFAULT NULL,
          status TEXT DEFAULT 'connected',
          a_device_id TEXT NOT NULL, a_device_type TEXT NOT NULL, a_port_name TEXT DEFAULT '',
          b_device_id TEXT NOT NULL, b_device_type TEXT NOT NULL, b_port_name TEXT DEFAULT '',
          description TEXT DEFAULT '',
          created_at TEXT DEFAULT (datetime('now','localtime')), updated_at TEXT DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_dc_cables_a ON dc_cables(a_device_id, a_device_type);
        CREATE INDEX IF NOT EXISTS idx_dc_cables_b ON dc_cables(b_device_id, b_device_type);
        CREATE INDEX IF NOT EXISTS idx_dc_cables_status ON dc_cables(status);
      `);
    }
  },
];

// ========== 运行迁移 ==========
function runMigrations() {
  // 创建迁移记录表
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY, version INTEGER NOT NULL UNIQUE, name TEXT NOT NULL,
      applied_at DATETIME DEFAULT (datetime('now','localtime')),
      success INTEGER NOT NULL DEFAULT 0, error_message TEXT
    )
  `);

  // 获取已应用版本
  const applied = db.prepare('SELECT version FROM schema_migrations WHERE success = 1 ORDER BY version').all();
  const appliedSet = new Set(applied.map((r) => r.version));

  const pending = migrations.filter(m => !appliedSet.has(m.version));
  console.log(`当前: v${applied.length > 0 ? applied[applied.length-1].version : 0}, 待迁移: ${pending.length} 个`);

  for (const m of pending) {
    try {
      console.log(`⏳ 运行 v${m.version} ${m.name}...`);
      m.up();
      const id = crypto.randomUUID();
      db.prepare('INSERT INTO schema_migrations (id, version, name, success) VALUES (?, ?, ?, 1)').run(id, m.version, m.name);
      console.log(`✅ v${m.version} ${m.name} 完成`);
    } catch (err) {
      console.error(`❌ v${m.version} ${m.name} 失败:`, err.message);
      const id = crypto.randomUUID();
      try {
        db.prepare('INSERT INTO schema_migrations (id, version, name, success, error_message) VALUES (?, ?, ?, 0, ?)').run(id, m.version, m.name, err.message);
      } catch (_) {}
      throw err;
    }
  }
  console.log('✅ 全部迁移完成');
}

try {
  runMigrations();

  // 验证新表
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  console.log('\n📋 数据库表:', tables.map((t) => t.name).join(', '));
} finally {
  db.close();
}
