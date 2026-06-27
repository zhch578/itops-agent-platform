import { Router, Request, Response } from 'express';
import { db } from '../models/database';
import crypto from 'crypto';

const router = Router();



// ==================== 机房管理 ====================

// GET /api/dc/rooms — 机房列表
router.get('/rooms', (_req: Request, res: Response) => {
  try {
    const rooms = db.prepare('SELECT * FROM dc_rooms ORDER BY sort_order').all();
    res.json({ success: true, data: rooms });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/dc/rooms — 创建机房
router.post('/rooms', (req: Request, res: Response) => {
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

// PUT /api/dc/rooms/:id — 更新机房
router.put('/rooms/:id', (req: Request, res: Response) => {
  try {
    const { name, label, description, width_m, depth_m, layout_config, sort_order } = req.body;
    db.prepare(`
      UPDATE dc_rooms SET name=?, label=?, description=?, width_m=?, depth_m=?,
        layout_config=?, sort_order=?, updated_at=datetime('now','localtime') WHERE id=?
    `).run(name, label || '', description || '', width_m || 20, depth_m || 15, layout_config || '{}', sort_order || 0, req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/dc/rooms/:id — 删除机房
router.delete('/rooms/:id', (req: Request, res: Response) => {
  try {
    db.prepare('DELETE FROM dc_rooms WHERE id = ?').run(req.params.id);
    db.prepare('DELETE FROM dc_racks WHERE room_id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== 机柜管理 ====================

// GET /api/dc/racks — 机柜列表（可按机房筛选）
router.get('/racks', (req: Request, res: Response) => {
  try {
    const roomId = req.query.room_id as string || '';
    const status = req.query.status as string || '';
    const search = req.query.search as string || '';
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
    if (roomId) {
      query += ' AND r.room_id = ?';
      params.push(roomId);
    }
    if (status) {
      query += ' AND r.status = ?';
      params.push(status);
    }
    if (search) {
      query += ' AND (r.name LIKE ? OR r.label LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    query += ' ORDER BY r.sort_order';
    const racks = db.prepare(query).all(...params);
    res.json({ success: true, data: racks });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/dc/racks/:id — 单个机柜详情（含U位占用图）
router.get('/racks/:id', (req: Request, res: Response) => {
  try {
    const rack = db.prepare('SELECT * FROM dc_racks WHERE id = ?').get(req.params.id) as any;
    if (!rack) return res.status(404).json({ success: false, message: '机柜未找到' });

    const slots = db.prepare(`
      SELECT s.*, 
        COALESCE(ser.name, nd.name, vm.name, s.device_id) as device_name,
        CASE WHEN ser.enabled = 1 THEN 'online' ELSE 'offline' END as server_status,
        NULL as cpu_usage, NULL as memory_usage, NULL as disk_usage
      FROM dc_rack_slots s
      LEFT JOIN servers ser ON s.device_type='server' AND s.device_id = ser.id
      LEFT JOIN network_devices nd ON s.device_type='network_device' AND s.device_id = nd.id
      LEFT JOIN virtual_machines vm ON s.device_type='vm_host' AND s.device_id = vm.id
      WHERE s.rack_id = ?
      ORDER BY s.start_u
    `).all(req.params.id);

    res.json({ success: true, data: { ...rack, slots } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /api/dc/racks/:id/alerts — 获取机柜内设备的告警
router.get('/racks/:id/alerts', (req: Request, res: Response) => {
  try {
    const slotDevices = db.prepare(`
      SELECT device_id, device_type FROM dc_rack_slots WHERE rack_id = ?
    `).all(req.params.id) as any[];

    if (slotDevices.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const deviceIds = slotDevices.map((s: any) => s.device_id);
    const placeholders = deviceIds.map(() => '?').join(',');

    const alerts = db.prepare(`
      SELECT * FROM alerts 
      WHERE source IN (${placeholders}) AND status != 'resolved'
      ORDER BY created_at DESC
      LIMIT 50
    `).all(...deviceIds);

    res.json({ success: true, data: alerts });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/dc/racks — 创建机柜
router.post('/racks', (req: Request, res: Response) => {
  try {
    const { room_id, name, label, row_number, position_x, position_z, total_u, sort_order } = req.body;
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO dc_racks (id, room_id, name, label, row_number, position_x, position_z, total_u, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, room_id, name, label || '', row_number || 1, position_x || 0, position_z || 0, total_u || 42, sort_order || 0);
    res.json({ success: true, data: { id } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/dc/racks/:id
router.put('/racks/:id', (req: Request, res: Response) => {
  try {
    const { name, label, position_x, position_z, total_u, sort_order } = req.body;
    db.prepare(`
      UPDATE dc_racks SET name=?, label=?, position_x=?, position_z=?, total_u=?, sort_order=?,
        updated_at=datetime('now','localtime') WHERE id=?
    `).run(name, label || '', position_x || 0, position_z || 0, total_u || 42, sort_order || 0, req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/dc/racks/:id
router.delete('/racks/:id', (req: Request, res: Response) => {
  try {
    db.prepare('DELETE FROM dc_racks WHERE id = ?').run(req.params.id);
    db.prepare('DELETE FROM dc_rack_slots WHERE rack_id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== U位分配管理 ====================

// GET /api/dc/batch-slots — 批量获取所有机柜的U位分配（供3D看板使用）
router.get('/batch-slots', (_req: Request, res: Response) => {
  try {
    const slots = db.prepare(`
      SELECT s.rack_id, s.id as slot_id, s.device_id, s.device_type, s.start_u, s.end_u, s.position_face,
        COALESCE(ser.name, nd.name, vm.name, s.device_id) as device_name,
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

// GET /api/dc/slots/:rackId — 获取机柜U位分配列表
router.get('/slots/:rackId', (req: Request, res: Response) => {
  try {
    const slots = db.prepare(`
      SELECT s.*,
        COALESCE(ser.name, nd.name, vm.name, s.device_id) as device_name,
        COALESCE(CASE WHEN ser.enabled = 1 THEN 'online' ELSE 'offline' END, nd.status, vm.status) as device_status,
        NULL as cpu_usage, NULL as memory_usage, NULL as disk_usage
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

// POST /api/dc/slots — 分配U位(把设备放进机柜)
router.post('/slots', (req: Request, res: Response) => {
  try {
    const { rack_id, device_id, device_type, start_u, end_u, position_face, lifecycle_notes } = req.body;

    // 检查U位是否已被占用
    const conflict = db.prepare(`
      SELECT * FROM dc_rack_slots 
      WHERE rack_id = ? AND NOT (end_u < ? OR start_u > ?)
    `).get(rack_id, start_u, end_u);
    if (conflict) {
      return res.status(409).json({ success: false, message: 'U位冲突：该U位已被占用' });
    }

    // 检查机柜总U数
    const rack = db.prepare('SELECT * FROM dc_racks WHERE id = ?').get(rack_id) as any;
    if (rack && end_u > rack.total_u) {
      return res.status(400).json({ success: false, message: `超出机柜容量(最大${rack.total_u}U)` });
    }

    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO dc_rack_slots (id, rack_id, device_id, device_type, start_u, end_u, position_face)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, rack_id, device_id, device_type, start_u, end_u, position_face || 'front');

    // 记录生命周期
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

// POST /api/dc/slots/batch — 批量分配U位
router.post('/slots/batch', (req: Request, res: Response) => {
  try {
    const { assignments } = req.body as { assignments: Array<{
      rack_id: string; device_id: string; device_type: string;
      start_u: number; end_u: number; position_face?: string;
    }> };

    if (!assignments || !Array.isArray(assignments) || assignments.length === 0) {
      return res.status(400).json({ success: false, message: '缺少分配数据' });
    }

    const insertSlot = db.prepare(`
      INSERT INTO dc_rack_slots (id, rack_id, device_id, device_type, start_u, end_u, position_face)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertLifecycle = db.prepare(`
      INSERT INTO dc_device_lifecycle (id, device_id, device_type, action,
        to_rack_id, to_slot_start, to_slot_end, notes)
      VALUES (?, ?, ?, 'mounted', ?, ?, ?, '批量导入')
    `);

    const insertMany = db.transaction((items: typeof assignments) => {
      for (const item of items) {
        const { rack_id, device_id, device_type, start_u, end_u, position_face } = item;
        // Check conflict
        const conflict = db.prepare(`
          SELECT * FROM dc_rack_slots 
          WHERE rack_id = ? AND NOT (end_u < ? OR start_u > ?)
        `).get(rack_id, start_u, end_u);
        if (conflict) continue; // Skip conflicts

        const id = crypto.randomUUID();
        insertSlot.run(id, rack_id, device_id, device_type, start_u, end_u, position_face || 'front');
        insertLifecycle.run(crypto.randomUUID(), device_id, device_type, rack_id, start_u, end_u);
      }
    });

    insertMany(assignments);
    res.json({ success: true, message: `批量分配完成，共处理 ${assignments.length} 条` });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/dc/slots/:id — 移位（更换机柜或U位位置）
router.put('/slots/:id', (req: Request, res: Response) => {
  try {
    const oldSlot = db.prepare('SELECT * FROM dc_rack_slots WHERE id = ?').get(req.params.id) as any;
    if (!oldSlot) return res.status(404).json({ success: false, message: '未找到U位分配' });

    const { rack_id, start_u, end_u, position_face } = req.body;

    // 检查新位置是否被占用（排除自身）
    const conflict = db.prepare(`
      SELECT * FROM dc_rack_slots 
      WHERE rack_id = ? AND id != ? AND NOT (end_u < ? OR start_u > ?)
    `).get(rack_id, req.params.id, start_u, end_u);
    if (conflict) {
      return res.status(409).json({ success: false, message: '该U位已被占用' });
    }

    db.prepare(`
      UPDATE dc_rack_slots SET rack_id=?, start_u=?, end_u=?, position_face=?,
        updated_at=datetime('now','localtime') WHERE id=?
    `).run(rack_id, start_u, end_u, position_face || 'front', req.params.id);

    // 记录移位操作
    db.prepare(`
      INSERT INTO dc_device_lifecycle (id, device_id, device_type, action,
        from_rack_id, from_slot_start, from_slot_end,
        to_rack_id, to_slot_start, to_slot_end, notes)
      VALUES (?, ?, ?, 'moved', ?, ?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), oldSlot.device_id, oldSlot.device_type,
      oldSlot.rack_id, oldSlot.start_u, oldSlot.end_u,
      rack_id, start_u, end_u, `从 U${oldSlot.start_u}-${oldSlot.end_u} 移动到 U${start_u}-${end_u}`);

    res.json({ success: true, message: '设备移位成功' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/dc/slots/:id — 移除U位分配（记录生命周期）
router.delete('/slots/:id', (req: Request, res: Response) => {
  try {
    const slot = db.prepare('SELECT * FROM dc_rack_slots WHERE id = ?').get(req.params.id) as any;
    if (!slot) return res.status(404).json({ success: false, message: '未找到U位分配' });

    db.prepare('DELETE FROM dc_rack_slots WHERE id = ?').run(req.params.id);

    // 记录下架
    db.prepare(`
      INSERT INTO dc_device_lifecycle (id, device_id, device_type, action,
        from_rack_id, from_slot_start, from_slot_end, notes)
      VALUES (?, ?, ?, 'unmounted', ?, ?, ?, ?)
    `).run(crypto.randomUUID(), slot.device_id, slot.device_type,
      slot.rack_id, slot.start_u, slot.end_u, 'U位分配移除');

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== 设备生命周期管理 ====================

// GET /api/dc/lifecycle — 生命周期记录
router.get('/lifecycle', (req: Request, res: Response) => {
  try {
    const deviceId = req.query.device_id as string || '';
    const action = req.query.action as string || '';
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 1000);
    let query = `
      SELECT l.*, 
        COALESCE(from_rm.name || '-' || from_r.name, 'N/A') as from_location,
        COALESCE(to_rm.name || '-' || to_r.name, 'N/A') as to_location
      FROM dc_device_lifecycle l
      LEFT JOIN dc_racks from_r ON l.from_rack_id = from_r.id
      LEFT JOIN dc_rooms from_rm ON from_r.room_id = from_rm.id
      LEFT JOIN dc_racks to_r ON l.to_rack_id = to_r.id
      LEFT JOIN dc_rooms to_rm ON to_r.room_id = to_rm.id
      WHERE 1=1
    `;
    const params: any[] = [];
    if (deviceId) {
      query += ' AND l.device_id = ?';
      params.push(deviceId);
    }
    if (action) {
      query += ' AND l.action = ?';
      params.push(action);
    }
    query += ' ORDER BY l.created_at DESC LIMIT ?';
    params.push(limit);

    const records = db.prepare(query).all(...params);
    res.json({ success: true, data: records });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/dc/lifecycle — 手动记录生命周期事件
router.post('/lifecycle', (req: Request, res: Response) => {
  try {
    const { device_id, device_type, action, from_rack_id, from_slot_start, from_slot_end,
      to_rack_id, to_slot_start, to_slot_end, performed_by, notes } = req.body;

    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO dc_device_lifecycle 
        (id, device_id, device_type, action, from_rack_id, from_slot_start, from_slot_end,
         to_rack_id, to_slot_start, to_slot_end, performed_by, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, device_id, device_type, action, from_rack_id || null, from_slot_start || null,
      from_slot_end || null, to_rack_id || null, to_slot_start || null, to_slot_end || null,
      performed_by || 'system', notes || '');

    res.json({ success: true, data: { id } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== PDU/UPS 基础设施管理 ====================

// GET /api/dc/pdus — PDU/UPS 设备列表
router.get('/pdus', (req: Request, res: Response) => {
  try {
    const rackId = req.query.rack_id as string || '';
    const type = req.query.type as string || '';
    let query = `
      SELECT p.*, r.name as rack_name, rm.name as room_name
      FROM dc_pdus p
      LEFT JOIN dc_racks r ON p.rack_id = r.id
      LEFT JOIN dc_rooms rm ON r.room_id = rm.id
      WHERE 1=1
    `;
    const params: any[] = [];
    if (rackId) {
      query += ' AND p.rack_id = ?';
      params.push(rackId);
    }
    if (type) {
      query += ' AND p.type = ?';
      params.push(type);
    }
    query += ' ORDER BY p.name';
    const pdus = db.prepare(query).all(...params);
    res.json({ success: true, data: pdus });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/dc/pdus — 创建 PDU/UPS
router.post('/pdus', (req: Request, res: Response) => {
  try {
    const { name, rack_id, type, model, power_capacity_w, current_load_w,
      input_voltage, output_sockets, ip_address, snmp_community, notes } = req.body;
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO dc_pdus (id, name, rack_id, type, model, power_capacity_w, current_load_w,
        input_voltage, output_sockets, ip_address, snmp_community, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, rack_id || null, type || 'pdu', model || '',
      power_capacity_w || 4000, current_load_w || 0, input_voltage || 220,
      output_sockets || 8, ip_address || '', snmp_community || '', notes || '');
    res.json({ success: true, data: { id } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /api/dc/pdus/:id
router.put('/pdus/:id', (req: Request, res: Response) => {
  try {
    const { name, rack_id, type, model, power_capacity_w, current_load_w,
      input_voltage, output_sockets, ip_address, snmp_community, status, notes } = req.body;
    db.prepare(`
      UPDATE dc_pdus SET name=?, rack_id=?, type=?, model=?, power_capacity_w=?, current_load_w=?,
        input_voltage=?, output_sockets=?, ip_address=?, snmp_community=?, status=?, notes=?,
        updated_at=datetime('now','localtime') WHERE id=?
    `).run(name, rack_id || null, type || 'pdu', model || '', power_capacity_w || 4000,
      current_load_w || 0, input_voltage || 220, output_sockets || 8,
      ip_address || '', snmp_community || '', status || 'normal', notes || '', req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/dc/pdus/:id
router.delete('/pdus/:id', (req: Request, res: Response) => {
  try {
    db.prepare('DELETE FROM dc_pdus WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== 数据同步接口(供DataRoom 3D场景调用的聚合API) ====================

// GET /api/dc/overview — DataRoom 总览数据
router.get('/overview', (_req: Request, res: Response) => {
  try {
    // ===== 1. 检查是否有数据 =====
    const realRooms = db.prepare('SELECT * FROM dc_rooms ORDER BY sort_order').all() as any[];
    const realRackCount = (db.prepare('SELECT COUNT(*) as c FROM dc_racks').get() as any)?.c || 0;
    const realSlotCount = (db.prepare('SELECT COUNT(*) as c FROM dc_rack_slots').get() as any)?.c || 0;
    const hasData = realRackCount > 0 || realSlotCount > 0;

    if (!hasData) {
      // 数据库为空，返回空状态
      return res.json({
        success: true,
        data: {
          rooms: [],
          summary: {
            totalRacks: 0, totalDevices: 0, totalRooms: 0,
            onlineDevices: 0, warningDevices: 0, criticalDevices: 0, alertDevices: 0,
            totalPower: 0, coolingPower: 0, itPower: 0, pue: 0,
            avgTemp: 0, avgHumidity: 0,
          },
          rackData: [],
          slotData: [],
          isEmpty: true,
        }
      });
    }

    // ===== 2. 加载真实数据 =====
    const rackData = db.prepare(`
      SELECT r.*, rm.name as room_name, rm.label as room_label,
        (SELECT COUNT(*) FROM dc_rack_slots WHERE rack_id = r.id) as device_count,
        (SELECT COALESCE(SUM(end_u - start_u + 1), 0) FROM dc_rack_slots WHERE rack_id = r.id) as used_u,
        rm.current_temperature, rm.current_humidity
      FROM dc_racks r
      JOIN dc_rooms rm ON r.room_id = rm.id
      ORDER BY rm.sort_order, r.sort_order
    `).all();

    const allSlots = db.prepare(`
      SELECT s.*,
        COALESCE(ser.name, nd.name, vm.name) as device_name,
        CASE WHEN ser.enabled = 1 THEN 'online' ELSE 'offline' END as server_status,
        COALESCE(ser.ip_address, nd.ip_address, '') as ip_address,
        NULL as cpu_usage, NULL as memory_usage, NULL as disk_usage,
        ser.cpu_cores, (ser.memory_gb * 1000) as memory_mb,
        nd.status as net_status,
        vm.status as vm_status
      FROM dc_rack_slots s
      LEFT JOIN servers ser ON s.device_type='server' AND s.device_id = ser.id
      LEFT JOIN network_devices nd ON s.device_type='network_device' AND s.device_id = nd.id
      LEFT JOIN virtual_machines vm ON s.device_type='vm_host' AND s.device_id = vm.id
    `).all();

    const rackCounts: Record<string, number> = {};
    const roomDeviceCounts: Record<string, number> = {};
    for (const rack of rackData as any[]) {
      rackCounts[rack.room_id] = (rackCounts[rack.room_id] || 0) + 1;
    }
    for (const slot of allSlots as any[]) {
      const r = (rackData as any[]).find((rk: any) => rk.id === slot.rack_id);
      if (r) {
        roomDeviceCounts[r.room_id] = (roomDeviceCounts[r.room_id] || 0) + 1;
      }
    }
    const dataRooms = realRooms.map((rm: any) => ({
      ...rm,
      rack_count: rackCounts[rm.id] || 0,
      device_count: roomDeviceCounts[rm.id] || 0,
    }));

    // ===== 3. 告警统计 =====
    const rackAlertCounts: Record<string, number> = {};
    const slotsWithAlerts = db.prepare(`
      SELECT s.rack_id, a.id as alert_id, a.severity, a.status
      FROM dc_rack_slots s
      JOIN alerts a ON s.device_id = a.source
      WHERE a.status != 'resolved'
    `).all() as any[];
    for (const sa of slotsWithAlerts) {
      rackAlertCounts[sa.rack_id] = (rackAlertCounts[sa.rack_id] || 0) + 1;
    }

    const finalRackCount = rackData.length;
    const finalDeviceCount = allSlots.length;
    const onlineCount = (allSlots as any[]).filter((s: any) =>
      s.server_status === 'online' || s.net_status === 'online' || s.vm_status === 'running'
    ).length;
    const warningCount = (allSlots as any[]).filter((s: any) =>
      s.server_status === 'warning' || s.server_status === 'critical'
    ).length;
    const criticalCount = (allSlots as any[]).filter((s: any) =>
      s.server_status === 'critical'
    ).length;

    const totalPower = finalDeviceCount * 0.3;
    const itPower = finalDeviceCount * 0.18;
    const coolingPower = finalDeviceCount * 0.12;
    const pue = 1.5;

    const avgTemp = dataRooms.length > 0
      ? (dataRooms as any[]).reduce((s: number, r: any) => s + (r.current_temperature || 24), 0) / dataRooms.length
      : 24.5;
    const avgHumidity = dataRooms.length > 0
      ? (dataRooms as any[]).reduce((s: number, r: any) => s + (r.current_humidity || 45), 0) / dataRooms.length
      : 45;

    res.json({
      success: true,
      data: {
        rooms: dataRooms,
        summary: {
          totalRacks: finalRackCount,
          totalDevices: finalDeviceCount,
          totalRooms: dataRooms.length,
          onlineDevices: onlineCount,
          warningDevices: warningCount,
          criticalDevices: criticalCount,
          alertDevices: warningCount + criticalCount,
          totalPower,
          coolingPower,
          itPower,
          pue,
          avgTemp,
          avgHumidity,
        },
        rackData: rackData.map((r: any) => ({
          ...r,
          alert_count: rackAlertCounts[r.id] || 0,
        })),
        slotData: allSlots,
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== 搜索可分配的设备(供前端选择器) ====================

// GET /api/dc/available-devices — 获取未分配的服务器/网络设备/虚拟机
router.get('/available-devices', (req: Request, res: Response) => {
  try {
    const type = req.query.type as string || 'server';
    const search = req.query.search as string || '';
    const assignedIds = db.prepare('SELECT DISTINCT device_id FROM dc_rack_slots').all()
      .map((r: any) => r.device_id);
    const idSet = assignedIds.length > 0 ? assignedIds.map(() => '?').join(',') : '\'\'';

    let devices: any[] = [];
    if (type === 'server') {
      let q = `SELECT id, name, ip_address, enabled, cpu_cores, memory_gb FROM servers`;
      const params: any[] = [];
      if (assignedIds.length > 0) {
        q += ` WHERE id NOT IN (${idSet})`;
        params.push(...assignedIds);
      }
      if (search) {
        q += (assignedIds.length > 0 ? ' AND' : ' WHERE') + ' (name LIKE ? OR ip_address LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
      }
      q += ' ORDER BY name LIMIT 200';
      devices = db.prepare(q).all(...params);
    } else if (type === 'network_device') {
      let q = 'SELECT id, name, ip_address, status FROM network_devices';
      const params: any[] = [];
      if (assignedIds.length > 0) {
        q += ` WHERE id NOT IN (${idSet})`;
        params.push(...assignedIds);
      }
      if (search) {
        q += (assignedIds.length > 0 ? ' AND' : ' WHERE') + ' (name LIKE ? OR ip_address LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
      }
      q += ' ORDER BY name LIMIT 200';
      devices = db.prepare(q).all(...params);
    } else if (type === 'vm_host' || type === 'virtual_machine') {
      let q = 'SELECT id, name, status, cpu_cores, memory_mb FROM virtual_machines';
      const params: any[] = [];
      if (assignedIds.length > 0) {
        q += ` WHERE id NOT IN (${idSet})`;
        params.push(...assignedIds);
      }
      if (search) {
        q += (assignedIds.length > 0 ? ' AND' : ' WHERE') + ' (name LIKE ?)';
        params.push(`%${search}%`);
      }
      q += ' ORDER BY name LIMIT 200';
      devices = db.prepare(q).all(...params);
    }

    // 统一字段名：将各表的不同列名映射为 status / cpu_usage / memory_usage
    devices = devices.map((d: any) => ({
      ...d,
      status: d.status || (d.enabled === 1 ? 'online' : d.enabled === 0 ? 'offline' : '-'),
      cpu_usage: d.cpu_usage != null ? d.cpu_usage : d.cpu_cores,
      memory_usage: d.memory_usage != null ? d.memory_usage : d.memory_gb || d.memory_mb,
    }));

    res.json({ success: true, data: devices });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== 导出功能 ====================

// GET /api/dc/export — 导出数据中心布局 JSON
router.get('/export', (_req: Request, res: Response) => {
  try {
    const rooms = db.prepare('SELECT * FROM dc_rooms ORDER BY sort_order').all();
    const racks = db.prepare('SELECT * FROM dc_racks ORDER BY sort_order').all();
    const slots = db.prepare('SELECT * FROM dc_rack_slots ORDER BY start_u').all();
    const lifecycles = db.prepare('SELECT * FROM dc_device_lifecycle ORDER BY created_at DESC LIMIT 500').all();
    const pdus = db.prepare('SELECT * FROM dc_pdus ORDER BY name').all();

    const exportData = {
      exportVersion: '1.0',
      exportedAt: new Date().toISOString(),
      rooms,
      racks,
      slots,
      lifecycles,
      pdus,
      summary: {
        rooms: rooms.length,
        racks: racks.length,
        slots: slots.length,
        lifecycles: lifecycles.length,
        pdus: pdus.length,
      },
    };

    res.json({ success: true, data: exportData });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /api/dc/import — 导入数据中心布局数据
router.post('/import', (req: Request, res: Response) => {
  try {
    const { rooms, racks, slots, pdus } = req.body;

    const importTransaction = db.transaction(() => {
      if (rooms && Array.isArray(rooms)) {
        const insertRoom = db.prepare(`
          INSERT OR REPLACE INTO dc_rooms (id, name, label, description, width_m, depth_m, layout_config, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const r of rooms) {
          insertRoom.run(r.id, r.name, r.label || '', r.description || '', r.width_m || 20, r.depth_m || 15, r.layout_config || '{}', r.sort_order || 0);
        }
      }
      if (racks && Array.isArray(racks)) {
        const insertRack = db.prepare(`
          INSERT OR REPLACE INTO dc_racks (id, room_id, name, label, row_number, position_x, position_z, total_u, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const r of racks) {
          insertRack.run(r.id, r.room_id, r.name, r.label || '', r.row_number || 1, r.position_x || 0, r.position_z || 0, r.total_u || 42, r.sort_order || 0);
        }
      }
      if (slots && Array.isArray(slots)) {
        const insertSlot = db.prepare(`
          INSERT OR REPLACE INTO dc_rack_slots (id, rack_id, device_id, device_type, start_u, end_u, position_face)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        for (const s of slots) {
          insertSlot.run(s.id, s.rack_id, s.device_id, s.device_type, s.start_u, s.end_u, s.position_face || 'front');
        }
      }
      if (pdus && Array.isArray(pdus)) {
        const insertPdu = db.prepare(`
          INSERT OR REPLACE INTO dc_pdus (id, name, rack_id, type, model, power_capacity_w, current_load_w, input_voltage, output_sockets, ip_address, snmp_community, notes)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const p of pdus) {
          insertPdu.run(p.id, p.name, p.rack_id || null, p.type || 'pdu', p.model || '',
            p.power_capacity_w || 4000, p.current_load_w || 0, p.input_voltage || 220,
            p.output_sockets || 8, p.ip_address || '', p.snmp_community || '', p.notes || '');
        }
      }
    });

    importTransaction();
    res.json({ success: true, message: '导入完成' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// ==================== 全量设备分布查询 ====================

// GET /api/dc/devices — 返回所有已挂载到U位的设备及其位置信息
router.get('/devices', (_req: Request, res: Response) => {
  try {
    const devices = db.prepare(`
      SELECT
        s.id as slot_id,
        s.rack_id,
        s.device_id,
        s.device_type,
        s.start_u,
        s.end_u,
        r.name as rack_name,
        rm.id as room_id,
        rm.name as room_name,
        rm.label as room_label,
        COALESCE(ser.name, nd.name, vm.name) as device_name,
        COALESCE(ser.ip_address, nd.ip_address, '') as ip_address,
        CASE WHEN ser.enabled = 1 THEN 'online' ELSE 'offline' END as server_status,
        ser.os as server_os,
        ser.cpu_cores as server_cpu,
        ser.memory_gb as server_mem,
        nd.status as net_status,
        nd.vendor as net_vendor,
        vm.status as vm_status,
        vm.cpu_cores as vm_cpu,
        vm.memory_mb as vm_mem
      FROM dc_rack_slots s
      JOIN dc_racks r ON s.rack_id = r.id
      JOIN dc_rooms rm ON r.room_id = rm.id
      LEFT JOIN servers ser ON s.device_type = 'server' AND s.device_id = ser.id
      LEFT JOIN network_devices nd ON s.device_type = 'network_device' AND s.device_id = nd.id
      LEFT JOIN virtual_machines vm ON s.device_type = 'vm_host' AND s.device_id = vm.id
      ORDER BY rm.sort_order, r.sort_order, s.start_u
    `).all();

    // 按房间/机柜分组
    const grouped: Record<string, any> = {};
    for (const d of devices as any[]) {
      const roomKey = d.room_id;
      if (!grouped[roomKey]) {
        grouped[roomKey] = {
          room_id: d.room_id,
          room_name: d.room_name,
          room_label: d.room_label,
          racks: {},
        };
      }
      const rackKey = d.rack_id;
      if (!grouped[roomKey].racks[rackKey]) {
        grouped[roomKey].racks[rackKey] = {
          rack_id: d.rack_id,
          rack_name: d.rack_name,
          devices: [],
        };
      }
      grouped[roomKey].racks[rackKey].devices.push(d);
    }

    res.json({ success: true, data: { groups: Object.values(grouped) } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
