import type { Request, Response } from 'express';
import { Router } from 'express';
import { db } from '../../models/database';

const router = Router();

// GET /lifecycle — 生命周期记录
router.get('/', (req: Request, res: Response) => {
  try {
    const { action, limit } = req.query;
    let query = 'SELECT * FROM dc_device_lifecycle';
    const params: any[] = [];
    if (action) { query += ' WHERE action = ?'; params.push(action); }
    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(Number(limit) || 500);
    const records = db.prepare(query).all(...params);
    res.json({ success: true, data: records });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
