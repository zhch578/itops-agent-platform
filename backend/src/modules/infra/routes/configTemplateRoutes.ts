import type { Request, Response } from 'express';
import { Router } from 'express';
import { db } from '../../../models/database';
import crypto from 'crypto';
import { requireRole } from '../../../middleware/auth';

const router = Router();

// GET /
router.get('/', (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const offset = (page - 1) * pageSize;
    const type = req.query.type as string || '';
    const target = req.query.target_type as string || '';
    const search = req.query.search as string || '';

    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (type) { where += ' AND type = ?'; params.push(type); }
    if (target) { where += ' AND target_type = ?'; params.push(target); }
    if (search) { where += ' AND (name LIKE ? OR description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

    const total = (db.prepare(`SELECT COUNT(*) as count FROM config_templates ${where}`).get(...params) as any)?.count || 0;
    const data = db.prepare(`SELECT * FROM config_templates ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
    res.json({ success: true, data, total });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /:id
router.get('/:id', (req: Request, res: Response) => {
  try {
    const item = db.prepare('SELECT * FROM config_templates WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: '未找到' });
    res.json({ success: true, data: item });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /
router.post('/', (req: Request, res: Response) => {
  try {
    const { name, description, type, content, variables, target_type, tags, created_by } = req.body;
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO config_templates (id, name, description, type, content, variables, target_type, tags, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name || '', description || '', type || 'generic', content || '', JSON.stringify(variables || []), target_type || 'server', JSON.stringify(tags || []), created_by || '');
    res.json({ success: true, data: { id } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /:id
router.put('/:id', (req: Request, res: Response) => {
  try {
    const { name, description, type, content, variables, target_type, tags } = req.body;
    db.prepare(`
      UPDATE config_templates SET name=?, description=?, type=?, content=?, variables=?, target_type=?, tags=?, version=version+1, updated_at=datetime('now','localtime') WHERE id=?
    `).run(name || '', description || '', type || 'generic', content || '', JSON.stringify(variables || []), target_type || 'server', JSON.stringify(tags || []), req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /:id
router.delete('/:id', requireRole('admin', 'operator'), (req: Request, res: Response) => {
  try {
    db.prepare('DELETE FROM config_templates WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /:id/render — 渲染模板
router.post('/:id/render', (req: Request, res: Response) => {
  try {
    const tmpl = db.prepare('SELECT * FROM config_templates WHERE id = ?').get(req.params.id) as any;
    if (!tmpl) return res.status(404).json({ success: false, message: '未找到' });

    const variables = req.body.variables || {};
    let rendered = tmpl.content;
    const tmplVars = JSON.parse(tmpl.variables || '[]') as string[];
    for (const v of tmplVars) {
      rendered = rendered.replace(new RegExp(`\\{\\{\\s*${v}\\s*\\}\\}`, 'g'), variables[v] || '');
    }
    res.json({ success: true, data: { rendered } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /:id/apply — 应用到目标
router.post('/:id/apply', requireRole('admin', 'operator'), (req: Request, res: Response) => {
  try {
    const tmpl = db.prepare('SELECT * FROM config_templates WHERE id = ?').get(req.params.id) as any;
    if (!tmpl) return res.status(404).json({ success: false, message: '未找到' });

    // 创建应用任务
    const taskId = crypto.randomUUID();
    const targetIds = req.body.target_ids || [];
    db.prepare(`
      INSERT INTO tasks (id, name, status, workflow_id, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, datetime('now','localtime'), datetime('now','localtime'))
    `).run(taskId, `应用模板: ${tmpl.name}`, tmpl.id);

    res.json({ success: true, data: { taskId, targetIds } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
