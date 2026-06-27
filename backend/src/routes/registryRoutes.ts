import { Router, Request, Response } from 'express';
import { registryService } from '../services/registryService';
import { requireRole } from '../middleware/auth';

const router = Router();

// GET / — 列出所有仓库
router.get('/', (_req: Request, res: Response) => {
  try {
    const registries = registryService.listRegistries();
    res.json({ success: true, data: registries });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /:id — 获取仓库详情
router.get('/:id', (req: Request, res: Response) => {
  try {
    const registry = registryService.getRegistry(req.params.id);
    if (!registry) return res.status(404).json({ success: false, message: '仓库不存在' });
    res.json({ success: true, data: registry });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST / — 添加仓库
router.post('/', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { name, type, url, username, password } = req.body;
    if (!name || !type || !url) return res.status(400).json({ success: false, message: '名称、类型、地址必填' });
    const registry = await registryService.addRegistry({ name, type, url, username, password });
    res.json({ success: true, data: registry });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /:id — 删除仓库
router.delete('/:id', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    await registryService.deleteRegistry(req.params.id);
    res.json({ success: true, message: '已删除' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /:id/test — 测试连接
router.post('/:id/test', requireRole('admin', 'operator'), async (req: Request, res: Response) => {
  try {
    const result = await registryService.testConnection(req.params.id);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /:id/images — 列出镜像
router.get('/:id/images', async (req: Request, res: Response) => {
  try {
    const project = req.query.project as string;
    const images = await registryService.listImages(req.params.id, project);
    res.json({ success: true, data: images });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
