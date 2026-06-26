import { useState, useEffect } from 'react';
import { Table, Button, Modal, Tag, Space, message, Drawer, Select, Descriptions } from 'antd';
import { Search, RefreshCw, Play, Square, RotateCcw, Eye } from 'lucide-react';
import { Input } from 'antd';
import api from '../lib/api';

const statusColors: Record<string, string> = {
  running: 'green', stopped: 'red', paused: 'orange', exited: 'default',
};

export default function Containers() {
  const [data, setData] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState('');
  const [hostFilter, setHostFilter] = useState('');
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailItem, setDetailItem] = useState<any>(null);
  const [hosts, setHosts] = useState<string[]>([]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/containers', { params: { page, pageSize, search, host: hostFilter } });
      setData(res.data.data || []);
      setTotal(res.data.total || 0);
    } catch { message.error('加载失败'); }
    finally { setLoading(false); }
  };

  const fetchHosts = async () => {
    try { const res = await api.get('/api/containers/hosts'); setHosts((res.data.data || []).map((h: any) => h.host)); } catch {}
  };

  useEffect(() => { fetchData(); }, [page, pageSize, search, hostFilter]);
  useEffect(() => { fetchHosts(); }, []);

  const handleSync = async () => {
    try {
      const res = await api.post('/api/containers/sync', { serverId: 'mock-1' });
      message.success(`同步完成: ${res.data.data?.synced || 0} 个容器`);
      fetchData();
    } catch { message.error('同步失败'); }
  };

  const handleAction = async (id: string, action: 'start' | 'stop' | 'restart') => {
    try {
      await api.post(`/api/containers/${id}/${action}`);
      message.success(`操作成功`);
      fetchData();
    } catch { message.error('操作失败'); }
  };

  const showDetail = (record: any) => {
    setDetailItem(record);
    setDetailVisible(true);
  };

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name' },
    { title: '镜像', dataIndex: 'image', key: 'image', ellipsis: true },
    { title: '状态', dataIndex: 'status', key: 'status', render: (s: string) => <Tag color={statusColors[s] || 'default'}>{s}</Tag> },
    { title: '主机', dataIndex: 'host', key: 'host' },
    { title: '端口映射', dataIndex: 'port_mappings', key: 'port_mappings', render: (p: string) => {
      const ports = typeof p === 'string' ? JSON.parse(p || '[]') : (p || []);
      return ports.join(', ');
    }, ellipsis: true },
    { title: '操作', key: 'action', width: 220, render: (_: any, record: any) => (
      <Space>
        <Button type="link" size="small" icon={<Eye size={14} />} onClick={() => showDetail(record)}>详情</Button>
        <Button type="link" size="small" icon={<Play size={14} />} style={{ color: '#52c41a' }} onClick={() => handleAction(record.id, 'start')}>启动</Button>
        <Button type="link" size="small" danger icon={<Square size={14} />} onClick={() => handleAction(record.id, 'stop')}>停止</Button>
        <Button type="link" size="small" icon={<RotateCcw size={14} />} onClick={() => handleAction(record.id, 'restart')}>重启</Button>
      </Space>
    )},
  ];

  return (
    <div className="p-6">
      <div className="flex items-center gap-3 mb-4">
        <Input placeholder="搜索容器名/镜像..." prefix={<Search size={14} className="text-gray-400" />} className="w-64" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} allowClear />
        <Select placeholder="主机筛选" className="w-40" value={hostFilter || undefined} onChange={v => { setHostFilter(v || ''); setPage(1); }} allowClear>
          {hosts.map(h => <Select.Option key={h} value={h}>{h}</Select.Option>)}
        </Select>
        <Button icon={<RefreshCw size={14} />} onClick={fetchData}>刷新</Button>
        <Button type="primary" icon={<RefreshCw size={14} />} onClick={handleSync}>同步</Button>
      </div>

      <Table columns={columns} dataSource={data} rowKey="id" loading={loading}
        pagination={{ current: page, pageSize, total, onChange: (p, ps) => { setPage(p); setPageSize(ps); } }}
      />

      <Drawer title="容器详情" open={detailVisible} onClose={() => setDetailVisible(false)} width={480}>
        {detailItem && (
          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="名称">{detailItem.name}</Descriptions.Item>
            <Descriptions.Item label="容器ID">{detailItem.container_id}</Descriptions.Item>
            <Descriptions.Item label="镜像">{detailItem.image}</Descriptions.Item>
            <Descriptions.Item label="状态"><Tag color={(statusColors[detailItem.status] || '')}>{detailItem.status}</Tag></Descriptions.Item>
            <Descriptions.Item label="主机">{detailItem.host || '-'}</Descriptions.Item>
            <Descriptions.Item label="端口映射">{
              (() => {
                const ports = typeof detailItem.port_mappings === 'string' ? JSON.parse(detailItem.port_mappings || '[]') : (detailItem.port_mappings || []);
                return ports.join(', ') || '-';
              })()
            }</Descriptions.Item>
            <Descriptions.Item label="创建时间">{detailItem.created_at}</Descriptions.Item>
            <Descriptions.Item label="更新时间">{detailItem.updated_at}</Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </div>
  );
}
