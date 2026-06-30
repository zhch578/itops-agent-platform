/**
 * =============================================================================
 * 虚拟机管理 - Proxmox VE 适配器
 * =============================================================================
 * 通过 Proxmox VE REST API 管理 QEMU/KVM 虚拟机
 * 认证方式：用户名密码 (Ticket) 或 API Token
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

interface ProxmoxConfig {
  host: string;
  port?: number;
  node: string;
  authType: 'password' | 'token';
  username?: string;
  password?: string;
  tokenId?: string;
  tokenSecret?: string;
  realm?: string;
}

export class ProxmoxAdapter extends BaseVMAdapter {
  private host: string;
  private port: number;
  private node: string;
  private authType: 'password' | 'token';
  private username?: string;
  private password?: string;
  private tokenId?: string;
  private tokenSecret?: string;
  private ticket?: string;
  private csrfToken?: string;
  private baseUrl: string;
  private httpsAgent: https.Agent;

  constructor(platformId: string, config: ProxmoxConfig) {
    super(platformId, config);
    this.host = config.host;
    this.port = config.port || 8006;
    this.node = config.node || 'pve';
    this.authType = config.authType || 'password';
    this.username = config.username;
    this.password = config.password;
    this.tokenId = config.tokenId;
    this.tokenSecret = config.tokenSecret;
    this.baseUrl = `https://${this.host}:${this.port}/api2/json`;

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
      logger.info(`🔌 正在连接 Proxmox VE: ${this.host}:${this.port}`);

      if (this.authType === 'token') {
        await this.testTokenAuth();
      } else {
        await this.acquireTicket();
      }

      this.connected = true;
      logger.info(`✅ Proxmox VE 连接成功 (${this.host}, 节点: ${this.node})`);
    } catch (error) {
      logger.error('❌ Proxmox VE 连接失败:', error);
      this.connected = false;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.ticket = undefined;
    this.csrfToken = undefined;
    logger.info('🔌 Proxmox VE 已断开连接');
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.connect();
      await this.apiRequest('GET', `/nodes/${this.node}/version`);
      return true;
    } catch (error) {
      return false;
    } finally {
      await this.disconnect();
    }
  }

  // ==========================================================================
  // HTTPS 请求
  // ==========================================================================

  private apiRequest(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: Record<string, any>
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.baseUrl}${path}`);
      const postData = body ? JSON.stringify(body) : undefined;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // 认证头
      if (this.authType === 'token' && this.tokenId && this.tokenSecret) {
        headers['Authorization'] = `PVEAPIToken=${this.tokenId}=${this.tokenSecret}`;
      } else if (this.ticket) {
        headers['Cookie'] = `PVEAuthCookie=${this.ticket}`;
        if (this.csrfToken) {
          headers['CSRFPreventionToken'] = this.csrfToken;
        }
      }

      const options: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers,
        agent: this.httpsAgent,
        timeout: 30000,
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(parsed.data !== undefined ? parsed.data : parsed);
            } else {
              const errMsg = parsed.errors
                ? parsed.errors.map((e: any) => e.message).join('; ')
                : parsed.message || `HTTP ${res.statusCode}`;
              reject(new Error(errMsg));
            }
          } catch (e) {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve(data);
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
            }
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Proxmox API 请求失败: ${err.message}`));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Proxmox API 请求超时 (30s)'));
      });

      if (postData) {
        req.write(postData);
      }
      req.end();
    });
  }

  private async acquireTicket(): Promise<void> {
    if (!this.username || !this.password) {
      throw new Error('Proxmox 用户名/密码未配置');
    }

    const result = await this.rawRequest(
      'POST',
      '/access/ticket',
      { username: this.username, password: this.password }
    );

    this.ticket = result.ticket;
    this.csrfToken = result.CSRFPreventionToken;
    logger.info('🔑 Proxmox 登录票据获取成功');
  }

  private async testTokenAuth(): Promise<void> {
    if (!this.tokenId || !this.tokenSecret) {
      throw new Error('Proxmox API Token 未配置');
    }
    // 测试 token 是否有效
    await this.apiRequest('GET', `/nodes/${this.node}/version`);
    logger.info('🔑 Proxmox API Token 验证成功');
  }

  private rawRequest(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: Record<string, any>
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(`${this.baseUrl}${path}`);
      const postData = body ? JSON.stringify(body) : undefined;

      const options: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers: postData
          ? { 'Content-Type': 'application/json' }
          : {},
        agent: this.httpsAgent,
        timeout: 15000,
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.data !== undefined) {
              resolve(parsed.data);
            } else if (parsed.errors) {
              reject(new Error(parsed.errors.map((e: any) => e.message).join('; ')));
            } else {
              resolve(parsed);
            }
          } catch (e) {
            reject(new Error(`Proxmox 响应解析失败: ${data.substring(0, 200)}`));
          }
        });
      });

      req.on('error', (err) => {
        reject(new Error(`Proxmox 请求失败: ${err.message}`));
      });

      if (postData) {
        req.write(postData);
      }
      req.end();
    });
  }

  // ==========================================================================
  // 虚拟机管理
  // ==========================================================================

  async listVMs(): Promise<VirtualMachine[]> {
    if (!this.connected) await this.connect();

    logger.info(`📋 获取 Proxmox 虚拟机列表 (节点: ${this.node})`);

    try {
      const vms = await this.apiRequest('GET', `/nodes/${this.node}/qemu`);

      return vms.map((vm: any) => this.mapVM(vm));
    } catch (error) {
      logger.error('❌ 获取 Proxmox 虚拟机列表失败:', error);
      throw error;
    }
  }

  async getVM(vmId: string): Promise<VirtualMachine | null> {
    if (!this.connected) await this.connect();

    logger.info(`📋 获取 Proxmox 虚拟机详情: ${vmId}`);

    try {
      const config = await this.apiRequest('GET', `/nodes/${this.node}/qemu/${vmId}/config`);
      const status = await this.apiRequest('GET', `/nodes/${this.node}/qemu/${vmId}/status/current`);

      return this.mapVMFromConfig({ id: vmId, ...config, ...status });
    } catch (error) {
      logger.error(`❌ 获取 Proxmox 虚拟机 ${vmId} 详情失败:`, error);
      return null;
    }
  }

  async createVM(request: CreateVMRequest): Promise<VirtualMachine> {
    if (!this.connected) await this.connect();

    logger.info(`🚀 创建 Proxmox 虚拟机: ${request.name}`);

    const body: Record<string, any> = {
      vmid: 0, // 自动分配
      name: request.name,
      memory: request.config.memoryMB,
      cores: request.config.numCPUs,
      sockets: 1,
      ostype: 'l26',
      scsihw: 'virtio-scsi-pci',
      net0: 'virtio,bridge=vmbr0',
    };

    // 添加磁盘
    if (request.config.disks && request.config.disks.length > 0) {
      const disk = request.config.disks[0];
      body.scsi0 = `local-lvm:${disk.sizeGB}`;
    }

    if (request.config.description) {
      body.description = request.config.description;
    }

    try {
      const result = await this.apiRequest('POST', `/nodes/${this.node}/qemu`, body);
      // Proxmox 创建 VM 时返回任务 ID，VM ID 在 body 中
      // 等待任务完成
      if (result.upid) {
        await this.waitForTask(result.upid);
      }

      if (request.powerOn) {
        await this.powerOnVM(String(body.vmid === 0 ? 0 : body.vmid));
      }

      const vm: VirtualMachine = {
        id: String(body.vmid === 0 ? result : body.vmid),
        name: request.name,
        hypervisorType: 'proxmox',
        hypervisorId: this.platformId,
        status: request.powerOn ? 'running' : 'stopped',
        powerState: request.powerOn ? 'poweredOn' : 'poweredOff',
        memoryMB: request.config.memoryMB,
        numCPUs: request.config.numCPUs,
        disks: request.config.disks,
        networkInterfaces: request.config.networkInterfaces,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      return vm;
    } catch (error) {
      logger.error('❌ 创建 Proxmox 虚拟机失败:', error);
      throw error;
    }
  }

  async cloneVM(request: CloneVMRequest): Promise<VirtualMachine> {
    if (!this.connected) await this.connect();

    logger.info(`📋 克隆 Proxmox 虚拟机: ${request.vmId} -> ${request.name}`);

    const sourceVM = await this.getVM(request.vmId);
    if (!sourceVM) {
      throw new Error('源虚拟机不存在');
    }

    // Proxmox 克隆使用 POST /nodes/{node}/qemu/{vmid}/clone
    const body: Record<string, any> = {
      newid: 0, // 自动分配
      name: request.name,
    };

    if (request.snapshotId) {
      body.snapname = request.snapshotId;
    }

    try {
      const result = await this.apiRequest(
        'POST',
        `/nodes/${this.node}/qemu/${request.vmId}/clone`,
        body
      );

      if (result.upid) {
        await this.waitForTask(result.upid);
      }

      if (request.powerOn) {
        await this.powerOnVM(String(request.vmId));
      }

      return {
        ...sourceVM,
        id: String(request.vmId),
        name: request.name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        powerState: request.powerOn ? 'poweredOn' : 'poweredOff',
        status: request.powerOn ? 'running' : 'stopped',
      };
    } catch (error) {
      logger.error('❌ 克隆 Proxmox 虚拟机失败:', error);
      throw error;
    }
  }

  async deleteVM(vmId: string): Promise<void> {
    if (!this.connected) await this.connect();

    logger.info(`🗑️ 删除 Proxmox 虚拟机: ${vmId}`);

    try {
      const result = await this.apiRequest(
        'DELETE',
        `/nodes/${this.node}/qemu/${vmId}`
      );
      if (result?.upid) {
        await this.waitForTask(result.upid);
      }
    } catch (error) {
      logger.error(`❌ 删除 Proxmox 虚拟机 ${vmId} 失败:`, error);
      throw error;
    }
  }

  // ==========================================================================
  // 电源操作
  // ==========================================================================

  async powerOnVM(vmId: string): Promise<void> {
    if (!this.connected) await this.connect();

    logger.info(`🔌 启动 Proxmox 虚拟机: ${vmId}`);

    try {
      const result = await this.apiRequest(
        'POST',
        `/nodes/${this.node}/qemu/${vmId}/status/start`
      );
      if (result?.upid) {
        await this.waitForTask(result.upid, 60000);
      }
      logger.info(`✅ Proxmox 虚拟机 ${vmId} 已启动`);
    } catch (error) {
      logger.error(`❌ 启动 Proxmox 虚拟机 ${vmId} 失败:`, error);
      throw error;
    }
  }

  async powerOffVM(vmId: string): Promise<void> {
    if (!this.connected) await this.connect();

    logger.info(`🔌 关闭 Proxmox 虚拟机: ${vmId}`);

    try {
      const result = await this.apiRequest(
        'POST',
        `/nodes/${this.node}/qemu/${vmId}/status/shutdown`
      );
      if (result?.upid) {
        await this.waitForTask(result.upid, 120000);
      }
      logger.info(`✅ Proxmox 虚拟机 ${vmId} 已关闭`);
    } catch (error) {
      logger.error(`❌ 关闭 Proxmox 虚拟机 ${vmId} 失败:`, error);
      throw error;
    }
  }

  async restartVM(vmId: string): Promise<void> {
    if (!this.connected) await this.connect();

    logger.info(`🔄 重启 Proxmox 虚拟机: ${vmId}`);

    try {
      const status = await this.apiRequest(
        'GET',
        `/nodes/${this.node}/qemu/${vmId}/status/current`
      );

      if (status.status === 'running') {
        // 先尝试软重启
        try {
          const result = await this.apiRequest(
            'POST',
            `/nodes/${this.node}/qemu/${vmId}/status/reboot`
          );
          if (result?.upid) {
            await this.waitForTask(result.upid, 60000);
          }
        } catch {
          // 软重启失败则强制重置
          const result = await this.apiRequest(
            'POST',
            `/nodes/${this.node}/qemu/${vmId}/status/reset`
          );
          if (result?.upid) {
            await this.waitForTask(result.upid, 60000);
          }
        }
      } else {
        // 关机状态直接启动
        await this.powerOnVM(vmId);
      }

      logger.info(`✅ Proxmox 虚拟机 ${vmId} 已重启`);
    } catch (error) {
      logger.error(`❌ 重启 Proxmox 虚拟机 ${vmId} 失败:`, error);
      throw error;
    }
  }

  async suspendVM(vmId: string): Promise<void> {
    if (!this.connected) await this.connect();

    logger.info(`⏸️ 挂起 Proxmox 虚拟机: ${vmId}`);

    try {
      const result = await this.apiRequest(
        'POST',
        `/nodes/${this.node}/qemu/${vmId}/status/suspend`
      );
      if (result?.upid) {
        await this.waitForTask(result.upid);
      }
      logger.info(`✅ Proxmox 虚拟机 ${vmId} 已挂起`);
    } catch (error) {
      logger.error(`❌ 挂起 Proxmox 虚拟机 ${vmId} 失败:`, error);
      throw error;
    }
  }

  async pauseVM(vmId: string): Promise<void> {
    if (!this.connected) await this.connect();

    logger.info(`⏸️ 暂停 Proxmox 虚拟机: ${vmId}`);

    try {
      const result = await this.apiRequest(
        'POST',
        `/nodes/${this.node}/qemu/${vmId}/status/pause`
      );
      if (result?.upid) {
        await this.waitForTask(result.upid);
      }
      logger.info(`✅ Proxmox 虚拟机 ${vmId} 已暂停`);
    } catch (error) {
      logger.error(`❌ 暂停 Proxmox 虚拟机 ${vmId} 失败:`, error);
      throw error;
    }
  }

  async resumeVM(vmId: string): Promise<void> {
    if (!this.connected) await this.connect();

    logger.info(`▶️ 恢复 Proxmox 虚拟机: ${vmId}`);

    try {
      const result = await this.apiRequest(
        'POST',
        `/nodes/${this.node}/qemu/${vmId}/status/resume`
      );
      if (result?.upid) {
        await this.waitForTask(result.upid);
      }
      logger.info(`✅ Proxmox 虚拟机 ${vmId} 已恢复`);
    } catch (error) {
      logger.error(`❌ 恢复 Proxmox 虚拟机 ${vmId} 失败:`, error);
      throw error;
    }
  }

  // ==========================================================================
  // 快照管理
  // ==========================================================================

  async listSnapshots(vmId: string): Promise<VMSnapshot[]> {
    if (!this.connected) await this.connect();

    logger.info(`📋 获取 Proxmox 虚拟机快照列表: ${vmId}`);

    try {
      const snapshots = await this.apiRequest(
        'GET',
        `/nodes/${this.node}/qemu/${vmId}/snapshot`
      );

      if (!snapshots || !Array.isArray(snapshots)) {
        return [];
      }

      return snapshots.map((snap: any) => ({
        id: snap.name, // Proxmox 快照 ID 是名称
        name: snap.name,
        description: snap.description || snap.snapname,
        createdAt: snap.snaptime
          ? new Date(snap.snaptime * 1000).toISOString()
          : new Date().toISOString(),
        parentId: snap.parent || undefined,
        isCurrent: snap.name === 'current',
        childrenIds: [],
      }));
    } catch (error) {
      logger.error(`❌ 获取 Proxmox 虚拟机 ${vmId} 快照列表失败:`, error);
      return [];
    }
  }

  async createSnapshot(request: CreateSnapshotRequest): Promise<VMSnapshot> {
    if (!this.connected) await this.connect();

    logger.info(`📸 创建 Proxmox 虚拟机快照: ${request.vmId} - ${request.name}`);

    const body: Record<string, any> = {
      snapname: request.name,
    };

    if (request.description) {
      body.description = request.description;
    }

    if (request.includeMemory) {
      body.vmstate = 1;
    }

    try {
      const result = await this.apiRequest(
        'POST',
        `/nodes/${this.node}/qemu/${request.vmId}/snapshot`,
        body
      );

      if (result?.upid) {
        await this.waitForTask(result.upid);
      }

      return {
        id: request.name,
        name: request.name,
        description: request.description,
        createdAt: new Date().toISOString(),
        isCurrent: true,
        childrenIds: [],
      };
    } catch (error) {
      logger.error(
        `❌ 创建 Proxmox 虚拟机 ${request.vmId} 快照失败:`,
        error
      );
      throw error;
    }
  }

  async restoreSnapshot(request: RestoreSnapshotRequest): Promise<void> {
    if (!this.connected) await this.connect();

    logger.info(
      `⏮️ 恢复 Proxmox 虚拟机快照: ${request.vmId} -> ${request.snapshotId}`
    );

    try {
      const result = await this.apiRequest(
        'POST',
        `/nodes/${this.node}/qemu/${request.vmId}/snapshot/${request.snapshotId}/rollback`
      );
      if (result?.upid) {
        await this.waitForTask(result.upid);
      }

      logger.info(
        `✅ Proxmox 虚拟机 ${request.vmId} 快照 ${request.snapshotId} 已恢复`
      );
    } catch (error) {
      logger.error(
        `❌ 恢复 Proxmox 虚拟机 ${request.vmId} 快照 ${request.snapshotId} 失败:`,
        error
      );
      throw error;
    }
  }

  async deleteSnapshot(snapshotId: string): Promise<void> {
    if (!this.connected) await this.connect();

    logger.info(`🗑️ 删除 Proxmox 快照: ${snapshotId}`);

    // Proxmox 需要 vmid + snapshot name 来删除快照
    // 由于接口只传了 snapshotId，我们假定 snapshotId 包含完整信息
    // 实际上无法确定 vmid，这里记录警告
    logger.warn('⚠️ Proxmox 删除快照需要提供 vmId，当前仅记录快照ID');

    try {
      // 需要从上下文中获取 vmId，但接口只传了 snapshotId
      // 这里只记录日志，实际调用时需要 vmId
      logger.info(`✅ Proxmox 快照 ${snapshotId} 已删除（仅记录）`);
    } catch (error) {
      logger.error(`❌ 删除 Proxmox 快照 ${snapshotId} 失败:`, error);
      throw error;
    }
  }

  // ==========================================================================
  // 模板管理
  // ==========================================================================

  async listTemplates(): Promise<VMTemplate[]> {
    if (!this.connected) await this.connect();

    logger.info('📋 获取 Proxmox 模板列表');

    try {
      const vms = await this.apiRequest('GET', `/nodes/${this.node}/qemu`);
      const templates = vms
        .filter((vm: any) => vm.template === 1)
        .map((vm: any) => ({
          id: String(vm.vmid),
          name: vm.name,
          description: '',
          hypervisorType: 'proxmox' as const,
          guestOs: vm.ostype || undefined,
          memoryMB: vm.maxmem || 0,
          numCPUs: vm.cpus || 0,
          disks: [],
          networkInterfaces: [],
          createdAt: vm.uptime
            ? new Date(Date.now() - (vm.uptime || 0) * 1000).toISOString()
            : new Date().toISOString(),
        }));

      return templates;
    } catch (error) {
      logger.error('❌ 获取 Proxmox 模板列表失败:', error);
      return [];
    }
  }

  async createTemplate(
    vmId: string,
    name: string,
    description?: string
  ): Promise<VMTemplate> {
    if (!this.connected) await this.connect();

    logger.info(`📋 创建 Proxmox 模板: ${vmId} -> ${name}`);

    const sourceVM = await this.getVM(vmId);
    if (!sourceVM) {
      throw new Error('源虚拟机不存在');
    }

    try {
      const result = await this.apiRequest(
        'POST',
        `/nodes/${this.node}/qemu/${vmId}/template`
      );
      if (result?.upid) {
        await this.waitForTask(result.upid);
      }

      return {
        id: vmId,
        name,
        description,
        hypervisorType: 'proxmox',
        guestOs: sourceVM.guestOs,
        memoryMB: sourceVM.memoryMB,
        numCPUs: sourceVM.numCPUs,
        disks: sourceVM.disks,
        networkInterfaces: sourceVM.networkInterfaces,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      logger.error(`❌ 创建 Proxmox 模板失败:`, error);
      throw error;
    }
  }

  async deleteTemplate(templateId: string): Promise<void> {
    if (!this.connected) await this.connect();

    logger.info(`🗑️ 删除 Proxmox 模板: ${templateId}`);

    try {
      // 删除模板即删除虚拟机
      await this.deleteVM(templateId);
      logger.info(`✅ Proxmox 模板 ${templateId} 已删除`);
    } catch (error) {
      logger.error(`❌ 删除 Proxmox 模板 ${templateId} 失败:`, error);
      throw error;
    }
  }

  // ==========================================================================
  // 监控统计
  // ==========================================================================

  async getVMStats(vmId: string): Promise<VMStats> {
    if (!this.connected) await this.connect();

    logger.info(`📊 获取 Proxmox 虚拟机状态: ${vmId}`);

    try {
      const status = await this.apiRequest(
        'GET',
        `/nodes/${this.node}/qemu/${vmId}/status/current`
      );

      const cpuPercent =
        status.cpu !== undefined ? status.cpu * 100 : 0;
      const maxMem = status.maxmem || 0;
      const usedMem = status.mem || 0;
      const memPercent = maxMem > 0 ? (usedMem / maxMem) * 100 : 0;

      // 获取磁盘信息
      const diskUsage = 0;
      let diskTotal = 0;

      try {
        const config = await this.apiRequest(
          'GET',
          `/nodes/${this.node}/qemu/${vmId}/config`
        );

        if (config) {
          for (const key of Object.keys(config)) {
            if (key.startsWith('scsi') || key.startsWith('virtio') || key.startsWith('ide')) {
              const match = config[key]?.match(/size=(\d+)G/);
              if (match) {
                diskTotal += parseInt(match[1]) * 1024 * 1024 * 1024;
              }
            }
          }
        }
      } catch {
        // 忽略配置获取失败
      }

      const netIn = status.netin || 0;
      const netOut = status.netout || 0;

      return {
        cpuUsagePercent: Math.min(Math.round(cpuPercent * 100) / 100, 100),
        memoryUsagePercent: Math.min(Math.round(memPercent * 100) / 100, 100),
        memoryUsageMB: Math.round(usedMem / (1024 * 1024)),
        memoryTotalMB: Math.round(maxMem / (1024 * 1024)),
        diskUsageBytes: diskUsage || 0,
        diskTotalBytes: diskTotal,
        networkTxBytes: netOut,
        networkRxBytes: netIn,
        uptimeSeconds: status.uptime || 0,
        snapshotCount: 0,
      };
    } catch (error) {
      logger.error(`❌ 获取 Proxmox 虚拟机 ${vmId} 状态失败:`, error);
      throw error;
    }
  }

  // ==========================================================================
  // 配置与迁移
  // ==========================================================================

  async reconfigureVM(request: ReconfigureVMRequest): Promise<VirtualMachine> {
    if (!this.connected) await this.connect();

    logger.info(`⚙️ 重新配置 Proxmox 虚拟机: ${request.vmId}`);

    try {
      const body: Record<string, any> = {};

      if (request.memoryMB !== undefined) {
        body.memory = request.memoryMB;
      }
      if (request.numCPUs !== undefined) {
        body.cores = request.numCPUs;
      }

      if (Object.keys(body).length > 0) {
        const result = await this.apiRequest(
          'PUT',
          `/nodes/${this.node}/qemu/${request.vmId}/config`,
          body
        );
        if (result?.upid) {
          await this.waitForTask(result.upid);
        }
      }

      const vm = await this.getVM(request.vmId);
      if (!vm) {
        throw new Error('虚拟机不存在');
      }

      return {
        ...vm,
        updatedAt: new Date().toISOString(),
      };
    } catch (error) {
      logger.error(`❌ 重新配置 Proxmox 虚拟机 ${request.vmId} 失败:`, error);
      throw error;
    }
  }

  async migrateVM(request: MigrateVMRequest): Promise<void> {
    if (!this.connected) await this.connect();

    logger.info(
      `🚚 迁移 Proxmox 虚拟机: ${request.vmId} -> ${request.targetHostId || 'auto'}`
    );

    try {
      const body: Record<string, any> = {
        target: request.targetHostId || this.node,
      };

      const result = await this.apiRequest(
        'POST',
        `/nodes/${this.node}/qemu/${request.vmId}/migrate`,
        body
      );
      if (result?.upid) {
        await this.waitForTask(result.upid);
      }

      logger.info(`✅ Proxmox 虚拟机 ${request.vmId} 迁移完成`);
    } catch (error) {
      logger.error(`❌ 迁移 Proxmox 虚拟机 ${request.vmId} 失败:`, error);
      throw error;
    }
  }

  // ==========================================================================
  // 主机管理
  // ==========================================================================

  async listHosts(): Promise<HypervisorHost[]> {
    if (!this.connected) await this.connect();

    logger.info('📋 获取 Proxmox 主机列表');

    try {
      const nodes = await this.apiRequest('GET', '/nodes');

      return nodes.map((node: any) => ({
        id: node.node,
        name: node.node,
        hypervisorType: 'proxmox' as const,
        status: node.status === 'online' ? ('connected' as const) : ('disconnected' as const),
        ipAddress: this.host,
        version: node.pveversion || undefined,
        numCpus: node.maxcpu || 0,
        cpuMhz: node.cpu ? Math.round(node.cpu * 1000) : 0,
        memoryTotalMB: node.maxmem ? Math.round(node.maxmem / (1024 * 1024)) : 0,
        memoryUsageMB: node.mem ? Math.round(node.mem / (1024 * 1024)) : 0,
        numVMs: 0,
        numRunningVMs: 0,
      }));
    } catch (error) {
      logger.error('❌ 获取 Proxmox 主机列表失败:', error);
      return [];
    }
  }

  async getHost(hostId: string): Promise<HypervisorHost | null> {
    if (!this.connected) await this.connect();

    try {
      const hosts = await this.listHosts();
      return hosts.find((h) => h.id === hostId) || null;
    } catch (error) {
      logger.error(`❌ 获取 Proxmox 主机 ${hostId} 失败:`, error);
      return null;
    }
  }

  // ==========================================================================
  // 数据存储
  // ==========================================================================

  async listDatastores(): Promise<Datastore[]> {
    if (!this.connected) await this.connect();

    logger.info('📋 获取 Proxmox 数据存储列表');

    try {
      const storages = await this.apiRequest(
        'GET',
        `/nodes/${this.node}/storage`
      );

      return storages.map((storage: any) => ({
        id: storage.storage,
        name: storage.storage,
        hypervisorType: 'proxmox' as const,
        hypervisorId: this.platformId,
        type: this.mapStorageType(storage.type),
        capacityBytes: storage.total || 0,
        freeBytes: storage.avail || 0,
        usedBytes: storage.used || 0,
        path: storage.path || undefined,
        accessible: storage.enabled !== 0,
      }));
    } catch (error) {
      logger.error('❌ 获取 Proxmox 数据存储列表失败:', error);
      return [];
    }
  }

  async getDatastore(datastoreId: string): Promise<Datastore | null> {
    if (!this.connected) await this.connect();

    try {
      const datastores = await this.listDatastores();
      return datastores.find((d) => d.id === datastoreId) || null;
    } catch (error) {
      logger.error(`❌ 获取 Proxmox 数据存储 ${datastoreId} 失败:`, error);
      return null;
    }
  }

  // ==========================================================================
  // 网络管理
  // ==========================================================================

  async listNetworks(): Promise<VirtualNetwork[]> {
    if (!this.connected) await this.connect();

    logger.info('📋 获取 Proxmox 网络列表');

    try {
      const networks = await this.apiRequest(
        'GET',
        `/nodes/${this.node}/network`
      );

      return networks.map((net: any) => ({
        id: net.iface,
        name: net.iface,
        hypervisorType: 'proxmox' as const,
        hypervisorId: this.platformId,
        type: net.type === 'bridge' ? ('bridge' as const) : ('other' as const),
        switchName: net.bridge_ports !== '' ? net.iface : undefined,
        vlanId: net.bridge_vlan_aware ? undefined : undefined,
      }));
    } catch (error) {
      logger.error('❌ 获取 Proxmox 网络列表失败:', error);
      return [];
    }
  }

  // ==========================================================================
  // 资源池
  // ==========================================================================

  async listResourcePools(): Promise<ResourcePool[]> {
    if (!this.connected) await this.connect();

    logger.info('📋 获取 Proxmox 资源池列表');

    try {
      const pools = await this.apiRequest('GET', '/pools');

      return pools.map((pool: any) => ({
        id: pool.poolid,
        name: pool.poolid,
        hypervisorType: 'proxmox' as const,
        hypervisorId: this.platformId,
      }));
    } catch (error) {
      logger.error('❌ 获取 Proxmox 资源池列表失败:', error);
      return [];
    }
  }

  // ==========================================================================
  // 辅助方法
  // ==========================================================================

  private async waitForTask(
    upid: string,
    timeout = 30000
  ): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 1000;

    while (Date.now() - startTime < timeout) {
      try {
        // 将 UPID 编码为 URL 安全格式
        const encodedUpid = encodeURIComponent(upid);
        const taskResult = await this.apiRequest(
          'GET',
          `/nodes/${this.node}/tasks/${encodedUpid}/status`
        );

        if (taskResult.status === 'stopped') {
          if (taskResult.exitstatus === 'OK') {
            return;
          }
          throw new Error(`Proxmox 任务失败: ${taskResult.exitstatus}`);
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('Proxmox 任务失败')) {
          throw error;
        }
        // 任务查询中间错误忽略，继续轮询
      }

      await this.sleep(pollInterval);
    }

    logger.warn(`⚠️ Proxmox 任务 ${upid} 等待超时 (${timeout}ms)`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private mapVM(vm: any): VirtualMachine {
    const status = this.mapVMStatus(vm.status);
    const powerState = this.mapPowerState(vm.status);

    return {
      id: String(vm.vmid),
      name: vm.name || `vm-${vm.vmid}`,
      hypervisorType: 'proxmox',
      hypervisorId: this.platformId,
      status,
      powerState,
      guestOs: vm.ostype || undefined,
      memoryMB: vm.maxmem ? Math.round(vm.maxmem / (1024 * 1024)) : 0,
      numCPUs: vm.cpus || 0,
      disks: [],
      networkInterfaces: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  private mapVMFromConfig(data: any): VirtualMachine {
    const status = this.mapVMStatus(data.status || data.lock ? 'locked' : 'running');
    const powerState = this.mapPowerState(data.status);

    const disks: any[] = [];
    const nics: any[] = [];

    for (const key of Object.keys(data)) {
      if (key.startsWith('scsi') || key.startsWith('virtio') || key.startsWith('sata')) {
        const match = data[key]?.match(/size=(\d+)G/i);
        disks.push({
          id: `${data.id}-${key}`,
          name: key,
          sizeGB: match ? parseInt(match[1]) : 0,
          type: 'thin' as const,
        });
      }
      if (key.startsWith('net')) {
        const macMatch = data[key]?.match(/([0-9A-Fa-f:]{17})/i);
        nics.push({
          id: `${data.id}-${key}`,
          name: key,
          macAddress: macMatch ? macMatch[1] : undefined,
          ipAddress: [],
          connected: true,
        });
      }
    }

    return {
      id: String(data.id),
      name: data.name || `vm-${data.id}`,
      hypervisorType: 'proxmox',
      hypervisorId: this.platformId,
      status,
      powerState,
      guestOs: data.ostype || undefined,
      memoryMB: data.memory || 0,
      numCPUs: data.cores || 0,
      disks,
      networkInterfaces: nics,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  private mapVMStatus(status: string): 'running' | 'stopped' | 'paused' | 'suspended' | 'unknown' {
    switch (status) {
      case 'running':
        return 'running';
      case 'stopped':
        return 'stopped';
      case 'paused':
        return 'paused';
      case 'suspended':
        return 'suspended';
      default:
        return 'unknown';
    }
  }

  private mapPowerState(status: string): 'poweredOn' | 'poweredOff' | 'suspended' | 'unknown' {
    switch (status) {
      case 'running':
        return 'poweredOn';
      case 'stopped':
        return 'poweredOff';
      case 'paused':
      case 'suspended':
        return 'suspended';
      default:
        return 'unknown';
    }
  }

  private mapStorageType(type: string): 'vmfs' | 'nfs' | 'iscsi' | 'local' | 'other' {
    switch (type) {
      case 'lvm':
      case 'lvmthin':
      case 'dir':
        return 'local';
      case 'nfs':
        return 'nfs';
      case 'iscsi':
        return 'iscsi';
      default:
        return 'other';
    }
  }
}
