import { Router, Request, Response } from 'express';
import { dockerService } from '../services/dockerService';
import { requireRole } from '../middleware/auth';
import Docker from 'dockerode';

const router = Router();

// 用于 createContainer/run 操作的 Docker 实例
const docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });

// 检查 Docker 可用性的辅助函数
function checkDockerAvailable(res: Response): boolean {
  if (!dockerService.isAvailable()) {
    res.status(503).json({ success: false, message: 'Docker 服务不可用' });
    return false;
  }
  return true;
}

// GET / — 获取容器列表
router.get('/', async (req: Request, res: Response) => {
  if (!checkDockerAvailable(res)) return;

  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const search = (req.query.search as string || '').toLowerCase();
    const status = (req.query.status as string || '').toLowerCase();

    const allContainers = await dockerService.listContainers(true);

    // 内存分页与过滤
    let filtered = allContainers;
    if (search) {
      filtered = filtered.filter(c =>
        c.name.toLowerCase().includes(search) ||
        c.image.toLowerCase().includes(search)
      );
    }
    if (status) {
      filtered = filtered.filter(c => c.state.toLowerCase() === status);
    }

    const total = filtered.length;
    const offset = (page - 1) * pageSize;
    const data = filtered.slice(offset, offset + pageSize);

    res.json({ success: true, data, total });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /hosts — 主机列表（单 Docker 守护进程）
router.get('/hosts', (_req: Request, res: Response) => {
  if (!checkDockerAvailable(res)) return;

  res.json({ success: true, data: [{ host: 'local', name: 'Docker Host' }] });
});

// GET /logs/:id — 容器日志（必须放在 /:id 之前）
router.get('/logs/:id', async (req: Request, res: Response) => {
  if (!checkDockerAvailable(res)) return;

  try {
    const tail = parseInt(req.query.tail as string) || 100;
    const timestamps = req.query.timestamps !== 'false';

    const logs = await dockerService.getContainerLogs(req.params.id, tail, timestamps);
    res.json({ success: true, data: logs });
  } catch (error: any) {
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, message: error.message });
  }
});

// GET /stats/:id — 容器实时统计（必须放在 /:id 之前）
router.get('/stats/:id', async (req: Request, res: Response) => {
  if (!checkDockerAvailable(res)) return;

  try {
    const stats = await dockerService.getContainerStats(req.params.id);
    res.json({ success: true, data: stats });
  } catch (error: any) {
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, message: error.message });
  }
});

// POST /run — 创建并运行容器（必须放在 /:id 之前）
router.post('/run', requireRole('admin', 'operator'), async (req: Request, res: Response) => {
  if (!checkDockerAvailable(res)) return;

  try {
    const { image, name, ports, env, volumes, restartPolicy, memory, cpuShares } = req.body;
    if (!image) {
      return res.status(400).json({ success: false, message: '缺少镜像名称' });
    }

    // 构建端口映射
    const exposedPorts: Record<string, any> = {};
    const portBindings: Record<string, any> = {};

    if (ports && Array.isArray(ports)) {
      for (const mapping of ports) {
        const [hostPort, containerPort] = String(mapping).split(':');
        if (containerPort) {
          const containerPortKey = `${containerPort}/tcp`;
          exposedPorts[containerPortKey] = {};
          portBindings[containerPortKey] = [{ HostPort: hostPort }];
        }
      }
    }

    // 构建卷绑定
    const binds: string[] = [];
    if (volumes && Array.isArray(volumes)) {
      for (const v of volumes) {
        binds.push(String(v));
      }
    }

    // 构建环境变量
    const envList: string[] = [];
    if (env && Array.isArray(env)) {
      for (const e of env) {
        envList.push(String(e));
      }
    }

    const containerConfig: Docker.ContainerCreateOptions = {
      Image: image,
      name: name || undefined,
      ExposedPorts: Object.keys(exposedPorts).length > 0 ? exposedPorts : undefined,
      Env: envList.length > 0 ? envList : undefined,
      HostConfig: {
        PortBindings: Object.keys(portBindings).length > 0 ? portBindings : undefined,
        Binds: binds.length > 0 ? binds : undefined,
        RestartPolicy: restartPolicy ? { Name: restartPolicy } : undefined,
        Memory: memory || undefined,
        CpuShares: cpuShares || undefined,
      },
    };

    const container = await docker.createContainer(containerConfig);
    await container.start();

    res.json({ success: true, data: { id: container.id, name: name || container.id } });
  } catch (error: any) {
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, message: error.message });
  }
});

// GET /:id — 容器详情
router.get('/:id', async (req: Request, res: Response) => {
  if (!checkDockerAvailable(res)) return;

  try {
    const container = await dockerService.getContainer(req.params.id);
    res.json({ success: true, data: container });
  } catch (error: any) {
    const status = error.statusCode || 404;
    res.status(status).json({ success: false, message: error.message });
  }
});

// POST /:id/start
router.post('/:id/start', requireRole('admin', 'operator'), async (req: Request, res: Response) => {
  if (!checkDockerAvailable(res)) return;

  try {
    await dockerService.startContainer(req.params.id);
    res.json({ success: true, message: '容器已启动' });
  } catch (error: any) {
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, message: error.message });
  }
});

// POST /:id/stop
router.post('/:id/stop', requireRole('admin', 'operator'), async (req: Request, res: Response) => {
  if (!checkDockerAvailable(res)) return;

  try {
    await dockerService.stopContainer(req.params.id);
    res.json({ success: true, message: '容器已停止' });
  } catch (error: any) {
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, message: error.message });
  }
});

// POST /:id/restart
router.post('/:id/restart', requireRole('admin', 'operator'), async (req: Request, res: Response) => {
  if (!checkDockerAvailable(res)) return;

  try {
    await dockerService.restartContainer(req.params.id);
    res.json({ success: true, message: '容器已重启' });
  } catch (error: any) {
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, message: error.message });
  }
});

// DELETE /:id
router.delete('/:id', requireRole('admin', 'operator'), async (req: Request, res: Response) => {
  if (!checkDockerAvailable(res)) return;

  try {
    await dockerService.removeContainer(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, message: error.message });
  }
});

export default router;
