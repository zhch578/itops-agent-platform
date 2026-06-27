import { useState, useEffect, useCallback } from 'react';
import { Table, Card, Tag, Select, Tabs, Row, Col, Progress, Button, Modal, Drawer, Descriptions, InputNumber, Space, message, Spin, Empty } from 'antd';
import { ReloadOutlined, EyeOutlined, DeleteOutlined, FileTextOutlined, PlusOutlined, MinusOutlined } from '@ant-design/icons';
import { Container, Server, Box, Cpu, MemoryStick } from 'lucide-react';
import api from '../lib/api';

// ==================== 类型定义 ====================
interface Namespace {
  name: string;
  status: string;
  creationTimestamp?: string;
}

interface Pod {
  name: string;
  namespace: string;
  status: string;
  ready: string;
  restarts: number;
  cpu?: string;
  memory?: string;
  ip: string;
  node: string;
  creationTimestamp: string;
}

interface PodDetail {
  name: string;
  namespace: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  conditions: Array<{ type: string; status: string; reason?: string; message?: string }>;
  containers: Array<{ name: string; image: string; ports: string[]; resources: Record<string, string> }>;
}

interface Deployment {
  name: string;
  namespace: string;
  replicas: number;
  availableReplicas: number;
  image: string;
  creationTimestamp: string;
}

interface DeploymentDetail {
  name: string;
  namespace: string;
  selector: Record<string, string>;
  strategy: string;
  podTemplate: string;
}

interface Service {
  name: string;
  namespace: string;
  type: string;
  clusterIP: string;
  externalIP: string;
  ports: string;
  creationTimestamp: string;
}

interface NodeInfo {
  name: string;
  status: string;
  cpuAllocated: number;
  cpuTotal: number;
  memoryAllocated: number;
  memoryTotal: number;
  podsCount: number;
  podsMax: number;
  kubeletVersion: string;
}

interface ClusterOverview {
  nodes: number;
  pods: number;
  services: number;
  deployments: number;
}

// ==================== 状态着色 ====================
const podStatusColors: Record<string, string> = {
  Running: 'green', Pending: 'orange', Failed: 'red', Succeeded: 'blue',
  Unknown: 'default', Terminating: 'purple', CrashLoopBackOff: 'red',
};

const serviceTypeColors: Record<string, string> = {
  ClusterIP: 'blue', NodePort: 'green', LoadBalancer: 'purple',
};

const nodeStatusColors: Record<string, string> = {
  Ready: 'green', NotReady: 'red', Unknown: 'orange',
};

// ==================== 主组件 ====================
export default function Kubernetes() {
  const [namespace, setNamespace] = useState<string>('');
  const [namespaces, setNamespaces] = useState<Namespace[]>([]);
  const [overview, setOverview] = useState<ClusterOverview>({ nodes: 0, pods: 0, services: 0, deployments: 0 });
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('pods');

  // Pods
  const [pods, setPods] = useState<Pod[]>([]);
  const [podDetailVisible, setPodDetailVisible] = useState(false);
  const [podDetail, setPodDetail] = useState<PodDetail | null>(null);
  const [podLogsVisible, setPodLogsVisible] = useState(false);
  const [podLogs, setPodLogs] = useState<string>('');
  const [podLogsLoading, setPodLogsLoading] = useState(false);

  // Deployments
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [depDetailVisible, setDepDetailVisible] = useState(false);
  const [depDetail, setDepDetail] = useState<DeploymentDetail | null>(null);
  const [scaleVisible, setScaleVisible] = useState(false);
  const [scaleTarget, setScaleTarget] = useState<Deployment | null>(null);
  const [scaleReplicas, setScaleReplicas] = useState(1);

  // Services
  const [services, setServices] = useState<Service[]>([]);

  // Nodes
  const [nodes, setNodes] = useState<NodeInfo[]>([]);

  // ==================== 数据获取 ====================
  const fetchNamespaces = useCallback(async () => {
    try {
      const res = await api.get('/api/kubernetes/namespaces');
      const nsList = res.data.data || [];
      setNamespaces(nsList);
      if (!namespace && nsList.length > 0) {
        setNamespace(nsList[0].name);
      }
    } catch { /* ignore */ }
  }, [namespace]);

  const fetchOverview = useCallback(async () => {
    try {
      const [podsRes, nodesRes, servicesRes, deploymentsRes] = await Promise.all([
        api.get('/api/kubernetes/pods', { params: { namespace: namespace || undefined } }),
        api.get('/api/kubernetes/nodes'),
        api.get('/api/kubernetes/services', { params: { namespace: namespace || undefined } }),
        api.get('/api/kubernetes/deployments', { params: { namespace: namespace || undefined } }),
      ]);
      setOverview({
        nodes: (nodesRes.data.data || []).length,
        pods: (podsRes.data.data || []).length,
        services: (servicesRes.data.data || []).length,
        deployments: (deploymentsRes.data.data || []).length,
      });
    } catch { /* ignore */ }
  }, [namespace]);

  const fetchPods = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/kubernetes/pods', { params: { namespace: namespace || undefined } });
      setPods(res.data.data || []);
    } catch { message.error('获取Pods失败'); }
    finally { setLoading(false); }
  }, [namespace]);

  const fetchDeployments = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/kubernetes/deployments', { params: { namespace: namespace || undefined } });
      setDeployments(res.data.data || []);
    } catch { message.error('获取Deployments失败'); }
    finally { setLoading(false); }
  }, [namespace]);

  const fetchServices = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/kubernetes/services', { params: { namespace: namespace || undefined } });
      setServices(res.data.data || []);
    } catch { message.error('获取Services失败'); }
    finally { setLoading(false); }
  }, [namespace]);

  const fetchNodes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/api/kubernetes/nodes');
      setNodes(res.data.data || []);
    } catch { message.error('获取节点失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchNamespaces(); fetchNodes(); }, []);
  useEffect(() => { if (namespace) { fetchOverview(); } }, [namespace]);

  const refreshCurrentTab = () => {
    switch (activeTab) {
      case 'pods': fetchPods(); break;
      case 'deployments': fetchDeployments(); break;
      case 'services': fetchServices(); break;
      case 'nodes': fetchNodes(); break;
    }
  };

  useEffect(() => { refreshCurrentTab(); }, [activeTab, namespace]);

  // ==================== 操作 ====================
  const showPodDetail = async (pod: Pod) => {
    try {
      const res = await api.get(`/api/kubernetes/pods/${pod.namespace}/${pod.name}`);
      setPodDetail(res.data.data || null);
      setPodDetailVisible(true);
    } catch { message.error('获取Pod详情失败'); }
  };

  const showPodLogs = async (pod: Pod) => {
    setPodLogsLoading(true);
    setPodLogsVisible(true);
    try {
      const res = await api.get(`/api/kubernetes/pods/${pod.namespace}/${pod.name}`);
      setPodLogs(res.data.data?.log || '暂无日志');
    } catch { setPodLogs('获取日志失败'); }
    finally { setPodLogsLoading(false); }
  };

  const deletePod = (pod: Pod) => {
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除 Pod "${pod.name}" 吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.delete(`/api/kubernetes/pods/${pod.namespace}/${pod.name}`);
          message.success('Pod 已删除');
          fetchPods();
          fetchOverview();
        } catch { message.error('删除失败'); }
      },
    });
  };

  const showScaleModal = (dep: Deployment) => {
    setScaleTarget(dep);
    setScaleReplicas(dep.replicas);
    setScaleVisible(true);
  };

  const handleScale = async () => {
    if (!scaleTarget) return;
    try {
      await api.put(`/api/kubernetes/deployments/${scaleTarget.namespace}/${scaleTarget.name}/scale`, { replicas: scaleReplicas });
      message.success('扩缩容成功');
      setScaleVisible(false);
      fetchDeployments();
    } catch { message.error('扩缩容失败'); }
  };

  const restartDeployment = (dep: Deployment) => {
    Modal.confirm({
      title: '确认重启',
      content: `确定要重启 Deployment "${dep.name}" 吗？`,
      okText: '重启',
      cancelText: '取消',
      onOk: async () => {
        try {
          await api.put(`/api/kubernetes/deployments/${dep.namespace}/${dep.name}/scale`, { replicas: 0 });
          await api.put(`/api/kubernetes/deployments/${dep.namespace}/${dep.name}/scale`, { replicas: dep.replicas });
          message.success('重启指令已下发');
          fetchDeployments();
        } catch { message.error('重启失败'); }
      },
    });
  };

  const showDepDetail = async (dep: Deployment) => {
    try {
      const res = await api.get(`/api/kubernetes/deployments/${dep.namespace}/${dep.name}`);
      setDepDetail(res.data.data || null);
      setDepDetailVisible(true);
    } catch { message.error('获取Deployment详情失败'); }
  };

  // ==================== 表格列定义 ====================
  const podColumns = [
    { title: '名称', dataIndex: 'name', key: 'name', ellipsis: true },
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace', width: 120 },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100,
      render: (s: string) => <Tag color={podStatusColors[s] || 'default'}>{s}</Tag> },
    { title: '就绪容器', dataIndex: 'ready', key: 'ready', width: 90 },
    { title: '重启次数', dataIndex: 'restarts', key: 'restarts', width: 80,
      render: (v: number) => <span className={v > 5 ? 'text-red-500 font-medium' : ''}>{v}</span> },
    { title: 'CPU使用', dataIndex: 'cpu', key: 'cpu', width: 100, render: (v: string) => v || '-' },
    { title: '内存使用', dataIndex: 'memory', key: 'memory', width: 100, render: (v: string) => v || '-' },
    { title: 'IP', dataIndex: 'ip', key: 'ip', width: 130 },
    { title: '节点', dataIndex: 'node', key: 'node', width: 140 },
    { title: '创建时间', dataIndex: 'creationTimestamp', key: 'creationTimestamp', width: 170 },
    { title: '操作', key: 'actions', width: 180, render: (_: unknown, record: Pod) => (
      <Space size="small">
        <Button size="small" icon={<FileTextOutlined />} onClick={() => showPodLogs(record)}>日志</Button>
        <Button size="small" icon={<EyeOutlined />} onClick={() => showPodDetail(record)}>详情</Button>
        <Button size="small" danger icon={<DeleteOutlined />} onClick={() => deletePod(record)}>删除</Button>
      </Space>
    )},
  ];

  const deploymentColumns = [
    { title: '名称', dataIndex: 'name', key: 'name', ellipsis: true },
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace', width: 120 },
    { title: '副本数', key: 'replicas', width: 120,
      render: (_: unknown, r: Deployment) => (
        <span className={r.availableReplicas < r.replicas ? 'text-orange-500' : 'text-green-600'}>
          {r.availableReplicas} / {r.replicas}
        </span>
      )},
    { title: '镜像', dataIndex: 'image', key: 'image', ellipsis: true },
    { title: '创建时间', dataIndex: 'creationTimestamp', key: 'creationTimestamp', width: 170 },
    { title: '操作', key: 'actions', width: 220, render: (_: unknown, record: Deployment) => (
      <Space size="small">
        <Button size="small" icon={<PlusOutlined />} onClick={() => showScaleModal(record)}>扩缩容</Button>
        <Button size="small" icon={<ReloadOutlined />} onClick={() => restartDeployment(record)}>重启</Button>
        <Button size="small" icon={<EyeOutlined />} onClick={() => showDepDetail(record)}>详情</Button>
      </Space>
    )},
  ];

  const serviceColumns = [
    { title: '名称', dataIndex: 'name', key: 'name', ellipsis: true },
    { title: '命名空间', dataIndex: 'namespace', key: 'namespace', width: 120 },
    { title: '类型', dataIndex: 'type', key: 'type', width: 120,
      render: (t: string) => <Tag color={serviceTypeColors[t] || 'default'}>{t}</Tag> },
    { title: 'Cluster IP', dataIndex: 'clusterIP', key: 'clusterIP', width: 140 },
    { title: 'External IP', dataIndex: 'externalIP', key: 'externalIP', width: 140,
      render: (v: string) => v || '-' },
    { title: '端口映射', dataIndex: 'ports', key: 'ports', width: 200 },
    { title: '创建时间', dataIndex: 'creationTimestamp', key: 'creationTimestamp', width: 170 },
    { title: '操作', key: 'actions', width: 90, render: (_: unknown, record: Service) => (
      <Button size="small" icon={<EyeOutlined />}>详情</Button>
    )},
  ];

  // ==================== 渲染 ====================
  return (
    <div className="p-6 space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Container size={28} className="text-blue-500" />
          <h1 className="text-2xl font-bold text-white">K8s 资源管理</h1>
        </div>
        <Button icon={<ReloadOutlined />} onClick={refreshCurrentTab}>刷新</Button>
      </div>

      {/* 命名空间选择器 */}
      <Card size="small" className="bg-slate-800/50 border-slate-700">
        <div className="flex items-center gap-3">
          <span className="text-slate-300 text-sm">命名空间：</span>
          <Select
            value={namespace}
            onChange={(v) => setNamespace(v)}
            style={{ width: 240 }}
            options={namespaces.map(ns => ({ label: ns.name, value: ns.name }))}
            placeholder="选择命名空间"
            showSearch
            filterOption={(input, option) => (option?.label as string)?.toLowerCase().includes(input.toLowerCase())}
          />
          <Button icon={<ReloadOutlined />} onClick={fetchNamespaces} size="small">刷新命名空间</Button>
        </div>
      </Card>

      {/* 集群概览卡片 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card className="bg-slate-800/50 border-slate-700">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <Server size={20} className="text-blue-400" />
              </div>
              <div>
                <p className="text-slate-400 text-xs">节点数</p>
                <p className="text-2xl font-bold text-white">{overview.nodes}</p>
              </div>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="bg-slate-800/50 border-slate-700">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center">
                <Box size={20} className="text-green-400" />
              </div>
              <div>
                <p className="text-slate-400 text-xs">Pods 总数</p>
                <p className="text-2xl font-bold text-white">{overview.pods}</p>
              </div>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="bg-slate-800/50 border-slate-700">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <Cpu size={20} className="text-purple-400" />
              </div>
              <div>
                <p className="text-slate-400 text-xs">Services 总数</p>
                <p className="text-2xl font-bold text-white">{overview.services}</p>
              </div>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="bg-slate-800/50 border-slate-700">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
                <MemoryStick size={20} className="text-orange-400" />
              </div>
              <div>
                <p className="text-slate-400 text-xs">Deployments 总数</p>
                <p className="text-2xl font-bold text-white">{overview.deployments}</p>
              </div>
            </div>
          </Card>
        </Col>
      </Row>

      {/* Tab 面板 */}
      <Card className="bg-slate-800/50 border-slate-700">
        <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
          {
            key: 'pods',
            label: 'Pods',
            children: (
              <Spin spinning={loading}>
                {pods.length === 0 && !loading ? (
                  <Empty description="暂无 Pod 数据" />
                ) : (
                  <Table
                    dataSource={pods}
                    columns={podColumns}
                    rowKey={(r) => `${r.namespace}/${r.name}`}
                    size="small"
                    scroll={{ x: 1400 }}
                    pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 个 Pod` }}
                  />
                )}
              </Spin>
            ),
          },
          {
            key: 'deployments',
            label: 'Deployments',
            children: (
              <Spin spinning={loading}>
                {deployments.length === 0 && !loading ? (
                  <Empty description="暂无 Deployment 数据" />
                ) : (
                  <Table
                    dataSource={deployments}
                    columns={deploymentColumns}
                    rowKey={(r) => `${r.namespace}/${r.name}`}
                    size="small"
                    scroll={{ x: 1000 }}
                    pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 个 Deployment` }}
                  />
                )}
              </Spin>
            ),
          },
          {
            key: 'services',
            label: 'Services',
            children: (
              <Spin spinning={loading}>
                {services.length === 0 && !loading ? (
                  <Empty description="暂无 Service 数据" />
                ) : (
                  <Table
                    dataSource={services}
                    columns={serviceColumns}
                    rowKey={(r) => `${r.namespace}/${r.name}`}
                    size="small"
                    scroll={{ x: 1100 }}
                    pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 个 Service` }}
                  />
                )}
              </Spin>
            ),
          },
          {
            key: 'nodes',
            label: '节点',
            children: (
              <Spin spinning={loading}>
                {nodes.length === 0 && !loading ? (
                  <Empty description="暂无节点数据" />
                ) : (
                  <Row gutter={[16, 16]}>
                    {nodes.map((node) => (
                      <Col xs={24} md={12} xl={8} key={node.name}>
                        <Card
                          size="small"
                          className="bg-slate-700/50 border-slate-600"
                          title={<span className="text-white text-sm">{node.name}</span>}
                          extra={<Tag color={nodeStatusColors[node.status] || 'default'}>{node.status}</Tag>}
                        >
                          <div className="space-y-3">
                            <div>
                              <div className="flex justify-between text-xs text-slate-400 mb-1">
                                <span>CPU</span>
                                <span>{node.cpuAllocated} / {node.cpuTotal} 核</span>
                              </div>
                              <Progress
                                percent={node.cpuTotal > 0 ? Math.round((node.cpuAllocated / node.cpuTotal) * 100) : 0}
                                strokeColor="#3b82f6"
                                showInfo={false}
                                size="small"
                              />
                            </div>
                            <div>
                              <div className="flex justify-between text-xs text-slate-400 mb-1">
                                <span>内存</span>
                                <span>{node.memoryAllocated} / {node.memoryTotal} GB</span>
                              </div>
                              <Progress
                                percent={node.memoryTotal > 0 ? Math.round((node.memoryAllocated / node.memoryTotal) * 100) : 0}
                                strokeColor="#10b981"
                                showInfo={false}
                                size="small"
                              />
                            </div>
                            <div>
                              <div className="flex justify-between text-xs text-slate-400 mb-1">
                                <span>Pods</span>
                                <span>{node.podsCount} / {node.podsMax}</span>
                              </div>
                              <Progress
                                percent={node.podsMax > 0 ? Math.round((node.podsCount / node.podsMax) * 100) : 0}
                                strokeColor="#8b5cf6"
                                showInfo={false}
                                size="small"
                              />
                            </div>
                            <div className="text-xs text-slate-500 pt-1">
                              K8s 版本：{node.kubeletVersion}
                            </div>
                          </div>
                        </Card>
                      </Col>
                    ))}
                  </Row>
                )}
              </Spin>
            ),
          },
        ]} />
      </Card>

      {/* Pod 详情抽屉 */}
      <Drawer
        title="Pod 详情"
        open={podDetailVisible}
        onClose={() => setPodDetailVisible(false)}
        width={640}
      >
        {podDetail && (
          <div className="space-y-4">
            <Descriptions column={1} size="small" bordered labelStyle={{ color: '#94a3b8' }}>
              <Descriptions.Item label="名称">{podDetail.name}</Descriptions.Item>
              <Descriptions.Item label="命名空间">{podDetail.namespace}</Descriptions.Item>
            </Descriptions>

            <Card title="Labels" size="small" className="bg-slate-800/30 border-slate-700">
              {Object.keys(podDetail.labels || {}).length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {Object.entries(podDetail.labels).map(([k, v]) => (
                    <Tag key={k} color="blue">{k}: {v}</Tag>
                  ))}
                </div>
              ) : (
                <span className="text-slate-500 text-sm">无 Labels</span>
              )}
            </Card>

            <Card title="Annotations" size="small" className="bg-slate-800/30 border-slate-700">
              {Object.keys(podDetail.annotations || {}).length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {Object.entries(podDetail.annotations).map(([k, v]) => (
                    <Tag key={k} color="purple">{k}: {v}</Tag>
                  ))}
                </div>
              ) : (
                <span className="text-slate-500 text-sm">无 Annotations</span>
              )}
            </Card>

            <Card title="Conditions" size="small" className="bg-slate-800/30 border-slate-700">
              <Table
                dataSource={podDetail.conditions || []}
                columns={[
                  { title: '类型', dataIndex: 'type', key: 'type' },
                  { title: '状态', dataIndex: 'status', key: 'status',
                    render: (s: string) => <Tag color={s === 'True' ? 'green' : 'red'}>{s}</Tag> },
                  { title: '原因', dataIndex: 'reason', key: 'reason', render: (v: string) => v || '-' },
                  { title: '消息', dataIndex: 'message', key: 'message', render: (v: string) => v || '-' },
                ]}
                rowKey="type"
                size="small"
                pagination={false}
              />
            </Card>

            <Card title="容器列表" size="small" className="bg-slate-800/30 border-slate-700">
              {(podDetail.containers || []).map((c, i) => (
                <Card key={i} size="small" className="mb-2 bg-slate-700/50 border-slate-600">
                  <Descriptions column={2} size="small" labelStyle={{ color: '#94a3b8' }}>
                    <Descriptions.Item label="容器名">{c.name}</Descriptions.Item>
                    <Descriptions.Item label="镜像">{c.image}</Descriptions.Item>
                    <Descriptions.Item label="端口">{c.ports?.join(', ') || '-'}</Descriptions.Item>
                    <Descriptions.Item label="资源">
                      {c.resources ? JSON.stringify(c.resources) : '-'}
                    </Descriptions.Item>
                  </Descriptions>
                </Card>
              ))}
            </Card>
          </div>
        )}
      </Drawer>

      {/* Pod 日志抽屉 */}
      <Drawer
        title="Pod 日志"
        open={podLogsVisible}
        onClose={() => setPodLogsVisible(false)}
        width={800}
      >
        {podLogsLoading ? (
          <div className="flex items-center justify-center py-20"><Spin /></div>
        ) : (
          <pre className="text-xs text-green-300 bg-slate-900 p-4 rounded-lg overflow-auto max-h-[70vh] whitespace-pre-wrap font-mono">
            {podLogs}
          </pre>
        )}
      </Drawer>

      {/* Deployment 详情抽屉 */}
      <Drawer
        title="Deployment 详情"
        open={depDetailVisible}
        onClose={() => setDepDetailVisible(false)}
        width={640}
      >
        {depDetail && (
          <div className="space-y-4">
            <Descriptions column={1} size="small" bordered labelStyle={{ color: '#94a3b8' }}>
              <Descriptions.Item label="名称">{depDetail.name}</Descriptions.Item>
              <Descriptions.Item label="命名空间">{depDetail.namespace}</Descriptions.Item>
              <Descriptions.Item label="更新策略">{depDetail.strategy}</Descriptions.Item>
            </Descriptions>

            <Card title="Selector" size="small" className="bg-slate-800/30 border-slate-700">
              <div className="flex flex-wrap gap-1">
                {Object.entries(depDetail.selector || {}).map(([k, v]) => (
                  <Tag key={k} color="blue">{k}: {v}</Tag>
                ))}
              </div>
            </Card>

            <Card title="Pod Template" size="small" className="bg-slate-800/30 border-slate-700">
              <pre className="text-xs text-slate-300 overflow-auto max-h-96 whitespace-pre-wrap font-mono">
                {depDetail.podTemplate}
              </pre>
            </Card>
          </div>
        )}
      </Drawer>

      {/* 扩缩容 Modal */}
      <Modal
        title="扩缩容"
        open={scaleVisible}
        onOk={handleScale}
        onCancel={() => setScaleVisible(false)}
        okText="确认"
        cancelText="取消"
      >
        {scaleTarget && (
          <div className="space-y-4 py-4">
            <div className="text-slate-300">
              <span className="text-slate-500">Deployment：</span>
              <span className="font-medium">{scaleTarget.namespace}/{scaleTarget.name}</span>
            </div>
            <div className="text-slate-300">
              <span className="text-slate-500">当前副本数：</span>
              <span className="font-medium">{scaleTarget.replicas}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-slate-400 text-sm">目标副本数：</span>
              <InputNumber
                min={1}
                max={100}
                value={scaleReplicas}
                onChange={(v) => setScaleReplicas(v || 1)}
                style={{ width: 120 }}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
