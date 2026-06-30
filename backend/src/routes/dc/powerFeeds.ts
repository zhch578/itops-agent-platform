import type { Request, Response } from 'express';
import { Router } from 'express';
import { db } from '../../models/database';
import crypto from 'crypto';

const router = Router();

/**
 * GET /power-feeds — 获取全部供电线路
 */
router.get('/', (req: Request, res: Response) => {
  try {
    const panelId = req.query.power_panel_id as string;
    let list: any[];
    if (panelId) {
      list = db.prepare(`
        SELECT pf.*, pp.name as panel_name, r.name as rack_name, r.label as rack_label
        FROM dc_power_feeds pf
        JOIN dc_power_panels pp ON pp.id = pf.power_panel_id
        LEFT JOIN dc_racks r ON r.id = pf.rack_id
        WHERE pf.power_panel_id = ? ORDER BY pf.name
      `).all(panelId);
    } else {
      list = db.prepare(`
        SELECT pf.*, pp.name as panel_name, r.name as rack_name, r.label as rack_label
        FROM dc_power_feeds pf
        JOIN dc_power_panels pp ON pp.id = pf.power_panel_id
        LEFT JOIN dc_racks r ON r.id = pf.rack_id
        ORDER BY pp.name, pf.name
      `).all();
    }
    res.json({ success: true, data: list });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /power-feeds/rack/:rackId — 获取指定机柜的所有供电线路（用于功耗计算）
 */
router.get('/rack/:rackId', (req: Request, res: Response) => {
  try {
    const feeds = db.prepare(`
      SELECT pf.*, pp.name as panel_name
      FROM dc_power_feeds pf
      JOIN dc_power_panels pp ON pp.id = pf.power_panel_id
      WHERE pf.rack_id = ? ORDER BY pf.feed_type, pf.name
    `).all(req.params.rackId);
    res.json({ success: true, data: feeds });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /power-feeds/:id — 单条供电线路详情
 */
router.get('/:id', (req: Request, res: Response) => {
  try {
    const feed = db.prepare(`
      SELECT pf.*, pp.name as panel_name, pp.room_id,
        r.name as rack_name, r.label as rack_label
      FROM dc_power_feeds pf
      JOIN dc_power_panels pp ON pp.id = pf.power_panel_id
      LEFT JOIN dc_racks r ON r.id = pf.rack_id
      WHERE pf.id = ?
    `).get(req.params.id);
    if (!feed) return res.status(404).json({ success: false, message: 'Power feed not found' });
    res.json({ success: true, data: feed });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /power-feeds — 创建供电线路
 */
router.post('/', (req: Request, res: Response) => {
  try {
    const { power_panel_id, rack_id, name, status, feed_type, supply, voltage, amperage, max_utilization_pct, current_load_w, description } = req.body;
    if (!power_panel_id || !name) return res.status(400).json({ success: false, message: 'power_panel_id and name required' });
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO dc_power_feeds (id, power_panel_id, rack_id, name, status, feed_type, supply, voltage, amperage, max_utilization_pct, current_load_w, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, power_panel_id, rack_id || null, name, status || 'active', feed_type || 'primary',
      supply || 'ac', voltage || 220, amperage || 16, max_utilization_pct || 80, current_load_w || 0, description || '');
    res.json({ success: true, data: { id } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * PUT /power-feeds/:id — 更新供电线路
 */
router.put('/:id', (req: Request, res: Response) => {
  try {
    const { rack_id, name, status, feed_type, supply, voltage, amperage, max_utilization_pct, current_load_w, description } = req.body;
    db.prepare(`
      UPDATE dc_power_feeds SET rack_id=?, name=?, status=?, feed_type=?, supply=?,
        voltage=?, amperage=?, max_utilization_pct=?, current_load_w=?, description=?,
        updated_at=datetime('now','localtime')
      WHERE id=?
    `).run(rack_id || null, name, status || 'active', feed_type || 'primary', supply || 'ac',
      voltage || 220, amperage || 16, max_utilization_pct || 80, current_load_w || 0,
      description || '', req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * DELETE /power-feeds/:id — 删除供电线路
 */
router.delete('/:id', (req: Request, res: Response) => {
  try {
    db.prepare('DELETE FROM dc_power_feeds WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
