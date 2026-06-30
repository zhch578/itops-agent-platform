/**
 * =============================================================================
 * 虚拟机管理 - VMware vSphere REST API 适配器
 * =============================================================================
 * 通过 vSphere REST API (非 SOAP) 管理 ESXi / vCenter 虚拟机
 * 认证: POST /rest/com/vmware/cis/session 获取 session-id
 */

import https from 'https';
import { BaseVMAdapter } from './vmAdapter';
import type {
  VirtualMachine,
  VMStats,
  VMSnapshot,
  VMTemplate,
  HypervisorHost,
  Datastore,
  VirtualNetwork,
  ResourcePool,
  CreateVMRequest,
  CloneVMRequest,
  CreateSnapshotRequest,
  RestoreSnapshotRequest,
  MigrateVMRequest,
  ReconfigureVMRequest,
} from '../../../../types/vmManagement';
import { logger } from '../../../../utils/logger';

export class VMwareAdapter extends BaseVMAdapter {
  private host: string;
  private port: number;
  private username: string;
  private password: string;
  private sessionId?: string;
  private baseUrl: string;
  private httpsAgent: https.Agent;

  constructor(platformId: string, config: any) {
    super(platformId, config);
    this.host = config.host || config.baseUrl || '';
    this.port = config.port || 443;
    this.username = config.username || '';
    this.password = config.password || '';
    this.baseUrl = this.host.startsWith('https://')
      ? this.host
      : `https://${this.host}:${this.port}`;

    this.httpsAgent = new https.Agent({
      rejectUnauthorized: false,
      keepAlive: true,
    });
  }

  // ==========================================================================
  // 连接管理
  // ==========================================================================

  async connect(): Promise<void> {
    try {
      logger.info(`🔌 正在连接 VMware vSphere: ${this.baseUrl}`);

      if (!this.username || !this.password) {
        throw new Error('VMware vSphere 用户名/密码未配置');
      }

      const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');
      const result = await this.apiRequest(
        'POST',
        '/rest/com/vmware/cis/session',
        null,
        { Authorization: `Basic ${auth}` }
      );

      if (result?.value) {
        this.sessionId = result.value;
        this.connected = true;
        logger.info(`✅ VMware vSphere 会话已建立 (${this.host})`);
      } else {
        throw new Error('获取 vSphere session-id 失败');
      }
    } catch (error) {
      logger.error('❌ VMware vSphere 连接失败:', error);
      this.connected = false;
      this.sessionId = undefined;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.sessionId) {
      try {
        await this.apiRequest('DELETE', '/rest/com/vmware/cis/session');
      } catch {
        // 忽略
      }
    }
    this.connected = false;
    this.sessionId = undefined;
    logger.info('🔌 VMware vSphere 已断开连接');
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.connect();
      await this.apiRequest('GET', '/rest/vcenter/vm');
      return true;
    } catch {
      return false;
    } finally {
      await this.disconnect();
    }
  }

  // ==========================================================================
  // HTTPS 请求
  // ==========================================================================

  private apiRequest(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    path: string,
    body?: Record<string, any> | null,
    extraHeaders?: Record<string, string>
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const urlObj = new URL(`${this.baseUrl}${path}`);
      const isBody = body && method !== 'GET';
      const bodyStr = isBody ? JSON.stringify(body) : undefined;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };

      if (this.sessionId) {
        headers['vmware-api-session-id'] = this.sessionId;
      }

      if (extraHeaders) {
        Object.assign(headers, extraHeaders);
      }

      const options: https.RequestOptions = {
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: urlObj.pathname + urlObj.search,
        method,
        headers,
        agent: this.httpsAgent,
        timeout: 30000,
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          try {
            if (res.statusCode === 204 || data.length === 0) {
              resolve(null); return;
            }
            const parsed = JSON.parse(data);
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed);
            } else {
              reject(new Error(parsed.value?.messages?.[0]?.default_message || `HTTP ${res.statusCode}`));
            }
          } catch {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(data);
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
            }
          }
        });
      });

      req.on('error', (err) => reject(new Error(`VMware API 请求失败: ${err.message}`)));
      req.on('timeout', () => { req.destroy(); reject(new Error('VMware API 请求超时 (30s)')); });
      if (bodyStr) req.write(bodyStr);
      req.end();
    });
  }

  // ==========================================================================
  // 虚拟机管理
  // ==========================================================================

  async listVMs(): Promise<VirtualMachine[]> {
    if (!this.connected) await this.connect();
    logger.info('📋 获取 VMware 虚拟机列表');
    try {
      const result = await this.apiRequest('GET', '/rest/vcenter/vm');
      if (!result?.value || !Array.isArray(result.value)) return [];
      const vms = await Promise.all(
        result.value.map(async (s: any) => {
          try {
            const d = await this.apiRequest('GET', `/rest/vcenter/vm/${s.vm}`);
            return this.mapVM(s.vm, d?.value || s);
          } catch {
            return this.mapVM(s.vm, s);
          }
        })
      );
      return vms;
    } catch (error) {
      logger.error('❌ 获取 VMware 虚拟机列表失败:', error);
      throw error;
    }
  }

  async getVM(vmId: string): Promise<VirtualMachine | null> {
    if (!this.connected) await this.connect();
    try {
      const detail = await this.apiRequest('GET', `/rest/vcenter/vm/${vmId}`);
      if (!detail?.value) return null;
      return this.mapVM(vmId, detail.value);
    } catch (error) {
      logger.error(`❌ 获取 VMware 虚拟机 ${vmId} 详情失败:`, error);
      return null;
    }
  }

  async createVM(request: CreateVMRequest): Promise<VirtualMachine> {
    if (!this.connected) await this.connect();
    const body: Record<string, any> = {
      spec: {
        name: request.name,
        guest_OS: 'OTHER_LINUX_64',
        memory: { size_MiB: request.config.memoryMB },
        cpu: { count: request.config.numCPUs },
        boot: { type: 'BIOS' },
      },
    };
    if (request.datastoreId) body.spec.placement = { datastore: request.datastoreId };
    try {
      const result = await this.apiRequest('POST', '/rest/vcenter/vm', body);
      if (!result?.value) throw new Error('创建虚拟机失败：未返回 VM ID');
      if (request.powerOn) {
        try { await this.powerOnVM(result.value); } catch (e) { logger.warn('⚠️ 创建后启动失败:', e); }
      }
      return {
        id: result.value, name: request.name, hypervisorType: 'vmware', hypervisorId: this.platformId,
        status: request.powerOn ? 'running' : 'stopped',
        powerState: request.powerOn ? 'poweredOn' : 'poweredOff',
        memoryMB: request.config.memoryMB, numCPUs: request.config.numCPUs,
        disks: request.config.disks, networkInterfaces: request.config.networkInterfaces,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('❌ 创建 VMware 虚拟机失败:', error);
      throw error;
    }
  }

  async cloneVM(request: CloneVMRequest): Promise<VirtualMachine> {
    if (!this.connected) await this.connect();
    const sourceVM = await this.getVM(request.vmId);
    if (!sourceVM) throw new Error('源虚拟机不存在');
    try {
      const result = await this.apiRequest('POST', '/rest/vcenter/vm?action=clone', {
        spec: { name: request.name, source: request.vmId },
      });
      if (!result?.value) throw new Error('克隆失败：未返回 VM ID');
      if (request.powerOn) {
        try { await this.powerOnVM(result.value); } catch { logger.warn('⚠️ 克隆后启动失败'); }
      }
      return {
        ...sourceVM, id: result.value, name: request.name,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        powerState: request.powerOn ? 'poweredOn' : 'poweredOff',
        status: request.powerOn ? 'running' : 'stopped',
      };
    } catch (error) {
      logger.error('❌ 克隆 VMware 虚拟机失败:', error);
      throw error;
    }
  }

  async deleteVM(vmId: string): Promise<void> {
    if (!this.connected) await this.connect();
    try {
      await this.apiRequest('DELETE', `/rest/vcenter/vm/${vmId}`);
    } catch (error) {
      logger.error(`❌ 删除 VMware 虚拟机 ${vmId} 失败:`, error);
      throw error;
    }
  }

  // ==========================================================================
  // 电源操作
  // ==========================================================================

  async powerOnVM(vmId: string): Promise<void> {
    if (!this.connected) await this.connect();
    await this.apiRequest('POST', `/rest/vcenter/vm/${vmId}/power/start`);
  }

  async powerOffVM(vmId: string): Promise<void> {
    if (!this.connected) await this.connect();
    await this.apiRequest('POST', `/rest/vcenter/vm/${vmId}/power/stop`);
  }

  async restartVM(vmId: string): Promise<void> {
    if (!this.connected) await this.connect();
    await this.apiRequest('POST', `/rest/vcenter/vm/${vmId}/power/reset`);
  }

  async suspendVM(vmId: string): Promise<void> {
    if (!this.connected) await this.connect();
    await this.apiRequest('POST', `/rest/vcenter/vm/${vmId}/power/suspend`);
  }

  async pauseVM(vmId: string): Promise<void> {
    await this.suspendVM(vmId);
  }

  async resumeVM(vmId: string): Promise<void> {
    await this.powerOnVM(vmId);
  }

  // ==========================================================================
  // 快照管理
  // ==========================================================================

  async listSnapshots(vmId: string): Promise<VMSnapshot[]> {
    if (!this.connected) await this.connect();
    try {
      const result = await this.apiRequest('GET', `/rest/vcenter/vm/${vmId}/snapshots`);
      if (!result?.value || !Array.isArray(result.value)) return [];
      return result.value.map((s: any) => ({
        id: s.snapshot, name: s.name || s.snapshot,
        description: s.description || '', createdAt: s.creation_date || new Date().toISOString(),
        isCurrent: s.state === 'active', parentId: undefined, childrenIds: [],
      }));
    } catch (error) {
      logger.error(`❌ 获取 VMware 快照列表(${vmId})失败:`, error);
      return [];
    }
  }

  async createSnapshot(request: CreateSnapshotRequest): Promise<VMSnapshot> {
    if (!this.connected) await this.connect();
    try {
      const result = await this.apiRequest('POST', `/rest/vcenter/vm/${request.vmId}/snapshots`, {
        name: request.name, description: request.description || '',
        memory: request.includeMemory !== false,
      });
      return {
        id: result?.value || `snap-${Date.now()}`, name: request.name,
        description: request.description || '', createdAt: new Date().toISOString(),
        isCurrent: true, childrenIds: [],
      };
    } catch (error) {
      logger.error(`❌ 创建 VMware 快照(${request.vmId})失败:`, error);
      throw error;
    }
  }

  async restoreSnapshot(request: RestoreSnapshotRequest): Promise<void> {
    if (!this.connected) await this.connect();
    await this.apiRequest(
      'POST',
      `/rest/vcenter/vm/${request.vmId}/snapshots/${request.snapshotId}?action=restore`
    );
  }

  async deleteSnapshot(snapshotId: string): Promise<void> {
    if (!this.connected) await this.connect();
    const vms = await this.listVMs();
    for (const vm of vms) {
      const snaps = await this.listSnapshots(vm.id);
      if (snaps.some((s) => s.id === snapshotId)) {
        await this.apiRequest('DELETE', `/rest/vcenter/vm/${vm.id}/snapshots/${snapshotId}`);
        return;
      }
    }
    logger.warn(`⚠️ 未找到 VMware 快照 ${snapshotId}`);
  }

  // ==========================================================================
  // 模板管理
  // ==========================================================================

  async listTemplates(): Promise<VMTemplate[]> {
    if (!this.connected) await this.connect();
    try {
      const result = await this.apiRequest('GET', '/rest/vcenter/vm-template');
      if (!result?.value || !Array.isArray(result.value)) return [];
      return result.value.map((t: any) => ({
        id: t.template, name: t.name, description: t.description || '',
        hypervisorType: 'vmware' as const, guestOs: t.guest_OS || undefined,
        memoryMB: t.memory_size_MiB || 0, numCPUs: t.cpu_count || 0,
        disks: [], networkInterfaces: [], createdAt: new Date().toISOString(),
      }));
    } catch (error) {
      logger.error('❌ 获取 VMware 模板列表失败:', error);
      return [];
    }
  }

  async createTemplate(vmId: string, name: string, description?: string): Promise<VMTemplate> {
    if (!this.connected) await this.connect();
    const sourceVM = await this.getVM(vmId);
    if (!sourceVM) throw new Error('源虚拟机不存在');
    try {
      const result = await this.apiRequest('POST', '/rest/vcenter/vm-template', {
        spec: { source_vm: vmId, name, description: description || '' },
      });
      return {
        id: result?.value || vmId, name, description,
        hypervisorType: 'vmware', guestOs: sourceVM.guestOs,
        memoryMB: sourceVM.memoryMB, numCPUs: sourceVM.numCPUs,
        disks: sourceVM.disks, networkInterfaces: sourceVM.networkInterfaces,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      logger.error('❌ 创建 VMware 模板失败:', error);
      throw error;
    }
  }

  async deleteTemplate(templateId: string): Promise<void> {
    if (!this.connected) await this.connect();
    await this.apiRequest('DELETE', `/rest/vcenter/vm-template/${templateId}`);
  }

  // ==========================================================================
  // 监控统计
  // ==========================================================================

  async getVMStats(vmId: string): Promise<VMStats> {
    if (!this.connected) await this.connect();
    const detail = await this.apiRequest('GET', `/rest/vcenter/vm/${vmId}`);
    const vm = detail?.value || {};
    const memSize = vm.memory?.size_MiB || 0;
    const memPct = vm.memory?.usage_percent || 0;
    return {
      cpuUsagePercent: vm.cpu?.usage_percent || 0,
      memoryUsagePercent: memPct,
      memoryUsageMB: Math.round((memSize * memPct) / 100),
      memoryTotalMB: memSize,
      diskUsageBytes: 0, diskTotalBytes: 0,
      networkTxBytes: 0, networkRxBytes: 0,
      uptimeSeconds: 0, snapshotCount: 0,
    };
  }

  // ==========================================================================
  // 配置与迁移
  // ==========================================================================

  async reconfigureVM(request: ReconfigureVMRequest): Promise<VirtualMachine> {
    if (!this.connected) await this.connect();
    const spec: Record<string, any> = {};
    if (request.memoryMB !== undefined) spec.memory = { size_MiB: request.memoryMB };
    if (request.numCPUs !== undefined) spec.cpu = { count: request.numCPUs };
    if (Object.keys(spec).length > 0) {
      await this.apiRequest('PATCH', `/rest/vcenter/vm/${request.vmId}`, { spec });
    }
    const vm = await this.getVM(request.vmId);
    if (!vm) throw new Error('虚拟机不存在');
    return { ...vm, updatedAt: new Date().toISOString() };
  }

  async migrateVM(request: MigrateVMRequest): Promise<void> {
    if (!this.connected) await this.connect();
    await this.apiRequest('POST', `/rest/vcenter/vm/${request.vmId}?action=migrate`, {
      spec: {
        host: request.targetHostId || undefined,
        datastore: request.targetDatastoreId || undefined,
      },
    });
  }

  // ==========================================================================
  // 主机管理
  // ==========================================================================

  async listHosts(): Promise<HypervisorHost[]> {
    if (!this.connected) await this.connect();
    try {
      const result = await this.apiRequest('GET', '/rest/vcenter/host');
      if (!result?.value || !Array.isArray(result.value)) return [];
      return result.value.map((h: any) => ({
        id: h.host, name: h.name, hypervisorType: 'vmware' as const,
        status: h.connection_state === 'CONNECTED' ? ('connected' as const) : ('disconnected' as const),
        ipAddress: '', numCpus: 0, cpuMhz: 0, memoryTotalMB: 0, memoryUsageMB: 0,
        numVMs: 0, numRunningVMs: 0, version: undefined,
      }));
    } catch (error) {
      logger.error('❌ 获取 VMware 主机列表失败:', error);
      return [];
    }
  }

  async getHost(hostId: string): Promise<HypervisorHost | null> {
    const hosts = await this.listHosts();
    return hosts.find((h) => h.id === hostId) || null;
  }

  // ==========================================================================
  // 数据存储
  // ==========================================================================

  async listDatastores(): Promise<Datastore[]> {
    if (!this.connected) await this.connect();
    try {
      const result = await this.apiRequest('GET', '/rest/vcenter/datastore');
      if (!result?.value || !Array.isArray(result.value)) return [];
      return result.value.map((ds: any) => ({
        id: ds.datastore, name: ds.name, hypervisorType: 'vmware' as const, hypervisorId: this.platformId,
        type: ds.type === 'NFS' ? ('nfs' as const) : ('vmfs' as const),
        capacityBytes: ds.capacity || 0, freeBytes: ds.free_space || 0,
        usedBytes: (ds.capacity || 0) - (ds.free_space || 0),
        accessible: ds.accessible !== false,
      }));
    } catch (error) {
      logger.error('❌ 获取 VMware 数据存储列表失败:', error);
      return [];
    }
  }

  async getDatastore(datastoreId: string): Promise<Datastore | null> {
    const datastores = await this.listDatastores();
    return datastores.find((d) => d.id === datastoreId) || null;
  }

  // ==========================================================================
  // 网络管理
  // ==========================================================================

  async listNetworks(): Promise<VirtualNetwork[]> {
    if (!this.connected) await this.connect();
    try {
      const result = await this.apiRequest('GET', '/rest/vcenter/network');
      if (!result?.value || !Array.isArray(result.value)) return [];
      return result.value.map((net: any) => ({
        id: net.network, name: net.name, hypervisorType: 'vmware' as const, hypervisorId: this.platformId,
        type: net.type === 'DISTRIBUTED_PORTGROUP' ? ('distributed' as const) : ('standard' as const),
      }));
    } catch (error) {
      logger.error('❌ 获取 VMware 网络列表失败:', error);
      return [];
    }
  }

  // ==========================================================================
  // 资源池
  // ==========================================================================

  async listResourcePools(): Promise<ResourcePool[]> {
    if (!this.connected) await this.connect();
    try {
      const result = await this.apiRequest('GET', '/rest/vcenter/resource-pool');
      if (!result?.value || !Array.isArray(result.value)) return [];
      return result.value.map((rp: any) => ({
        id: rp.resource_pool, name: rp.name, hypervisorType: 'vmware' as const, hypervisorId: this.platformId,
      }));
    } catch (error) {
      logger.error('❌ 获取 VMware 资源池列表失败:', error);
      return [];
    }
  }

  // ==========================================================================
  // 辅助映射
  // ==========================================================================

  private mapVM(vmId: string, vm: any): VirtualMachine {
    const ps = vm.power_state;
    let powerState: 'poweredOn' | 'poweredOff' | 'suspended' | 'unknown' = 'unknown';
    let status: 'running' | 'stopped' | 'paused' | 'suspended' | 'unknown' = 'unknown';
    switch (ps) {
      case 'POWERED_ON': powerState = 'poweredOn'; status = 'running'; break;
      case 'POWERED_OFF': powerState = 'poweredOff'; status = 'stopped'; break;
      case 'SUSPENDED': powerState = 'suspended'; status = 'suspended'; break;
    }
    return {
      id: vmId, name: vm.name || `vm-${vmId}`,
      hypervisorType: 'vmware', hypervisorId: this.platformId,
      status, powerState, guestOs: vm.guest_OS || undefined,
      memoryMB: vm.memory?.size_MiB || 0, numCPUs: vm.cpu?.count || 0,
      disks: [], networkInterfaces: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
  }
}
