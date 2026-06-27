import { Router, Request, Response } from 'express';
import { vmSnapshotSchedulerService } from '../services/vmSnapshotSchedulerService';
import { requireRole } from '../middleware/auth';

const router = Router();

// GET / — 列出所有快照策略
router.get('/', (_req: Request, res: Response) => {
  try {
    const policies = vmSnapshotSchedulerService.listPolicies();
    res.json({ success: true, data: policies });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /:id — 获取策略详情
router.get('/:id', (req: Request, res: Response) => {
  try {
    const policy = vmSnapshotSchedulerService.getPolicy(req.params.id);
    if (!policy) return res.status(404).json({ success: false, message: '策略不存在' });
    res.json({ success: true, data: policy });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST / — 创建策略
router.post('/', requireRole('admin', 'operator'), (req: Request, res: Response) => {
  try {
    const { name, platformId, vmId, cronExpression, retention, snapshotMemory, enabled } = req.body;
    if (!name || !platformId || !vmId || !cronExpression) {
      return res.status(400).json({ success: false, message: '名称、平台ID、虚拟机ID、Cron表达式必填' });
    }
    const policy = vmSnapshotSchedulerService.createPolicy({
      name, platformId, vmId, cronExpression,
      retention: retention || 7,
      snapshotMemory: snapshotMemory !== undefined ? snapshotMemory : true,
      enabled: enabled !== undefined ? enabled : true,
    });
    res.json({ success: true, data: policy });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /:id — 更新策略
router.put('/:id', requireRole('admin', 'operator'), (req: Request, res: Response) => {
  try {
    const policy = vmSnapshotSchedulerService.updatePolicy(req.params.id, req.body);
    res.json({ success: true, data: policy });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /:id — 删除策略
router.delete('/:id', requireRole('admin'), (req: Request, res: Response) => {
  try {
    vmSnapshotSchedulerService.deletePolicy(req.params.id);
    res.json({ success: true, message: '已删除' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
