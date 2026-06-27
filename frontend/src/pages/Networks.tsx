import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Network, Trash2, Plus, Search, RefreshCw, Globe,
} from 'lucide-react';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';

interface DockerNetwork {
  id: string;
  name: string;
  driver: string;
  scope: string;
  internal: boolean;
  attachable: boolean;
  ipam: {
    Driver: string;
    Config: Array<{
      Subnet?: string;
      Gateway?: string;
    }>;
  };
  containers: Record<string, {
    Name: string;
    IPv4Address: string;
    IPv6Address: string;
  }>;
  options: Record<string, string>;
  labels: Record<string, string>;
  created: string;
}

export default function Networks() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newNetworkName, setNewNetworkName] = useState('');
  const [newNetworkDriver, setNewNetworkDriver] = useState('bridge');

  // 获取网络列表
  const { data: networksData, isLoading, error } = useQuery({
    queryKey: ['docker-networks'],
    queryFn: async () => {
      const response = await api.get('/api/docker/networks');
      return response.data.data as DockerNetwork[];
    },
    refetchInterval: 30000,
  });

  const networks = networksData || [];

  // 删除网络
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/docker/networks/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docker-networks'] });
      toast.success('网络已删除');
    },
    onError: () => toast.error('删除网络失败'),
  });

  // 创建网络
  const createMutation = useMutation({
    mutationFn: () => api.post('/api/docker/networks', {
      name: newNetworkName,
      driver: newNetworkDriver,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docker-networks'] });
      toast.success('网络已创建');
      setShowCreateModal(false);
      setNewNetworkName('');
      setNewNetworkDriver('bridge');
    },
    onError: () => toast.error('创建网络失败'),
  });

  // 过滤网络
  const filteredNetworks = networks.filter(network =>
    network.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    network.driver.toLowerCase().includes(searchTerm.toLowerCase()) ||
    network.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-text-secondary">加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20">
        <Globe className="w-16 h-16 text-text-tertiary mb-4" />
        <h3 className="text-lg font-semibold text-text-primary mb-2">Docker 网络不可用</h3>
        <p className="text-text-secondary text-sm mb-6 text-center max-w-md">
          当前环境未连接 Docker 引擎，网络管理功能需要 Docker 运行环境支持。
        </p>
        <button
          onClick={() => queryClient.invalidateQueries({ queryKey: ['docker-networks'] })}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">网络管理</h1>
          <p className="text-text-secondary mt-1">管理 Docker 网络</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => queryClient.invalidateQueries({ queryKey: ['docker-networks'] })}
            className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-text-primary rounded-lg flex items-center gap-2 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            刷新
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2 transition-colors"
          >
            <Plus className="w-4 h-4" />
            创建网络
          </button>
        </div>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surface rounded-lg p-4 border border-border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-text-secondary text-sm">总网络数</p>
              <p className="text-2xl font-bold text-text-primary mt-1">{networks.length}</p>
            </div>
            <Globe className="w-8 h-8 text-blue-500" />
          </div>
        </div>
        <div className="bg-surface rounded-lg p-4 border border-border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-text-secondary text-sm">Bridge 网络</p>
              <p className="text-2xl font-bold text-text-primary mt-1">
                {networks.filter(n => n.driver === 'bridge').length}
              </p>
            </div>
            <Network className="w-8 h-8 text-green-500" />
          </div>
        </div>
        <div className="bg-surface rounded-lg p-4 border border-border">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-text-secondary text-sm">连接容器</p>
              <p className="text-2xl font-bold text-text-primary mt-1">
                {networks.reduce((sum, n) => sum + Object.keys(n.containers || {}).length, 0)}
              </p>
            </div>
            <Network className="w-8 h-8 text-purple-500" />
          </div>
        </div>
      </div>

      {/* 搜索 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-text-secondary" />
        <input
          type="text"
          placeholder="搜索网络名称、驱动或ID..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full pl-10 pr-4 py-2 bg-surface border border-border rounded-lg text-text-primary placeholder-text-tertiary focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* 网络列表 */}
      <div className="bg-surface rounded-lg border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-background border-b border-border">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wider">
                  名称
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wider">
                  驱动
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wider">
                  子网
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wider">
                  网关
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wider">
                  容器数
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wider">
                  范围
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-text-secondary uppercase tracking-wider">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {filteredNetworks.map((network) => {
                const containerCount = Object.keys(network.containers || {}).length;
                const subnet = network.ipam?.Config?.[0]?.Subnet || '-';
                const gateway = network.ipam?.Config?.[0]?.Gateway || '-';

                return (
                  <tr key={network.id} className="hover:bg-slate-700/50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-text-primary">{network.name}</div>
                      <div className="text-xs text-text-secondary font-mono">{network.id.substring(0, 12)}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-text-primary">{network.driver}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-text-primary font-mono">{subnet}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-text-primary font-mono">{gateway}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-text-primary">{containerCount}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-text-primary">{network.scope}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button
                        onClick={() => {
                          if (confirm('确定要删除此网络吗？')) {
                            deleteMutation.mutate(network.id);
                          }
                        }}
                        className="text-red-400 hover:text-red-300"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filteredNetworks.length === 0 && (
          <div className="text-center py-12">
            <Globe className="w-12 h-12 text-text-tertiary mx-auto mb-4" />
            <p className="text-text-secondary">没有找到网络</p>
          </div>
        )}
      </div>

      {/* 创建网络模态框 */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-surface rounded-lg border border-border w-full max-w-md">
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h3 className="text-lg font-semibold text-text-primary">创建网络</h3>
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewNetworkName('');
                  setNewNetworkDriver('bridge');
                }}
                className="text-text-secondary hover:text-text-primary"
              >
                ✕
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  网络名称
                </label>
                <input
                  type="text"
                  value={newNetworkName}
                  onChange={(e) => setNewNetworkName(e.target.value)}
                  placeholder="输入网络名称"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-text-primary placeholder-text-tertiary focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-2">
                  驱动
                </label>
                <select
                  value={newNetworkDriver}
                  onChange={(e) => setNewNetworkDriver(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-text-primary focus:outline-none focus:border-blue-500"
                >
                  <option value="bridge">bridge</option>
                  <option value="host">host</option>
                  <option value="overlay">overlay</option>
                  <option value="macvlan">macvlan</option>
                </select>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setShowCreateModal(false);
                    setNewNetworkName('');
                    setNewNetworkDriver('bridge');
                  }}
                  className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-text-primary rounded-lg transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => createMutation.mutate()}
                  disabled={!newNetworkName.trim()}
                  className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="w-4 h-4" />
                  创建
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
