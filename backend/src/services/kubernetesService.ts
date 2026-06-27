import { logger } from '../utils/logger';
import { db } from '../models/database';

// Kubernetes 客户端库为可选依赖，运行时按需加载
let k8s: any = null;
try {
  k8s = require('@kubernetes/client-node');
} catch {
  logger.warn('⚠️ @kubernetes/client-node not installed, K8s management disabled. Install with: npm install @kubernetes/client-node');
}

class KubernetesService {
  private kc: any;
  private coreApi: any;
  private appsApi: any;
  private initialized: boolean = false;

  constructor() {
    if (!k8s) {
      this.initialized = false;
      this.initTables();
      return;
    }
    try {
      this.kc = new k8s.KubeConfig();
      this.kc.loadFromDefault();
      this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
      this.appsApi = this.kc.makeApiClient(k8s.AppsV1Api);
      this.initialized = true;
      logger.info('✅ Kubernetes service initialized');
    } catch {
      logger.warn('⚠️ Kubernetes config not found, K8s management disabled');
      this.initialized = false;
    }
    this.initTables();
  }

  private initTables() {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS k8s_contexts (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, cluster_url TEXT,
          namespace TEXT DEFAULT 'default', auth_type TEXT DEFAULT 'kubeconfig',
          config TEXT, status TEXT DEFAULT 'inactive',
          node_count INTEGER DEFAULT 0, pod_count INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now','localtime')),
          updated_at TEXT DEFAULT (datetime('now','localtime'))
        )
      `);
    } catch {}
  }

  isAvailable(): boolean { return this.initialized; }

  async listNamespaces(): Promise<any[]> {
    try {
      const res: any = await this.coreApi.listNamespace();
      return (res.body.items || []).map((ns: any) => ({
        name: ns.metadata?.name || '',
        status: ns.status?.phase || '',
        createdAt: ns.metadata?.creationTimestamp,
      }));
    } catch (err: any) {
      logger.error('K8s listNamespaces error:', err.message);
      throw err;
    }
  }

  async listPods(namespace: string = 'default'): Promise<any[]> {
    try {
      const res: any = await this.coreApi.listNamespacedPod(namespace);
      return (res.body.items || []).map((pod: any) => ({
        name: pod.metadata?.name || '',
        namespace: pod.metadata?.namespace || '',
        status: pod.status?.phase || 'Unknown',
        nodeName: pod.spec?.nodeName || '',
        podIP: pod.status?.podIP || '',
        hostIP: pod.status?.hostIP || '',
        containers: (pod.spec?.containers || []).map((c: any) => ({
          name: c.name,
          image: c.image || '',
          ready: true,
        })),
        containerStatuses: (pod.status?.containerStatuses || []).map((cs: any) => ({
          name: cs.name, ready: cs.ready, restartCount: cs.restartCount,
          state: cs.state ? Object.keys(cs.state)[0] : 'unknown',
        })),
        restartCount: (pod.status?.containerStatuses || []).reduce((sum: number, cs: any) => sum + cs.restartCount, 0),
        totalContainers: (pod.spec?.containers || []).length,
        readyContainers: (pod.status?.containerStatuses || []).filter((cs: any) => cs.ready).length,
        labels: pod.metadata?.labels || {},
        annotations: pod.metadata?.annotations || {},
        conditions: pod.status?.conditions || [],
        createdAt: pod.metadata?.creationTimestamp,
        resources: (pod.spec?.containers || []).map((c: any) => ({
          name: c.name,
          requests: c.resources?.requests || {},
          limits: c.resources?.limits || {},
        })),
      }));
    } catch (err: any) {
      logger.error('K8s listPods error:', err.message);
      throw err;
    }
  }

  async listDeployments(namespace: string = 'default'): Promise<any[]> {
    try {
      const res: any = await this.appsApi.listNamespacedDeployment(namespace);
      return (res.body.items || []).map((deploy: any) => ({
        name: deploy.metadata?.name || '',
        namespace: deploy.metadata?.namespace || '',
        replicas: deploy.spec?.replicas || 0,
        readyReplicas: deploy.status?.readyReplicas || 0,
        availableReplicas: deploy.status?.availableReplicas || 0,
        image: (deploy.spec?.template?.spec?.containers[0]?.image || '').split('/').pop() || '',
        strategy: deploy.spec?.strategy?.type || 'RollingUpdate',
        selector: deploy.spec?.selector?.matchLabels || {},
        conditions: deploy.status?.conditions || [],
        containers: (deploy.spec?.template?.spec?.containers || []).map((c: any) => ({
          name: c.name, image: c.image || '',
        })),
        createdAt: deploy.metadata?.creationTimestamp,
      }));
    } catch (err: any) {
      logger.error('K8s listDeployments error:', err.message);
      throw err;
    }
  }

  async listServices(namespace: string = 'default'): Promise<any[]> {
    try {
      const res: any = await this.coreApi.listNamespacedService(namespace);
      return (res.body.items || []).map((svc: any) => ({
        name: svc.metadata?.name || '',
        namespace: svc.metadata?.namespace || '',
        type: svc.spec?.type || 'ClusterIP',
        clusterIP: svc.spec?.clusterIP || '',
        externalIPs: svc.spec?.externalIPs || [],
        ports: (svc.spec?.ports || []).map((p: any) => ({
          name: p.name || '', port: p.port, targetPort: p.targetPort,
          protocol: p.protocol || 'TCP', nodePort: p.nodePort,
        })),
        selector: svc.spec?.selector || {},
        createdAt: svc.metadata?.creationTimestamp,
      }));
    } catch (err: any) {
      logger.error('K8s listServices error:', err.message);
      throw err;
    }
  }

  async listNodes(): Promise<any[]> {
    try {
      const res: any = await this.coreApi.listNode();
      return (res.body.items || []).map((node: any) => ({
        name: node.metadata?.name || '',
        status: node.status?.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True' ? 'Ready' : 'NotReady',
        roles: (node.metadata?.labels?.['node-role.kubernetes.io/control-plane'] || node.metadata?.labels?.['node-role.kubernetes.io/master']) ? ['control-plane'] : ['worker'],
        version: node.status?.nodeInfo?.kubeletVersion || '',
        os: node.status?.nodeInfo?.osImage || '',
        cpuCapacity: parseInt(node.status?.capacity?.cpu || '0'),
        cpuAllocatable: parseInt(node.status?.allocatable?.cpu || '0'),
        memoryCapacity: parseInt(node.status?.capacity?.memory?.replace('Ki', '') || '0') * 1024,
        memoryAllocatable: parseInt(node.status?.allocatable?.memory?.replace('Ki', '') || '0') * 1024,
        podCapacity: parseInt(node.status?.capacity?.pods || '0'),
        podAllocatable: parseInt(node.status?.allocatable?.pods || '0'),
        podsRunning: 0,
        internalIP: (node.status?.addresses || []).find((a: any) => a.type === 'InternalIP')?.address || '',
        createdAt: node.metadata?.creationTimestamp,
      }));
    } catch (err: any) {
      logger.error('K8s listNodes error:', err.message);
      throw err;
    }
  }

  async getPod(namespace: string, name: string): Promise<any> {
    try {
      const res: any = await this.coreApi.readNamespacedPod(name, namespace);
      const pod = res.body;
      return {
        name: pod.metadata?.name || '',
        namespace: pod.metadata?.namespace || '',
        status: pod.status?.phase || 'Unknown',
        podIP: pod.status?.podIP || '',
        hostIP: pod.status?.hostIP || '',
        containers: (pod.spec?.containers || []).map((c: any) => ({
          name: c.name, image: c.image || '',
          ports: c.ports || [], env: c.env || [],
          resources: c.resources || {}, volumeMounts: c.volumeMounts || [],
        })),
        containerStatuses: pod.status?.containerStatuses || [],
        labels: pod.metadata?.labels || {},
        annotations: pod.metadata?.annotations || {},
        conditions: pod.status?.conditions || [],
        volumes: pod.spec?.volumes || [],
        createdAt: pod.metadata?.creationTimestamp,
      };
    } catch (err: any) {
      logger.error('K8s getPod error:', err.message);
      throw err;
    }
  }

  async deletePod(namespace: string, name: string): Promise<void> {
    try {
      await this.coreApi.deleteNamespacedPod(name, namespace);
      logger.info(`Deleted pod ${namespace}/${name}`);
    } catch (err: any) {
      logger.error('K8s deletePod error:', err.message);
      throw err;
    }
  }

  async scaleDeployment(namespace: string, name: string, replicas: number): Promise<void> {
    try {
      const patch = [{ op: 'replace', path: '/spec/replicas', value: replicas }];
      await this.appsApi.patchNamespacedDeploymentScale(name, namespace, patch, undefined, undefined, undefined, undefined, {
        headers: { 'Content-Type': 'application/json-patch+json' }
      });
      logger.info(`Scaled deployment ${namespace}/${name} to ${replicas}`);
    } catch (err: any) {
      logger.error('K8s scaleDeployment error:', err.message);
      throw err;
    }
  }
}

export const kubernetesService = new KubernetesService();
