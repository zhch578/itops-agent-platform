/**
 * MCP 平台内置工具定义
 *
 * 将 13 个模块的 Specialist 能力暴露为 MCP 工具
 * 每个工具包含：名称、描述、Zod 输入参数、安全注解、处理器
 *
 * 设计原则：
 * - 默认只读（readOnlyHint: true），写操作需显式标记
 * - 破坏性操作需要审批（requiresApproval: true）
 * - 参数校验使用 Zod schema
 * - 处理器最小化外部依赖，优先使用数据库直接查询
 */

import { z } from 'zod';
import {
  type RegisteredTool,
  RiskLevel,
  type ToolCallContext,
  type ToolCallResult,
} from './types';
import { toolRegistry } from './toolRegistry';
import { logger } from '../../utils/logger';
import { executeCommand } from '../../modules/servers/services/sshService';
import { dockerService } from '../../modules/containers/services/dockerService';
import { serverInfoCollector } from '../../modules/servers/services/serverInfoCollector';
import db from '../../models/database';

// ============================================================
// 辅助函数
// ============================================================

function textResult(text: string, isError = false): ToolCallResult {
  return {
    content: [{ type: 'text', text }],
    isError,
  };
}

function jsonResult(data: unknown, summary?: string): ToolCallResult {
  return {
    content: [
      {
        type: 'text',
        text: summary
          ? `${summary}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``
          : `\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``,
      },
    ],
    structuredContent: data as Record<string, unknown>,
    isError: false,
  };
}

/** 安全的只读注解 */
const READONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  riskLevel: RiskLevel.READONLY,
  requiresApproval: false,
} as const;

/** 低风险操作（可能产生数据但可回滚） */
const LOW_RISK = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  riskLevel: RiskLevel.LOW,
  requiresApproval: false,
} as const;

/** 需要审批的操作 */
const REQUIRES_APPROVAL = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  riskLevel: RiskLevel.MEDIUM,
  requiresApproval: true,
} as const;

// ============================================================
// 工具定义
// ============================================================

export const PLATFORM_TOOLS: RegisteredTool[] = [
  // ==========================================
  // 1. 告警管理模块 (alerts)
  // ==========================================

  {
    name: 'alert.list',
    title: '查询告警列表',
    description: '查询告警中心告警列表，支持按严重级别、状态、时间范围过滤。返回只读告警事实数据。',
    domain: 'alert_handling',
    annotations: READONLY,
    inputSchema: z.object({
      severity: z.enum(['critical', 'warning', 'info']).optional().describe('告警严重级别'),
      status: z.enum(['active', 'acknowledged', 'resolved']).optional().describe('告警状态'),
      limit: z.number().min(1).max(100).default(20).describe('返回数量'),
      offset: z.number().min(0).default(0).describe('偏移量'),
    }),
    handler: async (args) => {
      try {
        const { default: db } = await import('../../models/database');
        let query = 'SELECT * FROM alert_notifications WHERE 1=1';
        const params: any[] = [];
        if (args.severity) { query += ' AND severity = ?'; params.push(args.severity); }
        if (args.status) { query += ' AND status = ?'; params.push(args.status); }
        query += ' ORDER BY timestamp DESC';
        query += ` LIMIT ${args.limit || 20} OFFSET ${args.offset || 0}`;
        const alerts = db.prepare(query).all(...params);
        return jsonResult(alerts, `找到 ${(alerts as any[])?.length || 0} 条告警`);
      } catch (err) {
        return textResult(`查询告警失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  {
    name: 'alert.analyze',
    title: '分析告警根因',
    description: '对指定告警进行 AI 根因分析（RCA），返回分析结论、依据和建议动作。',
    domain: 'alert_handling',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      riskLevel: RiskLevel.LOW,
      requiresApproval: false,
    },
    inputSchema: z.object({
      alertId: z.string().describe('告警 ID'),
      includeMetrics: z.boolean().default(false).describe('是否包含关联指标'),
    }),
    handler: async (args, ctx) => {
      try {
        const { rootCauseAnalysisService } = await import(
          '../../modules/ai/services/rca/rootCauseAnalysisService'
        );
        const result = await rootCauseAnalysisService.analyze(args.alertId as string);
        return jsonResult(result, '告警根因分析完成');
      } catch (err) {
        return textResult(`根因分析失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  {
    name: 'alert.correlate',
    title: '告警关联分析',
    description: '查询与指定告警相关联的其他告警，发现潜在关联关系。',
    domain: 'alert_handling',
    annotations: READONLY,
    inputSchema: z.object({
      alertId: z.string().describe('告警 ID'),
      timeWindowMinutes: z.number().min(5).max(1440).default(60).describe('时间窗口（分钟）'),
      limit: z.number().min(1).max(50).default(10).describe('返回数量'),
    }),
    handler: async (args) => {
      try {
        // 通过 alertCorrelationService 获取关联告警
        const { alertCorrelationService } = await import(
          '../../modules/alerts/services/alertCorrelationService'
        );
        const correlated = (alertCorrelationService as any).findCorrelated
          ? (alertCorrelationService as any).findCorrelated(args.alertId, args.timeWindowMinutes)
          : { message: '告警关联服务正在初始化中', alerts: [] };
        return jsonResult(correlated, '告警关联分析完成');
      } catch (err) {
        return textResult(`关联分析失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  // ==========================================
  // 2. 服务器管理模块 (servers)
  // ==========================================

  {
    name: 'server.list',
    title: '查询服务器列表',
    description: '查询所有管理的服务器列表，包含基本信息（主机名、IP、状态、分组）。',
    domain: 'server_operation',
    annotations: READONLY,
    inputSchema: z.object({
      groupId: z.string().optional().describe('服务器分组 ID'),
      status: z.enum(['online', 'offline', 'unknown']).optional().describe('在线状态'),
      search: z.string().optional().describe('搜索关键词（主机名/IP）'),
      limit: z.number().min(1).max(100).default(50).describe('返回数量'),
    }),
    handler: async (args) => {
      try {
        const { default: db } = await import('../../models/database');
        let query = 'SELECT id, name, host, port, status, group_id, os, cpu_cores, memory_gb, last_checked FROM servers WHERE 1=1';
        const params: any[] = [];
        if (args.groupId) { query += ' AND group_id = ?'; params.push(args.groupId); }
        if (args.status) { query += ' AND status = ?'; params.push(args.status); }
        if (args.search) { query += ' AND (name LIKE ? OR host LIKE ?)'; params.push(`%${args.search}%`, `%${args.search}%`); }
        query += ` LIMIT ${args.limit || 50}`;
        const servers = db.prepare(query).all(...params);
        return jsonResult(servers, `找到 ${(servers as any[])?.length || 0} 台服务器`);
      } catch (err) {
        return textResult(`查询服务器失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  {
    name: 'server.detail',
    title: '查询服务器详情',
    description: '查询指定服务器的详细信息，包括配置、磁盘、网络接口、运行服务等。',
    domain: 'server_operation',
    annotations: READONLY,
    inputSchema: z.object({
      serverId: z.string().describe('服务器 ID'),
    }),
    handler: async (args) => {
      try {
        const { default: db } = await import('../../models/database');
        const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(args.serverId);
        if (!server) return textResult(`服务器 ${args.serverId} 不存在`, true);
        return jsonResult(server, `服务器 ${(server as any).name} 详情`);
      } catch (err) {
        return textResult(`查询服务器详情失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  // ==========================================
  // 3. 网络管理模块 (network)
  // ==========================================

  {
    name: 'network.device.list',
    title: '查询网络设备列表',
    description: '查询所有网络设备（交换机、路由器、防火墙等），包含型号、固件、端口数、管理 IP。',
    domain: 'network_inspection',
    annotations: READONLY,
    inputSchema: z.object({
      deviceType: z.string().optional().describe('设备类型'),
      vendor: z.string().optional().describe('厂商'),
      status: z.enum(['online', 'offline', 'unknown']).optional().describe('在线状态'),
      limit: z.number().min(1).max(100).default(50).describe('返回数量'),
    }),
    handler: async (args) => {
      try {
        const { default: db } = await import('../../models/database');
        let query = 'SELECT * FROM network_devices WHERE 1=1';
        const params: any[] = [];
        if (args.deviceType) { query += ' AND device_type = ?'; params.push(args.deviceType); }
        if (args.vendor) { query += ' AND manufacturer = ?'; params.push(args.vendor); }
        if (args.status) { query += ' AND status = ?'; params.push(args.status); }
        query += ` LIMIT ${args.limit || 50}`;
        const devices = db.prepare(query).all(...params);
        return jsonResult(devices, `找到 ${(devices as any[])?.length || 0} 台网络设备`);
      } catch (err) {
        return textResult(`查询网络设备失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  {
    name: 'network.topology',
    title: '查询网络拓扑',
    description: '查询网络拓扑结构和设备间连接关系。',
    domain: 'network_inspection',
    annotations: READONLY,
    inputSchema: z.object({
      rootDeviceId: z.string().optional().describe('根设备 ID（不传则返回完整拓扑）'),
      depth: z.number().min(1).max(5).default(2).describe('拓扑深度'),
    }),
    handler: async (args) => {
      try {
        const { topologyService } = await import('../../modules/network/services/topologyService');
        const topology = await (topologyService as any).getTopology?.(
          args.rootDeviceId,
          args.depth
        );
        return jsonResult(topology || { message: '拓扑数据正在收集中' }, '网络拓扑');
      } catch (err) {
        return textResult(`查询拓扑失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  // ==========================================
  // 4. 容器与虚拟化管理模块 (containers)
  // ==========================================

  {
    name: 'container.list',
    title: '查询容器列表',
    description: '查询 Docker 容器列表，包含运行状态、镜像、端口映射、资源使用。',
    domain: 'system_inspection',
    annotations: READONLY,
    inputSchema: z.object({
      hostId: z.string().optional().describe('Docker 主机 ID'),
      status: z.enum(['running', 'stopped', 'paused']).optional().describe('容器状态'),
      limit: z.number().min(1).max(100).default(50).describe('返回数量'),
    }),
    handler: async (args) => {
      try {
        const { default: db } = await import('../../models/database');
        let query = 'SELECT * FROM containers WHERE 1=1';
        const params: any[] = [];
        if (args.hostId) { query += ' AND docker_host_id = ?'; params.push(args.hostId); }
        if (args.status) { query += ' AND status = ?'; params.push(args.status); }
        query += ` LIMIT ${args.limit || 50}`;
        const containers = db.prepare(query).all(...params);
        return jsonResult(containers, `找到 ${(containers as any[])?.length || 0} 个容器`);
      } catch (err) {
        return textResult(`查询容器失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  {
    name: 'vm.list',
    title: '查询虚拟机列表',
    description: '查询虚拟机列表，包含 CPU、内存、磁盘、状态、所属宿主机。',
    domain: 'system_inspection',
    annotations: READONLY,
    inputSchema: z.object({
      status: z.enum(['running', 'stopped', 'paused', 'unknown']).optional().describe('VM 状态'),
      hostId: z.string().optional().describe('宿主机 ID'),
      limit: z.number().min(1).max(100).default(50).describe('返回数量'),
    }),
    handler: async (args) => {
      try {
        const { default: db } = await import('../../models/database');
        let query = 'SELECT * FROM virtual_machines WHERE 1=1';
        const params: any[] = [];
        if (args.status) { query += ' AND status = ?'; params.push(args.status); }
        if (args.hostId) { query += ' AND host_id = ?'; params.push(args.hostId); }
        query += ` LIMIT ${args.limit || 50}`;
        const vms = db.prepare(query).all(...params);
        return jsonResult(vms, `找到 ${(vms as any[])?.length || 0} 台虚拟机`);
      } catch (err) {
        return textResult(`查询虚拟机失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  // ==========================================
  // 5. Kubernetes 模块 (kubernetes)
  // ==========================================

  {
    name: 'k8s.cluster.summary',
    title: '查询 K8s 集群摘要',
    description: '查询 Kubernetes 集群摘要信息，包含节点数、Pod 数、命名空间数、资源使用率。',
    domain: 'system_inspection',
    annotations: READONLY,
    inputSchema: z.object({
      clusterId: z.string().optional().describe('集群 ID（不传则返回所有集群）'),
    }),
    handler: async (args) => {
      try {
        const { kubernetesService } = await import(
          '../../modules/kubernetes/services/kubernetesService'
        );
        const summary = await (kubernetesService as any).getClusterSummary?.(args.clusterId);
        return jsonResult(summary || { message: 'K8s 集群数据正在同步中' }, 'K8s 集群摘要');
      } catch (err) {
        return textResult(`查询 K8s 集群失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  {
    name: 'k8s.pod.list',
    title: '查询 K8s Pod 列表',
    description: '查询 Kubernetes Pod 列表，包含状态、重启次数、资源使用。支持按命名空间和工作负载过滤。',
    domain: 'system_inspection',
    annotations: READONLY,
    inputSchema: z.object({
      clusterId: z.string().optional().describe('集群 ID'),
      namespace: z.string().optional().describe('命名空间'),
      labelSelector: z.string().optional().describe('标签选择器'),
      limit: z.number().min(1).max(200).default(50).describe('返回数量'),
    }),
    handler: async (args) => {
      try {
        const { kubernetesService } = await import(
          '../../modules/kubernetes/services/kubernetesService'
        );
        const pods = await (kubernetesService as any).listPods?.(
          args.clusterId,
          args.namespace,
          args.labelSelector,
          args.limit
        );
        return jsonResult(pods || [], `Pod 列表`);
      } catch (err) {
        return textResult(`查询 Pod 失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  // ==========================================
  // 6. 数据中心模块 (dc)
  // ==========================================

  {
    name: 'dc.rack.list',
    title: '查询机柜列表',
    description: '查询数据中心机柜列表，包含位置、容量、功耗、温度等信息。',
    domain: 'system_inspection',
    annotations: READONLY,
    inputSchema: z.object({
      roomId: z.string().optional().describe('机房 ID'),
      status: z.enum(['active', 'maintenance', 'offline']).optional().describe('机柜状态'),
      limit: z.number().min(1).max(100).default(50).describe('返回数量'),
    }),
    handler: async (args) => {
      try {
        const { default: db } = await import('../../models/database');
        let query = 'SELECT * FROM dc_racks WHERE 1=1';
        const params: any[] = [];
        if (args.roomId) { query += ' AND room_id = ?'; params.push(args.roomId); }
        if (args.status) { query += ' AND status = ?'; params.push(args.status); }
        query += ` LIMIT ${args.limit || 50}`;
        const racks = db.prepare(query).all(...params);
        return jsonResult(racks, `找到 ${(racks as any[])?.length || 0} 个机柜`);
      } catch (err) {
        return textResult(`查询机柜失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  {
    name: 'dc.device.list',
    title: '查询数据中心设备',
    description: '查询数据中心设备清单（服务器、交换机、PDU 等），含机架位置和功耗。',
    domain: 'system_inspection',
    annotations: READONLY,
    inputSchema: z.object({
      rackId: z.string().optional().describe('机柜 ID'),
      deviceType: z.string().optional().describe('设备类型'),
      limit: z.number().min(1).max(200).default(100).describe('返回数量'),
    }),
    handler: async (args) => {
      try {
        const { default: db } = await import('../../models/database');
        let query = 'SELECT * FROM dc_devices WHERE 1=1';
        const params: any[] = [];
        if (args.rackId) { query += ' AND rack_id = ?'; params.push(args.rackId); }
        if (args.deviceType) { query += ' AND device_type = ?'; params.push(args.deviceType); }
        query += ` LIMIT ${args.limit || 100}`;
        const devices = db.prepare(query).all(...params);
        return jsonResult(devices, `找到 ${(devices as any[])?.length || 0} 台设备`);
      } catch (err) {
        return textResult(`查询数据中心设备失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  // ==========================================
  // 7. 监控模块 (monitor)
  // ==========================================

  {
    name: 'monitor.health',
    title: '查询系统健康状态',
    description: '查询整体系统健康状态，包含各服务健康检查结果和资源使用。',
    domain: 'system_inspection',
    annotations: READONLY,
    inputSchema: z.object({}),
    handler: async () => {
      try {
        const { healthService } = await import('../../modules/monitor/services/healthService');
        const health = await healthService.checkHealth();
        return jsonResult(health, `系统健康状态: ${health.status}`);
      } catch (err) {
        return textResult(`查询健康状态失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  {
    name: 'monitor.metrics',
    title: '查询系统指标',
    description: '查询系统运行指标（CPU、内存、磁盘、网络），支持时间范围。',
    domain: 'system_inspection',
    annotations: READONLY,
    inputSchema: z.object({
      metricType: z.enum(['cpu', 'memory', 'disk', 'network']).optional().describe('指标类型'),
      hostId: z.string().optional().describe('主机 ID'),
      minutes: z.number().min(5).max(1440).default(15).describe('时间范围（分钟）'),
    }),
    handler: async (args) => {
      try {
        const { default: db } = await import('../../models/database');
        // 从 selfMonitor 获取最近的指标报告
        const { selfMonitorService } = await import(
          '../../modules/monitor/services/selfMonitorService'
        );
        const report = selfMonitorService.getLastReport();
        return jsonResult(
          { report, query: args },
          report ? '系统指标（最近一次检查）' : '监控数据正在初始化'
        );
      } catch (err) {
        return textResult(`查询指标失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  // ==========================================
  // 8. 工作流引擎模块 (workflow)
  // ==========================================

  {
    name: 'workflow.list',
    title: '查询工作流列表',
    description: '查询所有工作流定义，包含步骤、触发器、状态。',
    domain: 'system_inspection',
    annotations: READONLY,
    inputSchema: z.object({
      status: z.enum(['active', 'inactive', 'draft']).optional().describe('工作流状态'),
      limit: z.number().min(1).max(50).default(20).describe('返回数量'),
    }),
    handler: async (args) => {
      try {
        const { default: db } = await import('../../models/database');
        let query = 'SELECT id, name, description, status, trigger_type, created_at, updated_at FROM workflows WHERE 1=1';
        const params: any[] = [];
        if (args.status) { query += ' AND status = ?'; params.push(args.status); }
        query += ` LIMIT ${args.limit || 20}`;
        const workflows = db.prepare(query).all(...params);
        return jsonResult(workflows, `找到 ${(workflows as any[])?.length || 0} 个工作流`);
      } catch (err) {
        return textResult(`查询工作流失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  {
    name: 'workflow.task.list',
    title: '查询任务列表',
    description: '查询任务中心的任务列表，包含执行状态、主机、耗时。',
    domain: 'system_inspection',
    annotations: READONLY,
    inputSchema: z.object({
      status: z.enum(['pending', 'running', 'success', 'failed']).optional().describe('任务状态'),
      hostId: z.string().optional().describe('主机 ID'),
      limit: z.number().min(1).max(100).default(20).describe('返回数量'),
    }),
    handler: async (args) => {
      try {
        const { default: db } = await import('../../models/database');
        let query = 'SELECT * FROM tasks WHERE 1=1';
        const params: any[] = [];
        if (args.status) { query += ' AND status = ?'; params.push(args.status); }
        if (args.hostId) { query += ' AND host_id = ?'; params.push(args.hostId); }
        query += ' ORDER BY created_at DESC';
        query += ` LIMIT ${args.limit || 20}`;
        const tasks = db.prepare(query).all(...params);
        return jsonResult(tasks, `找到 ${(tasks as any[])?.length || 0} 个任务`);
      } catch (err) {
        return textResult(`查询任务失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  // ==========================================
  // 9. 自动化修复模块 (auto)
  // ==========================================

  {
    name: 'remediation.policy.list',
    title: '查询修复策略',
    description: '查询自动化修复策略列表，包含匹配条件、修复动作、执行历史。',
    domain: 'change_execution',
    annotations: READONLY,
    inputSchema: z.object({
      enabled: z.boolean().optional().describe('是否启用'),
      limit: z.number().min(1).max(50).default(20).describe('返回数量'),
    }),
    handler: async (args) => {
      try {
        const { default: db } = await import('../../models/database');
        let query = 'SELECT * FROM remediation_policies WHERE 1=1';
        const params: any[] = [];
        if (args.enabled !== undefined) { query += ' AND enabled = ?'; params.push(args.enabled ? 1 : 0); }
        query += ` LIMIT ${args.limit || 20}`;
        const policies = db.prepare(query).all(...params);
        return jsonResult(policies, `找到 ${(policies as any[])?.length || 0} 条修复策略`);
      } catch (err) {
        return textResult(`查询修复策略失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  {
    name: 'remediation.audit',
    title: '查询修复审计',
    description: '查询自动化修复的执行审计记录，包含触发告警、修复动作、执行结果。',
    domain: 'change_execution',
    annotations: READONLY,
    inputSchema: z.object({
      status: z.enum(['success', 'failed', 'pending', 'rollback']).optional().describe('执行状态'),
      limit: z.number().min(1).max(100).default(20).describe('返回数量'),
    }),
    handler: async (args) => {
      try {
        const { default: db } = await import('../../models/database');
        let query = 'SELECT * FROM remediation_audit WHERE 1=1';
        const params: any[] = [];
        if (args.status) { query += ' AND status = ?'; params.push(args.status); }
        query += ' ORDER BY executed_at DESC';
        query += ` LIMIT ${args.limit || 20}`;
        const audits = db.prepare(query).all(...params);
        return jsonResult(audits, `找到 ${(audits as any[])?.length || 0} 条修复审计`);
      } catch (err) {
        return textResult(`查询修复审计失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  // ==========================================
  // 10. 数据库管理模块 (database)
  // ==========================================

  {
    name: 'database.list',
    title: '查询数据库列表',
    description: '查询管理的数据库实例列表，包含类型、版本、连接信息。',
    domain: 'database_operation',
    annotations: READONLY,
    inputSchema: z.object({
      dbType: z.string().optional().describe('数据库类型（mysql/postgresql/redis等）'),
      limit: z.number().min(1).max(50).default(20).describe('返回数量'),
    }),
    handler: async (args) => {
      try {
        const { default: db } = await import('../../models/database');
        let query = 'SELECT id, name, db_type, host, port, status, version FROM databases WHERE 1=1';
        const params: any[] = [];
        if (args.dbType) { query += ' AND db_type = ?'; params.push(args.dbType); }
        query += ` LIMIT ${args.limit || 20}`;
        const databases = db.prepare(query).all(...params);
        return jsonResult(databases, `找到 ${(databases as any[])?.length || 0} 个数据库`);
      } catch (err) {
        return textResult(`查询数据库失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  // ==========================================
  // 11. 基础设施模块 (infra)
  // ==========================================

  {
    name: 'infra.script.list',
    title: '查询脚本列表',
    description: '查询运维脚本库，包含脚本名称、类型、执行环境。',
    domain: 'document_generation',
    annotations: READONLY,
    inputSchema: z.object({
      scriptType: z.string().optional().describe('脚本类型（shell/python/ansible等）'),
      search: z.string().optional().describe('按名称搜索'),
      limit: z.number().min(1).max(50).default(20).describe('返回数量'),
    }),
    handler: async (args) => {
      try {
        const { default: db } = await import('../../models/database');
        let query = 'SELECT id, name, description, script_type, language, enabled FROM scripts WHERE 1=1';
        const params: any[] = [];
        if (args.scriptType) { query += ' AND script_type = ?'; params.push(args.scriptType); }
        if (args.search) { query += ' AND name LIKE ?'; params.push(`%${args.search}%`); }
        query += ` LIMIT ${args.limit || 20}`;
        const scripts = db.prepare(query).all(...params);
        return jsonResult(scripts, `找到 ${(scripts as any[])?.length || 0} 个脚本`);
      } catch (err) {
        return textResult(`查询脚本失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  {
    name: 'infra.backup.list',
    title: '查询备份记录',
    description: '查询配置和数据备份记录，包含备份类型、时间、大小。',
    domain: 'system_inspection',
    annotations: READONLY,
    inputSchema: z.object({
      backupType: z.string().optional().describe('备份类型'),
      limit: z.number().min(1).max(50).default(20).describe('返回数量'),
    }),
    handler: async (args) => {
      try {
        const { default: db } = await import('../../models/database');
        let query = 'SELECT * FROM backups WHERE 1=1';
        const params: any[] = [];
        if (args.backupType) { query += ' AND backup_type = ?'; params.push(args.backupType); }
        query += ' ORDER BY created_at DESC';
        query += ` LIMIT ${args.limit || 20}`;
        const backups = db.prepare(query).all(...params);
        return jsonResult(backups, `找到 ${(backups as any[])?.length || 0} 条备份记录`);
      } catch (err) {
        return textResult(`查询备份失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  // ==========================================
  // 12. AI 智能运维模块 (ai)
  // ==========================================

  {
    name: 'aiops.knowledge',
    title: '查询 AIOps 知识图谱',
    description: '查询运维知识图谱，按环境、系统或服务搜索历史排障经验和最佳实践。',
    domain: 'document_generation',
    annotations: READONLY,
    inputSchema: z.object({
      query: z.string().describe('搜索关键词'),
      category: z.string().optional().describe('知识分类'),
      limit: z.number().min(1).max(20).default(5).describe('返回数量'),
    }),
    handler: async (args) => {
      try {
        const { default: db } = await import('../../models/database');
        let query = 'SELECT * FROM knowledge WHERE 1=1';
        const params: any[] = [];
        if (args.query) {
          query += ' AND (title LIKE ? OR content LIKE ? OR tags LIKE ?)';
          params.push(`%${args.query}%`, `%${args.query}%`, `%${args.query}%`);
        }
        if (args.category) { query += ' AND category = ?'; params.push(args.category); }
        query += ` LIMIT ${args.limit || 5}`;
        const results = db.prepare(query).all(...params);
        return jsonResult(results, `找到 ${(results as any[])?.length || 0} 条知识`);
      } catch (err) {
        return textResult(`查询知识图谱失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  {
    name: 'aiops.session.list',
    title: '查询 AI 会话列表',
    description: '查询 AI Agent 会话历史，包含用户问题、Agent 回答、工具调用统计。',
    domain: 'document_generation',
    annotations: READONLY,
    inputSchema: z.object({
      status: z.enum(['active', 'completed', 'failed']).optional().describe('会话状态'),
      limit: z.number().min(1).max(50).default(10).describe('返回数量'),
    }),
    handler: async (args) => {
      try {
        const { default: db } = await import('../../models/database');
        let query = `
          SELECT cs.id, cs.title, cs.status, cs.model_name, cs.created_at,
            COUNT(cm.id) as message_count
          FROM chat_sessions cs
          LEFT JOIN chat_messages cm ON cs.id = cm.session_id
          WHERE 1=1
        `;
        const params: any[] = [];
        if (args.status) { query += ' AND cs.status = ?'; params.push(args.status); }
        query += ' GROUP BY cs.id ORDER BY cs.created_at DESC';
        query += ` LIMIT ${args.limit || 10}`;
        const sessions = db.prepare(query).all(...params);
        return jsonResult(sessions, `找到 ${(sessions as any[])?.length || 0} 个会话`);
      } catch (err) {
        return textResult(`查询会话失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  // ==========================================
  // 13. 认证授权模块 (auth)
  // ==========================================

  {
    name: 'auth.user.list',
    title: '查询用户列表',
    description: '查询系统用户列表（只读），包含用户名、角色、状态。',
    domain: 'compliance_check',
    annotations: READONLY,
    inputSchema: z.object({
      role: z.string().optional().describe('角色过滤'),
      status: z.enum(['active', 'disabled']).optional().describe('用户状态'),
      limit: z.number().min(1).max(50).default(20).describe('返回数量'),
    }),
    handler: async (args) => {
      try {
        const { default: db } = await import('../../models/database');
        let query = 'SELECT id, username, display_name, role, email, status, created_at FROM users WHERE 1=1';
        const params: any[] = [];
        if (args.role) { query += ' AND role = ?'; params.push(args.role); }
        if (args.status) { query += ' AND status = ?'; params.push(args.status); }
        query += ` LIMIT ${args.limit || 20}`;
        const users = db.prepare(query).all(...params);
        return jsonResult(users, `找到 ${(users as any[])?.length || 0} 个用户`);
      } catch (err) {
        return textResult(`查询用户失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  // ============================================================
  // SSH & 系统管理工具 (从 agentToolRegistry 迁移)
  // ============================================================

  {
    name: 'ssh.exec',
    title: 'SSH 命令执行',
    description: '在远程服务器上执行 SSH 命令',
    domain: 'servers',
    inputSchema: z.object({
      serverId: z.string().describe('服务器 ID'),
      command: z.string().describe('要执行的命令'),
    }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, riskLevel: RiskLevel.MEDIUM, requiresApproval: true },
    handler: async (args, _ctx) => {
      try {
        const result = await executeCommand(args.serverId as string, args.command as string);
        return textResult(
          `执行结果 (${result.success ? '✅ 成功' : '❌ 失败'})\n输出:\n${result.stdout}${result.stderr ? `\n错误:\n${result.stderr}` : ''}\n用时: ${result.duration}ms`
        );
      } catch (err) {
        return textResult(`SSH 执行失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  {
    name: 'ssh.viewFile',
    title: '查看远程文件',
    description: '查看远程服务器上的文件内容（tail）',
    domain: 'servers',
    inputSchema: z.object({
      serverId: z.string().describe('服务器 ID'),
      filePath: z.string().describe('文件路径'),
      lines: z.number().optional().default(100).describe('显示行数'),
    }),
    annotations: READONLY,
    handler: async (args, _ctx) => {
      try {
        const command = `tail -n ${args.lines || 100} ${args.filePath}`;
        const result = await executeCommand(args.serverId as string, command);
        return textResult(`文件: ${args.filePath}\n${result.stdout}${result.stderr ? `\n错误: ${result.stderr}` : ''}`);
      } catch (err) {
        return textResult(`查看文件失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  {
    name: 'server.hostLoad',
    title: '主机负载信息',
    description: '获取主机负载详情（uptime/free/df/iostat/vmstat）',
    domain: 'servers',
    inputSchema: z.object({
      serverId: z.string().describe('服务器 ID'),
    }),
    annotations: READONLY,
    handler: async (args, _ctx) => {
      try {
        const commands = ['uptime', 'free -h', 'df -h', 'iostat -x 1 1', 'vmstat 1 1'].join(' && echo -e "\\n---\\n" && ');
        const result = await executeCommand(args.serverId as string, commands);
        return textResult(result.stdout);
      } catch (err) {
        return textResult(`获取负载信息失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  {
    name: 'server.processes',
    title: '主机进程列表',
    description: '获取主机进程列表，可按 CPU 或内存排序',
    domain: 'servers',
    inputSchema: z.object({
      serverId: z.string().describe('服务器 ID'),
      sortBy: z.enum(['cpu', 'mem']).optional().default('cpu').describe('排序方式'),
      limit: z.number().optional().default(20).describe('显示数量'),
    }),
    annotations: READONLY,
    handler: async (args, _ctx) => {
      try {
        const sortFlag = args.sortBy === 'mem' ? '-%mem' : '-%cpu';
        const command = `ps aux --sort=${sortFlag} | head -${args.limit || 20}`;
        const result = await executeCommand(args.serverId as string, command);
        return textResult(result.stdout);
      } catch (error: any) {
        return textResult(`获取进程列表失败: ${(error as Error).message}`, true);
      }
    },
    enabled: true,
  },

  {
    name: 'server.networkStatus',
    title: '网络状态检查',
    description: '检查服务器网络状态（IP/Socket/路由/Ping）',
    domain: 'servers',
    inputSchema: z.object({
      serverId: z.string().describe('服务器 ID'),
    }),
    annotations: READONLY,
    handler: async (args, _ctx) => {
      try {
        const commands = ['ip addr show', 'ss -tuln', 'ip route show', 'ping -c 4 8.8.8.8'].join(' && echo -e "\\n---\\n" && ');
        const result = await executeCommand(args.serverId as string, commands);
        return textResult(result.stdout);
      } catch (err) {
        return textResult(`网络检查失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  {
    name: 'server.findLargeFiles',
    title: '查找大文件',
    description: '查找服务器上的大文件（可指定目录和最小大小）',
    domain: 'servers',
    inputSchema: z.object({
      serverId: z.string().describe('服务器 ID'),
      directory: z.string().optional().default('/').describe('查找目录'),
      minSizeMB: z.number().optional().default(100).describe('最小文件大小 (MB)'),
      limit: z.number().optional().default(10).describe('显示数量'),
    }),
    annotations: READONLY,
    handler: async (args, _ctx) => {
      try {
        const command = `find ${args.directory || '/'} -type f -size +${args.minSizeMB || 100}M -exec ls -lh {} \\; 2>/dev/null | head -${args.limit || 10}`;
        const result = await executeCommand(args.serverId as string, command);
        return textResult(`查找目录: ${args.directory || '/'}\n最小文件大小: ${args.minSizeMB || 100} MB\n${result.stdout}`);
      } catch (err) {
        return textResult(`查找大文件失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  {
    name: 'server.logs',
    title: '系统日志查询',
    description: '查询服务器系统日志（journalctl）',
    domain: 'servers',
    inputSchema: z.object({
      serverId: z.string().describe('服务器 ID'),
      unit: z.string().optional().describe('服务单元名称'),
      since: z.string().optional().default('1 hour ago').describe('起始时间'),
      lines: z.number().optional().default(100).describe('显示行数'),
      level: z.enum(['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug']).optional().describe('日志级别'),
    }),
    annotations: READONLY,
    handler: async (args, _ctx) => {
      try {
        let command = 'journalctl';
        if (args.unit) command += ` -u ${args.unit}`;
        if (args.level) command += ` -p ${args.level}`;
        command += ` --since '${args.since || '1 hour ago'}' -n ${args.lines || 100}`;
        const result = await executeCommand(args.serverId as string, command);
        return textResult(`系统日志 (${args.unit || '所有单元'}, ${args.since || '1 hour ago'}):\n${result.stdout}`);
      } catch (err) {
        return textResult(`查询日志失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  {
    name: 'server.services',
    title: '服务状态检查',
    description: '检查服务器上的 systemd 服务状态',
    domain: 'servers',
    inputSchema: z.object({
      serverId: z.string().describe('服务器 ID'),
      unit: z.string().optional().describe('服务单元名称'),
      listAll: z.boolean().optional().default(false).describe('列出所有服务'),
    }),
    annotations: READONLY,
    handler: async (args, _ctx) => {
      try {
        let command = 'systemctl';
        if (args.listAll) {
          command += ' list-units --type=service';
        } else if (args.unit) {
          command += ` status ${args.unit}`;
        } else {
          command += ' --failed --type=service';
        }
        const result = await executeCommand(args.serverId as string, command);
        return textResult(`服务状态:\n${result.stdout}`);
      } catch (err) {
        return textResult(`服务检查失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  // ============================================================
  // Docker 管理工具 (从 agentToolRegistry 迁移)
  // ============================================================

  {
    name: 'docker.container.list',
    title: 'Docker 容器列表',
    description: '列出所有 Docker 容器',
    domain: 'containers',
    inputSchema: z.object({
      all: z.boolean().optional().default(false).describe('是否显示所有容器（含已停止）'),
    }),
    annotations: READONLY,
    handler: async (args, _ctx) => {
      try {
        const containers = await dockerService.listContainers(Boolean(args.all));
        return jsonResult(
          containers,
          `Docker 容器列表 (共 ${containers.length} 个):\n${containers.map((c: any) => `• ${c.name} (${c.state}) ${c.image}`).join('\n')}`
        );
      } catch (err) {
        return textResult(`获取容器列表失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  {
    name: 'docker.image.list',
    title: 'Docker 镜像列表',
    description: '列出所有 Docker 镜像',
    domain: 'containers',
    inputSchema: z.object({}),
    annotations: READONLY,
    handler: async (_args, _ctx) => {
      try {
        const images = await dockerService.listImages();
        return jsonResult(
          images,
          `Docker 镜像列表 (共 ${images.length} 个):\n${images.map((img: any) => `• ${img.tags?.join(', ') || 'untagged'} (${img.size} bytes)`).join('\n')}`
        );
      } catch (err) {
        return textResult(`获取镜像列表失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  {
    name: 'docker.container.logs',
    title: 'Docker 容器日志',
    description: '获取指定 Docker 容器的日志',
    domain: 'containers',
    inputSchema: z.object({
      containerId: z.string().describe('容器 ID'),
      tail: z.number().optional().default(100).describe('显示行数'),
    }),
    annotations: READONLY,
    handler: async (args, _ctx) => {
      try {
        const logs = await dockerService.getContainerLogs(args.containerId as string, Number(args.tail) || 100);
        return textResult(`容器 ${args.containerId} 日志 (最近 ${args.tail || 100} 行):\n${logs}`);
      } catch (err) {
        return textResult(`获取容器日志失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  {
    name: 'docker.container.stats',
    title: 'Docker 容器统计',
    description: '获取 Docker 容器资源使用统计',
    domain: 'containers',
    inputSchema: z.object({
      containerId: z.string().describe('容器 ID'),
    }),
    annotations: READONLY,
    handler: async (args, _ctx) => {
      try {
        const stats = await dockerService.getContainerStats(args.containerId as string);
        return jsonResult(stats, `容器 ${args.containerId} 资源统计`);
      } catch (err) {
        return textResult(`获取容器统计失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  {
    name: 'docker.container.info',
    title: 'Docker 容器详情',
    description: '获取 Docker 容器配置和状态详情',
    domain: 'containers',
    inputSchema: z.object({
      containerId: z.string().describe('容器 ID'),
    }),
    annotations: READONLY,
    handler: async (args, _ctx) => {
      try {
        const info = await dockerService.getContainer(args.containerId as string);
        return jsonResult(info, `容器 ${args.containerId} 详细信息`);
      } catch (err) {
        return textResult(`获取容器详情失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  {
    name: 'docker.system.info',
    title: 'Docker 系统信息',
    description: '获取 Docker Engine 系统信息',
    domain: 'containers',
    inputSchema: z.object({}),
    annotations: READONLY,
    handler: async (_args, _ctx) => {
      try {
        const info = await dockerService.getSystemInfo();
        return jsonResult(info, 'Docker 系统信息');
      } catch (err) {
        return textResult(`获取 Docker 系统信息失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  {
    name: 'docker.volume.list',
    title: 'Docker 卷列表',
    description: '列出所有 Docker 数据卷',
    domain: 'containers',
    inputSchema: z.object({}),
    annotations: READONLY,
    handler: async (_args, _ctx) => {
      try {
        const volumes = await dockerService.listVolumes();
        return jsonResult(
          volumes,
          `Docker 卷列表 (共 ${volumes.length} 个):\n${volumes.map((v: any) => `• ${v.name} (${v.driver})`).join('\n')}`
        );
      } catch (err) {
        return textResult(`获取卷列表失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  {
    name: 'docker.network.list',
    title: 'Docker 网络列表',
    description: '列出所有 Docker 网络',
    domain: 'containers',
    inputSchema: z.object({}),
    annotations: READONLY,
    handler: async (_args, _ctx) => {
      try {
        const networks = await dockerService.listNetworks();
        return jsonResult(
          networks,
          `Docker 网络列表 (共 ${networks.length} 个):\n${networks.map((n: any) => `• ${n.name} (${n.driver})`).join('\n')}`
        );
      } catch (err) {
        return textResult(`获取网络列表失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },

  // ============================================================
  // 数据库统计工具 (从 agentToolRegistry 迁移)
  // ============================================================

  {
    name: 'database.info',
    title: '数据库信息统计',
    description: '获取数据库统计信息（服务器数/告警数/用户数）',
    domain: 'database',
    inputSchema: z.object({}),
    annotations: READONLY,
    handler: async (_args, _ctx) => {
      try {
        const serverCount = (db.prepare('SELECT COUNT(*) as count FROM servers').get() as any).count;
        const alertCount = (db.prepare('SELECT COUNT(*) as count FROM alerts').get() as any).count;
        const userCount = (db.prepare('SELECT COUNT(*) as count FROM users').get() as any).count;
        return jsonResult(
          { serverCount, alertCount, userCount },
          `数据库信息统计:\n- 服务器数量: ${serverCount}\n- 告警数量: ${alertCount}\n- 用户数量: ${userCount}`
        );
      } catch (err) {
        return textResult(`获取数据库统计失败: ${(err as Error).message}`, true);
      }
    },
    enabled: true,
  },
];

// ============================================================
// 初始化函数
// ============================================================

/**
 * 注册所有平台内置工具到 Registry
 */
export function registerAllPlatformTools(): void {
  toolRegistry.registerAll(PLATFORM_TOOLS);
  logger.info(
    `Registered ${PLATFORM_TOOLS.length} MCP platform tools across 13 domains`
  );
}
