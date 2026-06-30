import type { Request, Response } from 'express';
import { Router } from 'express';
import { db } from '../../models/database';
import crypto from 'crypto';

const router = Router();

/**
 * GET /device-types — 获取设备型号列表（可附带 manufacturer 信息）
 */
router.get('/', (req: Request, res: Response) => {
  try {
    const manufacturerId = req.query.manufacturer_id as string;
    let list: any[];
    if (manufacturerId) {
      list = db.prepare(`
        SELECT dt.*, dm.name as manufacturer_name, dm.slug as manufacturer_slug
        FROM device_types dt
        JOIN device_manufacturers dm ON dm.id = dt.manufacturer_id
        WHERE dt.manufacturer_id = ?
        ORDER BY dm.name, dt.model
      `).all(manufacturerId);
    } else {
      list = db.prepare(`
        SELECT dt.*, dm.name as manufacturer_name, dm.slug as manufacturer_slug
        FROM device_types dt
        JOIN device_manufacturers dm ON dm.id = dt.manufacturer_id
        ORDER BY dm.name, dt.model
      `).all();
    }
    res.json({ success: true, data: list });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /device-types/:id — 获取单个型号（含槽位定义和关联设备数量）
 */
router.get('/:id', (req: Request, res: Response) => {
  try {
    const dt = db.prepare(`
      SELECT dt.*, dm.name as manufacturer_name, dm.slug as manufacturer_slug
      FROM device_types dt
      JOIN device_manufacturers dm ON dm.id = dt.manufacturer_id
      WHERE dt.id = ?
    `).get(req.params.id);
    if (!dt) return res.status(404).json({ success: false, message: 'Device type not found' });

    const slots = db.prepare(
      'SELECT * FROM device_type_slot_definitions WHERE device_type_id = ? ORDER BY slot_type, slot_name'
    ).all(req.params.id);

    const instanceCount = db.prepare(
      'SELECT COUNT(*) as cnt FROM dc_rack_slots WHERE device_type_id = ?'
    ).get(req.params.id) as any;

    res.json({
      success: true,
      data: {
        ...dt as any,
        slot_definitions: slots,
        instance_count: instanceCount?.cnt || 0,
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /device-types — 创建设备型号
 */
router.post('/', (req: Request, res: Response) => {
  try {
    const { manufacturer_id, model, slug, part_number, u_height, is_full_depth,
            subdevice_role, airflow, weight_kg, max_power_w, description } = req.body;
    if (!manufacturer_id || !model || !slug) {
      return res.status(400).json({ success: false, message: 'manufacturer_id, model, slug required' });
    }
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO device_types
        (id, manufacturer_id, model, slug, part_number, u_height, is_full_depth,
         subdevice_role, airflow, weight_kg, max_power_w, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, manufacturer_id, model, slug, part_number || '', u_height || 1,
      is_full_depth ?? 1, subdevice_role || null, airflow || 'front-to-rear',
      weight_kg || null, max_power_w || null, description || '');
    res.json({ success: true, data: { id } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /device-types/:id — 更新设备型号
 */
router.put('/:id', (req: Request, res: Response) => {
  try {
    const { manufacturer_id, model, slug, part_number, u_height, is_full_depth,
            subdevice_role, airflow, weight_kg, max_power_w, description } = req.body;
    db.prepare(`
      UPDATE device_types
      SET manufacturer_id=?, model=?, slug=?, part_number=?, u_height=?, is_full_depth=?,
          subdevice_role=?, airflow=?, weight_kg=?, max_power_w=?, description=?,
          updated_at=datetime('now','localtime')
      WHERE id=?
    `).run(manufacturer_id, model, slug, part_number || '', u_height || 1,
      is_full_depth ?? 1, subdevice_role || null, airflow || 'front-to-rear',
      weight_kg || null, max_power_w || null, description || '', req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * DELETE /device-types/:id — 删除设备型号
 */
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const cnt = db.prepare(
      'SELECT COUNT(*) as cnt FROM dc_rack_slots WHERE device_type_id = ?'
    ).get(req.params.id) as any;
    if (cnt?.cnt > 0) {
      return res.status(409).json({
        success: false,
        message: `Cannot delete: ${cnt.cnt} device instance(s) still reference this type`
      });
    }
    db.prepare('DELETE FROM device_types WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
