import type { Request, Response } from 'express';
import { Router } from 'express';
import { db } from '../../models/database';
import crypto from 'crypto';

const router = Router();

/**
 * GET /cables — 获取线缆列表
 */
router.get('/', (req: Request, res: Response) => {
  try {
    const deviceId = req.query.device_id as string;
    const status = req.query.status as string;
    let query = `
      SELECT c.*,
        COALESCE(s.name, nd.name, vm.name, pf.name, c.a_device_id) as a_device_name,
        COALESCE(s2.name, nd2.name, vm2.name, pf2.name, c.b_device_id) as b_device_name
      FROM dc_cables c
      LEFT JOIN servers s ON c.a_device_type='server' AND c.a_device_id = s.id
      LEFT JOIN servers s2 ON c.b_device_type='server' AND c.b_device_id = s2.id
      LEFT JOIN network_devices nd ON c.a_device_type='network_device' AND c.a_device_id = nd.id
      LEFT JOIN network_devices nd2 ON c.b_device_type='network_device' AND c.b_device_id = nd2.id
      LEFT JOIN virtual_machines vm ON c.a_device_type='vm_host' AND c.a_device_id = vm.id
      LEFT JOIN virtual_machines vm2 ON c.b_device_type='vm_host' AND c.b_device_id = vm2.id
      LEFT JOIN dc_power_feeds pf ON c.a_device_type='power_feed' AND c.a_device_id = pf.id
      LEFT JOIN dc_power_feeds pf2 ON c.b_device_type='power_feed' AND c.b_device_id = pf2.id
      WHERE 1=1
    `;
    const params: any[] = [];
    if (deviceId) {
      query += ' AND (c.a_device_id = ? OR c.b_device_id = ?)';
      params.push(deviceId, deviceId);
    }
    if (status) {
      query += ' AND c.status = ?';
      params.push(status);
    }
    query += ' ORDER BY c.created_at DESC';
    const list = db.prepare(query).all(...params);
    res.json({ success: true, data: list });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /cables/scene — 获取带 3D 坐标的全部线缆（供 DataRoom3D Scene 使用）
 * 每条线缆的 a_position 和 b_position 基于机柜位置+U位计算
 */
router.get('/scene', (_req: Request, res: Response) => {
  try {
    const PER_U = 0.04445;
    const RACK_W = 2.3;

    // 获取所有机柜位置
    const racks = db.prepare('SELECT id, name, position_x, position_z, total_u FROM dc_racks').all() as any[];
    const rackPosMap: Record<string, { x: number; z: number; baseY: number }> = {};
    for (const r of racks) {
      rackPosMap[r.id] = { x: r.position_x || 0, z: r.position_z || 0, baseY: 0 };
    }

    // 获取所有槽位（设备到机柜的映射）
    const slots = db.prepare(`
      SELECT s.device_id, s.device_type, s.rack_id, s.start_u, s.end_u
      FROM dc_rack_slots s WHERE s.device_id IS NOT NULL AND s.device_id != ''
    `).all() as any[];

    // 构建 device → { rackId, startU, endU } 映射
    const deviceRackMap: Record<string, { rackId: string; startU: number; endU: number }> = {};
    for (const sl of slots) {
      deviceRackMap[sl.device_id] = { rackId: sl.rack_id, startU: sl.start_u, endU: sl.end_u };
    }

    // 获取所有线缆
    const cables = db.prepare(`
      SELECT c.*,
        COALESCE(s1.name, nd1.name, '') as a_device_name,
        COALESCE(s2.name, nd2.name, '') as b_device_name
      FROM dc_cables c
      LEFT JOIN servers s1 ON c.a_device_type='server' AND c.a_device_id = s1.id
      LEFT JOIN servers s2 ON c.b_device_type='server' AND c.b_device_id = s2.id
      LEFT JOIN network_devices nd1 ON c.a_device_type='network_device' AND c.a_device_id = nd1.id
      LEFT JOIN network_devices nd2 ON c.b_device_type='network_device' AND c.b_device_id = nd2.id
      ORDER BY c.created_at DESC
    `).all() as any[];

    // 为每条线缆计算 3D 坐标
    const result = cables.map(c => {
      const aDev = deviceRackMap[c.a_device_id];
      const bDev = deviceRackMap[c.b_device_id];
      const aRack = aDev ? rackPosMap[aDev.rackId] : null;
      const bRack = bDev ? rackPosMap[bDev.rackId] : null;

      const aPos: [number, number, number] = aRack
        ? [aRack.x + RACK_W / 2 + 0.3, aDev.startU * PER_U, aRack.z]
        : [0, 0, 0];
      const bPos: [number, number, number] = bRack
        ? [bRack.x + RACK_W / 2 + 0.3, bDev.startU * PER_U, bRack.z]
        : [0, 0, 0];

      return {
        id: c.id,
        name: c.name || '',
        cable_type: c.cable_type || 'cat6',
        cable_color: c.cable_color || '',
        status: c.status || 'connected',
        a_device_id: c.a_device_id,
        a_device_name: c.a_device_name || c.a_device_id,
        a_port_name: c.a_port_name || '',
        b_device_id: c.b_device_id,
        b_device_name: c.b_device_name || c.b_device_id,
        b_port_name: c.b_port_name || '',
        a_position: aPos,
        b_position: bPos,
      };
    });

    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /cables/topology/:rackId — 获取某个机柜内所有设备的连接拓扑
 * 用于 3D 场景中的线缆渲染
 */
router.get('/topology/:rackId', (req: Request, res: Response) => {
  try {
    const rackId = req.params.rackId;
    // 先找该机柜内的所有设备
    const devices = db.prepare(`
      SELECT DISTINCT s.id as device_id, 'server' as device_type, s.name as device_name,
        COALESCE(s.ip_address, '') as ip_address
      FROM dc_rack_slots sl
      JOIN servers s ON sl.device_id = s.id
      WHERE sl.rack_id = ? AND sl.device_type = 'server'
      UNION
      SELECT DISTINCT nd.id, 'network_device', nd.name, COALESCE(nd.ip_address, '')
      FROM dc_rack_slots sl
      JOIN network_devices nd ON sl.device_id = nd.id
      WHERE sl.rack_id = ? AND sl.device_type = 'network_device'
    `).all(rackId, rackId) as any[];

    const deviceIds = devices.map(d => d.device_id);
    let cables: any[] = [];
    if (deviceIds.length > 0) {
      const placeholders = deviceIds.map(() => '?').join(',');
      cables = db.prepare(`
        SELECT c.* FROM dc_cables c
        WHERE (c.a_device_id IN (${placeholders}) OR c.b_device_id IN (${placeholders}))
          AND c.status = 'connected'
        ORDER BY c.name
      `).all(...deviceIds, ...deviceIds);
    }

    res.json({ success: true, data: { devices, cables } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /cables — 创建线缆连接
 */
router.post('/', (req: Request, res: Response) => {
  try {
    const { name, cable_type, cable_color, length_m, status,
            a_device_id, a_device_type, a_port_name,
            b_device_id, b_device_type, b_port_name, description } = req.body;
    if (!a_device_id || !b_device_id) {
      return res.status(400).json({ success: false, message: 'a_device_id and b_device_id required' });
    }
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO dc_cables (id, name, cable_type, cable_color, length_m, status,
        a_device_id, a_device_type, a_port_name,
        b_device_id, b_device_type, b_port_name, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name || '', cable_type || 'cat6', cable_color || '', length_m || null,
      status || 'connected',
      a_device_id, a_device_type || 'server', a_port_name || '',
      b_device_id, b_device_type || 'network_device', b_port_name || '',
      description || '');
    res.json({ success: true, data: { id } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /cables/:id — 更新线缆
 */
router.put('/:id', (req: Request, res: Response) => {
  try {
    const { name, cable_type, cable_color, length_m, status, description } = req.body;
    db.prepare(`
      UPDATE dc_cables SET name=?, cable_type=?, cable_color=?, length_m=?, status=?, description=?,
        updated_at=datetime('now','localtime')
      WHERE id=?
    `).run(name || '', cable_type || 'cat6', cable_color || '', length_m || null,
      status || 'connected', description || '', req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * DELETE /cables/:id — 删除线缆
 */
router.delete('/:id', (req: Request, res: Response) => {
  try {
    db.prepare('DELETE FROM dc_cables WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
