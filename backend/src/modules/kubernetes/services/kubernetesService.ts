import { logger } from '../../../utils/logger';
import { db } from '../../../models/database';
import { randomUUID } from 'crypto';

let k8s: any = null;
try {
  k8s = require('@kubernetes/client-node');
} catch {
  logger.warn('⚠️ @kubernetes/client-node not installed, K8s management disabled. Install with: npm install @kubernetes/client-node');
}

interface K8sContext {
  id: string;
  name: string;
  clusterUrl: string;
  namespace: string;
  authType: string;
  config: string;
  status: string;
  nodeCount: number;
  podCount: number;
  createdAt: string;
  updatedAt: string;
}

class KubernetesService {
  private clients: Map<string, { kc: any; coreApi: any; appsApi: any }> = new Map();
  private contexts: Map<string, K8sContext> = new Map();
  private available = false;

  constructor() {
    if (!k8s) {
      this.available = false;
      return;
    }
    this.available = true;
    // Tables and contexts initialized via ensureTables() called from app.ts
  }

  ensureTables() {
    this.initTables();
    this.loadContexts();
  }

  private initTables() {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS k8s_contexts (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          cluster_url TEXT,
          namespace TEXT DEFAULT 'default',
          auth_type TEXT DEFAULT 'kubeconfig',
          config TEXT,
          status TEXT DEFAULT 'inactive',
          node_count INTEGER DEFAULT 0,
          pod_count INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime'))
        )
      `);
    } catch {}
  }

  private loadContexts() {
    try {
      const rows = db.prepare('SELECT * FROM k8s_contexts WHERE status = ?').all('active') as any[];
      for (const row of rows) {
        try {
          const kc = new k8s.KubeConfig();
          kc.loadFromString(row.config);
          this.clients.set(row.id, {
            kc,
            coreApi: kc.makeApiClient(k8s.CoreV1Api),
            appsApi: kc.makeApiClient(k8s.AppsV1Api),
          });
          this.contexts.set(row.id, this.rowToContext(row));
        } catch (err: any) {
          logger.error(`Failed to load K8s context ${row.name}:`, err.message);
        }
      }
      logger.info(`📋 Loaded ${this.clients.size} K8s cluster(s)`);
    } catch (err: any) {
      logger.error('Failed to load K8s contexts:', err.message);
    }
  }

  private rowToContext(row: any): K8sContext {
    return {
      id: row.id, name: row.name, clusterUrl: row.cluster_url,
      namespace: row.namespace, authType: row.auth_type, config: row.config,
      status: row.status, nodeCount: row.node_count, podCount: row.pod_count,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }

  getClient(contextId: string) {
    const client = this.clients.get(contextId);
    if (!client) throw Object.assign(new Error(`K8s 集群未连接: ${contextId}`), { statusCode: 503 });
    return client;
  }

  isAvailable(): boolean {
    return this.available && this.clients.size > 0;
  }

  // ── 集群管理 ──
  listContexts(): K8sContext[] {
    return Array.from(this.contexts.values());
  }

  async addContext(configContent: string): Promise<K8sContext> {
    if (!k8s) throw new Error('@kubernetes/client-node 未安装');

    // 解析 kubeconfig 获取集群信息
    const kc = new k8s.KubeConfig();
    kc.loadFromString(configContent);

    const contextName = kc.getCurrentContext();
    const cluster = kc.getCurrentCluster();
    const user = kc.getCurrentUser();

    const id = randomUUID();
    const now = new Date().toISOString();
    const name = contextName || `k8s-${id.substring(0, 8)}`;
    const clusterUrl = cluster?.server || '';

    db.prepare(`
      INSERT INTO k8s_contexts (id, name, cluster_url, namespace, auth_type, config, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `).run(id, name, clusterUrl, 'default', 'kubeconfig', configContent, now, now);

    // 立即加载客户端
    try {
      this.clients.set(id, {
        kc,
        coreApi: kc.makeApiClient(k8s.CoreV1Api),
        appsApi: kc.makeApiClient(k8s.AppsV1Api),
      });

      // 更新集群信息
      const nodes = await kc.makeApiClient(k8s.CoreV1Api).listNode().catch(() => ({ body: { items: [] } }));
      const pods = await kc.makeApiClient(k8s.CoreV1Api).listPodForAllNamespaces().catch(() => ({ body: { items: [] } }));
      db.prepare('UPDATE k8s_contexts SET node_count=?, pod_count=?, updated_at=? WHERE id=?')
        .run(nodes.body.items.length, pods.body.items.length, now, id);

      const ctx: K8sContext = {
        id, name, clusterUrl, namespace: 'default', authType: 'kubeconfig',
        config: configContent, status: 'active',
        nodeCount: nodes.body.items.length, podCount: pods.body.items.length,
        createdAt: now, updatedAt: now,
      };
      this.contexts.set(id, ctx);
      logger.info(`✅ K8s cluster connected: ${name} (${clusterUrl})`);
      return ctx;
    } catch (err: any) {
      db.prepare('UPDATE k8s_contexts SET status=?, updated_at=? WHERE id=?').run('error', now, id);
      throw new Error(`连接集群失败: ${err.message}`);
    }
  }

  async deleteContext(contextId: string): Promise<void> {
    this.clients.delete(contextId);
    this.contexts.delete(contextId);
    db.prepare('DELETE FROM k8s_contexts WHERE id = ?').run(contextId);
  }

  async testContext(configContent: string): Promise<{ success: boolean; message: string }> {
    if (!k8s) return { success: false, message: '@kubernetes/client-node 未安装' };
    try {
      const kc = new k8s.KubeConfig();
      kc.loadFromString(configContent);
      const api = kc.makeApiClient(k8s.CoreV1Api);
      const res = await api.listNode();
      const cluster = kc.getCurrentCluster();
      return { success: true, message: `${cluster?.server || 'Unknown'}, ${res.body.items.length} nodes` };
    } catch (err: any) {
      return { success: false, message: err.message };
    }
  }

  // ── 核心 API ──
  async listNamespaces(contextId?: string): Promise<any[]> {
    const { coreApi } = this.getClient(contextId || this.contexts.keys().next().value || '');
    const res = await coreApi.listNamespace();
    return (res.body.items || []).map((ns: any) => ({
      name: ns.metadata?.name || '',
      status: ns.status?.phase || '',
      createdAt: ns.metadata?.creationTimestamp,
    }));
  }

  async listPods(namespace = 'default', contextId?: string): Promise<any[]> {
    const { coreApi } = this.getClient(contextId || this.contexts.keys().next().value || '');
    const res = await coreApi.listNamespacedPod(namespace);
    return (res.body.items || []).map((pod: any) => ({
      name: pod.metadata?.name || '',
      namespace: pod.metadata?.namespace || '',
      status: pod.status?.phase || 'Unknown',
      nodeName: pod.spec?.nodeName || '',
      podIP: pod.status?.podIP || '',
      containers: (pod.spec?.containers || []).map((c: any) => ({ name: c.name, image: c.image || '' })),
      containerStatuses: (pod.status?.containerStatuses || []).map((cs: any) => ({
        name: cs.name, ready: cs.ready, restartCount: cs.restartCount,
        state: cs.state ? Object.keys(cs.state)[0] : 'unknown',
      })),
      restartCount: (pod.status?.containerStatuses || []).reduce((sum: number, cs: any) => sum + cs.restartCount, 0),
      totalContainers: (pod.spec?.containers || []).length,
      readyContainers: (pod.status?.containerStatuses || []).filter((cs: any) => cs.ready).length,
      labels: pod.metadata?.labels || {},
      createdAt: pod.metadata?.creationTimestamp,
    }));
  }

  async listDeployments(namespace = 'default', contextId?: string): Promise<any[]> {
    const { appsApi } = this.getClient(contextId || this.contexts.keys().next().value || '');
    const res = await appsApi.listNamespacedDeployment(namespace);
    return (res.body.items || []).map((deploy: any) => ({
      name: deploy.metadata?.name || '',
      namespace: deploy.metadata?.namespace || '',
      replicas: deploy.spec?.replicas || 0,
      readyReplicas: deploy.status?.readyReplicas || 0,
      availableReplicas: deploy.status?.availableReplicas || 0,
      image: (deploy.spec?.template?.spec?.containers?.[0]?.image || '').split('/').pop() || '',
      strategy: deploy.spec?.strategy?.type || 'RollingUpdate',
      containers: (deploy.spec?.template?.spec?.containers || []).map((c: any) => ({ name: c.name, image: c.image || '' })),
      createdAt: deploy.metadata?.creationTimestamp,
    }));
  }

  async listServices(namespace = 'default', contextId?: string): Promise<any[]> {
    const { coreApi } = this.getClient(contextId || this.contexts.keys().next().value || '');
    const res = await coreApi.listNamespacedService(namespace);
    return (res.body.items || []).map((svc: any) => ({
      name: svc.metadata?.name || '',
      namespace: svc.metadata?.namespace || '',
      type: svc.spec?.type || 'ClusterIP',
      clusterIP: svc.spec?.clusterIP || '',
      ports: (svc.spec?.ports || []).map((p: any) => ({
        name: p.name || '', port: p.port, targetPort: p.targetPort,
        protocol: p.protocol || 'TCP', nodePort: p.nodePort,
      })),
      createdAt: svc.metadata?.creationTimestamp,
    }));
  }

  async listNodes(contextId?: string): Promise<any[]> {
    const { coreApi } = this.getClient(contextId || this.contexts.keys().next().value || '');
    const res = await coreApi.listNode();
    return (res.body.items || []).map((node: any) => ({
      name: node.metadata?.name || '',
      status: node.status?.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True' ? 'Ready' : 'NotReady',
      roles: node.metadata?.labels?.['node-role.kubernetes.io/control-plane'] ? ['control-plane'] : ['worker'],
      version: node.status?.nodeInfo?.kubeletVersion || '',
      os: node.status?.nodeInfo?.osImage || '',
      cpu: node.status?.capacity?.cpu || '0',
      memory: node.status?.capacity?.memory || '0',
      createdAt: node.metadata?.creationTimestamp,
    }));
  }

  async getPod(namespace: string, name: string, contextId?: string): Promise<any> {
    const { coreApi } = this.getClient(contextId || this.contexts.keys().next().value || '');
    const res = await coreApi.readNamespacedPod(name, namespace);
    const pod = res.body;
    return {
      name: pod.metadata?.name || '',
      namespace: pod.metadata?.namespace || '',
      status: pod.status?.phase || 'Unknown',
      podIP: pod.status?.podIP || '',
      hostIP: pod.status?.hostIP || '',
      containers: (pod.spec?.containers || []).map((c: any) => ({
        name: c.name, image: c.image || '',
        ports: c.ports || [], resources: c.resources || {},
      })),
      containerStatuses: pod.status?.containerStatuses || [],
      labels: pod.metadata?.labels || {},
      conditions: pod.status?.conditions || [],
      createdAt: pod.metadata?.creationTimestamp,
    };
  }

  async getPodLogs(namespace: string, name: string, tail = 100, contextId?: string): Promise<string> {
    const { kc } = this.getClient(contextId || this.contexts.keys().next().value || '');
    const log = new k8s.Log(kc);
    return await log.log(namespace, name, 'all', { tailLines: tail, timestamps: false });
  }

  async deletePod(namespace: string, name: string, contextId?: string): Promise<void> {
    const { coreApi } = this.getClient(contextId || this.contexts.keys().next().value || '');
    await coreApi.deleteNamespacedPod(name, namespace);
    logger.info(`Deleted pod ${namespace}/${name}`);
  }

  async scaleDeployment(namespace: string, name: string, replicas: number, contextId?: string): Promise<void> {
    const { appsApi } = this.getClient(contextId || this.contexts.keys().next().value || '');
    const patch = [{ op: 'replace', path: '/spec/replicas', value: replicas }];
    await appsApi.patchNamespacedDeploymentScale(name, namespace, patch, undefined, undefined, undefined, undefined, {
      headers: { 'Content-Type': 'application/json-patch+json' },
    });
    logger.info(`Scaled deployment ${namespace}/${name} to ${replicas}`);
  }
}

export const kubernetesService = new KubernetesService();
