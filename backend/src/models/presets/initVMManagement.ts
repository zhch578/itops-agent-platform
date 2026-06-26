import { db } from '../database';
import { logger } from '../../utils/logger';

export function initializeVMManagementTables() {
  try {
    // VM平台配置表
    db.exec(`
      CREATE TABLE IF NOT EXISTS vm_platforms (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        hypervisor_type TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER,
        username TEXT,
        encrypted_password TEXT,
        encrypted_password_iv TEXT,
        config TEXT,
        status TEXT NOT NULL DEFAULT 'inactive',
        last_connected TEXT,
        error_message TEXT,
        tags TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // VM操作审计表
    db.exec(`
      CREATE TABLE IF NOT EXISTS vm_audit_logs (
        id TEXT PRIMARY KEY,
        platform_id TEXT NOT NULL,
        vm_id TEXT,
        vm_name TEXT,
        operation TEXT NOT NULL,
        user_id TEXT,
        username TEXT,
        parameters TEXT,
        result TEXT,
        status TEXT NOT NULL,
        error_message TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (platform_id) REFERENCES vm_platforms(id)
      )
    `);

    // 创建索引
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_vm_platforms_type ON vm_platforms(hypervisor_type)
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_vm_platforms_status ON vm_platforms(status)
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_vm_audit_platform ON vm_audit_logs(platform_id)
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_vm_audit_vm ON vm_audit_logs(vm_id)
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_vm_audit_time ON vm_audit_logs(started_at DESC)
    `);

    logger.info('✅ VM管理数据库表初始化完成');
  } catch (error) {
    logger.error('❌ VM管理数据库表初始化失败:', error);
  }
}
