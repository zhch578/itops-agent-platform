import { Router, Request, Response } from 'express';
import db from '../models/database';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { requireRole } from '../middleware/auth';
import { z } from 'zod';
import { validateBody, validateParams } from '../middleware/validation';

// Ensure upload directory exists
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads/tool-icons');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    cb(null, `${randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  },
});

const router = Router();

const toolLinkIdSchema = z.object({ id: z.string().uuid('无效的工具ID') });

const createToolLinkSchema = z.object({
  name: z.string().min(1, '工具名称不能为空').max(100),
  url: z.string().url('请输入有效的URL').max(2048),
  icon: z.string().max(50).optional().default('ExternalLink'),
  category: z.string().max(100).optional().default('未分类'),
  description: z.string().max(500).optional().default(''),
  sort_order: z.number().int().min(0).optional().default(0),
  is_external: z.boolean().optional().default(true),
});

const updateToolLinkSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  url: z.string().url('请输入有效的URL').max(2048).optional(),
  icon: z.string().max(50).optional(),
  category: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  sort_order: z.number().int().min(0).optional(),
  is_external: z.boolean().optional(),
});

interface ToolLink {
  id: string;
  name: string;
  url: string;
  icon: string;
  image_icon: string | null;
  category: string;
  description: string | null;
  sort_order: number;
  is_external: number;
  created_at: string;
  updated_at: string;
}

// GET /api/tool-links — 获取全部工具链接，按分类分组
router.get('/', (_req: Request, res: Response) => {
  try {
    const rows = db.prepare('SELECT * FROM tool_links ORDER BY sort_order ASC, name ASC').all() as ToolLink[];
    res.json({ success: true, data: rows });
  } catch (error: any) {
    res.status(500).json({ success: false, error: '获取工具链接失败', details: error.message });
  }
});

// GET /api/tool-links/categories — 获取分组数据
router.get('/categories', (_req: Request, res: Response) => {
  try {
    const rows = db.prepare('SELECT * FROM tool_links ORDER BY sort_order ASC, name ASC').all() as ToolLink[];
    const grouped: Record<string, ToolLink[]> = {};
    for (const row of rows) {
      const cat = row.category || '未分类';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(row);
    }
    res.json({ success: true, data: grouped });
  } catch (error: any) {
    res.status(500).json({ success: false, error: '获取分类工具链接失败', details: error.message });
  }
});

// GET /api/tool-links/:id — 获取单个
router.get('/:id', validateParams(toolLinkIdSchema), (req: Request, res: Response) => {
  try {
    const row = db.prepare('SELECT * FROM tool_links WHERE id = ?').get(req.params.id) as ToolLink | undefined;
    if (!row) {
      res.status(404).json({ success: false, error: '工具链接不存在' });
      return;
    }
    res.json({ success: true, data: row });
  } catch (error: any) {
    res.status(500).json({ success: false, error: '获取工具链接失败', details: error.message });
  }
});

// POST /api/tool-links — 新增
router.post('/', requireRole('admin', 'operator'), validateBody(createToolLinkSchema), (req: Request, res: Response) => {
  try {
    const { name, url, icon, category, description, sort_order, is_external } = req.body;
    const id = randomUUID();
    db.prepare(`
      INSERT INTO tool_links (id, name, url, icon, category, description, sort_order, is_external)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, url, icon || 'ExternalLink', category || '未分类', description || '', sort_order || 0, is_external ? 1 : 0);
    const row = db.prepare('SELECT * FROM tool_links WHERE id = ?').get(id) as ToolLink;
    res.status(201).json({ success: true, data: row });
  } catch (error: any) {
    res.status(500).json({ success: false, error: '创建工具链接失败', details: error.message });
  }
});

// PUT /api/tool-links/:id — 更新
router.put('/:id', requireRole('admin', 'operator'), validateParams(toolLinkIdSchema), validateBody(updateToolLinkSchema), (req: Request, res: Response) => {
  try {
    const existing = db.prepare('SELECT * FROM tool_links WHERE id = ?').get(req.params.id) as ToolLink | undefined;
    if (!existing) {
      res.status(404).json({ success: false, error: '工具链接不存在' });
      return;
    }
    const { name, url, icon, category, description, sort_order, is_external } = req.body;
    db.prepare(`
      UPDATE tool_links SET
        name = COALESCE(?, name),
        url = COALESCE(?, url),
        icon = COALESCE(?, icon),
        category = COALESCE(?, category),
        description = COALESCE(?, description),
        sort_order = COALESCE(?, sort_order),
        is_external = COALESCE(?, is_external),
        updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(
      name ?? null,
      url ?? null,
      icon ?? null,
      category ?? null,
      description !== undefined ? description : null,
      sort_order ?? null,
      is_external !== undefined ? (is_external ? 1 : 0) : null,
      req.params.id
    );
    const row = db.prepare('SELECT * FROM tool_links WHERE id = ?').get(req.params.id) as ToolLink;
    res.json({ success: true, data: row });
  } catch (error: any) {
    res.status(500).json({ success: false, error: '更新工具链接失败', details: error.message });
  }
});

// POST /api/tool-links/:id/upload-icon — 上传自定义图标
router.post('/:id/upload-icon', requireRole('admin', 'operator'), validateParams(toolLinkIdSchema), upload.single('icon'), (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: '请选择要上传的图片' });
      return;
    }
    const imagePath = `/uploads/tool-icons/${req.file.filename}`;
    db.prepare(`UPDATE tool_links SET image_icon = ?, updated_at = datetime('now','localtime') WHERE id = ?`).run(imagePath, req.params.id);
    const row = db.prepare('SELECT * FROM tool_links WHERE id = ?').get(req.params.id) as ToolLink;
    res.json({ success: true, data: row, imageUrl: imagePath });
  } catch (error: any) {
    res.status(500).json({ success: false, error: '上传图标失败', details: error.message });
  }
});

// DELETE /api/tool-links/:id/icon — 删除自定义图标，恢复默认
router.delete('/:id/icon', requireRole('admin', 'operator'), validateParams(toolLinkIdSchema), (req: Request, res: Response) => {
  try {
    const existing = db.prepare('SELECT * FROM tool_links WHERE id = ?').get(req.params.id) as ToolLink | undefined;
    if (existing?.image_icon) {
      const filePath = path.join(UPLOAD_DIR, path.basename(existing.image_icon));
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    db.prepare(`UPDATE tool_links SET image_icon = NULL, updated_at = datetime('now','localtime') WHERE id = ?`).run(req.params.id);
    res.json({ success: true, message: '图标已重置' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: '删除图标失败', details: error.message });
  }
});

// DELETE /api/tool-links/:id — 删除
router.delete('/:id', requireRole('admin', 'operator'), validateParams(toolLinkIdSchema), (req: Request, res: Response) => {
  try {
    const existing = db.prepare('SELECT * FROM tool_links WHERE id = ?').get(req.params.id) as ToolLink | undefined;
    if (!existing) {
      res.status(404).json({ success: false, error: '工具链接不存在' });
      return;
    }
    db.prepare('DELETE FROM tool_links WHERE id = ?').run(req.params.id);
    res.json({ success: true, message: '工具链接已删除' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: '删除工具链接失败', details: error.message });
  }
});

export default router;
