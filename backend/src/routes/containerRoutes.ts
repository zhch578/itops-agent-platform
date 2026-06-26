import { Router, Request, Response } from 'express';
import { db } from '../models/database';
import crypto from 'crypto';

const router = Router();

// GET /
router.get('/', (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const offset = (page - 1) * pageSize;
    const host = req.query.host as string || '';
    const search = req.query.search as string || '';

    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (host) { where += ' AND host = ?'; params.push(host); }
    if (search) { where += ' AND (name LIKE ? OR image LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    const total = (db.prepare(`SELECT COUNT(*) as count FROM containers ${where}`).get(...params) as any)?.count || 0;
    const data = db.prepare(`SELECT * FROM containers ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
    res.json({ success: true, data, total });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /hosts — 去重主机列表
router.get('/hosts', (_req: Request, res: Response) => {
  try {
    const hosts = db.prepare('SELECT DISTINCT host FROM containers WHERE host != "" ORDER BY host').all();
    res.json({ success: true, data: hosts });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /:id
router.get('/:id', (req: Request, res: Response) => {
  try {
    const item = db.prepare('SELECT * FROM containers WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: '未找到' });
    res.json({ success: true, data: item });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /sync — 从 agent 同步容器列表（模拟）
router.post('/sync', (req: Request, res: Response) => {
  try {
    const { serverId, containers: containerList } = req.body;
    if (!serverId) return res.status(400).json({ success: false, message: '需要 serverId' });

    const mockContainers = [
      { container_id: crypto.randomUUID().slice(0, 12), name: 'nginx-proxy', image: 'nginx:1.25', status: 'running', host: `server-${serverId}`, port_mappings: ['80:80', '443:443'] },
      { container_id: crypto.randomUUID().slice(0, 12), name: 'redis-cache', image: 'redis:7-alpine', status: 'running', host: `server-${serverId}`, port_mappings: ['6379:6379'] },
      { container_id: crypto.randomUUID().slice(0, 12), name: 'postgres-db', image: 'postgres:16', status: 'running', host: `server-${serverId}`, port_mappings: ['5432:5432'] },
    ];

    const list = containerList || mockContainers;
    for (const c of list) {
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT OR REPLACE INTO containers (id, container_id, name, image, status, host, port_mappings)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, c.container_id || id, c.name || 'unknown', c.image || '', c.status || 'unknown', c.host || '', JSON.stringify(c.port_mappings || []));
    }
    res.json({ success: true, data: { synced: list.length } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /:id/start
router.post('/:id/start', (req: Request, res: Response) => {
  try {
    db.prepare("UPDATE containers SET status='running', updated_at=datetime('now','localtime') WHERE id=?").run(req.params.id);
    res.json({ success: true, message: '容器已启动' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /:id/stop
router.post('/:id/stop', (req: Request, res: Response) => {
  try {
    db.prepare("UPDATE containers SET status='stopped', updated_at=datetime('now','localtime') WHERE id=?").run(req.params.id);
    res.json({ success: true, message: '容器已停止' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /:id/restart
router.post('/:id/restart', (req: Request, res: Response) => {
  try {
    db.prepare("UPDATE containers SET status='running', updated_at=datetime('now','localtime') WHERE id=?").run(req.params.id);
    res.json({ success: true, message: '容器已重启' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /:id
router.delete('/:id', (req: Request, res: Response) => {
  try {
    db.prepare('DELETE FROM containers WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
