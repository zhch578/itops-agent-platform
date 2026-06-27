/**
 * =============================================================================
 * AARS v2 — 告警自适应响应 API 路由
 * =============================================================================
 */

import { Router, Request, Response } from 'express';
import { alertAutoResponseService } from '../services/alertAutoResponse/alertAutoResponseService';
import { adaptiveAutomationEngine } from '../services/alertAutoResponse/adaptive/adaptiveAutomation';
import { strategyRecommender } from '../services/alertAutoResponse/adaptive/strategyRecommender';
import { resourceAwareScheduler } from '../services/alertAutoResponse/scheduler/resourceAwareScheduler';
import db from '../models/database';
import { logger } from '../utils/logger';

const router = Router();

/**
 * POST /api/alert-auto-response/trigger/:alertId
 * 手动触发某个告警的自动响应
 */
router.post('/trigger/:alertId', async (req: Request, res: Response) => {
  try {
    const { alertId } = req.params;

    // 检查告警是否存在
    const alert = db.prepare('SELECT id, title, severity FROM alerts WHERE id = ?').get(alertId) as any;
    if (!alert) {
      return res.status(404).json({ error: '告警不存在' });
    }

    // 异步触发（不等待完成）
    alertAutoResponseService.triggerManually(alertId).catch(err => {
      logger.error(`Manual trigger failed for ${alertId}: ${err.message}`);
    });

    res.json({
      success: true,
      message: `已触发告警 ${alertId} 的自动响应流程`,
      alertTitle: alert.title,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/alert-auto-response/logs
 * 获取自动响应执行日志
 */
router.get('/logs', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const logs = alertAutoResponseService.getLogs(limit);
    res.json({ logs, count: logs.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/alert-auto-response/logs/:alertId
 * 获取特定告警的响应日志
 */
router.get('/logs/:alertId', (req: Request, res: Response) => {
  try {
    const log = alertAutoResponseService.getLogByAlertId(req.params.alertId);
    if (!log) {
      return res.status(404).json({ error: '未找到该告警的响应记录' });
    }
    res.json(log);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/alert-auto-response/stats
 * 获取响应系统统计信息
 */
router.get('/stats', (req: Request, res: Response) => {
  try {
    const stats = alertAutoResponseService.getStats();
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/alert-auto-response/config
 * 获取当前配置
 */
router.get('/config', (req: Request, res: Response) => {
  try {
    const config = db.prepare('SELECT * FROM aars_config LIMIT 1').get();
    res.json(config || { enabled: true, min_severity: 'medium' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/alert-auto-response/config
 * 更新配置
 */
router.put('/config', (req: Request, res: Response) => {
  try {
    const updates = req.body;
    const fields: string[] = [];
    const params: Record<string, unknown> = {};

    const allowedFields = [
      'enabled', 'min_severity', 'auto_execute_enabled', 'approval_timeout_minutes',
      'max_concurrent', 'ssh_timeout_sec', 'verify_interval_sec', 'notification_channels',
      'auto_execute_whitelist', 'business_hours',
    ];

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        fields.push(`${field} = @${field}`);
        params[field] = updates[field];
      }
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: '没有可更新的字段' });
    }

    fields.push("updated_at = datetime('now','localtime')");
    db.prepare(`UPDATE aars_config SET ${fields.join(', ')} WHERE id = 1`).run(params);

    const config = db.prepare('SELECT * FROM aars_config LIMIT 1').get();
    res.json({ success: true, config });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/alert-auto-response/trust-stats
 * 查看自适应自动化信任统计
 */
router.get('/trust-stats', (req: Request, res: Response) => {
  try {
    const stats = adaptiveAutomationEngine.getTrustStats();
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/alert-auto-response/scheduler-stats
 * 查看调度器状态
 */
router.get('/scheduler-stats', (req: Request, res: Response) => {
  try {
    const stats = resourceAwareScheduler.getStats();
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/alert-auto-response/probe-stats
 * 查看探针统计
 */
router.get('/probe-stats', (req: Request, res: Response) => {
  try {
    const rows = db.prepare(`
      SELECT * FROM probe_execution_stats ORDER BY total_uses DESC LIMIT 50
    `).all();
    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
