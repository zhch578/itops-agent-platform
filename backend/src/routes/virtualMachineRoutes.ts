import { Router, Request, Response } from 'express';
import { db } from '../models/database';
import crypto from 'crypto';

const router = Router();

// GET /
router.get('/', (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;
    const offset = (page - 1) * pageSize;
    const status = req.query.status as string || '';
    const hypervisor = req.query.hypervisor as string || '';
    const search = req.query.search as string || '';

    let where = 'WHERE 1=1';
    const params: any[] = [];
    if (status) { where += ' AND status = ?'; params.push(status); }
    if (hypervisor) { where += ' AND hypervisor = ?'; params.push(hypervisor); }
    if (search) { where += ' AND (name LIKE ? OR host LIKE ? OR ip_address LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }

    const total = (db.prepare(`SELECT COUNT(*) as count FROM virtual_machines ${where}`).get(...params) as any)?.count || 0;
    const data = db.prepare(`SELECT * FROM virtual_machines ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
    res.json({ success: true, data, total });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /stats
router.get('/stats', (_req: Request, res: Response) => {
  try {
    const total = (db.prepare('SELECT COUNT(*) as count FROM virtual_machines').get() as any)?.count || 0;
    const byStatus = db.prepare('SELECT status, COUNT(*) as count FROM virtual_machines GROUP BY status').all();
    const totalCpu = (db.prepare('SELECT SUM(cpu_cores) as sum FROM virtual_machines').get() as any)?.sum || 0;
    const totalMem = (db.prepare('SELECT SUM(memory_mb) as sum FROM virtual_machines').get() as any)?.sum || 0;
    res.json({ success: true, data: { total, byStatus, totalCpu, totalMem } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// GET /:id
router.get('/:id', (req: Request, res: Response) => {
  try {
    const item = db.prepare('SELECT * FROM virtual_machines WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: '未找到' });
    res.json({ success: true, data: item });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /
router.post('/', (req: Request, res: Response) => {
  try {
    const { name, host, os, cpu_cores, memory_mb, disk_gb, ip_address, hypervisor, agent_id, server_id, tags, notes } = req.body;
    const id = crypto.randomUUID();
    db.prepare(`
      INSERT INTO virtual_machines (id, name, host, status, os, cpu_cores, memory_mb, disk_gb, ip_address, hypervisor, agent_id, server_id, tags, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name || '', host || '', 'stopped', os || '', cpu_cores || 0, memory_mb || 0, disk_gb || 0, ip_address || '', hypervisor || '', agent_id || '', server_id || '', JSON.stringify(tags || []), notes || '');
    res.json({ success: true, data: { id } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PUT /:id
router.put('/:id', (req: Request, res: Response) => {
  try {
    const { name, host, status, os, cpu_cores, memory_mb, disk_gb, ip_address, hypervisor, tags, notes } = req.body;
    db.prepare(`
      UPDATE virtual_machines SET name=?, host=?, status=?, os=?, cpu_cores=?, memory_mb=?, disk_gb=?, ip_address=?, hypervisor=?, tags=?, notes=?, updated_at=datetime('now','localtime') WHERE id=?
    `).run(name || '', host || '', status || '', os || '', cpu_cores || 0, memory_mb || 0, disk_gb || 0, ip_address || '', hypervisor || '', JSON.stringify(tags || []), notes || '', req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /:id
router.delete('/:id', (req: Request, res: Response) => {
  try {
    db.prepare('DELETE FROM virtual_machines WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /:id/start
router.post('/:id/start', (req: Request, res: Response) => {
  try {
    db.prepare("UPDATE virtual_machines SET status='running', updated_at=datetime('now','localtime') WHERE id=?").run(req.params.id);
    res.json({ success: true, message: '虚拟机已开机' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /:id/stop
router.post('/:id/stop', (req: Request, res: Response) => {
  try {
    db.prepare("UPDATE virtual_machines SET status='stopped', updated_at=datetime('now','localtime') WHERE id=?").run(req.params.id);
    res.json({ success: true, message: '虚拟机关机' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /:id/restart
router.post('/:id/restart', (req: Request, res: Response) => {
  try {
    db.prepare("UPDATE virtual_machines SET status='running', updated_at=datetime('now','localtime') WHERE id=?").run(req.params.id);
    res.json({ success: true, message: '虚拟机关机' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// POST /sync — 从 agent 同步
router.post('/sync', (req: Request, res: Response) => {
  try {
    const { serverId, vms } = req.body;
    const mockVMs = [
      { name: 'web-server-01', os: 'Ubuntu 22.04', cpu_cores: 4, memory_mb: 8192, disk_gb: 100, ip_address: '10.0.1.10', host: `server-${serverId || 'unknown'}`, hypervisor: 'VMware' },
      { name: 'db-server-01', os: 'CentOS 8', cpu_cores: 8, memory_mb: 16384, disk_gb: 500, ip_address: '10.0.1.20', host: `server-${serverId || 'unknown'}`, hypervisor: 'VMware' },
      { name: 'cache-node-01', os: 'Alpine 3.18', cpu_cores: 2, memory_mb: 4096, disk_gb: 50, ip_address: '10.0.1.30', host: `server-${serverId || 'unknown'}`, hypervisor: 'KVM' },
    ];
    const list = vms || mockVMs;
    for (const vm of list) {
      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO virtual_machines (id, name, host, status, os, cpu_cores, memory_mb, disk_gb, ip_address, hypervisor)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, vm.name || '', vm.host || '', 'running', vm.os || '', vm.cpu_cores || 0, vm.memory_mb || 0, vm.disk_gb || 0, vm.ip_address || '', vm.hypervisor || '');
    }
    res.json({ success: true, data: { synced: list.length } });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
