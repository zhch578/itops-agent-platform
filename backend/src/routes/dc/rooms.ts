import type { Request, Response } from 'express';
import { Router } from 'express';
import { db } from '../../models/database';
import crypto from 'crypto';

const router = Router();

// GET /rooms — 机房列表
router.get('/', (_req: Request, res: Response) => {
  try {
    const rooms = db.prepare('SELECT * FROM dc_rooms ORDER BY sort_order').all();
    res.json({ success: true, data: rooms });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /rooms — 创建机房
router.post('/', (req: Request, res: Response) => {
  try {
    const { name, label, description, width_m, depth_m, sort_order } = req.body;
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO dc_rooms (id, name, label, description, width_m, depth_m, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, label || '', description || '', width_m || 20, depth_m || 15, sort_order || 0);
    res.json({ success: true, data: { id } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /rooms/:id — 更新机房
router.put('/:id', (req: Request, res: Response) => {
  try {
    const { name, label, description, width_m, depth_m, layout_config, sort_order } = req.body;
    db.prepare(`
      UPDATE dc_rooms
      SET name=?, label=?, description=?, width_m=?, depth_m=?,
          layout_config=?, sort_order=?, updated_at=datetime('now','localtime')
      WHERE id=?
    `).run(name, label || '', description || '', width_m || 20, depth_m || 15,
      layout_config || '{}', sort_order || 0, req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /rooms/:id — 删除机房
router.delete('/:id', (req: Request, res: Response) => {
  try {
    db.prepare('DELETE FROM dc_rooms WHERE id = ?').run(req.params.id);
    db.prepare('DELETE FROM dc_racks WHERE room_id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
