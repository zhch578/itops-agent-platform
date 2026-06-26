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
    if (search) { where += ' AND (name LIKE ? OR driver LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    const total = (db.prepare(`SELECT COUNT(*) as count FROM storage_volumes ${where}`).get(...params) as any)?.count || 0;
    const data = db.prepare(`SELECT * FROM storage_volumes ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
    res.json({ success: true, data, total });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /:id
router.get('/:id', (req: Request, res: Response) => {
  try {
    const item = db.prepare('SELECT * FROM storage_volumes WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: '未找到' });
    res.json({ success: true, data: item });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /
router.post('/', (req: Request, res: Response) => {
  try {
    const { name, driver, mount_point, size_gb, host, type, tags } = req.body;
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO storage_volumes (id, name, driver, mount_point, size_gb, host, type, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name || '', driver || 'local', mount_point || '', size_gb || 0, host || '', type || 'docker', JSON.stringify(tags || []));
    res.json({ success: true, data: { id } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /:id
router.put('/:id', (req: Request, res: Response) => {
  try {
    const { name, driver, mount_point, size_gb, used_gb, status, host, type, tags } = req.body;
    db.prepare(`
      UPDATE storage_volumes SET name=?, driver=?, mount_point=?, size_gb=?, used_gb=?, status=?, host=?, type=?, tags=?, updated_at=datetime('now','localtime') WHERE id=?
    `).run(name || '', driver || 'local', mount_point || '', size_gb || 0, used_gb || 0, status || 'available', host || '', type || 'docker', JSON.stringify(tags || []), req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /:id
router.delete('/:id', (req: Request, res: Response) => {
  try {
    db.prepare('DELETE FROM storage_volumes WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /sync — 同步卷列表
router.post('/sync', (req: Request, res: Response) => {
  try {
    const { serverId, volumes } = req.body;
    const mockVols = [
      { name: 'docker-data', driver: 'overlay2', mount_point: '/var/lib/docker', size_gb: 500, used_gb: 320, status: 'in-use', host: `server-${serverId || 'unknown'}`, type: 'docker' },
      { name: 'app-logs', driver: 'local', mount_point: '/var/log/app', size_gb: 200, used_gb: 150, status: 'in-use', host: `server-${serverId || 'unknown'}`, type: 'docker' },
      { name: 'db-backup', driver: 'nfs', mount_point: '/mnt/backup', size_gb: 1000, used_gb: 600, status: 'available', host: `server-${serverId || 'unknown'}`, type: 'nfs' },
    ];
    const list = volumes || mockVols;
    for (const v of list) {
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO storage_volumes (id, name, driver, mount_point, size_gb, used_gb, status, host, type)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, v.name || '', v.driver || 'local', v.mount_point || '', v.size_gb || 0, v.used_gb || 0, v.status || 'available', v.host || '', v.type || 'docker');
    }
    res.json({ success: true, data: { synced: list.length } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
