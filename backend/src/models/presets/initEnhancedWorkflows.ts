import { db } from '../database';
import { randomUUID } from 'crypto';
import { logger } from '../../utils/logger';

/**
 * 初始化增强型工作流模板
 * 包含条件分支、并行执行、循环迭代、变量传递等高级特性
 */
export function initializeEnhancedWorkflows() {
  // 查询现有 Agent
  const alertAgent = db.prepare("SELECT id FROM agents WHERE name = '告警处理 Agent'").get() as { id: string } | undefined;
  const diagnosticAgent = db.prepare("SELECT id FROM agents WHERE name = '故障诊断 Agent'").get() as { id: string } | undefined;
  const logAgent = db.prepare("SELECT id FROM agents WHERE name = '日志分析 Agent'").get() as { id: string } | undefined;
  const systemCheckAgent = db.prepare("SELECT id FROM agents WHERE name = '系统巡检 Agent'").get() as { id: string } | undefined;
  const changeAgent = db.prepare("SELECT id FROM agents WHERE name = '变更执行 Agent'").get() as { id: string } | undefined;
  const docAgent = db.prepare("SELECT id FROM agents WHERE name = '文档生成 Agent'").get() as { id: string } | undefined;
  const commandAgent = db.prepare("SELECT id FROM agents WHERE name = '服务器命令执行 Agent'").get() as { id: string } | undefined;

  // ========== 模板 1: 智能告警分级修复 ==========
  const alertStartNode = randomUUID();
  const alertAnalysisNode = randomUUID();
  const alertConditionNode = randomUUID();
  const urgentFixNode = randomUUID();
  const autoFixNode = randomUUID();
  const logOnlyNode = randomUUID();
  const approvalNode = randomUUID();
  const alertEndNode = randomUUID();

  const smartAlertNodes = JSON.stringify([
    { id: alertStartNode, type: 'start', position: { x: 100, y: 300 }, data: { label: '开始' } },
    { id: alertAnalysisNode, type: 'agent', position: { x: 300, y: 300 }, data: { label: '告警分析', agentId: alertAgent?.id || null, avatar: '🔍' } },
    { id: alertConditionNode, type: 'condition', position: { x: 500, y: 300 }, data: { 
      label: '告警级别判断',
      conditionConfig: {
        variableSource: '{{alertAnalysis.output.level}}',
        branches: [
          { id: 'p0_branch', label: 'P0/P1 紧急修复', expression: '{{_conditionValue}} == "P0" || {{_conditionValue}} == "P1"', expressionType: 'simple_compare', targetNodeId: urgentFixNode, priority: 1 },
          { id: 'p2_branch', label: 'P2 自动修复', expression: '{{_conditionValue}} == "P2"', expressionType: 'simple_compare', targetNodeId: autoFixNode, priority: 2 },
          { id: 'p3_branch', label: 'P3/P4 仅记录', expression: '{{_conditionValue}} == "P3" || {{_conditionValue}} == "P4"', expressionType: 'simple_compare', targetNodeId: logOnlyNode, priority: 3 }
        ],
        defaultTargetNodeId: logOnlyNode
      }
    }},
    { id: urgentFixNode, type: 'agent', position: { x: 700, y: 100 }, data: { label: '紧急修复', agentId: changeAgent?.id || null, avatar: '🚨' } },
    { id: autoFixNode, type: 'agent', position: { x: 700, y: 300 }, data: { label: '自动修复', agentId: changeAgent?.id || null, avatar: '⚙️' } },
    { id: logOnlyNode, type: 'agent', position: { x: 700, y: 500 }, data: { label: '记录日志', agentId: logAgent?.id || null, avatar: '📝' } },
    { id: approvalNode, type: 'approval', position: { x: 900, y: 100 }, data: { label: '人工确认', approvalConfig: { approver: 'admin', timeout: 3600 } } },
    { id: alertEndNode, type: 'end', position: { x: 1100, y: 300 }, data: { label: '结束' } }
  ]);

  const smartAlertEdges = JSON.stringify([
    { id: randomUUID(), source: alertStartNode, target: alertAnalysisNode },
    { id: randomUUID(), source: alertAnalysisNode, target: alertConditionNode },
    { id: randomUUID(), source: urgentFixNode, target: approvalNode },
    { id: randomUUID(), source: approvalNode, target: alertEndNode },
    { id: randomUUID(), source: autoFixNode, target: alertEndNode },
    { id: randomUUID(), source: logOnlyNode, target: alertEndNode }
  ]);

  // ========== 模板 2: 批量服务器配置巡检 ==========
  const batchStartNode = randomUUID();
  const initServersNode = randomUUID();
  const loopNode = randomUUID();
  const parallelForkNode = randomUUID();
  const cpuCheckNode = randomUUID();
  const memCheckNode = randomUUID();
  const diskCheckNode = randomUUID();
  const parallelJoinNode = randomUUID();
  const summaryNode = randomUUID();
  const batchEndNode = randomUUID();

  const batchAuditNodes = JSON.stringify([
    { id: batchStartNode, type: 'start', position: { x: 100, y: 300 }, data: { label: '开始' } },
    { id: initServersNode, type: 'variable_set', position: { x: 300, y: 300 }, data: { 
      label: '初始化服务器列表',
      variableSetConfig: {
        assignments: [
          { name: 'server_list', valueType: 'json', valueExpression: '["server1", "server2", "server3"]' }
        ]
      }
    }},
    { id: loopNode, type: 'loop', position: { x: 500, y: 300 }, data: { 
      label: '遍历服务器',
      loopConfig: {
        loopMode: 'for_each',
        itemsSource: '{{server_list}}',
        itemName: 'current_server',
        indexName: 'server_index',
        bodyEntryNodeId: parallelForkNode,
        bodyExitNodeId: summaryNode,
        maxIterations: 100
      }
    }},
    { id: parallelForkNode, type: 'parallel', position: { x: 700, y: 300 }, data: { 
      label: '并行检查',
      parallelConfig: {
        mode: 'fork',
        forkTargets: [cpuCheckNode, memCheckNode, diskCheckNode],
        waitForAll: true,
        timeout: 300
      }
    }},
    { id: cpuCheckNode, type: 'agent', position: { x: 900, y: 100 }, data: { label: 'CPU检查', agentId: systemCheckAgent?.id || null, avatar: '🔎' } },
    { id: memCheckNode, type: 'agent', position: { x: 900, y: 300 }, data: { label: '内存检查', agentId: systemCheckAgent?.id || null, avatar: '🔎' } },
    { id: diskCheckNode, type: 'agent', position: { x: 900, y: 500 }, data: { label: '磁盘检查', agentId: systemCheckAgent?.id || null, avatar: '🔎' } },
    { id: parallelJoinNode, type: 'parallel', position: { x: 1100, y: 300 }, data: { 
      label: '汇总结果',
      parallelConfig: {
        mode: 'join',
        joinSources: [cpuCheckNode, memCheckNode, diskCheckNode]
      }
    }},
    { id: summaryNode, type: 'agent', position: { x: 1300, y: 300 }, data: { label: '汇总报告', agentId: docAgent?.id || null, avatar: '📄' } },
    { id: batchEndNode, type: 'end', position: { x: 1500, y: 300 }, data: { label: '结束' } }
  ]);

  const batchAuditEdges = JSON.stringify([
    { id: randomUUID(), source: batchStartNode, target: initServersNode },
    { id: randomUUID(), source: initServersNode, target: loopNode },
    { id: randomUUID(), source: loopNode, target: parallelForkNode },
    { id: randomUUID(), source: parallelForkNode, target: cpuCheckNode },
    { id: randomUUID(), source: parallelForkNode, target: memCheckNode },
    { id: randomUUID(), source: parallelForkNode, target: diskCheckNode },
    { id: randomUUID(), source: cpuCheckNode, target: parallelJoinNode },
    { id: randomUUID(), source: memCheckNode, target: parallelJoinNode },
    { id: randomUUID(), source: diskCheckNode, target: parallelJoinNode },
    { id: randomUUID(), source: parallelJoinNode, target: summaryNode },
    { id: randomUUID(), source: summaryNode, target: batchEndNode }
  ]);

  // ========== 模板 3: 配置文件模板化修复 ==========
  const configStartNode = randomUUID();
  const readTemplateNode = randomUUID();
  const renderVarsNode = randomUUID();
  const applyConfigNode = randomUUID();
  const waitNode = randomUUID();
  const verifyConfigNode = randomUUID();
  const configConditionNode = randomUUID();
  const rollbackNode = randomUUID();
  const configEndNode = randomUUID();

  const configRemediationNodes = JSON.stringify([
    { id: configStartNode, type: 'start', position: { x: 100, y: 300 }, data: { label: '开始' } },
    { id: readTemplateNode, type: 'agent', position: { x: 300, y: 300 }, data: { label: '读取配置模板', agentId: commandAgent?.id || null, avatar: '📖' } },
    { id: renderVarsNode, type: 'variable_set', position: { x: 500, y: 300 }, data: { 
      label: '渲染变量',
      variableSetConfig: {
        assignments: [
          { name: 'rendered_config', valueType: 'expression', valueExpression: '{{readTemplateNode.output}}' }
        ]
      }
    }},
    { id: applyConfigNode, type: 'agent', position: { x: 700, y: 300 }, data: { label: '下发配置', agentId: changeAgent?.id || null, avatar: '⚙️' } },
    { id: waitNode, type: 'wait', position: { x: 900, y: 300 }, data: { 
      label: '等待生效',
      waitConfig: {
        waitType: 'delay',
        delaySeconds: 10
      }
    }},
    { id: verifyConfigNode, type: 'agent', position: { x: 1100, y: 300 }, data: { label: '验证配置', agentId: systemCheckAgent?.id || null, avatar: '✓' } },
    { id: configConditionNode, type: 'condition', position: { x: 1300, y: 300 }, data: { 
      label: '验证结果',
      conditionConfig: {
        variableSource: '{{verifyConfigNode.output.status}}',
        branches: [
          { id: 'success_branch', label: '验证成功', expression: '{{_conditionValue}} == "success"', expressionType: 'simple_compare', targetNodeId: configEndNode, priority: 1 },
          { id: 'failed_branch', label: '验证失败', expression: '{{_conditionValue}} == "failed"', expressionType: 'simple_compare', targetNodeId: rollbackNode, priority: 2 }
        ],
        defaultTargetNodeId: rollbackNode
      }
    }},
    { id: rollbackNode, type: 'agent', position: { x: 1500, y: 500 }, data: { label: '回滚配置', agentId: changeAgent?.id || null, avatar: '↩️' } },
    { id: configEndNode, type: 'end', position: { x: 1700, y: 300 }, data: { label: '结束' } }
  ]);

  const configRemediationEdges = JSON.stringify([
    { id: randomUUID(), source: configStartNode, target: readTemplateNode },
    { id: randomUUID(), source: readTemplateNode, target: renderVarsNode },
    { id: randomUUID(), source: renderVarsNode, target: applyConfigNode },
    { id: randomUUID(), source: applyConfigNode, target: waitNode },
    { id: randomUUID(), source: waitNode, target: verifyConfigNode },
    { id: randomUUID(), source: verifyConfigNode, target: configConditionNode },
    { id: randomUUID(), source: rollbackNode, target: configEndNode }
  ]);

  // ========== 模板 4: 服务健康检查与自愈 ==========
  const healthStartNode = randomUUID();
  const checkServiceNode = randomUUID();
  const healthConditionNode = randomUUID();
  const restartServiceNode = randomUUID();
  const waitRestartNode = randomUUID();
  const webhookNode = randomUUID();
  const restartConditionNode = randomUUID();
  const manualInterventionNode = randomUUID();
  const healthEndNode = randomUUID();

  const serviceHealingNodes = JSON.stringify([
    { id: healthStartNode, type: 'start', position: { x: 100, y: 300 }, data: { label: '开始' } },
    { id: checkServiceNode, type: 'agent', position: { x: 300, y: 300 }, data: { label: '检查服务状态', agentId: systemCheckAgent?.id || null, avatar: '🔍' } },
    { id: healthConditionNode, type: 'condition', position: { x: 500, y: 300 }, data: { 
      label: '服务是否正常',
      conditionConfig: {
        variableSource: '{{checkServiceNode.output.status}}',
        branches: [
          { id: 'healthy_branch', label: '服务正常', expression: '{{_conditionValue}} == "healthy"', expressionType: 'simple_compare', targetNodeId: healthEndNode, priority: 1 },
          { id: 'unhealthy_branch', label: '服务异常', expression: '{{_conditionValue}} == "unhealthy"', expressionType: 'simple_compare', targetNodeId: restartServiceNode, priority: 2 }
        ],
        defaultTargetNodeId: restartServiceNode
      }
    }},
    { id: restartServiceNode, type: 'agent', position: { x: 700, y: 300 }, data: { label: '尝试重启', agentId: changeAgent?.id || null, avatar: '🔄' } },
    { id: waitRestartNode, type: 'wait', position: { x: 900, y: 300 }, data: { 
      label: '等待启动',
      waitConfig: {
        waitType: 'delay',
        delaySeconds: 30
      }
    }},
    { id: webhookNode, type: 'webhook', position: { x: 1100, y: 300 }, data: { 
      label: '通知运维',
      webhookConfig: {
        url: 'https://hooks.slack.com/services/xxx',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"text": "服务重启通知: {{restartServiceNode.output}}"}'
      }
    }},
    { id: restartConditionNode, type: 'condition', position: { x: 1300, y: 300 }, data: { 
      label: '重启是否成功',
      conditionConfig: {
        variableSource: '{{restartServiceNode.output.status}}',
        branches: [
          { id: 'restart_success', label: '重启成功', expression: '{{_conditionValue}} == "success"', expressionType: 'simple_compare', targetNodeId: healthEndNode, priority: 1 },
          { id: 'restart_failed', label: '重启失败', expression: '{{_conditionValue}} == "failed"', expressionType: 'simple_compare', targetNodeId: manualInterventionNode, priority: 2 }
        ],
        defaultTargetNodeId: manualInterventionNode
      }
    }},
    { id: manualInterventionNode, type: 'approval', position: { x: 1500, y: 500 }, data: { 
      label: '人工介入',
      approvalConfig: {
        approver: 'ops_team',
        timeout: 7200,
        message: '服务重启失败，需要人工介入'
      }
    }},
    { id: healthEndNode, type: 'end', position: { x: 1700, y: 300 }, data: { label: '结束' } }
  ]);

  const serviceHealingEdges = JSON.stringify([
    { id: randomUUID(), source: healthStartNode, target: checkServiceNode },
    { id: randomUUID(), source: checkServiceNode, target: healthConditionNode },
    { id: randomUUID(), source: restartServiceNode, target: waitRestartNode },
    { id: randomUUID(), source: waitRestartNode, target: webhookNode },
    { id: randomUUID(), source: webhookNode, target: restartConditionNode },
    { id: randomUUID(), source: manualInterventionNode, target: healthEndNode }
  ]);

  // 插入预设工作流
  const enhancedWorkflows = [
    {
      id: randomUUID(),
      name: '智能告警分级修复',
      description: '根据告警级别自动选择修复策略：P0/P1紧急修复需人工确认，P2自动修复，P3/P4仅记录日志',
      nodes: smartAlertNodes,
      edges: smartAlertEdges,
      is_template: 1
    },
    {
      id: randomUUID(),
      name: '批量服务器配置巡检',
      description: '遍历服务器列表，并行检查CPU、内存、磁盘，汇总生成巡检报告',
      nodes: batchAuditNodes,
      edges: batchAuditEdges,
      is_template: 1
    },
    {
      id: randomUUID(),
      name: '配置文件模板化修复',
      description: '读取配置模板 → 渲染变量 → 下发配置 → 验证 → 失败则回滚',
      nodes: configRemediationNodes,
      edges: configRemediationEdges,
      is_template: 1
    },
    {
      id: randomUUID(),
      name: '服务健康检查与自愈',
      description: '检查服务状态 → 异常则自动重启 → 通知运维 → 重启失败则人工介入',
      nodes: serviceHealingNodes,
      edges: serviceHealingEdges,
      is_template: 1
    }
  ];

  const insertWorkflow = db.prepare(`
    INSERT INTO workflows (id, name, description, nodes, edges, is_template)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  enhancedWorkflows.forEach(workflow => {
    try {
      insertWorkflow.run(workflow.id, workflow.name, workflow.description, workflow.nodes, workflow.edges, workflow.is_template);
    } catch (error) {
      logger.error(`Failed to insert enhanced workflow: ${workflow.name}`, error);
    }
  });

  logger.info(`✅ 成功创建 ${enhancedWorkflows.length} 个增强型工作流模板`);
}
