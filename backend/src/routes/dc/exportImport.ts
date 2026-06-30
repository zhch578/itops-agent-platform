import type { Request, Response } from 'express';
import { Router } from 'express';
import { db } from '../../models/database';

const exportRouter = Router();
const importRouter = Router();

// ====== 导出 ======

// GET /export — 导出完整数据中心数据
exportRouter.get('/', (_req: Request, res: Response) => {
  try {
    const rooms = db.prepare('SELECT * FROM dc_rooms').all();
    const racks = db.prepare('SELECT * FROM dc_racks').all();
    const slots = db.prepare('SELECT * FROM dc_rack_slots').all();
    const lifecycles = db.prepare('SELECT * FROM dc_device_lifecycle').all();
    const pdus = db.prepare('SELECT * FROM dc_pdus').all();
    const data = {
      exported_at: new Date().toISOString(),
      version: '1.0',
      summary: { rooms: rooms.length, racks: racks.length, slots: slots.length, pdus: pdus.length, lifecycles: lifecycles.length },
      rooms, racks, slots, lifecycles, pdus,
    };
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ====== 导入 ======

// POST /import — 导入数据中心数据
importRouter.post('/', (req: Request, res: Response) => {
  try {
    const { rooms = [], racks = [], slots = [], lifecycles = [], pdus = [] } = req.body.data || req.body;

    // 清空旧数据（按外键顺序）
    db.prepare('DELETE FROM dc_device_lifecycle').run();
    db.prepare('DELETE FROM dc_rack_slots').run();
    db.prepare('DELETE FROM dc_pdus').run();
    db.prepare('DELETE FROM dc_racks').run();
    db.prepare('DELETE FROM dc_rooms').run();

    // 导入
    const insertRoom = db.prepare(`
      INSERT INTO dc_rooms (id, name, label, description, width_m, depth_m, layout_config, sort_order, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
    `);
    const insertRack = db.prepare(`
      INSERT INTO dc_racks (id, name, room_id, row_number, total_u, status, sort_order, position_x, position_z, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))
    `);
    const insertSlot = db.prepare(`
      INSERT INTO dc_rack_slots (id, rack_id, device_id, device_type, start_u, end_u, position_face)
      VALUES (?,?,?,?,?,?,?)
    `);
    const insertPdu = db.prepare(`
      INSERT INTO dc_pdus (id, name, type, status, rack_id, power_capacity_w, current_load_w, input_voltage, output_sockets, model, ip_address, snmp_community, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);

    for (const r of rooms) insertRoom.run(r.id, r.name, r.label || '', r.description || '', r.width_m || 20, r.depth_m || 15, r.layout_config || '{}', r.sort_order || 0);
    for (const r of racks) insertRack.run(r.id, r.name, r.room_id, r.row_number || 0, r.total_u || 42, r.status || 'normal', r.sort_order || 0, r.position_x || 0, r.position_z || 0);
    for (const s of slots) insertSlot.run(s.id, s.rack_id, s.device_id, s.device_type, s.start_u, s.end_u, s.position_face || 'front');
    for (const p of pdus) insertPdu.run(p.id, p.name, p.type || 'pdu', p.status || 'active', p.rack_id || null, p.power_capacity_w || 0, p.current_load_w || 0, p.input_voltage || 220, p.output_sockets || 0, p.model || '', p.ip_address || '', p.snmp_community || '', p.notes || '');

    res.json({ success: true, message: `导入完成: ${rooms.length}机房, ${racks.length}机柜, ${slots.length}U位, ${pdus.length}PDU` });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export { exportRouter, importRouter };
