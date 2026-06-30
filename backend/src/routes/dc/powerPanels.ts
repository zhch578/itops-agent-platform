import type { Request, Response } from 'express';
import { Router } from 'express';
import { db } from '../../models/database';
import crypto from 'crypto';

const router = Router();

/**
 * GET /power-panels — 获取全部配电柜（含关联机房名称）
 */
router.get('/', (_req: Request, res: Response) => {
  try {
    const list = db.prepare(`
      SELECT pp.*, r.name as room_name, r.label as room_label,
        (SELECT COUNT(*) FROM dc_power_feeds WHERE power_panel_id = pp.id) as feed_count
      FROM dc_power_panels pp
      JOIN dc_rooms r ON r.id = pp.room_id
      ORDER BY r.sort_order, pp.sort_order
    `).all();
    res.json({ success: true, data: list });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /power-panels/:id — 单个配电柜详情（含供电线路）
 */
router.get('/:id', (req: Request, res: Response) => {
  try {
    const panel = db.prepare(`
      SELECT pp.*, r.name as room_name FROM dc_power_panels pp
      JOIN dc_rooms r ON r.id = pp.room_id WHERE pp.id = ?
    `).get(req.params.id);
    if (!panel) return res.status(404).json({ success: false, message: 'Power panel not found' });

    const feeds = db.prepare(`
      SELECT pf.*, r.name as rack_name
      FROM dc_power_feeds pf
      LEFT JOIN dc_racks r ON r.id = pf.rack_id
      WHERE pf.power_panel_id = ? ORDER BY pf.name
    `).all(req.params.id);

    res.json({ success: true, data: { ...panel as any, feeds } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /power-panels — 创建配电柜
 */
router.post('/', (req: Request, res: Response) => {
  try {
    const { room_id, name, location_label, panel_type, voltage, amperage, phase_count, description, sort_order } = req.body;
    if (!room_id || !name) return res.status(400).json({ success: false, message: 'room_id and name required' });
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO dc_power_panels (id, room_id, name, location_label, panel_type, voltage, amperage, phase_count, description, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, room_id, name, location_label || '', panel_type || 'rpp', voltage || 220, amperage || 63, phase_count || 3, description || '', sort_order || 0);
    res.json({ success: true, data: { id } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /power-panels/:id — 更新配电柜
 */
router.put('/:id', (req: Request, res: Response) => {
  try {
    const { name, location_label, panel_type, voltage, amperage, phase_count, description, sort_order } = req.body;
    db.prepare(`
      UPDATE dc_power_panels SET name=?, location_label=?, panel_type=?, voltage=?, amperage=?,
        phase_count=?, description=?, sort_order=?, updated_at=datetime('now','localtime')
      WHERE id=?
    `).run(name, location_label || '', panel_type || 'rpp', voltage || 220, amperage || 63,
      phase_count || 3, description || '', sort_order || 0, req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * DELETE /power-panels/:id — 删除配电柜（有关联馈线时禁止）
 */
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const cnt = db.prepare('SELECT COUNT(*) as cnt FROM dc_power_feeds WHERE power_panel_id = ?').get(req.params.id) as any;
    if (cnt?.cnt > 0) {
      return res.status(409).json({ success: false, message: `Cannot delete: ${cnt.cnt} power feed(s) still reference this panel` });
    }
    db.prepare('DELETE FROM dc_power_panels WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
