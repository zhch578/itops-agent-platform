import type { Request, Response } from 'express';
import { Router } from 'express';
import { db } from '../../models/database';
import crypto from 'crypto';

const router = Router();

// GET /racks — 机柜列表（可按机房/状态/搜索筛选）
router.get('/', (req: Request, res: Response) => {
  try {
    const roomId = (req.query.room_id as string) || '';
    const status = (req.query.status as string) || '';
    const search = (req.query.search as string) || '';
    let query = `
      SELECT r.*, rm.name as room_name, rm.label as room_label,
        (SELECT COUNT(*) FROM dc_rack_slots WHERE rack_id = r.id) as device_count,
        (SELECT IFNULL(SUM(used_u), 0) FROM (
          SELECT (end_u - start_u + 1) as used_u FROM dc_rack_slots WHERE rack_id = r.id
        )) as used_u
      FROM dc_racks r
      LEFT JOIN dc_rooms rm ON r.room_id = rm.id
      WHERE 1=1
    `;
    const params: any[] = [];
    if (roomId) { query += ' AND r.room_id = ?'; params.push(roomId); }
    if (status) { query += ' AND r.status = ?'; params.push(status); }
    if (search) { query += ' AND r.name LIKE ?'; params.push(`%${search}%`); }
    query += ' ORDER BY r.sort_order ASC, r.name ASC';
    const racks = db.prepare(query).all(...params);
    res.json({ success: true, data: racks });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /racks — 创建机柜
router.post('/', (req: Request, res: Response) => {
  try {
    const { name, room_id, row_number, total_u, sort_order, position_x, position_z } = req.body;
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO dc_racks (id, name, room_id, row_number, total_u, sort_order, position_x, position_z)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, room_id, row_number || 0, total_u || 42, sort_order || 0, position_x || 0, position_z || 0);
    res.json({ success: true, data: { id } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /racks/:id — 更新机柜
router.put('/:id', (req: Request, res: Response) => {
  try {
    const { name, room_id, row_number, total_u, status, sort_order, position_x, position_z } = req.body;
    db.prepare(`
      UPDATE dc_racks SET name=?, room_id=?, row_number=?, total_u=?, status=?,
        sort_order=?, position_x=?, position_z=?, updated_at=datetime('now','localtime')
      WHERE id=?
    `).run(name, room_id, row_number || 0, total_u || 42, status || 'normal',
      sort_order || 0, position_x || 0, position_z || 0, req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /racks/:id — 删除机柜
router.delete('/:id', (req: Request, res: Response) => {
  try {
    db.prepare('DELETE FROM dc_rack_slots WHERE rack_id = ?').run(req.params.id);
    db.prepare('DELETE FROM dc_racks WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
