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
    const search = req.query.search as string || '';

    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (search) { where += ' AND (name LIKE ? OR tag LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    const total = (db.prepare(`SELECT COUNT(*) as count FROM container_images ${where}`).get(...params) as any)?.count || 0;
    const data = db.prepare(`SELECT * FROM container_images ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
    res.json({ success: true, data, total });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /:id
router.get('/:id', (req: Request, res: Response) => {
  try {
    const item = db.prepare('SELECT * FROM container_images WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: '未找到' });
    res.json({ success: true, data: item });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /sync — 同步镜像列表（模拟）
router.post('/sync', (req: Request, res: Response) => {
  try {
    const { serverId, images } = req.body;
    const mockImages = [
      { image_id: 'sha256:abc123', name: 'nginx', tag: '1.25', size_bytes: 187000000, host: `server-${serverId || 'unknown'}` },
      { image_id: 'sha256:def456', name: 'redis', tag: '7-alpine', size_bytes: 32000000, host: `server-${serverId || 'unknown'}` },
      { image_id: 'sha256:ghi789', name: 'postgres', tag: '16', size_bytes: 412000000, host: `server-${serverId || 'unknown'}` },
      { image_id: 'sha256:jkl012', name: 'node', tag: '20-alpine', size_bytes: 126000000, host: `server-${serverId || 'unknown'}` },
    ];
    const list = images || mockImages;
    for (const img of list) {
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT OR REPLACE INTO container_images (id, image_id, name, tag, size_bytes, host)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, img.image_id || id, img.name || 'unknown', img.tag || 'latest', img.size_bytes || 0, img.host || '');
    }
    res.json({ success: true, data: { synced: list.length } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /pull — 拉取镜像（模拟）
router.post('/pull', (req: Request, res: Response) => {
  try {
    const { name, tag, serverId } = req.body;
    if (!name) return res.status(400).json({ success: false, message: '需要镜像名称' });

    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO container_images (id, image_id, name, tag, size_bytes, host)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, `sha256:${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`, name, tag || 'latest', Math.floor(Math.random() * 500000000), `server-${serverId || 'unknown'}`);
    res.json({ success: true, data: { id } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /:id
router.delete('/:id', (req: Request, res: Response) => {
  try {
    db.prepare('DELETE FROM container_images WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
