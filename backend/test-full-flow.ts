import { initializeDatabase, db } from './src/models/database';
import { randomUUID } from 'crypto';

async function main() {
  console.log('🚀 开始测试全流程');

  // 1. 初始化数据库
  console.log('⏳ 初始化数据库...');
  await initializeDatabase();
  console.log('✅ 数据库初始化完成');

  // 2. 创建一个模拟服务器
  console.log('\n📍 步骤1: 创建模拟服务器');
  const serverId = randomUUID();
  try {
    db.prepare(`
      INSERT INTO servers (
        id, name, hostname, port, username, password, status, os_type, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
    `).run(
      serverId,
      '测试服务器',
      '192.168.1.100',
      22,
      'admin',
      'encrypted-password',
      'online',
      'linux'
    );
    console.log(`✅ 服务器创建成功: ${serverId} (192.168.1.100)`);
  } catch (e) {
    console.error('❌ 服务器创建失败:', e);
  }

  // 3. 创建一个模拟告警
  console.log('\n📢 步骤2: 创建模拟告警');
  const alertId = randomUUID();
  try {
    db.prepare(`
      INSERT INTO alerts (
        id, source, severity, title, content, status, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
    `).run(
      alertId,
      'prometheus',
      'high',
      '测试服务器 CPU 使用率过高',
      'Instance 192.168.1.100 has been running with high CPU usage (>85%) for the last 5 minutes. Please investigate.',
      'new',
      JSON.stringify({
        host: '192.168.1.100',
        alertname: 'HighCPUUsage',
        instance: '192.168.1.100',
        tags: ['cpu', 'high_usage']
      })
    );
    console.log(`✅ 告警创建成功: ${alertId}`);
  } catch (e) {
    console.error('❌ 告警创建失败:', e);
  }

  // 4. 关联告警和服务器
  console.log('\n🔗 步骤3: 关联告警和服务器');
  try {
    db.prepare(`
      INSERT INTO alert_device_associations (
        id, alert_id, device_type, device_id, created_at
      ) VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
    `).run(randomUUID(), alertId, 'server', serverId);
    console.log('✅ 告警和服务器关联成功');
  } catch (e) {
    console.error('❌ 关联失败:', e);
  }

  console.log('\n✅ 测试数据准备完成！');
  console.log('\n📊 数据库信息：');
  const allAlerts = db.prepare('SELECT id, title, status FROM alerts').all();
  console.log('  全部告警:', allAlerts);
  const allServers = db.prepare('SELECT id, name, hostname FROM servers').all();
  console.log('  全部服务器:', allServers);
  console.log('\n现在你可以：');
  console.log('  1. 启动后端服务： cd backend && npm run dev');
  console.log('  2. 访问 http://localhost:3001 查看');
  console.log('  3. 或调用 API /api/alerts/:alertId/process 手动触发');
  console.log('\n等待15-30秒后，告警自动处理服务应该会自动处理这个告警');
}

main().catch(e => {
  console.error('❌ 测试失败:', e);
  process.exit(1);
});
