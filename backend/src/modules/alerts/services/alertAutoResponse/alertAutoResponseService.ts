/**
 * =============================================================================
 * AARS v2 — 告警自适应智能响应服务（主编排器）
 *
 * 这是整个系统的核心编排器，负责：
 *   1. 监听新告警（轮询 / webhook 双触发）
 *   2. 设备画像 → 诊断 → 风险评分 → 决策 → 执行 → 验证 → 闭环
 *   3. 并发控制 + 通知
 *
 * 架构风格：轻量编排 —— 只调度，不写业务逻辑
 * =============================================================================
 */

import { v4 as uuidv4 } from 'uuid';
import db from '../../../../models/database';
import { logger } from '../../../../utils/logger';
import { generateCompletion } from '../../../ai/services/llm/llmService';
import { deviceProfiler } from './adaptive/deviceProfiler';
import { sshDiagnosisEngine } from './diagnosis/sshDiagnosisEngine';
import { snmpDiagnosisEngine } from './diagnosis/snmpDiagnosisEngine';
import { riskAssessor } from './adaptive/riskAssessor';
import { adaptiveAutomationEngine } from './adaptive/adaptiveAutomation';
import { remediationExecutor } from './remediation/remediationExecutor';
import { knowledgeFeedbackLoop } from './adaptive/knowledgeFeedbackLoop';
import { resourceAwareScheduler } from './scheduler/resourceAwareScheduler';
import { smartNotifier } from './notification/smartNotifier';
import { escalationEngine } from './adaptive/escalationEngine';
import { baselineAnomalyDetector } from './adaptive/baselineAnomalyDetector';
import type {
  DeviceRuntimeProfile, AlertResponseLog, ResponseLogStatus,
  SshDiagnosisResult, SnmpDiagnosisResult,
} from './types';

class AlertAutoResponseService {
  private processingIds = new Set<string>();
  private initialized = false;

  /** 确保所有需要的表存在 */
  private ensureTables(): void {
    try {
      // 确保基线表存在
      db.exec(`
        CREATE TABLE IF NOT EXISTS baseline_metrics (
          device_id TEXT NOT NULL,
          metric_name TEXT NOT NULL,
          sample_value REAL NOT NULL,
          sampled_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          PRIMARY KEY (device_id, metric_name, sampled_at)
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS aars_response_logs (
          id TEXT PRIMARY KEY,
          alert_id TEXT NOT NULL,
          device_id TEXT,
          device_type TEXT,
          access_method TEXT,
          status TEXT NOT NULL DEFAULT 'identifying',
          probes_used TEXT,
          diagnosis_result TEXT,
          root_cause TEXT,
          remediation_plan TEXT,
          verification_result TEXT,
          execution_status TEXT,
          approval_status TEXT DEFAULT 'not_needed',
          notification_sent INTEGER DEFAULT 0,
          error_message TEXT,
          started_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime')),
          completed_at TEXT,
          FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE CASCADE
        )
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS aars_config (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          enabled INTEGER DEFAULT 1,
          min_severity TEXT DEFAULT 'medium',
          auto_execute_enabled INTEGER DEFAULT 1,
          approval_timeout_minutes INTEGER DEFAULT 30,
          max_concurrent INTEGER DEFAULT 5,
          ssh_timeout_sec INTEGER DEFAULT 30,
          verify_interval_sec INTEGER DEFAULT 30,
          notification_channels TEXT DEFAULT '["wecom","dingtalk","email"]',
          auto_execute_whitelist TEXT DEFAULT '["systemctl restart","logrotate","rm -rf /tmp/*"]',
          business_hours TEXT DEFAULT '{"start":"09:00","end":"18:00"}',
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime'))
        )
      `);

      // 插入默认配置
      const existing = db.prepare('SELECT id FROM aars_config LIMIT 1').get();
      if (!existing) {
        db.prepare(`INSERT INTO aars_config DEFAULT VALUES`).run();
      }
    } catch (err: any) {
      logger.warn(`[AARS] Failed to ensure tables: ${err.message}`);
    }
  }

  /**
   * 启动服务（仅加载子引擎，不再独立轮询 — 统一由 AlertProcessor 触发）
   */
  start(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.ensureTables();

    logger.info('🤖 [AARS v2] 告警自适应智能响应服务已启动（纯执行引擎模式，由 AlertProcessor 统一触发）');

    // 启动子引擎
    escalationEngine.ensureTable();
    escalationEngine.start();

    // 不再启动独立轮询 — AlertProcessor 统一决定何时调用 AARS
  }

  /**
   * 停止服务
   */
  stop(): void {
    this.initialized = false;
    escalationEngine.stop();
    logger.info('⏹ [AARS v2] 服务已停止');
  }

  // @deprecated 已由 AlertProcessor 统一接管的旧轮询逻辑
  // ===== 以下 poll / fetchPendingAlerts / isAlreadyProcessedByAnalyzer 保留供参考 =====

  /** 检查告警是否已被AutoAnalyzer处理 */
  private isAlreadyProcessedByAnalyzer(alertId: string): boolean {
    try {
      const record = db.prepare(`
        SELECT 1 FROM alert_auto_analysis 
        WHERE alert_id = ? 
        AND status NOT IN ('pending', 'running')
        LIMIT 1
      `).get(alertId);
      return !!record;
    } catch {
      return false;
    }
  }

  /**
   * 处理单个告警的主流程
   */
  async processAlert(alertId: string): Promise<void> {
    if (this.processingIds.has(alertId)) {
      logger.debug(`[AARS] Alert ${alertId} already being processed`);
      return;
    }
    
    // 检查是否已被AutoAnalyzer处理过
    if (this.isAlreadyProcessedByAnalyzer(alertId)) {
      logger.debug(`[AARS] Alert ${alertId} already processed by AutoAnalyzer, skipping`);
      return;
    }

    this.processingIds.add(alertId);
    const logId = uuidv4();
    const startTime = Date.now();

    try {
      const alert = db.prepare('SELECT id, title, content, severity, source, metadata FROM alerts WHERE id = ?')
        .get(alertId) as { id: string; title: string; content: string; severity: string; source: string; metadata: string } | undefined;

      if (!alert) {
        logger.warn(`[AARS] Alert ${alertId} not found`);
        return;
      }

      logger.info(`[AARS] Processing alert ${alertId}: "${alert.title.substring(0, 60)}" (severity=${alert.severity})`);

      // ── 启动渐进式升级追踪 ──
      escalationEngine.ensureTable();
      escalationEngine.track(alertId, alert.title, alert.severity, null);

      // ── 基线异常检测 ──
      let baselineDeviation = await baselineAnomalyDetector.analyze(alert.title, '', '');

      // ──────────────── 阶段1：设备画像 ────────────────
      const metadata = this.safeParseJson(alert.metadata, {});
      const targetIp = this.extractIp(alert.title, alert.content, metadata);
      if (!targetIp) {
        logger.warn(`[AARS] No IP found for alert ${alertId}`);
        await this.saveLog(logId, alertId, null, 'failed', { error_message: 'No target IP found' });
        return;
      }

      const device = await deviceProfiler.profile(targetIp, alert.title, alert.content);
      if (!device) {
        logger.warn(`[AARS] No device profile for IP ${targetIp}`);
        await this.saveLog(logId, alertId, null, 'failed', { error_message: `Cannot identify device: ${targetIp}` });
        await smartNotifier.notify({
          alertId, alertTitle: alert.title, alertSeverity: alert.severity,
          device: { deviceId: '', type: 'unknown', ip: targetIp, hostname: targetIp, accessMethod: 'none', identificationConfidence: 0 },
          reason: 'diagnosis_complete', summary: '设备无法识别', detail: `IP ${targetIp} 未匹配到任何已知设备，无法自动诊断`,
        });
        return;
      }

      await this.saveLog(logId, alertId, device, 'diagnosing');

      // ── 基线异常检测（有了设备信息后重新分析） ──
      baselineDeviation = await baselineAnomalyDetector.analyze(alert.title, device.deviceId, device.type);
      logger.info(`[AARS] Baseline deviation for ${device.hostname}: ${baselineDeviation.baselineSummary}`);

      // 更新升级引擎的设备信息
      // 重新用已知 device 进行追踪

      // ──────────────── 阶段2：诊断 ────────────────
      let diagnosisResult: SshDiagnosisResult | SnmpDiagnosisResult;

      if (device.accessMethod === 'ssh' || device.accessMethod === 'both') {
        // SSH 路径 —— 服务器设备
        diagnosisResult = await sshDiagnosisEngine.diagnose(device, alert.title, alert.content);
      } else if (device.accessMethod === 'snmp') {
        // SNMP 路径 —— 网络设备
        diagnosisResult = await snmpDiagnosisEngine.diagnose(device, alert.title, alert.content);
      } else {
        // 无法访问
        diagnosisResult = {
          probeResults: [],
          rawOutput: '',
          diagnosis: '❌ 无法访问设备（无 SSH/SNMP 凭证）',
          summary: '无法访问',
          rootCause: '无访问凭证',
          remediationPlan: { commands: [], rollbackCommands: [], summary: '', risk: {} as any, requiresApproval: true },
          riskAssessment: { overallRiskScore: 1, dimensions: {} as any, suggestedAction: 'manual_only', thresholds: { autoThreshold: 0.25, approveThreshold: 0.55, manualThreshold: 0.80 } as any },
          durationMs: 0,
        } as SshDiagnosisResult;
      }

      logger.info(`[AARS] Diagnosis complete: ${diagnosisResult.summary || '已诊断'}`);

      // ──────────────── 阶段3：决策（SSH设备 → 修复 / SNMP设备 → 仅通知） ────────────────

      if (device.accessMethod === 'snmp') {
        // 网络设备不自动修复，仅通知
        await this.saveLog(logId, alertId, device, 'resolved', {
          diagnosis_result: diagnosisResult.diagnosis,
          root_cause: diagnosisResult.rootCause,
        });

        await smartNotifier.notify({
          alertId, alertTitle: alert.title, alertSeverity: alert.severity, device,
          reason: 'diagnosis_complete',
          summary: diagnosisResult.summary,
          detail: diagnosisResult instanceof Object && 'findings' in diagnosisResult
            ? (diagnosisResult as SnmpDiagnosisResult).findings.join('\n')
            : diagnosisResult.diagnosis,
        });

        logger.info(`[AARS] SNMP device ${device.hostname} — diagnosis only (no auto-remediation)`);
        // SNMP 设备标记为处理完成（不自动修复但仍追踪升级）
        escalationEngine.onProcessed(alertId, false);
        await this.updateLogCompleted(logId, Date.now() - startTime);
        return;
      }

      const sshResult = diagnosisResult as SshDiagnosisResult;

      // SSH 设备：风险评估 + 自动化决策
      await this.saveLog(logId, alertId, device, 'analyzing');

      // 风险评估（如果还没有）
      if (!sshResult.remediationPlan.risk?.suggestedAction) {
        sshResult.remediationPlan.risk = riskAssessor.assess(
          sshResult.remediationPlan, alert.severity, alert.title
        );
      }

      // 自适应决策
      const decision = adaptiveAutomationEngine.decide(sshResult.remediationPlan, sshResult.remediationPlan.risk);

      logger.info(
        `[AARS] Decision for ${device.hostname}: ${decision} ` +
        `(risk=${sshResult.remediationPlan.risk.overallRiskScore.toFixed(3)})`
      );

      // ──────────────── 阶段4：执行 / 审批 / 通知 ────────────────

      if (decision === 'auto') {
        // 自动执行
        await this.saveLog(logId, alertId, device, 'executing');

        const execResult = await remediationExecutor.execute(
          sshResult.remediationPlan, device, sshResult.probeResults, alertId, alert.title
        );

        await this.saveLog(logId, alertId, device, execResult.success ? 'resolved' : 'failed', {
          verification_result: JSON.stringify(execResult.verificationResult),
          execution_status: execResult.success ? 'success' : 'failed',
        });

        await smartNotifier.notify({
          alertId, alertTitle: alert.title, alertSeverity: alert.severity, device,
          reason: execResult.success ? 'auto_executed' : (execResult.rolledBack ? 'rolled_back' : 'execution_failed'),
          summary: execResult.success ? `修复成功: ${sshResult.remediationPlan.summary}` : `修复失败: ${execResult.error || '未知错误'}`,
          detail: execResult.verificationResult.stages.map(s => `${s.passed ? '✅' : '❌'} ${s.stage}: ${s.detail}`).join('\n'),
          commands: sshResult.remediationPlan.commands.map(c => c.command),
        });

        // ── 知识反馈闭环 ──
        if (execResult.success) {
          knowledgeFeedbackLoop.feedback({
            alertId, alertTitle: alert.title, alertSource: alert.source,
            alertSeverity: alert.severity, device,
            probesUsed: sshResult.probeResults,
            rootCause: sshResult.rootCause,
            remediationPlan: sshResult.remediationPlan,
            verificationResult: execResult.verificationResult,
            overallSuccess: execResult.success,
            executionCommands: sshResult.remediationPlan.commands.map(c => c.command),
            durationMs: Date.now() - startTime,
          }).catch((err: any) => {
            logger.warn(`[AARS] Feedback loop error: ${err.message}`);
          });
        }

      } else if (decision === 'approve') {
        // 需要审核
        await this.saveLog(logId, alertId, device, 'pending_approval', {
          remediation_plan: JSON.stringify(sshResult.remediationPlan),
          approval_status: 'pending',
        });

        await smartNotifier.notify({
          alertId, alertTitle: alert.title, alertSeverity: alert.severity, device,
          reason: 'approval_required',
          summary: sshResult.remediationPlan.summary,
          detail: `风险评分: ${(sshResult.remediationPlan.risk.overallRiskScore * 100).toFixed(0)}/100\n\n**诊断结果**:\n${sshResult.diagnosis.substring(0, 500)}`,
          commands: sshResult.remediationPlan.commands.map(c => c.command),
        });

        logger.info(`[AARS] Approval pending for ${device.hostname} — sent notification`);

      } else {
        // manual_only / escalate
        await this.saveLog(logId, alertId, device, 'escalated', {
          remediation_plan: JSON.stringify(sshResult.remediationPlan),
          error_message: `Decision: ${decision} — requires manual intervention`,
        });

        await smartNotifier.notify({
          alertId, alertTitle: alert.title, alertSeverity: alert.severity, device,
          reason: 'escalated',
          summary: `需要人工介入 (${decision === 'blocked' ? '已被系统阻止' : '超出自动处理范围'})`,
          detail: `风险评分: ${(sshResult.remediationPlan.risk.overallRiskScore * 100).toFixed(0)}/100\n\n**诊断结果**:\n${sshResult.diagnosis.substring(0, 500)}`,
        });

        logger.info(`[AARS] Escalated ${device.hostname} — decision=${decision}`);
      }

      // ──────────────── 阶段5：日志更新 + 知识闭环 ────────────────
      await this.updateLogCompleted(logId, Date.now() - startTime);

      // ── 更新升级引擎 ──
      escalationEngine.onProcessed(alertId, decision === 'auto');

      // ── 触发告警关联聚合 ──

      // ── 更新基线 ──
      if (device?.deviceId) {
        baselineAnomalyDetector.updateBaseline(device.deviceId, {});
      }

    } catch (err: any) {
      logger.error(`[AARS] Error processing alert ${alertId}: ${err.message}`, err);

      escalationEngine.fail(alertId);

      await this.saveLog(logId, alertId, null, 'failed', {
        error_message: err.message,
      }).catch(() => {});

    } finally {
      this.processingIds.delete(alertId);
    }
  }

  // ══════════════════ 工具方法 ══════════════════

  private getConfig(): { enabled: boolean; minSeverity: string } {
    try {
      const config = db.prepare('SELECT enabled, min_severity FROM aars_config LIMIT 1').get() as any;
      return {
        enabled: config?.enabled === 1,
        minSeverity: config?.min_severity || 'medium',
      };
    } catch {
      return { enabled: true, minSeverity: 'medium' };
    }
  }

  private fetchPendingAlerts(minSeverity: string): Array<{ id: string; severity: string }> {
    const severityOrder: Record<string, number> = {
      'critical': 1, 'high': 2, 'medium': 3, 'low': 4, 'info': 5,
    };

    const minLevel = severityOrder[minSeverity] || 3;

    const rows = db.prepare(`
      SELECT a.id, a.severity
      FROM alerts a
      WHERE a.status = 'new'
        AND a.severity IN ('critical', 'high', 'medium', 'low')
        AND NOT EXISTS (SELECT 1 FROM aars_response_logs l WHERE l.alert_id = a.id)
      ORDER BY
        CASE a.severity
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          ELSE 4
        END ASC,
        a.created_at ASC
      LIMIT 10
    `).all() as Array<{ id: string; severity: string }>;

    return rows.filter(r => {
      const level = severityOrder[r.severity] || 10;
      return level <= minLevel && !this.processingIds.has(r.id);
    });
  }

  private severityToPriority(severity: string): 'critical' | 'high' | 'medium' | 'low' {
    if (severity === 'critical' || severity === 'disaster') return 'critical';
    if (severity === 'high') return 'high';
    if (severity === 'warning' || severity === 'medium') return 'medium';
    return 'low';
  }

  private extractIp(title: string, content: string, metadata: Record<string, any>): string | null {
    // 优先从 metadata 中取
    if (metadata.host && typeof metadata.host === 'string') return metadata.host;
    if (metadata.labels?.instance) return metadata.labels.instance;
    if (metadata.annotations?.instance) return metadata.annotations.instance;

    // 从标题/内容中正则提取
    const text = `${title} ${content || ''}`;
    const ipRegex = /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g;
    const ips = text.match(ipRegex);
    if (ips) {
      // 排除本地地址
      const valid = ips.filter(ip => !ip.startsWith('127.') && !ip.startsWith('169.254.'));
      return valid[0] || null;
    }

    return null;
  }

  private safeParseJson(str: string | null | undefined, fallback: any = {}): any {
    if (!str) return fallback;
    try { return JSON.parse(str); } catch { return fallback; }
  }

  private async saveLog(
    id: string, alertId: string, device: DeviceRuntimeProfile | null,
    status: ResponseLogStatus, extra?: Record<string, any>
  ): Promise<void> {
    try {
      const now = new Date().toISOString();
      db.prepare(`
        INSERT OR REPLACE INTO aars_response_logs
          (id, alert_id, device_id, device_type, access_method, status,
           diagnosis_result, root_cause, remediation_plan, verification_result,
           execution_status, approval_status, error_message,
           started_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, alertId,
        device?.deviceId || extra?.device_id || null,
        device?.type || extra?.device_type || null,
        device?.accessMethod || extra?.access_method || null,
        status,
        extra?.diagnosis_result || null,
        extra?.root_cause || null,
        extra?.remediation_plan || null,
        extra?.verification_result || null,
        extra?.execution_status || null,
        extra?.approval_status || 'not_needed',
        extra?.error_message || null,
        new Date().toISOString(),
        now
      );
    } catch (err: any) {
      logger.warn(`[AARS] Failed to save log: ${err.message}`);
    }
  }

  private async updateLogCompleted(id: string, durationMs: number): Promise<void> {
    try {
      db.prepare(`
        UPDATE aars_response_logs SET
          completed_at = datetime('now','localtime'),
          updated_at = datetime('now','localtime')
        WHERE id = ?
      `).run(id);
    } catch {}
  }

  // ══════════════════ 对外接口 ══════════════════

  /** 手动触发处理告警 */
  async triggerManually(alertId: string): Promise<void> {
    await this.processAlert(alertId);
  }

  /** 获取执行日志 */
  getLogs(limit = 50): AlertResponseLog[] {
    return db.prepare(`
      SELECT * FROM aars_response_logs ORDER BY started_at DESC LIMIT ?
    `).all(limit) as AlertResponseLog[];
  }

  /** 获取特定告警的日志 */
  getLogByAlertId(alertId: string): AlertResponseLog | undefined {
    return db.prepare(
      'SELECT * FROM aars_response_logs WHERE alert_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(alertId) as AlertResponseLog | undefined;
  }

  /** 统一接口: 获取特定告警的日志 */
  getByAlertId(alertId: string): AlertResponseLog | undefined {
    return this.getLogByAlertId(alertId);
  }

  /** 获取统计信息 */
  getStats(): {
    totalProcessed: number;
    autoResolved: number;
    failed: number;
    pendingApproval: number;
    escalated: number;
    scheduler: any;
    trust: any;
  } {
    try {
      const total = (db.prepare('SELECT COUNT(*) as c FROM aars_response_logs').get() as any)?.c || 0;
      const autoResolved = (db.prepare("SELECT COUNT(*) as c FROM aars_response_logs WHERE status = 'resolved' AND execution_status = 'success'").get() as any)?.c || 0;
      const failed = (db.prepare("SELECT COUNT(*) as c FROM aars_response_logs WHERE status = 'failed'").get() as any)?.c || 0;
      const pending = (db.prepare("SELECT COUNT(*) as c FROM aars_response_logs WHERE status = 'pending_approval'").get() as any)?.c || 0;
      const escalated = (db.prepare("SELECT COUNT(*) as c FROM aars_response_logs WHERE status = 'escalated'").get() as any)?.c || 0;

      return {
        totalProcessed: total,
        autoResolved,
        failed,
        pendingApproval: pending,
        escalated,
        scheduler: resourceAwareScheduler.getStats(),
        trust: adaptiveAutomationEngine.getTrustStats(),
      };
    } catch {
      return { totalProcessed: 0, autoResolved: 0, failed: 0, pendingApproval: 0, escalated: 0, scheduler: {}, trust: {} };
    }
  }
}

export const alertAutoResponseService = new AlertAutoResponseService();
