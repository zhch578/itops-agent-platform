import type { Request, Response } from 'express';
import { Router } from 'express';
import { db } from '../../models/database';

const router = Router();

// GET /devices — 按机房/机柜分组的设备分布（供设备分布Tab）
router.get('/', (_req: Request, res: Response) => {
  try {
    const rooms = db.prepare('SELECT * FROM dc_rooms ORDER BY sort_order').all() as any[];
    const groups = rooms.map(room => {
      const racks = db.prepare(`
        SELECT r.*, (
          SELECT COALESCE(json_group_array(json_object(
            'slot_id', s.id, 'device_id', s.device_id, 'device_name', COALESCE(ser.name, nd.name, vm.name, s.device_id),
            'device_type', s.device_type, 'start_u', s.start_u, 'end_u', s.end_u,
            'ip_address', COALESCE(ser.ip_address, nd.ip_address, ''),
            'server_status', CASE WHEN ser.enabled = 1 THEN 'online' ELSE 'offline' END
          )), '[]') FROM dc_rack_slots s
          LEFT JOIN servers ser ON s.device_type='server' AND s.device_id = ser.id
          LEFT JOIN network_devices nd ON s.device_type='network_device' AND s.device_id = nd.id
          LEFT JOIN virtual_machines vm ON s.device_type='vm_host' AND s.device_id = vm.id
          WHERE s.rack_id = r.id AND s.device_id IS NOT NULL
        ) as devices_json
        FROM dc_racks r WHERE r.room_id = ? ORDER BY r.sort_order
      `).all(room.id) as any[];

      const rackMap: Record<string, any> = {};
      for (const rack of racks) {
        rackMap[rack.name] = {
          rack_id: rack.id, rack_name: rack.name,
          devices: JSON.parse(rack.devices_json || '[]'),
        };
      }
      return { room_id: room.id, room_name: room.label || room.name, racks: rackMap };
    });

    res.json({ success: true, data: { groups } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /devices/unallocated — 获取未分配的设备
router.get('/unallocated', (req: Request, res: Response) => {
  try {
    const search = (req.query.search as string) || '';
    const assignedIds = db.prepare('SELECT DISTINCT device_id FROM dc_rack_slots').all()
      .map((r: any) => r.device_id);
    const idSet = assignedIds.length > 0 ? assignedIds.map(() => '?').join(',') : '\'\'';

    const servers = buildUnallocatedQuery('servers', 'id, name, ip_address, enabled, cpu_cores, memory_gb', 'server', assignedIds, idSet, search);
    const netDevs = buildUnallocatedQuery('network_devices', 'id, name, ip_address, status', 'network_device', assignedIds, idSet, search);
    const vms = buildUnallocatedQuery('virtual_machines', 'id, name, status, cpu_cores, memory_mb', 'vm_host', assignedIds, idSet, search);

    const combined = [...servers, ...netDevs, ...vms].slice(0, 200);
    res.json({ success: true, data: combined });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

function buildUnallocatedQuery(table: string, cols: string, type: string, assignedIds: string[], idSet: string, search: string) {
  const params: any[] = [];
  let query = `SELECT ${cols}, ? as device_type FROM ${table}`;
  params.push(type);
  if (assignedIds.length > 0) {
    query += ` WHERE id NOT IN (${idSet})`;
    params.push(...assignedIds);
  }
  if (search) {
    query += (assignedIds.length > 0 ? ' AND' : ' WHERE') + ' (name LIKE ? OR ip_address LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  query += ' ORDER BY name LIMIT 200';
  return db.prepare(query).all(...params);
}

export default router;
