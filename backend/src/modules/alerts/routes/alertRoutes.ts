import type { Request, Response } from 'express';
import { Router } from 'express';
import { randomUUID, createHash } from 'crypto';
import db, { getIOInstance } from '../../../models/database';
import { notificationService } from '../../infra/services/notificationService';
import { alertNoiseReductionService } from '../services/alertNoiseReductionService';
import { rootCauseAnalysisService } from '../../ai/services/rca/rootCauseAnalysisService';
import { alertService } from '../services/alertService';
import { emitToAlerts } from '../../../shared/websocket/handler';
import { logger } from '../../../utils/logger';
import { requireRole } from '../../../middleware/auth';
import { alertProviderRegistry } from '../services/alertProviderRegistry';
import { alertProcessor } from '../../../core/AlertProcessor';

const router = Router();

// 验证severity值的有效性
const validSeverities = ['critical', 'high', 'medium', 'low'];
const validStatuses = ['new', 'acknowledged', 'resolved'];

router.get('/', (req: Request, res: Response) => {
  try {
    const { status, severity, limit } = req.query;
    let query = 'SELECT * FROM alerts';
    const params: unknown[] = [];
    
    const conditions = [];
    if (status && validStatuses.includes(status as string)) {
      conditions.push('status = ?');
      params.push(status);
    }
    if (severity && validSeverities.includes(severity as string)) {
      conditions.push('severity = ?');
      params.push(severity);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY created_at DESC';
    
    if (limit) {
      const limitNum = parseInt(limit as string);
      if (!isNaN(limitNum) && limitNum > 0) {
        query += ' LIMIT ?';
        params.push(Math.min(limitNum, 100)); // 最多100条
      }
    }
    
    const alerts = db.prepare(query).all(...params) as Array<{ id: string; metadata?: string; [key: string]: unknown }>;
    alerts.forEach((a) => {
      if (a.metadata) {
        try {
          a.metadata = JSON.parse(a.metadata);
        } catch {
          a.metadata = '{}';
        }
      }
    });
    res.json({ success: true, data: alerts });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch alerts' });
  }
});

router.get('/:id', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id);
    
    if (!alert) {
      return res.status(404).json({ success: false, error: 'Alert not found' });
    }
    
    const alertObj = alert as { metadata?: string; [key: string]: unknown };
    if (alertObj.metadata) {
      try {
        alertObj.metadata = JSON.parse(alertObj.metadata);
      } catch {
        alertObj.metadata = '{}';
      }
    }
    
    res.json({ success: true, data: alert });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch alert' });
  }
});

router.get('/:id/automation-logs', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const logs = db.prepare(`
      SELECT * FROM audit_logs
      WHERE resource_type = 'alert_automation' AND resource_id = ?
      ORDER BY created_at DESC
      LIMIT 100
    `).all(id);

    res.json({ success: true, data: logs });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to fetch alert automation logs' });
  }
});

router.post('/', async (req: Request, res: Response) => {
    try {
      const { source, severity, title, content, metadata, related_task_id } = req.body;

      if (!title || title.length === 0) {
        return res.status(400).json({ success: false, error: 'Title is required' });
      }
      if (severity && !validSeverities.includes(severity)) {
        return res.status(400).json({ success: false, error: 'Invalid severity value' });
      }

      const noiseCheck = await alertNoiseReductionService.processAlert(
        source || 'unknown',
        title,
        content,
        severity
      );

      const id = randomUUID();
      const normalizedTitle = title.toLowerCase().replace(/[\d\s_-]+/g, ' ').trim();
      const normalizedSource = (source || 'unknown').toLowerCase();
      const fingerprint = createHash('md5').update(`${normalizedSource}:${normalizedTitle}`).digest('hex');

      try {
        db.prepare(`
          INSERT INTO alerts (id, source, severity, title, content, metadata, related_task_id, alert_fingerprint)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          source || 'unknown',
          severity || 'medium',
          title,
          content || '',
          JSON.stringify(metadata || {}),
          related_task_id,
          fingerprint
        );
      } catch (err) {
        const error = err as { code?: string };
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          logger.warn('Duplicate alert suppressed by database unique constraint', { fingerprint });
          return res.status(200).json({
            success: true,
            data: {
              alert: null,
              noiseReduction: { ...noiseCheck, suppressedByDB: true }
            }
          });
        }
        throw err;
      }

      const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id) as { id: string; metadata?: string; title: string; severity: string; content: string; source: string; [key: string]: unknown } | undefined;
      if (alert?.metadata) {
        try {
          alert.metadata = JSON.parse(alert.metadata);
        } catch {
          alert.metadata = '{}';
        }
      }

      if (noiseCheck.shouldNotify) {
        notificationService.sendAlertNotification(alert!).catch((err) => {
          logger.error('Failed to send alert notification:', err);
        });
      }

      setImmediate(() => runAlertProcessingPipeline({
        id,
        source: source || 'unknown',
        severity: severity || 'medium',
        rawSeverity: typeof metadata?.raw_severity === 'string' ? metadata.raw_severity : undefined,
        title,
        content: content || '',
        tags: metadata?.tags ? (Array.isArray(metadata.tags) ? metadata.tags : []): [],
      }));

      res.status(201).json({
        success: true,
        data: {
          alert,
          noiseReduction: noiseCheck
        }
      });
    } catch {
      res.status(500).json({ success: false, error: 'Failed to create alert' });
    }
  });

router.put('/:id/acknowledge', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id) as { id: string; title: string; [key: string]: unknown } | undefined;
    if (!alert) {
      return res.status(404).json({ success: false, error: 'Alert not found' });
    }
    
    db.prepare('UPDATE alerts SET status = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?').run('acknowledged', id);
    
    const updated = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id);
    
    // 发送告警确认通知
    notificationService.sendSystemNotification(
      '告警已确认',
      `告警 "${alert.title}" 已确认处理`
    ).catch((err) => logger.error('Failed to send ack notification:', err));
    
    res.json({ success: true, data: updated });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to acknowledge alert' });
  }
});

router.put('/:id/resolve', (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id) as { id: string; title: string; [key: string]: unknown } | undefined;
    if (!alert) {
      return res.status(404).json({ success: false, error: 'Alert not found' });
    }
    
    db.prepare('UPDATE alerts SET status = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?').run('resolved', id);
    
    const updated = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id);
    
    // 发送告警解决通知
    notificationService.sendSystemNotification(
      '告警已解决',
      `告警 "${alert.title}" 已解决`
    ).catch((err) => logger.error('Failed to send resolve notification:', err));
    
    res.json({ success: true, data: updated });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to resolve alert' });
  }
});

router.delete('/:id', requireRole('admin', 'operator'), (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id);
    if (!alert) {
      return res.status(404).json({ success: false, error: 'Alert not found' });
    }
    
    db.prepare('DELETE FROM alerts WHERE id = ?').run(id);
    
    res.json({ success: true, message: 'Alert deleted successfully' });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to delete alert' });
  }
});

router.get('/stats/summary', (_req: Request, res: Response) => {
  try {
    const stats = db.prepare(`
      SELECT 
        status, 
        COUNT(*) as count 
      FROM alerts 
      GROUP BY status
    `).all();
    
    const severityStats = db.prepare(`
      SELECT 
        severity, 
        COUNT(*) as count 
      FROM alerts 
      GROUP BY severity
    `).all();
    
    res.json({
      success: true,
      data: {
        byStatus: stats,
        bySeverity: severityStats,
        total: (stats as Array<{ count: number }>).reduce((sum: number, s) => sum + s.count, 0)
      }
    });
  } catch {
    res.status(500).json({ success: false, error: 'Failed to get alert stats' });
  }
});

// ── 告警自动处理流水线（复用新建告警时的全部逻辑） ──
interface AlertProcessingContext {
  id: string;
  source: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  rawSeverity?: string;
  title: string;
  content: string;
  tags: string[];
}

async function runAlertProcessingPipeline(ctx: AlertProcessingContext): Promise<void> {
  const io = getIOInstance();
  try {
    const { id, source, severity, rawSeverity, title, content, tags } = ctx;

    emitToAlerts(io!, 'remediation:started', {
      alertId: id,
      title,
      timestamp: new Date().toISOString()
    });

    // 自动根因分析
    const autoRCAEnabled = db.prepare("SELECT value FROM settings WHERE key = 'auto_root_cause_enabled'").get() as { value: string } | undefined;
    if (autoRCAEnabled?.value === 'true') {
      logger.info('🔍 Auto RCA triggered for alert:', id);
      rootCauseAnalysisService.analyzeByAlert(id, title, content).catch((err) => {
        logger.error('Failed to auto-trigger RCA for alert:', err);
      });
    }

    // ── 统一告警处理入口（AARS + 工作流 智能决策）──
    alertProcessor.processAlert({
      alertId: id,
      title,
      content,
      severity,
      source,
      metadata: { tags, rawSeverity }
    }).then((result) => {
      emitToAlerts(io!, 'remediation:result', {
        alertId: id,
        policyId: result.executionId || result.taskId || '',
        policyName: `统一处理: ${result.strategy}`,
        executionId: result.executionId || result.taskId,
        status: result.success ? 'success' : 'failed',
        timestamp: new Date().toISOString()
      });
    }).catch((err: Error) => {
      logger.error(`AlertProcessor failed for ${id}:`, err);
    });
  } catch (error) {
    logger.error('Failed to process alert remediation:', error);
    emitToAlerts(io!, 'remediation:error', {
      alertId: ctx.id,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    });
  }
}

// ── 手动触发告警处理（同步匹配 + 异步执行） ──
router.post('/:id/process', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!alert) {
      return res.status(404).json({ success: false, error: '告警不存在' });
    }

    const source = (alert.source as string) || 'unknown';
    const severity = ((alert.severity as string) || 'medium') as AlertProcessingContext['severity'];
    const title = alert.title as string;
    const content = (alert.content as string) || '';

    // 解析 tags
    let tags: string[] = [];
    let rawSeverity: string | undefined;
    if (alert.metadata) {
      try {
        const meta = typeof alert.metadata === 'string' ? JSON.parse(alert.metadata as string) : alert.metadata;
        tags = Array.isArray(meta.tags) ? meta.tags : [];
        rawSeverity = typeof meta.raw_severity === 'string'
          ? meta.raw_severity
          : typeof meta.zabbix_raw_severity === 'string'
            ? meta.zabbix_raw_severity
            : undefined;
      } catch { /* ignore */ }
    }

    const ctx: AlertProcessingContext = { id, source, severity, rawSeverity, title, content, tags };

    // ── 统一告警处理入口（AARS + 工作流 智能决策）──
    let processResult: { success: boolean; strategy: string; executionId?: string; taskId?: string; errorMessage?: string } | null = null;
    let errorMsg: string | null = null;

    try {
      processResult = await alertProcessor.processAlert({
        alertId: id,
        title,
        content,
        severity,
        source,
        metadata: { tags, rawSeverity }
      });
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
      logger.error('Manual process alert error:', e);
    }

    // 自动根因分析（后台异步）
    setImmediate(() => {
      const autoRCAEnabled = db.prepare("SELECT value FROM settings WHERE key = 'auto_root_cause_enabled'").get() as { value: string } | undefined;
      if (autoRCAEnabled?.value === 'true') {
        rootCauseAnalysisService.analyzeByAlert(id, title, content).catch((err) => {
          logger.error('Failed to auto-trigger RCA for alert:', err);
        });
      }
    });

    res.json({
      success: processResult?.success ?? false,
      message: errorMsg
        ? `处理出错: ${errorMsg}`
        : `处理完成：使用 ${processResult?.strategy ?? 'unknown'} 策略`,
      data: {
        alertId: id,
        strategy: processResult?.strategy ?? 'unknown',
        executionId: processResult?.executionId || processResult?.taskId,
        error: errorMsg || processResult?.errorMessage
      }
    });
  } catch (error) {
    logger.error('Failed to trigger manual alert processing:', error);
    res.status(500).json({ success: false, error: '触发告警处理失败' });
  }
});

// ── 统一入口：告警处理（自动决策用哪种策略） ──
router.post('/:id/process-unified', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const alert = db.prepare('SELECT id, title, content, severity, source, metadata FROM alerts WHERE id = ?').get(id) as any;
    if (!alert) {
      return res.status(404).json({ success: false, error: '告警不存在' });
    }

    // 解析 metadata
    let metadata: Record<string, unknown> = {};
    try {
      metadata = alert.metadata ? JSON.parse(alert.metadata) : {};
    } catch { /* ignore */ }

    const result = await alertProcessor.processAlert({
      alertId: alert.id,
      title: alert.title,
      content: alert.content,
      severity: alert.severity,
      source: alert.source,
      metadata
    });

    res.status(200).json({
      success: result.success,
      message: result.success
        ? `告警处理成功，策略: ${result.strategy}`
        : `告警处理失败，策略: ${result.strategy}，错误: ${result.errorMessage}`,
      data: result
    });
  } catch (error) {
    logger.error('Failed to process alert via unified API:', error);
    res.status(500).json({ success: false, error: '统一告警处理失败' });
  }
});

// ==================== 告警 Provider 管理 API ====================

router.get('/providers/list', (req: Request, res: Response) => {
  try {
    const { type } = req.query;
    let providers;
    
    if (type) {
      providers = alertProviderRegistry.listProvidersByType(type as any);
    } else {
      providers = alertProviderRegistry.listProviders();
    }
    
    const simplifiedProviders = providers.map(p => ({
      id: p.id,
      name: p.name,
      type: p.type,
      configSchema: p.configSchema
    }));
    
    res.json({ success: true, data: simplifiedProviders });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get alert providers' });
  }
});

router.post('/providers/fetch', async (req: Request, res: Response) => {
  try {
    const { providerId, config } = req.body;
    
    if (!providerId) {
      return res.status(400).json({ success: false, error: 'Provider ID is required' });
    }
    
    const provider = alertProviderRegistry.getProvider(providerId);
    if (!provider) {
      return res.status(404).json({ success: false, error: `Provider ${providerId} not found` });
    }
    
    const alerts = await provider.fetchAlerts(config || {});
    res.json({ success: true, data: alerts });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch alerts from provider' });
  }
});

// === Alert Provider Configs CRUD ===
router.get('/providers/configs', (req, res) => {
  try {
    const configs = db.prepare('SELECT * FROM alert_provider_configs ORDER BY created_at DESC').all();
    // Parse JSON config
    const parsedConfigs = configs.map((config: any) => {
      let parsedConfig;
      try {
        parsedConfig = config.config ? JSON.parse(config.config) : null;
      } catch {
        parsedConfig = null;
      }
      return { ...config, config: parsedConfig };
    });
    res.json({ success: true, data: parsedConfigs });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get provider configs' });
  }
});

router.get('/providers/configs/:id', (req, res) => {
  try {
    const config = db.prepare('SELECT * FROM alert_provider_configs WHERE id = ?').get(req.params.id);
    if (!config) {
      return res.status(404).json({ success: false, error: 'Config not found' });
    }
    let parsedConfig;
    try {
      parsedConfig = (config as any).config ? JSON.parse((config as any).config) : null;
    } catch {
      parsedConfig = null;
    }
    res.json({ success: true, data: { ...(config as any), config: parsedConfig } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to get provider config' });
  }
});

router.post('/providers/configs', (req, res) => {
  try {
    const { provider_id, name, config, enabled } = req.body;
    if (!provider_id || !name) {
      return res.status(400).json({ success: false, error: 'provider_id and name are required' });
    }
    const id = randomUUID();
    db.prepare(`
      INSERT INTO alert_provider_configs (id, provider_id, name, config, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))
    `).run(
      id,
      provider_id,
      name,
      JSON.stringify(config || {}),
      enabled !== undefined ? (enabled ? 1 : 0) : 1
    );
    const newConfig = db.prepare('SELECT * FROM alert_provider_configs WHERE id = ?').get(id);
    let parsedConfig;
    try {
      parsedConfig = (newConfig as any).config ? JSON.parse((newConfig as any).config) : null;
    } catch {
      parsedConfig = null;
    }
    res.status(201).json({ success: true, data: { ...(newConfig as any), config: parsedConfig } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to create provider config' });
  }
});

router.put('/providers/configs/:id', (req, res) => {
  try {
    const { name, config, enabled } = req.body;
    const id = req.params.id;
    const updates: string[] = [];
    const values: any[] = [];
    
    if (name !== undefined) {
      updates.push('name = ?');
      values.push(name);
    }
    if (config !== undefined) {
      updates.push('config = ?');
      values.push(JSON.stringify(config || {}));
    }
    if (enabled !== undefined) {
      updates.push('enabled = ?');
      values.push(enabled ? 1 : 0);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }
    updates.push('updated_at = datetime(\'now\',\'localtime\')');
    values.push(id);
    
    db.prepare(`UPDATE alert_provider_configs SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    
    const updatedConfig = db.prepare('SELECT * FROM alert_provider_configs WHERE id = ?').get(id);
    let parsedConfig;
    try {
      parsedConfig = (updatedConfig as any).config ? JSON.parse((updatedConfig as any).config) : null;
    } catch {
      parsedConfig = null;
    }
    res.json({ success: true, data: { ...(updatedConfig as any), config: parsedConfig } });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to update provider config' });
  }
});

router.delete('/providers/configs/:id', (req, res) => {
  try {
    const id = req.params.id;
    const result = db.prepare('DELETE FROM alert_provider_configs WHERE id = ?').run(id);
    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Config not found' });
    }
    res.json({ success: true, message: 'Config deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to delete provider config' });
  }
});

export default router;
