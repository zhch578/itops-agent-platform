import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ExternalLink, Globe, Cog, Plus, Search, Edit, Copy,
  Wrench, Monitor, Activity, Shield, FileSearch, BarChart3,
  LineChart, Bell, AlertTriangle, Database, Terminal,
  Cloud, Lock, Radio, Server, Layers, BookOpen, MessageSquare,
  Clock, Map, MapPin, GitBranch, Play, Zap, Users, Network, Key,
} from 'lucide-react';
import clsx from 'clsx';
import api from '../lib/api';
import { useToast } from '../contexts/ToastContext';
import { NavLink } from 'react-router-dom';

// Map icon names from DB to actual lucide components
const iconMap: Record<string, any> = {
  ExternalLink, Globe, Cog, Plus, Search, Edit, Copy,
  Wrench, Monitor, Activity, Shield, FileSearch, BarChart3,
  LineChart, Bell, AlertTriangle, Database, Terminal,
  Cloud, Lock, Radio, Server, Layers, BookOpen, MessageSquare,
  Clock, Map, MapPin, GitBranch, Play, Zap, Users, Network, Key,
};

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
}

function ToolIcon({ iconName, className }: { iconName: string; className?: string }) {
  const Icon = iconMap[iconName] || ExternalLink;
  return <Icon className={className || 'w-5 h-5'} />;
}

function getCategoryColor(category: string): string {
  const colors: Record<string, { bg: string; border: string; text: string; gradient: string }> = {
    '监控系统': { bg: 'from-blue-500/10 to-blue-600/5', border: 'border-blue-500/20', text: 'text-blue-400', gradient: 'from-blue-500 to-blue-600' },
    '日志系统': { bg: 'from-emerald-500/10 to-emerald-600/5', border: 'border-emerald-500/20', text: 'text-emerald-400', gradient: 'from-emerald-500 to-emerald-600' },
    '堡垒机': { bg: 'from-purple-500/10 to-purple-600/5', border: 'border-purple-500/20', text: 'text-purple-400', gradient: 'from-purple-500 to-purple-600' },
    '告警系统': { bg: 'from-orange-500/10 to-orange-600/5', border: 'border-orange-500/20', text: 'text-orange-400', gradient: 'from-orange-500 to-orange-600' },
    '自动化': { bg: 'from-cyan-500/10 to-cyan-600/5', border: 'border-cyan-500/20', text: 'text-cyan-400', gradient: 'from-cyan-500 to-cyan-600' },
    '数据库': { bg: 'from-pink-500/10 to-pink-600/5', border: 'border-pink-500/20', text: 'text-pink-400', gradient: 'from-pink-500 to-pink-600' },
    '网络': { bg: 'from-sky-500/10 to-sky-600/5', border: 'border-sky-500/20', text: 'text-sky-400', gradient: 'from-sky-500 to-sky-600' },
  };
  return colors[category]?.text || 'text-text-secondary';
}

export default function ToolLinks() {
  const toast = useToast();
  const [searchQuery, setSearchQuery] = useState('');

  const { data: groupedData, isLoading } = useQuery({
    queryKey: ['tool-links', 'categories'],
    queryFn: async () => {
      const res = await api.get('/api/tool-links/categories');
      return res.data.data as Record<string, ToolLink[]>;
    },
  });

  const filteredCategories = groupedData
    ? Object.entries(groupedData).reduce((acc, [category, tools]) => {
        const filtered = tools.filter(t => {
          if (!searchQuery) return true;
          const q = searchQuery.toLowerCase();
          return (
            t.name.toLowerCase().includes(q) ||
            (t.description || '').toLowerCase().includes(q) ||
            category.toLowerCase().includes(q)
          );
        });
        if (filtered.length > 0) acc[category] = filtered;
        return acc;
      }, {} as Record<string, ToolLink[]>)
    : {};

  const handleOpen = (tool: ToolLink) => {
    window.open(tool.url, '_blank', 'noopener,noreferrer');
  };

  const handleCopyUrl = (e: React.MouseEvent, url: string) => {
    e.stopPropagation();
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        toast.success('链接已复制到剪贴板');
      });
    } else {
      toast.success(url);
    }
  };

  const categoryKeys = Object.keys(filteredCategories);

  return (
    <div className="h-full overflow-auto p-6">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary mb-2">运维工具导航</h1>
            <p className="text-text-secondary text-sm">常用运维工具快捷入口，可在「工具配置」页面自定义管理</p>
          </div>
          <NavLink
            to="/tool-links-manage"
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Cog className="w-4 h-4" />
            工具配置
          </NavLink>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-tertiary" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索工具名称、描述、分类..."
            className="w-full pl-10 pr-4 py-2.5 bg-surface border border-border rounded-lg focus:outline-none focus:border-primary text-text-primary"
          />
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="space-y-8">
            {[1, 2, 3].map((i) => (
              <div key={i}>
                <div className="h-6 w-32 bg-border rounded animate-pulse mb-4" />
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                  {[1, 2, 3, 4, 5].map((j) => (
                    <div key={j} className="bg-surface border border-border rounded-xl p-5 animate-pulse">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-border" />
                        <div className="flex-1">
                          <div className="h-4 bg-border rounded w-1/2 mb-2" />
                          <div className="h-3 bg-border rounded w-3/4" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : categoryKeys.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-text-secondary">
            <Globe className="w-16 h-16 mb-4 opacity-30" />
            <p className="text-lg mb-1">
              {searchQuery ? '未找到匹配的工具' : '暂无运维工具配置'}
            </p>
            <p className="text-sm mb-6">
              {searchQuery ? '请调整搜索关键词' : '前往「工具配置」页面添加你的运维工具链接'}
            </p>
            {!searchQuery && (
              <NavLink
                to="/tool-links-manage"
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-4 h-4" />
                添加工具
              </NavLink>
            )}
          </div>
        ) : (
          <div className="space-y-8">
            {categoryKeys.map((category) => (
              <div key={category}>
                <div className="flex items-center gap-3 mb-4">
                  <div className={clsx(
                    'px-3 py-1 rounded-full text-xs font-semibold border',
                    'bg-slate-800 border-slate-600 text-slate-300'
                  )}>
                    {category}
                  </div>
                  <div className="flex-1 h-px bg-border/50" />
                  <span className="text-xs text-text-tertiary">
                    {filteredCategories[category].length} 个工具
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                  {filteredCategories[category].map((tool) => {
                    const colorClass = getCategoryColor(tool.category);
                    return (
                      <div
                        key={tool.id}
                        onClick={() => handleOpen(tool)}
                        className="group relative overflow-hidden rounded-xl border border-border bg-surface/80 backdrop-blur-sm p-5 transition-all duration-200 hover:border-primary/40 hover:bg-surface hover:shadow-md hover:shadow-primary/5 cursor-pointer"
                      >
                        {/* Hover gradient effect */}
                        <div className="absolute inset-0 bg-gradient-to-br from-primary/0 via-primary/0 to-primary/[0.02] opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

                        <div className="relative">
                          <div className="flex items-start gap-4">
                            <div className={clsx(
                              'flex items-center justify-center w-12 h-12 rounded-xl shrink-0 overflow-hidden',
                              tool.image_icon
                                ? ''
                                : 'border bg-gradient-to-br from-slate-700/50 to-slate-800/50 border-slate-600/30 group-hover:from-primary/20 group-hover:to-primary/10 group-hover:border-primary/30',
                              'transition-all duration-200'
                            )}>
                              {tool.image_icon ? (
                                <img
                                  src={tool.image_icon}
                                  alt={tool.name}
                                  className="w-full h-full object-contain p-1"
                                />
                              ) : (
                                <ToolIcon iconName={tool.icon} className={clsx(
                                  'w-5 h-5 transition-colors duration-200',
                                  'text-text-secondary group-hover:text-primary'
                                )} />
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <h3 className="text-sm font-semibold text-text-primary mb-1 truncate group-hover:text-primary transition-colors">
                                {tool.name}
                              </h3>
                              {tool.description && (
                                <p className="text-xs text-text-tertiary line-clamp-2 leading-relaxed">
                                  {tool.description}
                                </p>
                              )}
                              <div className="flex items-center gap-2 mt-2">
                                <span className="text-[10px] text-text-tertiary truncate max-w-[200px]">
                                  {tool.url}
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Action buttons */}
                          <div className="flex items-center gap-2 mt-4 pt-3 border-t border-border/50">
                            <button
                              onClick={(e) => handleOpen(tool)}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                            >
                              <ExternalLink className="w-3 h-3" />
                              打开
                            </button>
                            {tool.is_external === 1 && (
                              <span className="flex items-center gap-1 text-[10px] text-text-tertiary">
                                <ExternalLink className="w-2.5 h-2.5" />
                                外部链接
                              </span>
                            )}
                            <button
                              onClick={(e) => handleCopyUrl(e, tool.url)}
                              className="ml-auto p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-slate-700/30 transition-colors"
                              title="复制链接"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
