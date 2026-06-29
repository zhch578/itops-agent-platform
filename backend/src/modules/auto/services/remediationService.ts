import { v4 as uuidv4 } from 'uuid';
import db from '../../../models/database';
import { executeWorkflow } from '../../workflow/services/workflowExecutor';
import { notificationService } from '../../infra/services/notificationService';
import { logger } from '../../../utils/logger';
import type { RemediationPolicy, RemediationExecution, WorkflowNode, WorkflowEdge, WorkflowParsed } from '../../../types';
import { policyEngineMixin } from './remediation/policyEngine';
import { executionTrackerMixin } from './remediation/executionTracker';
import { remediationActionsMixin } from './remediation/remediationActions';

class RemediationService {
  private initialized = false;

  constructor() {
    Object.assign(this, policyEngineMixin);
    Object.assign(this, executionTrackerMixin);
    Object.assign(this, remediationActionsMixin);
  }

  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    logger.info('Auto-remediation engine initialized');
  }

  createPolicy(policy: Omit<RemediationPolicy, 'id' | 'created_at' | 'updated_at'>): RemediationPolicy {
    const id = uuidv4();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO remediation_policies (
        id, name, description, alert_source, alert_severity,
        alert_keywords, alert_tags, execution_mode, workflow_id,
        workflow_params, max_executions_per_hour, cooldown_seconds,
        require_confirmation, enable_verification, verification_workflow_id,
        verification_params, verification_timeout_seconds, enable_rollback,
        rollback_workflow_id, rollback_on_failure, enabled, created_by,
        created_at, updated_at
      ) VALUES (
        @id, @name, @description, @alert_source, @alert_severity,
        @alert_keywords, @alert_tags, @execution_mode, @workflow_id,
        @workflow_params, @max_executions_per_hour, @cooldown_seconds,
        @require_confirmation, @enable_verification, @verification_workflow_id,
        @verification_params, @verification_timeout_seconds, @enable_rollback,
        @rollback_workflow_id, @rollback_on_failure, @enabled, @created_by,
        @created_at, @updated_at
      )
    `).run({
      id,
      name: policy.name,
      description: policy.description || null,
      alert_source: policy.alert_source,
      alert_severity: policy.alert_severity || null,
      alert_keywords: policy.alert_keywords || null,
      alert_tags: policy.alert_tags || null,
      execution_mode: policy.execution_mode,
      workflow_id: policy.workflow_id || null,
      workflow_params: policy.workflow_params || null,
      max_executions_per_hour: policy.max_executions_per_hour,
      cooldown_seconds: policy.cooldown_seconds,
      require_confirmation: policy.require_confirmation || null,
      enable_verification: policy.enable_verification ? 1 : 0,
      verification_workflow_id: policy.verification_workflow_id || null,
      verification_params: policy.verification_params || null,
      verification_timeout_seconds: policy.verification_timeout_seconds,
      enable_rollback: policy.enable_rollback ? 1 : 0,
      rollback_workflow_id: policy.rollback_workflow_id || null,
      rollback_on_failure: policy.rollback_on_failure ? 1 : 0,
      enabled: policy.enabled ? 1 : 0,
      created_by: policy.created_by || null,
      created_at: now,
      updated_at: now
    });

    return this.getPolicy(id);
  }

  updatePolicy(id: string, updates: Partial<Pick<RemediationPolicy, 'name' | 'description' | 'alert_source' | 'alert_severity' | 'alert_keywords' | 'alert_tags' | 'execution_mode' | 'workflow_id' | 'workflow_params' | 'max_executions_per_hour' | 'cooldown_seconds' | 'require_confirmation' | 'enable_verification' | 'verification_workflow_id' | 'verification_params' | 'verification_timeout_seconds' | 'enable_rollback' | 'rollback_workflow_id' | 'rollback_on_failure' | 'enabled'>>): RemediationPolicy {
    const now = new Date().toISOString();
    const fields: string[] = [];
    const params: Record<string, unknown> = { id, updated_at: now };

    const fieldMap: Record<string, keyof typeof updates> = {
      'name': 'name',
      'description': 'description',
      'alert_source': 'alert_source',
      'alert_severity': 'alert_severity',
      'alert_keywords': 'alert_keywords',
      'alert_tags': 'alert_tags',
      'execution_mode': 'execution_mode',
      'workflow_id': 'workflow_id',
      'workflow_params': 'workflow_params',
      'max_executions_per_hour': 'max_executions_per_hour',
      'cooldown_seconds': 'cooldown_seconds',
      'require_confirmation': 'require_confirmation',
      'enable_verification': 'enable_verification',
      'verification_workflow_id': 'verification_workflow_id',
      'verification_params': 'verification_params',
      'verification_timeout_seconds': 'verification_timeout_seconds',
      'enable_rollback': 'enable_rollback',
      'rollback_workflow_id': 'rollback_workflow_id',
      'rollback_on_failure': 'rollback_on_failure',
      'enabled': 'enabled'
    };

    for (const [dbField, key] of Object.entries(fieldMap)) {
      const value = updates[key];
      if (value !== undefined) {
        fields.push(`${dbField} = @${key}`);
        if (typeof value === 'boolean') {
          params[key] = value ? 1 : 0;
        } else {
          params[key] = value;
        }
      }
    }

    if (fields.length === 0) {
      throw new Error('No fields to update');
    }

    fields.push('updated_at = @updated_at');
    const sql = `UPDATE remediation_policies SET ${fields.join(', ')} WHERE id = @id`;

    db.prepare(sql).run(params);
    return this.getPolicy(id);
  }

  deletePolicy(id: string): void {
    db.prepare('DELETE FROM remediation_policies WHERE id = ?').run(id);
    logger.info(`Deleted remediation policy: ${id}`);
  }

  getPolicy(id: string): RemediationPolicy {
    const policy = db.prepare('SELECT * FROM remediation_policies WHERE id = ?').get(id) as RemediationPolicy | undefined;
    if (!policy) {
      throw new Error(`Policy not found: ${id}`);
    }
    return policy;
  }

  listPolicies(filters: { enabled?: boolean; alert_source?: string; page?: number; limit?: number }): { policies: RemediationPolicy[]; total: number } {
    let sql = 'SELECT * FROM remediation_policies WHERE 1=1';
    let countSql = 'SELECT COUNT(*) as count FROM remediation_policies WHERE 1=1';
    const params: unknown[] = [];

    if (filters.enabled !== undefined) {
      sql += ' AND enabled = ?';
      countSql += ' AND enabled = ?';
      params.push(filters.enabled ? 1 : 0);
    }

    if (filters.alert_source) {
      sql += ' AND alert_source = ?';
      countSql += ' AND alert_source = ?';
      params.push(filters.alert_source);
    }

    sql += ' ORDER BY created_at DESC';

    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;
    sql += ` LIMIT ${limit} OFFSET ${offset}`;

    const policies = db.prepare(sql).all(...params) as RemediationPolicy[];
    const totalResult = db.prepare(countSql).get(...params) as { count: number };

    return { policies, total: totalResult.count };
  }

  togglePolicy(id: string): RemediationPolicy {
    const policy = this.getPolicy(id);
    const newEnabled = policy.enabled ? 0 : 1;
    db.prepare('UPDATE remediation_policies SET enabled = ?, updated_at = datetime(\'now\',\'localtime\') WHERE id = ?').run(newEnabled, id);
    return this.getPolicy(id);
  }

  async triggerRemediation(policy: RemediationPolicy, alert: { id: string; source: string; severity?: string; title?: string; content?: string; tags?: string[] }): Promise<RemediationExecution> {
    if ((this as any).isInCooldown(policy, alert)) {
      logger.info(`Policy ${policy.id} in cooldown for alert ${alert.id}`);
      return (this as any).createSkippedExecution(policy, alert, 'cooldown');
    }

    if ((this as any).isRateLimited(policy)) {
      logger.warn(`Policy ${policy.id} rate limited`);
      return (this as any).createSkippedExecution(policy, alert, 'rate_limited');
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const approvalRequired = policy.execution_mode === 'approval' ? 1 : 0;

    db.prepare(`
      INSERT INTO remediation_executions (
        id, policy_id, alert_id, alert_snapshot, status, approval_required, created_at
      ) VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `).run(
      id,
      policy.id,
      alert.id,
      JSON.stringify(alert),
      approvalRequired,
      now
    );

    const execution = (this as any).getExecution(id);

    switch (policy.execution_mode) {
      case 'auto':
        this.executeWorkflowAsync(execution.id);
        break;
      case 'approval':
        await this.requestApproval(execution);
        break;
      case 'suggestion':
        await this.sendSuggestion(execution);
        break;
    }

    return execution;
  }

  private async executeWorkflowAsync(executionId: string): Promise<void> {
    try {
      await this.executeWorkflow(executionId);
    } catch (error) {
      logger.error(`Async workflow execution failed for ${executionId}:`, error);
    }
  }

  async executeWorkflow(executionId: string): Promise<void> {
    const execution = (this as any).getExecution(executionId);
    const policy = this.getPolicy(execution.policy_id);
    const alert = JSON.parse(execution.alert_snapshot || '{}');

    if (!policy.workflow_id) {
      (this as any).updateExecutionStatus(executionId, 'failed', 'No workflow configured');
      return;
    }

    (this as any).updateExecution(executionId, { status: 'running', started_at: new Date().toISOString() });
    const startTime = Date.now();

    try {
      const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(policy.workflow_id) as {
        id: string; name: string; description: string; nodes: string; edges: string; agent_configs: string; is_template: number; created_at: string; updated_at: string;
      } | undefined;

      if (!workflow) {
        (this as any).updateExecutionStatus(executionId, 'failed', 'Workflow not found');
        return;
      }

      const taskId = uuidv4();
      const params = this.resolveParams(policy.workflow_params, alert);
      
      // 始终将告警关键字段注入 context，确保 Agent 节点能获取告警数据
      const alertContext = {
        alert_id: alert.id,
        alert_title: alert.title,
        alert_content: alert.content,
        alert_source: alert.source,
        alert_severity: alert.severity,
        alert_device_ip: alert.device_ip || alert.host,
        alert_service: alert.service,
        ...params,
      };

      db.prepare(`
        INSERT INTO tasks (id, workflow_id, name, status, context, created_at)
        VALUES (?, ?, ?, 'pending', ?, datetime('now','localtime'))
      `).run(taskId, workflow.id, `自动修复: ${workflow.name}`, JSON.stringify(alertContext));

      let nodes: WorkflowNode[] = [];
      let edges: WorkflowEdge[] = [];
      let agentConfigs = {};

      try {
        nodes = typeof workflow.nodes === 'string' ? JSON.parse(workflow.nodes) : workflow.nodes;
        edges = typeof workflow.edges === 'string' ? JSON.parse(workflow.edges) : workflow.edges;
        agentConfigs = workflow.agent_configs
          ? (typeof workflow.agent_configs === 'string' ? JSON.parse(workflow.agent_configs) : workflow.agent_configs)
          : {};
      } catch (error) {
        (this as any).updateExecutionStatus(executionId, 'failed', 'Invalid workflow format');
        logger.error(`Failed to parse workflow ${workflow.id}:`, error);
        return;
      }

      const parsedWorkflow: WorkflowParsed = {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        nodes,
        edges,
        agent_configs: agentConfigs,
        is_template: workflow.is_template,
        created_at: workflow.created_at,
        updated_at: workflow.updated_at
      };

      await executeWorkflow(taskId, parsedWorkflow, undefined, alertContext);

      (this as any).updateExecution(executionId, {
        workflow_execution_id: taskId,
        execution_result: JSON.stringify({ taskId }),
        completed_at: new Date().toISOString(),
        execution_duration_ms: Date.now() - startTime
      });

      if (policy.enable_verification && policy.verification_workflow_id) {
        await this.verifyResult(executionId);
      } else {
        (this as any).updateExecutionStatus(executionId, 'success');
        (this as any).resolveAlert(execution.alert_id);
        (this as any).notifySelfHeal(execution.alert_id, alert?.title);
        (this as any).updateCooldown(policy, alert);
        (this as any).recordHistory(execution, policy, 'success');
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Remediation execution ${executionId} failed:`, error);

      (this as any).updateExecution(executionId, {
        status: 'failed',
        status_reason: errorMsg,
        completed_at: new Date().toISOString(),
        execution_duration_ms: Date.now() - startTime
      });

      (this as any).recordHistory(execution, policy, 'failed', errorMsg);

      if (policy.enable_rollback && policy.rollback_on_failure && policy.rollback_workflow_id) {
        await this.rollbackExecution(executionId);
      }
    }
  }

  async verifyResult(executionId: string): Promise<{ success: boolean; result?: unknown; error?: string }> {
    const execution = (this as any).getExecution(executionId);
    const policy = this.getPolicy(execution.policy_id);
    const alert = JSON.parse(execution.alert_snapshot || '{}');

    (this as any).updateExecution(executionId, { verification_status: 'pending' });

    try {
      const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(policy.verification_workflow_id!) as {
        id: string; name: string; description: string; nodes: string; edges: string; agent_configs: string; is_template: number; created_at: string; updated_at: string;
      } | undefined;

      if (!workflow) {
        throw new Error('Verification workflow not found');
      }

      const params = this.resolveParams(policy.verification_params, alert);
      // 同样注入告警数据到验证工作流 context
      const verifyContext = {
        alert_id: alert.id,
        alert_title: alert.title,
        alert_content: alert.content,
        alert_source: alert.source,
        alert_severity: alert.severity,
        ...params,
      };
      const timeout = policy.verification_timeout_seconds * 1000;
      const taskId = uuidv4();

      db.prepare(`
        INSERT INTO tasks (id, workflow_id, name, status, context, created_at)
        VALUES (?, ?, ?, 'pending', ?, datetime('now','localtime'))
      `).run(taskId, workflow.id, `修复验证: ${workflow.name}`, JSON.stringify(verifyContext));

      let nodes: WorkflowNode[] = [];
      let edges: WorkflowEdge[] = [];
      let agentConfigs = {};

      try {
        nodes = typeof workflow.nodes === 'string' ? JSON.parse(workflow.nodes) : workflow.nodes;
        edges = typeof workflow.edges === 'string' ? JSON.parse(workflow.edges) : workflow.edges;
        agentConfigs = workflow.agent_configs
          ? (typeof workflow.agent_configs === 'string' ? JSON.parse(workflow.agent_configs) : workflow.agent_configs)
          : {};
      } catch {
        throw new Error('Invalid verification workflow format');
      }

      const parsedWorkflow: WorkflowParsed = {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        nodes,
        edges,
        agent_configs: agentConfigs,
        is_template: workflow.is_template,
        created_at: workflow.created_at,
        updated_at: workflow.updated_at
      };

      const result = await Promise.race([
        executeWorkflow(taskId, parsedWorkflow, undefined, verifyContext),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Verification timeout')), timeout)
        )
      ]);

      (this as any).updateExecution(executionId, {
        verification_status: 'success',
        verification_result: JSON.stringify(result),
        verification_completed_at: new Date().toISOString(),
        status: 'success'
      });

      (this as any).resolveAlert(execution.alert_id);
      (this as any).notifySelfHeal(execution.alert_id, alert?.title);
      (this as any).updateCooldown(policy, alert);
      (this as any).recordHistory(execution, policy, 'success');

      return { success: true, result };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Verification failed for execution ${executionId}:`, error);

      (this as any).updateExecution(executionId, {
        verification_status: 'failed',
        verification_result: JSON.stringify({ error: errorMsg }),
        verification_completed_at: new Date().toISOString()
      });

      (this as any).recordHistory(execution, policy, 'failed', errorMsg);

      if (policy.enable_rollback && policy.rollback_workflow_id) {
        await this.rollbackExecution(executionId);
      }

      return { success: false, error: errorMsg };
    }
  }

  async rollbackExecution(executionId: string): Promise<void> {
    const execution = (this as any).getExecution(executionId);
    const policy = this.getPolicy(execution.policy_id);

    if (!policy.rollback_workflow_id) {
      logger.warn(`No rollback workflow configured for policy ${policy.id}`);
      return;
    }

    logger.warn(`Rolling back execution ${executionId}`);

    try {
      const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(policy.rollback_workflow_id) as {
        id: string; name: string; description: string; nodes: string; edges: string; agent_configs: string; is_template: number; created_at: string; updated_at: string;
      } | undefined;

      if (!workflow) {
        throw new Error('Rollback workflow not found');
      }

      const taskId = uuidv4();
      db.prepare(`
        INSERT INTO tasks (id, workflow_id, name, status, context, created_at)
        VALUES (?, ?, ?, 'pending', ?, datetime('now','localtime'))
      `).run(taskId, workflow.id, `回滚: ${workflow.name}`, JSON.stringify({ execution_id: executionId }));

      const parsedWorkflow: WorkflowParsed = {
        id: workflow.id,
        name: workflow.name,
        description: workflow.description,
        nodes: typeof workflow.nodes === 'string' ? JSON.parse(workflow.nodes) as WorkflowNode[] : workflow.nodes,
        edges: typeof workflow.edges === 'string' ? JSON.parse(workflow.edges) as WorkflowEdge[] : workflow.edges,
        agent_configs: workflow.agent_configs ? (typeof workflow.agent_configs === 'string' ? JSON.parse(workflow.agent_configs) : workflow.agent_configs) : {},
        is_template: workflow.is_template,
        created_at: workflow.created_at,
        updated_at: workflow.updated_at
      };

      const result = await executeWorkflow(taskId, parsedWorkflow);

      (this as any).updateExecution(executionId, {
        rollback_triggered: 1,
        rollback_execution_id: taskId,
        rollback_result: JSON.stringify(result),
        rollback_completed_at: new Date().toISOString(),
        status: 'rolled_back'
      });

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Rollback failed for execution ${executionId}:`, error);

      (this as any).updateExecution(executionId, {
        rollback_triggered: 1,
        rollback_result: JSON.stringify({ error: errorMsg }),
        rollback_completed_at: new Date().toISOString()
      });
    }
  }

  async approveExecution(executionId: string, action: 'approve' | 'reject', userId: string, comment?: string): Promise<void> {
    const execution = (this as any).getExecution(executionId);

    if (execution.status !== 'waiting_approval') {
      throw new Error('Execution is not waiting for approval');
    }

    const now = new Date().toISOString();

    if (action === 'approve') {
      (this as any).updateExecution(executionId, {
        status: 'approved',
        approved_by: userId,
        approved_at: now,
        approval_comment: comment
      });

      this.executeWorkflowAsync(executionId);
    } else {
      (this as any).updateExecution(executionId, {
        status: 'rejected',
        approved_by: userId,
        approved_at: now,
        approval_comment: comment,
        completed_at: now
      });
    }
  }

  async retryExecution(executionId: string): Promise<void> {
    const execution = (this as any).getExecution(executionId);

    if (execution.status !== 'failed' && execution.status !== 'rejected') {
      throw new Error('Only failed or rejected executions can be retried');
    }

    (this as any).updateExecution(executionId, {
      status: 'pending' as any,
      workflow_execution_id: undefined,
      started_at: undefined,
      completed_at: undefined,
      execution_result: undefined,
      verification_status: undefined,
      verification_result: undefined,
      verification_completed_at: undefined,
      rollback_triggered: 0,
      rollback_execution_id: undefined,
      rollback_completed_at: undefined,
      rollback_result: undefined,
      execution_duration_ms: undefined
    });

    this.executeWorkflowAsync(executionId);
  }

  private resolveParams(paramsJson: string | undefined, alert: Record<string, unknown>): Record<string, unknown> {
    if (!paramsJson) return {};

    let params: Record<string, unknown>;
    try {
      params = JSON.parse(paramsJson);
    } catch {
      return {};
    }

    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      if (typeof value === 'string') {
        resolved[key] = value.replace(/\{\{alert\.(\w+)\}\}/g, (_match, prop) => {
          const val = alert[prop];
          return val !== undefined && val !== null ? String(val) : '';
        });
      } else {
        resolved[key] = value;
      }
    }

    return resolved;
  }

  private async requestApproval(execution: RemediationExecution): Promise<void> {
    (this as any).updateExecution(execution.id, { status: 'waiting_approval' });

    const policy = this.getPolicy(execution.policy_id);
    const alert = JSON.parse(execution.alert_snapshot || '{}');

    try {
      await notificationService.sendNotification({
        type: 'remediation_approval',
        title: '修复审批请求',
        content: `策略: ${policy.name}\n告警: ${alert.title || alert.content || 'Unknown'}\n请审批执行`,
        related_alert_id: execution.alert_id
      });
    } catch (error) {
      logger.error('Failed to send approval notification:', error);
    }
  }

  private async sendSuggestion(execution: RemediationExecution): Promise<void> {
    (this as any).updateExecution(execution.id, { status: 'success', status_reason: 'suggestion_sent' });

    const policy = this.getPolicy(execution.policy_id);
    const alert = JSON.parse(execution.alert_snapshot || '{}');

    try {
      await notificationService.sendNotification({
        type: 'remediation_suggestion',
        title: '修复建议',
        content: `策略: ${policy.name}\n告警: ${alert.title || alert.content || 'Unknown'}\n建议执行修复操作`,
        related_alert_id: execution.alert_id
      });
    } catch (error) {
      logger.error('Failed to send suggestion notification:', error);
    }
  }
}

export const remediationService = new RemediationService();
