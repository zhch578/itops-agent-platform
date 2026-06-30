import type { Database } from 'better-sqlite3';

export function up(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS config_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      type TEXT NOT NULL DEFAULT 'generic',
      category TEXT DEFAULT '',
      service_name TEXT DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      template_content TEXT DEFAULT '',
      variables TEXT DEFAULT '[]',
      os_type TEXT DEFAULT 'linux',
      target_type TEXT DEFAULT 'server',
      target_path TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      version INTEGER DEFAULT 1,
      backup_before_apply INTEGER DEFAULT 1,
      restart_command TEXT DEFAULT '',
      validation_command TEXT DEFAULT '',
      is_system INTEGER DEFAULT 0,
      usage_count INTEGER DEFAULT 0,
      success_count INTEGER DEFAULT 0,
      created_by TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now','localtime')),
      updated_at TEXT DEFAULT (datetime('now','localtime'))
    );

    CREATE INDEX IF NOT EXISTS idx_config_templates_type ON config_templates(type);
    CREATE INDEX IF NOT EXISTS idx_config_templates_category ON config_templates(category);
    CREATE INDEX IF NOT EXISTS idx_config_templates_service ON config_templates(service_name);
    CREATE INDEX IF NOT EXISTS idx_config_templates_os ON config_templates(os_type);
  `);

  // 配置模板应用历史表
  db.exec(`
    CREATE TABLE IF NOT EXISTS config_template_history (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      server_id TEXT NOT NULL,
      applied_by TEXT,
      variables_snapshot TEXT,
      backup_path TEXT,
      status TEXT NOT NULL,
      result TEXT,
      error_message TEXT,
      applied_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (template_id) REFERENCES config_templates(id)
    );

    CREATE INDEX IF NOT EXISTS idx_config_history_template ON config_template_history(template_id);
    CREATE INDEX IF NOT EXISTS idx_config_history_server ON config_template_history(server_id);
    CREATE INDEX IF NOT EXISTS idx_config_history_status ON config_template_history(status);
  `);
}

export function down(db: Database) {
  db.exec(`DROP TABLE IF EXISTS config_template_history;`);
  db.exec(`DROP TABLE IF EXISTS config_templates;`);
}

const v021_config_templates = { up, down };
export default v021_config_templates;
