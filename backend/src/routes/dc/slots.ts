import type { Request, Response } from 'express';
import { Router } from 'express';
import { db } from '../../models/database';
import crypto from 'crypto';

const router = Router();

// GET /slots — 所有U位数据（DataRoom 3D调用）
router.get('/', (_req: Request, res: Response) => {
  try {
    const slots = db.prepare(`
      SELECT s.*,
        COALESCE(ser.name, nd.name, vm.name, s.device_id) as device_name,
        COALESCE(ser.ip_address, nd.ip_address, '') as ip_address,
        COALESCE(CASE WHEN ser.enabled = 1 THEN 'online' ELSE 'offline' END, nd.status, vm.status) as device_status
      FROM dc_rack_slots s
      LEFT JOIN servers ser ON s.device_type='server' AND s.device_id = ser.id
      LEFT JOIN network_devices nd ON s.device_type='network_device' AND s.device_id = nd.id
      LEFT JOIN virtual_machines vm ON s.device_type='vm_host' AND s.device_id = vm.id
      ORDER BY s.rack_id, s.start_u
    `).all();
    res.json({ success: true, data: slots });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /slots/:rackId — 按机柜获取U位
router.get('/:rackId', (req: Request, res: Response) => {
  try {
    const slots = db.prepare(`
      SELECT s.*,
        COALESCE(ser.name, nd.name, vm.name, s.device_id) as device_name,
        COALESCE(CASE WHEN ser.enabled = 1 THEN 'online' ELSE 'offline' END, nd.status, vm.status) as device_status
      FROM dc_rack_slots s
      LEFT JOIN servers ser ON s.device_type='server' AND s.device_id = ser.id
      LEFT JOIN network_devices nd ON s.device_type='network_device' AND s.device_id = nd.id
      LEFT JOIN virtual_machines vm ON s.device_type='vm_host' AND s.device_id = vm.id
      WHERE s.rack_id = ?
      ORDER BY s.start_u
    `).all(req.params.rackId);
    res.json({ success: true, data: slots });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /slots — 分配U位
router.post('/', (req: Request, res: Response) => {
  try {
    const { rack_id, device_id, device_type, device_type_id, start_u, end_u, position_face, lifecycle_notes } = req.body;

    // 检查冲突
    const conflict = db.prepare(`
      SELECT * FROM dc_rack_slots
      WHERE rack_id = ? AND NOT (end_u < ? OR start_u > ?)
    `).get(rack_id, start_u, end_u);
    if (conflict) {
      return res.status(409).json({ success: false, message: 'U位冲突：该U位已被占用' });
    }

    // 检查总U数
    const rack = db.prepare('SELECT * FROM dc_racks WHERE id = ?').get(rack_id) as any;
    if (rack && end_u > rack.total_u) {
      return res.status(400).json({ success: false, message: `超出机柜容量(最大${rack.total_u}U)` });
    }

    // 如果有 device_type_id，自动从型号继承 u_height
    let resolvedEndU = end_u;
    if (device_type_id) {
      const dt = db.prepare('SELECT u_height FROM device_types WHERE id = ?').get(device_type_id) as any;
      if (dt && dt.u_height > 0) {
        resolvedEndU = start_u + Math.ceil(dt.u_height) - 1;
      }
    }

    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO dc_rack_slots (id, rack_id, device_id, device_type, device_type_id, start_u, end_u, position_face)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, rack_id, device_id, device_type, device_type_id || null, start_u, resolvedEndU, position_face || 'front');

    // 生命周期记录
    db.prepare(`
      INSERT INTO dc_device_lifecycle (id, device_id, device_type, action,
        to_rack_id, to_slot_start, to_slot_end, notes)
      VALUES (?, ?, ?, 'mounted', ?, ?, ?, ?)
    `).run(crypto.randomUUID(), device_id, device_type, rack_id, start_u, end_u, lifecycle_notes || '');

    res.json({ success: true, data: { id } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /slots/:id — 更新/移位U位
router.put('/:id', (req: Request, res: Response) => {
  try {
    const { rack_id, start_u, end_u, position_face, lifecycle_notes } = req.body;
    const oldSlot = db.prepare('SELECT * FROM dc_rack_slots WHERE id = ?').get(req.params.id) as any;
    if (!oldSlot) return res.status(404).json({ success: false, message: 'U位记录不存在' });

    // 检查冲突（排除自身）
    const conflict = db.prepare(`
      SELECT * FROM dc_rack_slots
      WHERE rack_id = ? AND id != ? AND NOT (end_u < ? OR start_u > ?)
    `).get(rack_id || oldSlot.rack_id, req.params.id, start_u, end_u);
    if (conflict) {
      return res.status(409).json({ success: false, message: 'U位冲突' });
    }

    db.prepare(`
      UPDATE dc_rack_slots
      SET rack_id=?, start_u=?, end_u=?, position_face=?
      WHERE id=?
    `).run(rack_id || oldSlot.rack_id, start_u, end_u, position_face || 'front', req.params.id);

    // 记录生命周期
    if (rack_id && rack_id !== oldSlot.rack_id) {
      db.prepare(`
        INSERT INTO dc_device_lifecycle (id, device_id, device_type, action,
          from_rack_id, to_rack_id, from_slot_start, from_slot_end, to_slot_start, to_slot_end, notes)
        VALUES (?, ?, ?, 'moved', ?, ?, ?, ?, ?, ?, ?)
      `).run(crypto.randomUUID(), oldSlot.device_id, oldSlot.device_type,
        oldSlot.rack_id, rack_id, oldSlot.start_u, oldSlot.end_u, start_u, end_u, lifecycle_notes || '');
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /slots/:id — 移除U位（下架设备）
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const slot = db.prepare('SELECT * FROM dc_rack_slots WHERE id = ?').get(req.params.id) as any;
    if (!slot) return res.status(404).json({ success: false, message: 'U位记录不存在' });

    // 生命周期记录
    db.prepare(`
      INSERT INTO dc_device_lifecycle (id, device_id, device_type, action,
        from_rack_id, from_slot_start, from_slot_end, notes)
      VALUES (?, ?, ?, 'unmounted', ?, ?, ?, ?)
    `).run(crypto.randomUUID(), slot.device_id, slot.device_type,
      slot.rack_id, slot.start_u, slot.end_u, '');

    db.prepare('DELETE FROM dc_rack_slots WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
