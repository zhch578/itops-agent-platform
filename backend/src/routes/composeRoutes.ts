import { Router, Request, Response } from 'express';
import { composeService } from '../services/composeService';
import { requireRole } from '../middleware/auth';

const router = Router();

// GET / — 列出所有项目
router.get('/', (_req: Request, res: Response) => {
  try {
    const projects = composeService.listProjects();
    res.json({ success: true, data: projects });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /:id — 获取项目详情
router.get('/:id', (req: Request, res: Response) => {
  try {
    const project = composeService.getProject(req.params.id);
    if (!project) return res.status(404).json({ success: false, message: '项目不存在' });
    res.json({ success: true, data: project });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST / — 创建项目
router.post('/', requireRole('admin', 'operator'), (req: Request, res: Response) => {
  try {
    const { name, composeContent, description, tags } = req.body;
    if (!name || !composeContent) return res.status(400).json({ success: false, message: '名称和compose内容必填' });
    const project = composeService.createProject(name, composeContent, description, tags);
    res.json({ success: true, data: project });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /:id — 更新项目
router.put('/:id', requireRole('admin', 'operator'), (req: Request, res: Response) => {
  try {
    const project = composeService.updateProject(req.params.id, req.body);
    res.json({ success: true, data: project });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /:id — 删除项目
router.delete('/:id', requireRole('admin'), async (req: Request, res: Response) => {
  try {
    await composeService.deleteProject(req.params.id);
    res.json({ success: true, message: '已删除' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /:id/up — 启动项目
router.post('/:id/up', requireRole('admin', 'operator'), async (req: Request, res: Response) => {
  try {
    const output = await composeService.upProject(req.params.id);
    res.json({ success: true, data: { output } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /:id/down — 停止项目
router.post('/:id/down', requireRole('admin', 'operator'), async (req: Request, res: Response) => {
  try {
    const output = await composeService.downProject(req.params.id);
    res.json({ success: true, data: { output } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /:id/restart — 重启项目
router.post('/:id/restart', requireRole('admin', 'operator'), async (req: Request, res: Response) => {
  try {
    const output = await composeService.restartProject(req.params.id);
    res.json({ success: true, data: { output } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /:id/services — 获取服务列表
router.get('/:id/services', async (req: Request, res: Response) => {
  try {
    const services = await composeService.listServices(req.params.id);
    res.json({ success: true, data: services });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /:id/logs — 获取日志
router.get('/:id/logs', async (req: Request, res: Response) => {
  try {
    const tail = parseInt(req.query.tail as string) || 100;
    const logs = await composeService.getLogs(req.params.id, tail);
    res.json({ success: true, data: { logs } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /validate — 验证 docker-compose 语法
router.post('/validate', (req: Request, res: Response) => {
  const { content } = req.body;
  if (!content) return res.status(400).json({ success: false, message: '需要compose内容' });
  composeService.validate(content).then(result => {
    res.json({ success: true, data: result });
  }).catch(err => {
    res.status(500).json({ success: false, message: err.message });
  });
});

export default router;
