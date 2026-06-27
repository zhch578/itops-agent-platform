import { Router, Request, Response } from 'express';
import { multiHostDockerService } from '../services/multiHostDockerService';
import { requireRole } from '../middleware/auth';

const router = Router();

// GET / - 列出所有端点
router.get('/', (_req: Request, res: Response) => {
  try {
    const endpoints = multiHostDockerService.listEndpoints();
    res.json({ success: true, data: endpoints });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /:id - 获取端点详情
router.get('/:id', (req: Request, res: Response) => {
  try {
    const endpoint = multiHostDockerService.getEndpoint(req.params.id);
    if (!endpoint) return res.status(404).json({ success: false, message: '端点不存在' });
    res.json({ success: true, data: endpoint });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST / - 添加端点
router.post('/', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const { name, host, port, protocol, tlsCa, tlsCert, tlsKey } = req.body;
    if (!name || !host) return res.status(400).json({ success: false, message: '名称和主机地址必填' });
    
    const endpoint = await multiHostDockerService.addEndpoint({
      name, host, port: port || 2375, protocol: protocol || 'socket',
      tlsCa, tlsCert, tlsKey, status: 'inactive',
      errorMessage: undefined,
    });
    res.json({ success: true, data: endpoint });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /test - 测试连接
router.post('/test', async (req: Request, res: Response) => {
  try {
    const { host, port, protocol } = req.body;
    const result = await multiHostDockerService.testConnection({ host, port, protocol });
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /:id - 更新端点
router.put('/:id', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    const endpoint = await multiHostDockerService.updateEndpoint(req.params.id, req.body);
    res.json({ success: true, data: endpoint });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /:id - 删除端点
router.delete('/:id', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    await multiHostDockerService.deleteEndpoint(req.params.id);
    res.json({ success: true, message: '已删除' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /:id/refresh - 刷新端点信息
router.post('/:id/refresh', requireRole('admin', 'operator'), async (req: Request, res: Response) => {
  try {
    await multiHostDockerService.refreshEndpointInfo(req.params.id);
    const endpoint = multiHostDockerService.getEndpoint(req.params.id);
    res.json({ success: true, data: endpoint });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

export default router;
