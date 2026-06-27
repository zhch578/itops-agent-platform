import { Router, Request, Response } from 'express';
import { kubernetesService } from '../services/kubernetesService';
import { requireRole } from '../middleware/auth';

const router = Router();

router.get('/namespaces', async (_req: Request, res: Response) => {
  try {
    if (!kubernetesService.isAvailable()) return res.status(503).json({ success: false, message: 'K8s 不可用' });
    const data = await kubernetesService.listNamespaces();
    res.json({ success: true, data });
  } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/pods', async (req: Request, res: Response) => {
  try {
    if (!kubernetesService.isAvailable()) return res.status(503).json({ success: false, message: 'K8s 不可用' });
    const ns = (req.query.namespace as string) || 'default';
    const data = await kubernetesService.listPods(ns);
    res.json({ success: true, data });
  } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/deployments', async (req: Request, res: Response) => {
  try {
    if (!kubernetesService.isAvailable()) return res.status(503).json({ success: false, message: 'K8s 不可用' });
    const ns = (req.query.namespace as string) || 'default';
    const data = await kubernetesService.listDeployments(ns);
    res.json({ success: true, data });
  } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/services', async (req: Request, res: Response) => {
  try {
    if (!kubernetesService.isAvailable()) return res.status(503).json({ success: false, message: 'K8s 不可用' });
    const ns = (req.query.namespace as string) || 'default';
    const data = await kubernetesService.listServices(ns);
    res.json({ success: true, data });
  } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/nodes', async (_req: Request, res: Response) => {
  try {
    if (!kubernetesService.isAvailable()) return res.status(503).json({ success: false, message: 'K8s 不可用' });
    const data = await kubernetesService.listNodes();
    res.json({ success: true, data });
  } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
});

router.get('/pods/:namespace/:name', async (req: Request, res: Response) => {
  try {
    if (!kubernetesService.isAvailable()) return res.status(503).json({ success: false, message: 'K8s 不可用' });
    const data = await kubernetesService.getPod(req.params.namespace, req.params.name);
    res.json({ success: true, data });
  } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
});

router.delete('/pods/:namespace/:name', requireRole('admin', 'operator'), async (req: Request, res: Response) => {
  try {
    if (!kubernetesService.isAvailable()) return res.status(503).json({ success: false, message: 'K8s 不可用' });
    await kubernetesService.deletePod(req.params.namespace, req.params.name);
    res.json({ success: true, message: 'Pod 已删除' });
  } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/deployments/:namespace/:name/scale', requireRole('admin', 'operator'), async (req: Request, res: Response) => {
  try {
    if (!kubernetesService.isAvailable()) return res.status(503).json({ success: false, message: 'K8s 不可用' });
    const { replicas } = req.body;
    if (!replicas) return res.status(400).json({ success: false, message: '需要副本数' });
    await kubernetesService.scaleDeployment(req.params.namespace, req.params.name, replicas);
    res.json({ success: true, message: `已扩缩容到 ${replicas} 副本` });
  } catch (err: any) { res.status(500).json({ success: false, message: err.message }); }
});

export default router;
