import { Migration } from './migrationFramework';
import { logger } from '../../utils/logger';

const v002ConfigTemplates: Migration = {
  id: '20240102000001',
  version: 2,
  name: 'config_templates',
  description: 'Add configuration templates for remediation',

  up: async (db: any) => {
    logger.info('🔄 Creating config_templates table...');

    // 配置文件模板表
    db.exec(`
      CREATE TABLE IF NOT EXISTS config_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        category TEXT NOT NULL,
        service_name TEXT NOT NULL,
        template_content TEXT NOT NULL,
        variables TEXT,
        os_type TEXT DEFAULT 'linux',
        target_path TEXT,
        backup_before_apply INTEGER DEFAULT 1,
        restart_command TEXT,
        validation_command TEXT,
        is_system INTEGER DEFAULT 0,
        usage_count INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT (datetime('now','localtime')),
        updated_at DATETIME DEFAULT (datetime('now','localtime'))
      );

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

    logger.info('✅ Config templates table created');
  },

  down: async (db: any) => {
    logger.info('🔄 Dropping config_templates tables...');
    db.exec('DROP TABLE IF EXISTS config_template_history');
    db.exec('DROP TABLE IF EXISTS config_templates');
    logger.info('✅ Config templates tables dropped');
  }
};

export default v002ConfigTemplates;
