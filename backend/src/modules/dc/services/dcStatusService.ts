import type { Server as SocketIOServer } from 'socket.io';
import { db } from '../../../models/database';
import { emitToDC } from '../../../shared/websocket/handler';
import { logger } from '../../../utils/logger';

let intervalId: ReturnType<typeof setInterval> | null = null;

/** 轮询 DC 概览数据并推送到 WebSocket */
function pollAndEmit(io: SocketIOServer) {
  try {
    // 统计
    const rackCount = (db.prepare('SELECT COUNT(*) as c FROM dc_racks').get() as any)?.c || 0;
    const slotCount = (db.prepare('SELECT COUNT(*) as c FROM dc_rack_slots').get() as any)?.c || 0;
    const deviceCount = (db.prepare(`
      SELECT COUNT(*) as c FROM dc_rack_slots WHERE device_id IS NOT NULL
    `).get() as any)?.c || 0;
    const onlineCount = (db.prepare(`
      SELECT COUNT(*) as c FROM dc_rack_slots s
      LEFT JOIN servers ser ON s.device_type='server' AND s.device_id = ser.id
      WHERE ser.enabled = 1
    `).get() as any)?.c || 0;

    // 机柜实时利用率
    const rackUtil = db.prepare(`
      SELECT r.id, r.name,
        (SELECT COALESCE(SUM(end_u - start_u + 1), 0) FROM dc_rack_slots WHERE rack_id = r.id) as used_u,
        r.total_u,
        (SELECT COUNT(*) FROM dc_rack_slots WHERE rack_id = r.id AND device_id IS NOT NULL) as device_count
      FROM dc_racks r
      ORDER BY r.name
    `).all();

    // 房间温湿度
    const roomEnv = db.prepare(`
      SELECT id, name, label, current_temperature, current_humidity
      FROM dc_rooms
    `).all();

        // 告警统计 — 按机房关联的设备 ID 统计，避免 title 误匹配（如 "disk corruption"）
    const alertCount = (db.prepare(`
      SELECT COUNT(DISTINCT a.id) as c
      FROM alerts a
      JOIN dc_rack_slots s ON s.device_id = a.device_id AND s.device_id IS NOT NULL
      WHERE a.status != 'resolved'
    `).get() as any)?.c || 0;

    emitToDC(io, 'dc:status', {
      timestamp: Date.now(),
      summary: {
        totalRacks: rackCount,
        totalSlots: slotCount,
        totalDevices: deviceCount,
        onlineDevices: onlineCount,
        alertDevices: alertCount,
      },
      rackUtil,
      roomEnv,
    });
  } catch (err) {
    logger.error('DC status poll error:', err as Error);
  }
}

/** 启动 DC 状态推送（默认每 5 秒轮询） */
export function startDCStatusPush(io: SocketIOServer, intervalMs = 5000) {
  if (intervalId) return;
  logger.info(`🏢 DC status push started (interval: ${intervalMs}ms)`);
  // 立即推一次
  pollAndEmit(io);
  intervalId = setInterval(() => pollAndEmit(io), intervalMs);
}

export function stopDCStatusPush() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info('🏢 DC status push stopped');
  }
}
