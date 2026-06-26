/**
 * =============================================================================
 * 虚拟机管理 - API 路由
 * =============================================================================
 */

import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger';
import { vmManagementService } from '../services/vmManagement';
import {
  CreateVMRequest,
  CloneVMRequest,
  CreateSnapshotRequest,
  RestoreSnapshotRequest,
  HypervisorType,
  VMPlatformConfig
} from '../types/vmManagement';

const router = Router();

// ========== 平台管理 ==========

// 获取平台列表
router.get('/platforms', (req: Request, res: Response) => {
  try {
    const platforms = vmManagementService.listPlatformConfigs();
    res.json({ success: true, data: platforms });
  } catch (error) {
    logger.error('❌ 获取平台列表失败:', error);
    res.status(500).json({ success: false, error: '获取平台列表失败' });
  }
});

// 获取单个平台
router.get('/platforms/:platformId', (req: Request, res: Response) => {
  try {
    const platform = vmManagementService.getPlatformConfig(req.params.platformId);
    if (!platform) {
      return res.status(404).json({ success: false, error: '平台不存在' });
    }
    res.json({ success: true, data: platform });
  } catch (error) {
    logger.error('❌ 获取平台详情失败:', error);
    res.status(500).json({ success: false, error: '获取平台详情失败' });
  }
});

// 添加平台
router.post('/platforms', async (req: Request, res: Response) => {
  try {
    const { name, hypervisorType, host, port, username, password, config, tags } = req.body;
    
    if (!name || !hypervisorType || !host) {
      return res.status(400).json({ success: false, error: '缺少必要参数' });
    }
    
    const platformData: Omit<VMPlatformConfig, 'id' | 'createdAt' | 'updatedAt'> = {
      name,
      hypervisorType: hypervisorType as HypervisorType,
      host,
      port: port ? parseInt(port) : undefined,
      username,
      encryptedPassword: password,
      config,
      status: 'inactive',
      tags
    };
    
    const platform = await vmManagementService.addPlatform(platformData);
    res.json({ success: true, data: platform, message: '平台添加成功' });
  } catch (error) {
    logger.error('❌ 添加平台失败:', error);
    res.status(500).json({ success: false, error: '添加平台失败' });
  }
});

// 更新平台
router.put('/platforms/:platformId', async (req: Request, res: Response) => {
  try {
    const { platformId } = req.params;
    const platform = await vmManagementService.updatePlatform(platformId, req.body);
    res.json({ success: true, data: platform, message: '平台更新成功' });
  } catch (error) {
    logger.error('❌ 更新平台失败:', error);
    res.status(500).json({ success: false, error: '更新平台失败' });
  }
});

// 删除平台
router.delete('/platforms/:platformId', async (req: Request, res: Response) => {
  try {
    await vmManagementService.deletePlatform(req.params.platformId);
    res.json({ success: true, message: '平台删除成功' });
  } catch (error) {
    logger.error('❌ 删除平台失败:', error);
    res.status(500).json({ success: false, error: '删除平台失败' });
  }
});

// 测试平台连接
router.post('/platforms/:platformId/test', async (req: Request, res: Response) => {
  try {
    const result = await vmManagementService.testPlatformConnection(req.params.platformId);
    res.json({ success: result.success, message: result.message });
  } catch (error) {
    logger.error('❌ 测试平台连接失败:', error);
    res.status(500).json({ success: false, error: '测试平台连接失败' });
  }
});

// ========== 虚拟机管理 ==========

// 获取虚拟机列表
router.get('/platforms/:platformId/vms', async (req: Request, res: Response) => {
  try {
    const vms = await vmManagementService.listVMs(req.params.platformId);
    res.json({ success: true, data: vms });
  } catch (error) {
    logger.error('❌ 获取虚拟机列表失败:', error);
    res.status(500).json({ success: false, error: '获取虚拟机列表失败' });
  }
});

// 获取单个虚拟机
router.get('/platforms/:platformId/vms/:vmId', async (req: Request, res: Response) => {
  try {
    const vm = await vmManagementService.getVM(req.params.platformId, req.params.vmId);
    if (!vm) {
      return res.status(404).json({ success: false, error: '虚拟机不存在' });
    }
    res.json({ success: true, data: vm });
  } catch (error) {
    logger.error('❌ 获取虚拟机详情失败:', error);
    res.status(500).json({ success: false, error: '获取虚拟机详情失败' });
  }
});

// 创建虚拟机
router.post('/platforms/:platformId/vms', async (req: Request, res: Response) => {
  try {
    const vm = await vmManagementService.createVM(req.params.platformId, req.body as CreateVMRequest);
    res.json({ success: true, data: vm, message: '虚拟机创建成功' });
  } catch (error) {
    logger.error('❌ 创建虚拟机失败:', error);
    res.status(500).json({ success: false, error: '创建虚拟机失败' });
  }
});

// 克隆虚拟机
router.post('/platforms/:platformId/vms/:vmId/clone', async (req: Request, res: Response) => {
  try {
    const cloneRequest: CloneVMRequest = {
      ...req.body,
      vmId: req.params.vmId
    };
    const vm = await vmManagementService.cloneVM(req.params.platformId, cloneRequest);
    res.json({ success: true, data: vm, message: '虚拟机克隆成功' });
  } catch (error) {
    logger.error('❌ 克隆虚拟机失败:', error);
    res.status(500).json({ success: false, error: '克隆虚拟机失败' });
  }
});

// 删除虚拟机
router.delete('/platforms/:platformId/vms/:vmId', async (req: Request, res: Response) => {
  try {
    await vmManagementService.deleteVM(req.params.platformId, req.params.vmId);
    res.json({ success: true, message: '虚拟机删除成功' });
  } catch (error) {
    logger.error('❌ 删除虚拟机失败:', error);
    res.status(500).json({ success: false, error: '删除虚拟机失败' });
  }
});

// 启动虚拟机
router.post('/platforms/:platformId/vms/:vmId/start', async (req: Request, res: Response) => {
  try {
    await vmManagementService.powerOnVM(req.params.platformId, req.params.vmId);
    res.json({ success: true, message: '虚拟机启动成功' });
  } catch (error) {
    logger.error('❌ 启动虚拟机失败:', error);
    res.status(500).json({ success: false, error: '启动虚拟机失败' });
  }
});

// 关闭虚拟机
router.post('/platforms/:platformId/vms/:vmId/stop', async (req: Request, res: Response) => {
  try {
    await vmManagementService.powerOffVM(req.params.platformId, req.params.vmId);
    res.json({ success: true, message: '虚拟机关闭成功' });
  } catch (error) {
    logger.error('❌ 关闭虚拟机失败:', error);
    res.status(500).json({ success: false, error: '关闭虚拟机失败' });
  }
});

// 重启虚拟机
router.post('/platforms/:platformId/vms/:vmId/restart', async (req: Request, res: Response) => {
  try {
    await vmManagementService.restartVM(req.params.platformId, req.params.vmId);
    res.json({ success: true, message: '虚拟机重启成功' });
  } catch (error) {
    logger.error('❌ 重启虚拟机失败:', error);
    res.status(500).json({ success: false, error: '重启虚拟机失败' });
  }
});

// ========== 快照管理 ==========

// 获取快照列表
router.get('/platforms/:platformId/vms/:vmId/snapshots', async (req: Request, res: Response) => {
  try {
    const snapshots = await vmManagementService.listSnapshots(req.params.platformId, req.params.vmId);
    res.json({ success: true, data: snapshots });
  } catch (error) {
    logger.error('❌ 获取快照列表失败:', error);
    res.status(500).json({ success: false, error: '获取快照列表失败' });
  }
});

// 创建快照
router.post('/platforms/:platformId/vms/:vmId/snapshots', async (req: Request, res: Response) => {
  try {
    const snapshotRequest: CreateSnapshotRequest = {
      ...req.body,
      vmId: req.params.vmId
    };
    const snapshot = await vmManagementService.createSnapshot(req.params.platformId, snapshotRequest);
    res.json({ success: true, data: snapshot, message: '快照创建成功' });
  } catch (error) {
    logger.error('❌ 创建快照失败:', error);
    res.status(500).json({ success: false, error: '创建快照失败' });
  }
});

// 恢复快照
router.post('/platforms/:platformId/vms/:vmId/snapshots/:snapshotId/restore', async (req: Request, res: Response) => {
  try {
    const restoreRequest: RestoreSnapshotRequest = {
      ...req.body,
      vmId: req.params.vmId,
      snapshotId: req.params.snapshotId
    };
    await vmManagementService.restoreSnapshot(req.params.platformId, restoreRequest);
    res.json({ success: true, message: '快照恢复成功' });
  } catch (error) {
    logger.error('❌ 恢复快照失败:', error);
    res.status(500).json({ success: false, error: '恢复快照失败' });
  }
});

// 删除快照
router.delete('/platforms/:platformId/vms/:vmId/snapshots/:snapshotId', async (req: Request, res: Response) => {
  try {
    await vmManagementService.deleteSnapshot(req.params.platformId, req.params.snapshotId, req.params.vmId);
    res.json({ success: true, message: '快照删除成功' });
  } catch (error) {
    logger.error('❌ 删除快照失败:', error);
    res.status(500).json({ success: false, error: '删除快照失败' });
  }
});

// ========== 模板管理 ==========

// 获取模板列表
router.get('/platforms/:platformId/templates', async (req: Request, res: Response) => {
  try {
    const templates = await vmManagementService.listTemplates(req.params.platformId);
    res.json({ success: true, data: templates });
  } catch (error) {
    logger.error('❌ 获取模板列表失败:', error);
    res.status(500).json({ success: false, error: '获取模板列表失败' });
  }
});

// 创建模板
router.post('/platforms/:platformId/vms/:vmId/template', async (req: Request, res: Response) => {
  try {
    const template = await vmManagementService.createTemplate(req.params.platformId, req.params.vmId, req.body.name, req.body.description);
    res.json({ success: true, data: template, message: '模板创建成功' });
  } catch (error) {
    logger.error('❌ 创建模板失败:', error);
    res.status(500).json({ success: false, error: '创建模板失败' });
  }
});

// 删除模板
router.delete('/platforms/:platformId/templates/:templateId', async (req: Request, res: Response) => {
  try {
    await vmManagementService.deleteTemplate(req.params.platformId, req.params.templateId);
    res.json({ success: true, message: '模板删除成功' });
  } catch (error) {
    logger.error('❌ 删除模板失败:', error);
    res.status(500).json({ success: false, error: '删除模板失败' });
  }
});

// ========== 监控 ==========

// 获取虚拟机状态
router.get('/platforms/:platformId/vms/:vmId/stats', async (req: Request, res: Response) => {
  try {
    const stats = await vmManagementService.getVMStats(req.params.platformId, req.params.vmId);
    res.json({ success: true, data: stats });
  } catch (error) {
    logger.error('❌ 获取虚拟机状态失败:', error);
    res.status(500).json({ success: false, error: '获取虚拟机状态失败' });
  }
});

// ========== 资源管理 ==========

// 获取主机列表
router.get('/platforms/:platformId/hosts', async (req: Request, res: Response) => {
  try {
    const hosts = await vmManagementService.listHosts(req.params.platformId);
    res.json({ success: true, data: hosts });
  } catch (error) {
    logger.error('❌ 获取主机列表失败:', error);
    res.status(500).json({ success: false, error: '获取主机列表失败' });
  }
});

// 获取数据存储列表
router.get('/platforms/:platformId/datastores', async (req: Request, res: Response) => {
  try {
    const datastores = await vmManagementService.listDatastores(req.params.platformId);
    res.json({ success: true, data: datastores });
  } catch (error) {
    logger.error('❌ 获取数据存储列表失败:', error);
    res.status(500).json({ success: false, error: '获取数据存储列表失败' });
  }
});

// 获取网络列表
router.get('/platforms/:platformId/networks', async (req: Request, res: Response) => {
  try {
    const networks = await vmManagementService.listNetworks(req.params.platformId);
    res.json({ success: true, data: networks });
  } catch (error) {
    logger.error('❌ 获取网络列表失败:', error);
    res.status(500).json({ success: false, error: '获取网络列表失败' });
  }
});

// ========== 审计日志 ==========

// 获取审计日志
router.get('/audit', (req: Request, res: Response) => {
  try {
    const { platformId, vmId, limit } = req.query;
    const logs = vmManagementService.getAuditLogs(
      platformId as string | undefined,
      vmId as string | undefined,
      limit ? parseInt(limit as string) : 100
    );
    res.json({ success: true, data: logs });
  } catch (error) {
    logger.error('❌ 获取审计日志失败:', error);
    res.status(500).json({ success: false, error: '获取审计日志失败' });
  }
});

export default router;
