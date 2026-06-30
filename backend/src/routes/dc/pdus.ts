import type { Request, Response } from 'express';
import { Router } from 'express';
import { db } from '../../models/database';
import crypto from 'crypto';

const router = Router();

// GET /pdus — PDU/UPS列表
router.get('/', (_req: Request, res: Response) => {
  try {
    const pdus = db.prepare(`
      SELECT p.*, r.name as rack_name
      FROM dc_pdus p
      LEFT JOIN dc_racks r ON p.rack_id = r.id
      ORDER BY p.name
    `).all();
    res.json({ success: true, data: pdus });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /pdus — 创建PDU/UPS
router.post('/', (req: Request, res: Response) => {
  try {
    const { name, type, status, rack_id, power_capacity_w, current_load_w, input_voltage, output_sockets, model, ip_address, snmp_community, notes } = req.body;
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO dc_pdus (id, name, type, status, rack_id, power_capacity_w, current_load_w, input_voltage, output_sockets, model, ip_address, snmp_community, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, type || 'pdu', status || 'active', rack_id || null, power_capacity_w || 0, current_load_w || 0, input_voltage || 220, output_sockets || 0, model || '', ip_address || '', snmp_community || '', notes || '');
    res.json({ success: true, data: { id } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /pdus/:id — 更新PDU/UPS
router.put('/:id', (req: Request, res: Response) => {
  try {
    const { name, type, status, rack_id, power_capacity_w, current_load_w, input_voltage, output_sockets, model, ip_address, snmp_community, notes } = req.body;
    db.prepare(`
      UPDATE dc_pdus SET name=?, type=?, status=?, rack_id=?, power_capacity_w=?, current_load_w=?, input_voltage=?, output_sockets=?, model=?, ip_address=?, snmp_community=?, notes=?, updated_at=datetime('now','localtime')
      WHERE id=?
    `).run(name, type, status, rack_id || null, power_capacity_w || 0, current_load_w || 0, input_voltage || 220, output_sockets || 0, model || '', ip_address || '', snmp_community || '', notes || '', req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /pdus/:id
router.delete('/:id', (req: Request, res: Response) => {
  try {
    db.prepare('DELETE FROM dc_pdus WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
