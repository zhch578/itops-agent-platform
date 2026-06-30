import type { Request, Response } from 'express';
import { Router } from 'express';
import { db } from '../../models/database';
import crypto from 'crypto';

const router = Router();

/**
 * GET /manufacturers — 获取全部制造商列表
 */
router.get('/', (_req: Request, res: Response) => {
  try {
    const list = db.prepare(
      'SELECT * FROM device_manufacturers ORDER BY sort_order, name'
    ).all();
    res.json({ success: true, data: list });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /manufacturers/:id — 获取单个制造商（含设备型号数量）
 */
router.get('/:id', (req: Request, res: Response) => {
  try {
    const mfg = db.prepare('SELECT * FROM device_manufacturers WHERE id = ?').get(req.params.id);
    if (!mfg) return res.status(404).json({ success: false, message: 'Manufacturer not found' });
    const typeCount = db.prepare(
      'SELECT COUNT(*) as cnt FROM device_types WHERE manufacturer_id = ?'
    ).get(req.params.id) as any;
    res.json({ success: true, data: { ...mfg as any, device_type_count: typeCount?.cnt || 0 } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /manufacturers — 创建制造商
 */
router.post('/', (req: Request, res: Response) => {
  try {
    const { name, slug, description, logo_url, sort_order } = req.body;
    if (!name || !slug) return res.status(400).json({ success: false, message: 'name and slug required' });
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO device_manufacturers (id, name, slug, description, logo_url, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name, slug, description || '', logo_url || '', sort_order || 0);
    res.json({ success: true, data: { id } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /manufacturers/:id — 更新制造商
 */
router.put('/:id', (req: Request, res: Response) => {
  try {
    const { name, slug, description, logo_url, sort_order } = req.body;
    db.prepare(`
      UPDATE device_manufacturers
      SET name=?, slug=?, description=?, logo_url=?, sort_order=?,
          updated_at=datetime('now','localtime')
      WHERE id=?
    `).run(name, slug, description || '', logo_url || '', sort_order || 0, req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * DELETE /manufacturers/:id — 删除制造商（有关联设备型号时禁止删除）
 */
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const typeCount = db.prepare(
      'SELECT COUNT(*) as cnt FROM device_types WHERE manufacturer_id = ?'
    ).get(req.params.id) as any;
    if (typeCount?.cnt > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete manufacturer with ${typeCount.cnt} associated device type(s)`
      });
    }
    db.prepare('DELETE FROM device_manufacturers WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
