import { Database } from 'better-sqlite3';

export function up(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS config_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      type TEXT NOT NULL DEFAULT 'generic',
      content TEXT NOT NULL DEFAULT '',
      variables TEXT DEFAULT '[]',
      target_type TEXT DEFAULT 'server',
      tags TEXT DEFAULT '[]',
      version INTEGER DEFAULT 1,
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );
  `);
}

export function down(db: Database) {
  db.exec(`DROP TABLE IF EXISTS config_templates;`);
}

const v021_config_templates = { up, down };
export default v021_config_templates;
