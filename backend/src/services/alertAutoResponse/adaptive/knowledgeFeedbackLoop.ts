/**
 * =============================================================================
 * AARS v2 — 知识反馈闭环
 *
 * 每次处理结束后，更新三个层面的知识：
 *   1. 探针历史准确率 → 影响 strategyRecommender
 *   2. 修复方案成功率 → 影响 adaptiveAutomation
 *   3. 写入故障案例（去重）→ 后续诊断参考
 *   4. 更新基线 → 更准确的门禁验证
 * =============================================================================
 */

import db from '../../../models/database';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../../utils/logger';
import { strategyRecommender } from './strategyRecommender';
import { adaptiveAutomationEngine } from './adaptiveAutomation';
import type { DeviceRuntimeProfile, ProbeResult, VerificationChainResult, RemediationPlan } from '../types';

class KnowledgeFeedbackLoop {
  /**
   * 主反馈入口 —— 告警处理完成后调用
   */
  async feedback(params: {
    alertId: string;
    alertTitle: string;
    alertSource: string;
    alertSeverity: string;
    device: DeviceRuntimeProfile;
    probesUsed: ProbeResult[];
    rootCause: string;
    remediationPlan: RemediationPlan;
    verificationResult: VerificationChainResult;
    overallSuccess: boolean;
    executionCommands: string[];
    durationMs: number;
  }): Promise<void> {
    // 并行执行四项更新
    await Promise.allSettled([
      this.updateProbeAccuracy(params.probesUsed, params.verificationResult),
      this.updateRemediationTrust(params.executionCommands, params.overallSuccess),
      this.writeKnowledgeCase(params),
      this.updateBaseline(params.device, params.overallSuccess),
    ]);
  }

  /**
   * 1. 更新探针历史准确率
   */
  private async updateProbeAccuracy(probes: ProbeResult[], verification: VerificationChainResult): Promise<void> {
    const overallPassed = verification.result === 'passed';
    for (const p of probes) {
      // 探针"成功"的条件：执行成功 + 整体验证通过（或部分通过）
      const successful = p.success && (overallPassed || verification.result === 'partially_passed_with_warning');
      strategyRecommender.recordProbeResult(
        p.probeId,
        successful,
        p.durationMs
      );
    }
  }

  /**
   * 2. 更新修复方案信任评分
   */
  private async updateRemediationTrust(commands: string[], success: boolean): Promise<void> {
    const operationKey = adaptiveAutomationEngine.buildOperationKeyFromCommands(commands);
    // 自动执行的成功/失败 = "隐式批准+已验证"
    adaptiveAutomationEngine.learnFromApproval(operationKey, true, success);
  }

  /**
   * 3. 写入故障案例（知识库去重）
   */
  private async writeKnowledgeCase(params: {
    alertId: string;
    alertTitle: string;
    alertSource: string;
    alertSeverity: string;
    device: DeviceRuntimeProfile;
    rootCause: string;
    remediationPlan: RemediationPlan;
    verificationResult: VerificationChainResult;
    overallSuccess: boolean;
    durationMs: number;
  }): Promise<void> {
    try {
      // 检查是否已存在相似案例（基于告警标题去重）
      const existing = db.prepare(`
        SELECT id FROM knowledge_base
        WHERE title LIKE ? AND category = 'auto_remediation'
        LIMIT 1
      `).get(`%${params.alertTitle.substring(0, 50)}%`) as { id: string } | undefined;

      if (existing) {
        // 更新已有案例（增加引用次数）
        db.prepare(`
          UPDATE knowledge_base
          SET usage_count = usage_count + 1,
              content = ?,
              updated_at = datetime('now','localtime')
          WHERE id = ?
        `).run(
          this.buildCaseContent(params),
          existing.id
        );
        logger.info(`[Feedback] Updated existing knowledge case: ${existing.id}`);
        return;
      }

      // 写入新案例
      const id = uuidv4();
      db.prepare(`
        INSERT INTO knowledge_base (id, title, category, content, tags, solutions, usage_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now','localtime'), datetime('now','localtime'))
      `).run(
        id,
        `AARS: ${params.alertTitle.substring(0, 200)}`,
        'auto_remediation',
        this.buildCaseContent(params),
        JSON.stringify(['auto_remediation', 'aars', params.device.type, params.alertSource]),
        JSON.stringify({
          rootCause: params.rootCause,
          commands: params.remediationPlan.commands.map(c => c.command),
          rollbackCommands: params.remediationPlan.rollbackCommands.map(c => c.command),
          verificationResult: params.verificationResult.result,
          success: params.overallSuccess,
        }),
      );

      logger.info(`[Feedback] Written new knowledge case: ${id} - ${params.alertTitle.substring(0, 50)}`);
    } catch (err: any) {
      logger.warn(`[Feedback] Failed to write knowledge case: ${err.message}`);
    }
  }

  private buildCaseContent(params: {
    alertTitle: string;
    alertSource: string;
    alertSeverity: string;
    device: DeviceRuntimeProfile;
    rootCause: string;
    remediationPlan: RemediationPlan;
    verificationResult: VerificationChainResult;
    overallSuccess: boolean;
    durationMs: number;
  }): string {
    return [
      `## 故障案例: ${params.alertTitle}`,
      ``,
      `**告警来源**: ${params.alertSource}`,
      `**告警等级**: ${params.alertSeverity}`,
      `**设备**: ${params.device.hostname} (${params.device.ip})`,
      `**设备类型**: ${params.device.type}`,
      `**根因**: ${params.rootCause}`,
      ``,
      `**修复命令**:`,
      ...params.remediationPlan.commands.map(c => `- \`${c.command}\``),
      ``,
      `**回滚命令**:`,
      ...(params.remediationPlan.rollbackCommands.length > 0
        ? params.remediationPlan.rollbackCommands.map(c => `- \`${c.command}\``)
        : ['（无）']),
      ``,
      `**验证结果**: ${params.verificationResult.result}`,
      `**处理时长**: ${(params.durationMs / 1000).toFixed(1)}s`,
      `**处理结果**: ${params.overallSuccess ? '✅ 成功' : '❌ 失败'}`,
    ].join('\n');
  }

  /**
   * 4. 更新历史基线
   * 利用修复后的指标更新设备基线（如果有采集点）
   */
  private async updateBaseline(device: DeviceRuntimeProfile, success: boolean): Promise<void> {
    if (!success) return;
    try {
      // 记录到 settings 表作为基线参考点
      db.prepare(`
        INSERT OR REPLACE INTO settings (key, value)
        VALUES (?, ?)
      `).run(
        `aars_baseline:${device.deviceId}:last_success`,
        new Date().toISOString()
      );
    } catch {
      // 可忽略
    }
  }
}

export const knowledgeFeedbackLoop = new KnowledgeFeedbackLoop();
