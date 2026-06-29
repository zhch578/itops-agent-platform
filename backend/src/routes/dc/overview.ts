import type { Request, Response } from 'express';
import { Router } from 'express';
import { db } from '../../models/database';

const router = Router();

// GET /overview — DataRoom 3D 总览数据（聚合所有资产）
router.get('/', (_req: Request, res: Response) => {
  try {
    // 检查是否有数据
    const realRooms = db.prepare('SELECT * FROM dc_rooms ORDER BY sort_order').all() as any[];
    const realRackCount = (db.prepare('SELECT COUNT(*) as c FROM dc_racks').get() as any)?.c || 0;
    const realSlotCount = (db.prepare('SELECT COUNT(*) as c FROM dc_rack_slots').get() as any)?.c || 0;
    const hasData = realRackCount > 0 || realSlotCount > 0;

    if (!hasData) {
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
          rackData: [], slotData: [], isEmpty: true,
        }
      });
    }

    // 加载真实数据
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
        ser.cpu_cores, (ser.memory_gb * 1000) as memory_mb,
        nd.status as net_status, vm.status as vm_status
      FROM dc_rack_slots s
      LEFT JOIN servers ser ON s.device_type='server' AND s.device_id = ser.id
      LEFT JOIN network_devices nd ON s.device_type='network_device' AND s.device_id = nd.id
      LEFT JOIN virtual_machines vm ON s.device_type='vm_host' AND s.device_id = vm.id
    `).all();

    // 统计
    const rackCounts: Record<string, number> = {};
    const roomDeviceCounts: Record<string, number> = {};
    let totalDevices = 0, onlineDevices = 0, alertDevices = 0;
    const rackAlertMap: Record<string, number> = {};

    for (const slot of allSlots as any[]) {
      if (!slot.device_id) continue;
      totalDevices++;
      rackCounts[slot.rack_id] = (rackCounts[slot.rack_id] || 0) + 1;
      if (slot.server_status === 'online') onlineDevices++;

      // 告警检测：按服务器真实状态判断
      if (slot.server_status && slot.server_status !== 'online' && slot.server_status !== 'offline') {
        rackAlertMap[slot.rack_id] = (rackAlertMap[slot.rack_id] || 0) + 1;
        alertDevices++;
      }
    }

    for (const rack of rackData as any[]) {
      roomDeviceCounts[rack.room_id] = (roomDeviceCounts[rack.room_id] || 0) + (rackCounts[rack.id] || 0);
    }

    res.json({
      success: true,
      data: {
        rooms: realRooms,
        summary: {
          totalRooms: realRooms.length,
          totalRacks: rackData.length,
          totalDevices,
          onlineDevices,
          offlineDevices: totalDevices - onlineDevices,
          alertDevices,
          avgTemp: realRooms.reduce((s, r) => s + (r.current_temperature || 25), 0) / (realRooms.length || 1),
          avgHumidity: realRooms.reduce((s, r) => s + (r.current_humidity || 50), 0) / (realRooms.length || 1),
          pue: realRooms.length > 0 ? (realRooms.reduce((s, r) => s + (r.pue || 1.45), 0) / realRooms.length) : 1.45,
          totalPowerKw: realRooms.length > 0 ? realRooms.reduce((s, r) => s + (r.total_power_kw || 0), 0) : (totalDevices * 0.35),
        },
        rackData: (rackData as any[]).map(r => ({
          ...r,
          device_count: rackCounts[r.id] || 0,
          alert_count: rackAlertMap[r.id] || 0,
        })),
        slotData: allSlots,
        isEmpty: false, isPartialMock: false,
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
