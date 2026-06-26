import { useState, useEffect } from 'react';
import { Table, Button, Modal, Form, Input, Select, Tag, Card, Statistic, Space, message, Popconfirm, Row, Col, InputNumber } from 'antd';
import { Plus, Edit, Trash2, Search, RefreshCw, Play, Square, RotateCcw } from 'lucide-react';
import api from '../lib/api';

const statusColors: Record<string, string> = {
  running: 'green', stopped: 'red', suspended: 'orange', unknown: 'default',
};

export default function VirtualMachines() {
  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();
  const [stats, setStats] = useState<any>({});

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/virtual-machines', { params: { page, pageSize, search, status: statusFilter } });
      setData(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch { message.error('加载失败'); }
    finally { setLoading(false); }
  };

  const fetchStats = async () => {
    try { const res = await api.get('/api/virtual-machines/stats'); setStats(res.data.data || {}); } catch {}
  };

  useEffect(() => { fetchData(); }, [page, pageSize, search, statusFilter]);
  useEffect(() => { fetchStats(); }, []);

  const handleSave = async () => {
    const values = await form.validateFields();
    try {
      if (editing) {
        await api.put(`/api/virtual-machines/${editing.id}`, values);
        message.success('更新成功');
      } else {
        await api.post('/api/virtual-machines', values);
        message.success('创建成功');
      }
      setModalOpen(false);
      setEditing(null);
      form.resetFields();
      fetchData();
      fetchStats();
    } catch { message.error('操作失败'); }
  };

  const handleDelete = async (id: string) => {
    try { await api.delete(`/api/virtual-machines/${id}`); message.success('删除成功'); fetchData(); fetchStats(); } catch { message.error('删除失败'); }
  };

  const handleAction = async (id: string, action: string) => {
    try { await api.post(`/api/virtual-machines/${id}/${action}`); message.success('操作成功'); fetchData(); } catch { message.error('操作失败'); }
  };

  const handleSync = async () => {
    try { const res = await api.post('/api/virtual-machines/sync', { serverId: 'mock-1' }); message.success(`同步完成: ${res.data.data?.synced || 0} 台`); fetchData(); fetchStats(); } catch { message.error('同步失败'); }
  };

  const openEdit = (record: any) => {
    setEditing(record);
    const vals = { ...record, tags: typeof record.tags === 'string' ? JSON.parse(record.tags || '[]') : (record.tags || []) };
    form.setFieldsValue(vals);
    setModalOpen(true);
  };

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: string) => <Tag color={statusColors[s] || 'default'}>{s}</Tag> },
    { title: '操作系统', dataIndex: 'os', key: 'os' },
    { title: 'CPU', dataIndex: 'cpu_cores', key: 'cpu_cores', render: (v: number) => `${v || 0} 核` },
    { title: '内存', dataIndex: 'memory_mb', key: 'memory_mb', render: (v: number) => `${Math.round((v || 0) / 1024)} GB` },
    { title: '磁盘', dataIndex: 'disk_gb', key: 'disk_gb', render: (v: number) => `${v || 0} GB` },
    { title: 'IP', dataIndex: 'ip_address', key: 'ip_address' },
    { title: '主机', dataIndex: 'host', key: 'host' },
    { title: '操作', key: 'action', width: 240, render: (_: any, record: any) => (
      <Space>
        <Button type="link" size="small" icon={<Play size={14} />} style={{ color: '#52c41a' }} onClick={() => handleAction(record.id, 'start')}>开机</Button>
        <Button type="link" size="small" danger icon={<Square size={14} />} onClick={() => handleAction(record.id, 'stop')}>关机</Button>
        <Button type="link" size="small" icon={<RotateCcw size={14} />} onClick={() => handleAction(record.id, 'restart')}>重启</Button>
        <Button type="link" size="small" icon={<Edit size={14} />} onClick={() => openEdit(record)}>编辑</Button>
        <Popconfirm title="确定删除?" onConfirm={() => handleDelete(record.id)}>
          <Button type="link" size="small" danger icon={<Trash2 size={14} />}>删除</Button>
        </Popconfirm>
      </Space>
    )},
  ];

  return (
    <div className="p-6">
      <Row gutter={16} className="mb-4">
        <Col span={6}><Card><Statistic title="总量" value={stats.total || 0} /></Card></Col>
        <Col span={6}><Card><Statistic title="CPU 总量" value={stats.totalCpu || 0} suffix="核" /></Card></Col>
        <Col span={6}><Card><Statistic title="内存总量" value={Math.round((stats.totalMem || 0) / 1024)} suffix="GB" /></Card></Col>
        <Col span={6}>
          {(stats.byStatus || []).map((s: any) => (
            <span key={s.status} className="mr-4"><Tag color={statusColors[s.status]}>{s.status}: {s.count}</Tag></span>
          ))}
        </Col>
      </Row>

      <div className="flex items-center gap-3 mb-4">
        <Input placeholder="搜索名称/IP..." prefix={<Search size={14} className="text-gray-400" />} className="w-64" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} allowClear />
        <Select placeholder="状态筛选" className="w-32" value={statusFilter || undefined} onChange={v => { setStatusFilter(v || ''); setPage(1); }} allowClear>
          <Select.Option value="running">运行中</Select.Option>
          <Select.Option value="stopped">已关机</Select.Option>
          <Select.Option value="suspended">已挂起</Select.Option>
        </Select>
        <Button icon={<RefreshCw size={14} />} onClick={fetchData}>刷新</Button>
        <Button icon={<RefreshCw size={14} />} onClick={handleSync}>同步VM</Button>
        <Button type="primary" icon={<Plus size={14} />} onClick={() => { setEditing(null); form.resetFields(); setModalOpen(true); }}>新建VM</Button>
      </div>

      <Table columns={columns} dataSource={data} rowKey="id" loading={loading}
        pagination={{ current: page, pageSize, total, onChange: (p, ps) => { setPage(p); setPageSize(ps); } }}
      />

      <Modal title={editing ? '编辑虚拟机' : '新建虚拟机'} open={modalOpen} onOk={handleSave} onCancel={() => { setModalOpen(false); setEditing(null); }} width={600}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item>
          <div className="grid grid-cols-2 gap-4">
            <Form.Item name="host" label="宿主机"><Input /></Form.Item>
            <Form.Item name="hypervisor" label="虚拟化平台"><Input /></Form.Item>
          </div>
          <Form.Item name="os" label="操作系统"><Input /></Form.Item>
          <div className="grid grid-cols-3 gap-4">
            <Form.Item name="cpu_cores" label="CPU 核数"><InputNumber min={1} className="w-full" /></Form.Item>
            <Form.Item name="memory_mb" label="内存 (MB)"><InputNumber min={128} className="w-full" /></Form.Item>
            <Form.Item name="disk_gb" label="磁盘 (GB)"><InputNumber min={10} className="w-full" /></Form.Item>
          </div>
          <Form.Item name="ip_address" label="IP 地址"><Input /></Form.Item>
          <Form.Item name="tags" label="标签"><Select mode="tags" placeholder="输入标签后回车" /></Form.Item>
          <Form.Item name="notes" label="备注"><Input.TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
