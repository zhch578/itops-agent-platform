
import db from '../models/database';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';
import { alertAutoResponseService } from '../modules/alerts/services/alertAutoResponse/alertAutoResponseService';
import { remediationService } from '../modules/auto/services/remediationService';
import { knowledgeEngine } from './KnowledgeEngine';
import type {
  AlertProcessingContext,
  ProcessingDecision,
  ProcessingResult,
  ProcessingStrategy
} from '../types/unified-alert-processing';

const DEFAULT_CONFIG = {
  criticalSeverity: 'hybrid' as ProcessingStrategy,
  highSeverity: 'hybrid' as ProcessingStrategy,
  mediumSeverity: 'aars' as ProcessingStrategy,
  lowSeverity: 'workflow' as ProcessingStrategy,
  knowledgeThreshold: 0.8,
  maxAarsFallback: true
};

class AlertProcessor {
  private initialized = false;
  private config = DEFAULT_CONFIG;

  async init(): Promise<void> {
    if (this.initialized) return;
    this.ensureTables();
    this.initialized = true;
    logger.info('✅ AlertProcessor 统一告警处理引擎已启动');
  }

  private ensureTables(): void {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS alert_processing_records (
          id TEXT PRIMARY KEY,
          alert_id TEXT NOT NULL,
          strategy TEXT NOT NULL,
          decision_reason TEXT,
          execution_id TEXT,
          task_id TEXT,
          aars_log_id TEXT,
          remediation_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          error_message TEXT,
          created_at DATETIME DEFAULT (datetime('now','localtime')),
          updated_at DATETIME DEFAULT (datetime('now','localtime')),
          FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_proc_alert_id ON alert_processing_records(alert_id);
        CREATE INDEX IF NOT EXISTS idx_proc_status ON alert_processing_records(status);
      `);
    } catch (err) {
      logger.warn('alert_processing_records 表可能已存在', err);
    }
  }

  async processAlert(context: AlertProcessingContext): Promise<ProcessingResult> {
    const recordId = randomUUID();
    logger.info(`🔍 [统一处理] 开始处理告警 ${context.alertId}: ${context.title}`);

    // 保存初始记录
    this.saveProcessingRecord(recordId, context, 'pending');

    try {
      // 决策策略
      const decision = this.makeDecision(context);
      logger.info(`🤖 [统一处理] 策略决策: ${decision.strategy}, 原因: ${decision.reason}`);
      this.saveDecision(recordId, decision);

      // 执行策略
      let result: ProcessingResult;

      if (decision.strategy === 'aars') {
        result = await this.processWithAars(recordId, context);
      } else if (decision.strategy === 'workflow') {
        result = await this.processWithWorkflow(recordId, context, decision.workflowId!);
      } else if (decision.strategy === 'hybrid') {
        result = await this.processWithHybrid(recordId, context);
      } else {
        result = await this.processWithAuto(recordId, context);
      }

      // 最终状态
      this.finalizeProcessingRecord(recordId, result);
      logger.info(`✅ [统一处理] 告警 ${context.alertId} 处理完成: ${result.success}`);
      return result;

    } catch (err: any) {
      const errorMsg = err.message || String(err);
      logger.error(`❌ [统一处理] 告警 ${context.alertId} 处理失败: ${errorMsg}`);
      this.finalizeProcessingRecord(recordId, {
        success: false,
        strategy: 'auto',
        errorMessage: errorMsg
      });
      throw err;
    }
  }

  private makeDecision(context: AlertProcessingContext): ProcessingDecision {
    // 先查历史知识
    const knowledgeMatch = this.checkKnowledge(context);
    if (knowledgeMatch.found && knowledgeMatch.successRate >= this.config.knowledgeThreshold) {
      return {
        strategy: 'workflow',
        reason: `知识库匹配成功: 历史成功率 ${(knowledgeMatch.successRate * 100).toFixed(1)}%`,
        workflowId: knowledgeMatch.workflowId
      };
    }

    // 按严重程度
    if (context.severity === 'critical' || context.severity === 'high') {
      return {
        strategy: this.config.criticalSeverity,
        reason: `${context.severity} 等级告警: 默认采用 ${this.config.criticalSeverity} 策略`,
        aarsFallback: this.config.maxAarsFallback,
        workflowId: this.getDefaultWorkflow(context)
      };
    }

    if (context.severity === 'medium') {
      return {
        strategy: this.config.mediumSeverity,
        reason: `medium 等级告警: 默认采用 aars 策略`
      };
    }

    return {
      strategy: this.config.lowSeverity,
      reason: `${context.severity}/info: 默认采用 workflow 策略`,
      workflowId: this.getDefaultWorkflow(context)
    };
  }

  private async processWithAars(_recordId: string, context: AlertProcessingContext): Promise<ProcessingResult> {
    try {
      await alertAutoResponseService.triggerManually(context.alertId);
      const log = alertAutoResponseService.getByAlertId(context.alertId);
      return {
        success: log?.status === 'resolved',
        strategy: 'aars',
        aarsLogId: log?.id
      };
    } catch (err: any) {
      return {
        success: false,
        strategy: 'aars',
        errorMessage: err.message || String(err)
      };
    }
  }

  private async processWithWorkflow(
    _recordId: string,
    context: AlertProcessingContext,
    workflowId: string
  ): Promise<ProcessingResult> {
    try {
      const alert = {
        id: context.alertId,
        title: context.title,
        content: context.content,
        severity: context.severity,
        source: context.source,
        tags: []
      };

      const policy = await this.getOrCreatePolicy(context, workflowId);
      if (!policy) {
        throw new Error('找不到或无法创建修复策略');
      }

      const execution = await remediationService.triggerRemediation(policy, alert);

      return {
        success: execution.status === 'success' || execution.status === 'pending' || execution.status === 'waiting_approval',
        strategy: 'workflow',
        executionId: execution.id,
        remediationId: execution.id
      };
    } catch (err: any) {
      return {
        success: false,
        strategy: 'workflow',
        errorMessage: err.message || String(err)
      };
    }
  }

  private async processWithHybrid(recordId: string, context: AlertProcessingContext): Promise<ProcessingResult> {
    logger.info(`🤖 [Hybrid] 首先尝试 AARS 策略`);
    let result = await this.processWithAars(recordId, context);

    if (result.success) {
      return result;
    }

    if (this.config.maxAarsFallback) {
      logger.info(`🔄 [Hybrid] AARS 策略失败，回退到 workflow 策略`);
      result = await this.processWithWorkflow(recordId, context, this.getDefaultWorkflow(context));
      return { ...result, strategy: 'hybrid' };
    }

    return result;
  }

  private async processWithAuto(recordId: string, context: AlertProcessingContext): Promise<ProcessingResult> {
    return this.processWithHybrid(recordId, context);
  }

  private checkKnowledge(context: AlertProcessingContext): {
    found: boolean;
    workflowId?: string;
    successRate: number;
  } {
    try {
      const recommendations = knowledgeEngine.recommend(context.title, context.content, 3);
      if (recommendations.length === 0) return { found: false, successRate: 0 };

      // 取相似度最高且成功率 > 阈值 的推荐
      const best = recommendations[0];
      if (best.similarity >= 0.4 && best.entry.successRating >= 0.5) {
        // 如果该知识条目关联了 workflowId，直接用
        const workflowId = best.entry.workflowId || undefined;
        return {
          found: true,
          workflowId,
          successRate: best.entry.successRating,
        };
      }

      return { found: false, successRate: 0 };
    } catch (err) {
      logger.debug('知识库推荐查询失败', err);
    }
    return { found: false, successRate: 0 };
  }

  private getDefaultWorkflow(context: AlertProcessingContext): string {
    const preset = db.prepare(
      'SELECT id FROM workflows WHERE is_template = 1 ORDER BY id LIMIT 1'
    ).get() as { id: string } | undefined;
    if (preset) return preset.id;
    throw new Error('找不到可用的预设工作流');
  }

  private async getOrCreatePolicy(
    context: AlertProcessingContext,
    workflowId: string
  ): Promise<any> {
    const existing = db.prepare(`
      SELECT * FROM remediation_policies
      WHERE alert_source = ?
        AND (alert_severity = ? OR alert_severity IS NULL)
        AND enabled = 1
        AND workflow_id = ?
      LIMIT 1
    `).get(context.source, context.severity, workflowId) as any;

    if (existing) return existing;

    const id = randomUUID();
    db.prepare(`
      INSERT INTO remediation_policies (
        id, name, description, alert_source, alert_severity, execution_mode, workflow_id, enabled, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now','localtime'), datetime('now','localtime'))
    `).run(
      id,
      `临时策略: ${context.title.substring(0, 40)}`,
      '系统自动创建的统一策略',
      context.source,
      context.severity,
      'approval',
      workflowId
    );

    return db.prepare('SELECT * FROM remediation_policies WHERE id = ?').get(id);
  }

  private saveProcessingRecord(
    recordId: string,
    context: AlertProcessingContext,
    status: string
  ): void {
    try {
      db.prepare(`
        INSERT INTO alert_processing_records (id, alert_id, status, created_at, updated_at)
        VALUES (?, ?, ?, datetime('now','localtime'), datetime('now','localtime'))
      `).run(recordId, context.alertId, status);
    } catch (err) {
      logger.debug('保存处理记录时出错', err);
    }
  }

  private saveDecision(recordId: string, decision: ProcessingDecision): void {
    try {
      db.prepare(`
        UPDATE alert_processing_records
        SET strategy = ?, decision_reason = ?, updated_at = datetime('now','localtime')
        WHERE id = ?
      `).run(decision.strategy, decision.reason, recordId);
    } catch (err) {
      logger.debug('保存策略决策时出错', err);
    }
  }

  private finalizeProcessingRecord(recordId: string, result: ProcessingResult): void {
    try {
      db.prepare(`
        UPDATE alert_processing_records
        SET status = ?,
            execution_id = ?,
            task_id = ?,
            aars_log_id = ?,
            remediation_id = ?,
            error_message = ?,
            updated_at = datetime('now','localtime')
        WHERE id = ?
      `).run(
        result.success ? 'success' : 'failed',
        result.executionId || null,
        result.taskId || null,
        result.aarsLogId || null,
        result.remediationId || null,
        result.errorMessage || null,
        recordId
      );
    } catch (err) {
      logger.debug('更新最终记录时出错', err);
    }
  }

  getRecordByAlertId(alertId: string): any {
    return db.prepare(
      'SELECT * FROM alert_processing_records WHERE alert_id = ? ORDER BY created_at DESC LIMIT 1'
    ).get(alertId);
  }
}

export const alertProcessor = new AlertProcessor();
