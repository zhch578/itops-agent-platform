/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Plus, RefreshCw, Server, Terminal, ShieldCheck, History, Clock,
  CheckCircle2, Upload, X, AlertTriangle, FolderPlus, Settings,
} from 'lucide-react';
import clsx from 'clsx';
import { useServerActions } from './useServerActions';
import { ServerListSection } from './ServerListSection';
import { ServerFormModal } from './ServerFormModal';
import { CommandSection } from './CommandSection';
import { ComplianceSection } from './ComplianceSection';
import { AiCommandSection } from './AiCommandSection';
import { ImportExport } from '../../../modules/infra/components/ImportExport';
import api from '../../../lib/api';
import type { Server as ServerType } from './types';

export default function Servers() {
  const actions = useServerActions();

  // Destructure for convenience
  const {
    isModalOpen, setIsModalOpen,
    selectedServer, setSelectedServer,
    formData, setFormData,
    command, setCommand,
    commandResult, setCommandResult,
    isExecuting,
    complianceResults,
    isRunningCompliance,
    activeTab, setActiveTab,
    showComplianceOptions, setShowComplianceOptions,
    selectedTag, setSelectedTag,
    selectedGroupId, setSelectedGroupId,
    isImportModalOpen, setIsImportModalOpen,
    isGroupModalOpen, setIsGroupModalOpen,
    isDeleteConfirmOpen, setIsDeleteConfirmOpen,
    pendingDeleteServer, setPendingDeleteServer,
    isCollecting,
    isCollectingMetrics,
    // AI
    isAiCommandModalOpen, setIsAiCommandModalOpen,
    aiCommandServer,
    aiPrompt, setAiPrompt,
    aiGeneratedCommand, setAiGeneratedCommand,
    aiCommandExplanation, setAiCommandExplanation,
    isAiGenerating,
    selectedAiAgent,
    showAiCommandConfirm, setShowAiCommandConfirm,
    aiGenerationError, setAiGenerationError,
    // SSH
    selectedSshKeyId, setSelectedSshKeyId,
    sshKeySearchQuery, setSshKeySearchQuery,
    showSshKeyDropdown, setShowSshKeyDropdown,
    // Group
    groupFormData, setGroupFormData,
    editingGroup, setEditingGroup,
    // Import
    importData, setImportData,
    importResult,
    // Sidebar
    showGroups, setShowGroups,
    // Tags
    tagDropdownOpen, setTagDropdownOpen,
    tagInputRef, tagDropdownRef,
    // Compliance options
    complianceOptions, setComplianceOptions,
    // Data
    agents, sshKeys, groupsData, servers, isLoading,
    allTags,
    filteredTagSuggestions,
    filteredServers,
    commandHistory, refetchCommandHistory,
    complianceHistory, refetchComplianceHistory,
    // Tag utilities
    parseCurrentTags, addTagToInput, removeTag,
    // Handlers
    resetForm, handleSubmit, handleEdit, handleTestConnection,
    handleExecuteCommand, handleRunCompliance, startComplianceCheck,
    handleCollectInfo, handleAiGenerateCommand, handleExecuteAiCommand,
    confirmExecuteAiCommand, handleCollectAll, handleCollectMetrics,
    handleCollectAllMetrics, handleGroupSubmit, handleImport,
    openAiCommandForServer,
    // Mutations
    deleteMutation,
    // Nav
    navigate, queryClient,
  } = actions;

  // Determine if we should show command section
  const showCommandSection =
    selectedServer && (activeTab === 'servers' || activeTab === 'compliance');

  return (
    <div className="h-full overflow-auto p-6">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-text-primary mb-2">服务器管理</h1>
            <p className="text-text-secondary">管理和监控您的服务器</p>
          </div>
          <div className="flex items-center gap-3">
            <ImportExport
              resourceType="servers"
              onImportSuccess={() => queryClient.invalidateQueries({ queryKey: ['servers'] })}
            />
            <button
              onClick={() => {
                resetForm();
                setSelectedServer(null);
                setIsModalOpen(true);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-4 h-4" />
              添加服务器
            </button>
          </div>
        </div>

        {/* 使用说明 */}
        <div className="bg-surface border border-border rounded-lg p-4">
          <div className="flex items-start gap-4">
            <div className="flex-1">
              <h3 className="text-sm font-medium text-text-primary mb-2">使用说明</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-xs text-text-secondary">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-gradient-to-b from-yellow-500 to-orange-500 flex-shrink-0" />
                  <span>
                    <strong>Linux 服务器</strong>：左侧黄橙渐变标识，支持 SSH 命令执行
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded bg-gradient-to-b from-blue-500 to-cyan-500 flex-shrink-0" />
                  <span>
                    <strong>Windows 服务器</strong>：左侧蓝青渐变标识，支持远程桌面
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <RefreshCw className="w-3 h-3 flex-shrink-0" />
                  <span>
                    <strong>采集信息</strong>：获取服务器 OS、CPU、内存、磁盘等信息
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Terminal className="w-3 h-3 flex-shrink-0" />
                  <span>
                    <strong>执行命令</strong>：通过 SSH 远程执行命令，查看执行历史
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 标签页导航 */}
        <div className="flex gap-2 border-b border-border">
          <button
            onClick={() => {
              setActiveTab('servers');
              setSelectedServer(null);
            }}
            className={clsx(
              'px-4 py-2 border-b-2 text-sm transition-colors',
              activeTab === 'servers'
                ? 'border-primary text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary',
            )}
          >
            服务器列表
          </button>
          {selectedServer && (
            <>
              <button
                onClick={() => setActiveTab('compliance')}
                className={clsx(
                  'px-4 py-2 border-b-2 text-sm transition-colors',
                  activeTab === 'compliance'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-text-secondary hover:text-text-primary',
                )}
              >
                合规检查
              </button>
              <button
                onClick={() => setActiveTab('command-history')}
                className={clsx(
                  'px-4 py-2 border-b-2 text-sm transition-colors',
                  activeTab === 'command-history'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-text-secondary hover:text-text-primary',
                )}
              >
                命令历史
              </button>
              <button
                onClick={() => setActiveTab('compliance-history')}
                className={clsx(
                  'px-4 py-2 border-b-2 text-sm transition-colors',
                  activeTab === 'compliance-history'
                    ? 'border-primary text-primary'
                    : 'border-transparent text-text-secondary hover:text-text-primary',
                )}
              >
                检查历史
              </button>
            </>
          )}
        </div>

        {/* Tab 内容 */}
        {activeTab === 'servers' && (
          <>
            <ServerListSection
              servers={servers || []}
              isLoading={isLoading}
              groupsData={groupsData}
              allTags={allTags}
              filteredServers={filteredServers}
              selectedTag={selectedTag}
              onSelectTag={setSelectedTag}
              selectedGroupId={selectedGroupId}
              onSelectGroupId={setSelectedGroupId}
              showGroups={showGroups}
              onToggleGroups={() => setShowGroups(!showGroups)}
              isCollecting={isCollecting}
              isCollectingMetrics={isCollectingMetrics}
              onCollectAll={handleCollectAll}
              onCollectAllMetrics={handleCollectAllMetrics}
              onOpenImport={() => {
                setIsImportModalOpen(true);
                setImportData('');
              }}
              onOpenGroupModal={() => {
                setEditingGroup(null);
                setGroupFormData({ name: '', description: '', parent_id: '' });
                setIsGroupModalOpen(true);
              }}
              onTestConnection={handleTestConnection}
              onCollectInfo={handleCollectInfo}
              onCollectMetrics={handleCollectMetrics}
              onEdit={handleEdit}
              onDelete={(id, name) => {
                setPendingDeleteServer({ id, name });
                setIsDeleteConfirmOpen(true);
              }}
              onOpenAiCommand={openAiCommandForServer}
              onSelectForCommand={(server) => {
                setSelectedServer(server);
                setCommandResult(null);
              }}
              onRunCompliance={handleRunCompliance}
              onViewCommandHistory={(server) => {
                setSelectedServer(server);
                setActiveTab('command-history');
              }}
              onViewComplianceHistory={(server) => {
                setSelectedServer(server);
                setActiveTab('compliance-history');
              }}
            />
            {showCommandSection && (
              <CommandSection
                selectedServer={selectedServer}
                command={command}
                onCommandChange={setCommand}
                commandResult={commandResult}
                onClearResult={() => setCommandResult(null)}
                isExecuting={isExecuting}
                onExecute={handleExecuteCommand}
              />
            )}
          </>
        )}

        {activeTab === 'compliance' && selectedServer && (
          <ComplianceSection
            selectedServer={selectedServer}
            isRunningCompliance={isRunningCompliance}
            complianceResults={complianceResults}
            complianceOptions={complianceOptions}
            onComplianceOptionsChange={setComplianceOptions}
            onRunCompliance={handleRunCompliance}
          />
        )}

        {activeTab === 'command-history' && selectedServer && (
          <div className="bg-surface border border-border rounded-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-text-primary">命令历史 - {selectedServer.name}</h2>
              <button
                onClick={async () => {
                  try {
                    const response = await api.get(
                      `/api/servers/${selectedServer.id}/command-history/export`,
                      { responseType: 'blob' },
                    );
                    const url = window.URL.createObjectURL(new Blob([response.data]));
                    const link = document.createElement('a');
                    link.href = url;
                    link.setAttribute('download', `command-history-${selectedServer.id}-${Date.now()}.json`);
                    document.body.appendChild(link);
                    link.click();
                    link.remove();
                  } catch (error) {
                    console.error('导出失败:', error);
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
              >
                <span>📥</span>
                导出历史
              </button>
            </div>
            <div className="space-y-4">
              {commandHistory?.map((item) => (
                <div key={item.id} className="bg-background rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-text-secondary" />
                      <span className="text-xs text-text-secondary">
                        {new Date(item.executed_at).toLocaleString()}
                      </span>
                    </div>
                    <span
                      className={clsx(
                        'px-2 py-1 rounded text-xs font-medium',
                        item.success
                          ? 'bg-status-success/10 text-status-success'
                          : 'bg-status-failed/10 text-status-failed',
                      )}
                    >
                      {item.success ? '成功' : '失败'}
                    </span>
                  </div>
                  <div className="mb-2">
                    <code className="font-mono text-sm bg-surface px-2 py-1 rounded text-text-primary">
                      {item.command}
                    </code>
                  </div>
                  {item.stdout && (
                    <details className="mt-2">
                      <summary className="text-xs text-text-secondary cursor-pointer hover:text-text-primary">
                        输出 ({item.stdout.length} 字符)
                      </summary>
                      <pre className="mt-2 bg-surface p-3 rounded text-xs overflow-x-auto text-text-primary font-mono max-h-40 overflow-y-auto">
                        {item.stdout}
                      </pre>
                    </details>
                  )}
                  {item.stderr && (
                    <details className="mt-2">
                      <summary className="text-xs text-status-warning cursor-pointer hover:text-text-primary">
                        错误 ({item.stderr.length} 字符)
                      </summary>
                      <pre className="mt-2 bg-status-failed/5 p-3 rounded text-xs overflow-x-auto text-status-failed font-mono max-h-40 overflow-y-auto">
                        {item.stderr}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
              {(!commandHistory || commandHistory.length === 0) && (
                <div className="text-center py-12 text-text-secondary">
                  <History className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>暂无命令历史</p>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === 'compliance-history' && selectedServer && (
          <div className="bg-surface border border-border rounded-lg p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold text-text-primary">
                合规检查历史 - {selectedServer.name}
              </h2>
              <button
                onClick={async () => {
                  try {
                    const response = await api.get(
                      `/api/servers/${selectedServer.id}/compliance-history/export`,
                      { responseType: 'blob' },
                    );
                    const url = window.URL.createObjectURL(new Blob([response.data]));
                    const link = document.createElement('a');
                    link.href = url;
                    link.setAttribute(
                      'download',
                      `compliance-history-${selectedServer.id}-${Date.now()}.json`,
                    );
                    document.body.appendChild(link);
                    link.click();
                    link.remove();
                  } catch (error) {
                    console.error('导出失败:', error);
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
              >
                <span>📥</span>
                导出历史
              </button>
            </div>
            <div className="space-y-4">
              {complianceHistory?.map((check) => (
                <div key={check.id} className="bg-background rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="font-medium text-text-primary">{check.check_name}</h4>
                    <span
                      className={clsx(
                        'px-2 py-1 rounded text-xs font-medium',
                        check.status === 'completed'
                          ? 'bg-status-success/10 text-status-success'
                          : check.status === 'running'
                            ? 'bg-status-running/10 text-status-running'
                            : 'bg-status-failed/10 text-status-failed',
                      )}
                    >
                      {check.status === 'completed'
                        ? '已完成'
                        : check.status === 'running'
                          ? '执行中'
                          : '失败'}
                    </span>
                  </div>
                  <div className="text-xs text-text-secondary space-y-1">
                    <p>开始: {check.started_at ? new Date(check.started_at).toLocaleString() : '-'}</p>
                    <p>完成: {check.completed_at ? new Date(check.completed_at).toLocaleString() : '-'}</p>
                  </div>
                  {check.check_results && (
                    <details className="mt-3">
                      <summary className="text-xs text-text-secondary cursor-pointer hover:text-text-primary">
                        查看结果
                      </summary>
                      <pre className="mt-2 bg-surface p-3 rounded text-xs overflow-x-auto text-text-primary font-mono max-h-60 overflow-y-auto">
                        {check.check_results}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
              {(!complianceHistory || complianceHistory.length === 0) && (
                <div className="text-center py-12 text-text-secondary">
                  <ShieldCheck className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>暂无合规检查历史</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========== Modals ========== */}

        {/* 添加/编辑服务器模态框 */}
        <ServerFormModal
          isOpen={isModalOpen}
          selectedServer={selectedServer}
          formData={formData}
          onFormDataChange={setFormData}
          onSubmit={handleSubmit}
          onClose={() => {
            setIsModalOpen(false);
            resetForm();
            setSelectedServer(null);
          }}
          resetForm={resetForm}
          parseCurrentTags={parseCurrentTags}
          getLastTagFragment={() => {
            const raw = formData.tags;
            const lastCommaIndex = raw.lastIndexOf(',');
            return lastCommaIndex >= 0 ? raw.substring(lastCommaIndex + 1).trim() : (raw || '').trim();
          }}
          addTagToInput={addTagToInput}
          removeTag={removeTag}
          tagDropdownOpen={tagDropdownOpen}
          setTagDropdownOpen={setTagDropdownOpen}
          tagInputRef={tagInputRef}
          tagDropdownRef={tagDropdownRef}
          filteredTagSuggestions={filteredTagSuggestions}
          allTags={allTags}
          sshKeys={sshKeys}
          sshKeySearchQuery={sshKeySearchQuery}
          onSshKeySearchQueryChange={setSshKeySearchQuery}
          showSshKeyDropdown={showSshKeyDropdown}
          onShowSshKeyDropdownChange={setShowSshKeyDropdown}
          selectedSshKeyId={selectedSshKeyId}
          onSelectedSshKeyIdChange={setSelectedSshKeyId}
          navigate={navigate}
        />

        {/* 批量导入模态框 */}
        {isImportModalOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-surface rounded-xl p-6 w-full max-w-4xl mx-4 max-h-[90vh] overflow-y-auto">
              <h3 className="text-xl font-bold text-text-primary mb-4">批量导入服务器</h3>
              <p className="text-sm text-text-secondary mb-4">
                每行一个 JSON 对象，包含以下字段：name, hostname, port, username, password,
                use_ssh_key(0/1), description, tags(逗号分隔)
              </p>
              <div className="mb-4 p-3 bg-background rounded-lg">
                <p className="text-xs text-text-secondary font-mono mb-2">示例:</p>
                <pre className="text-xs text-text-secondary font-mono overflow-x-auto">{`{"name":"Web-01","hostname":"192.168.1.10","port":22,"username":"root","password":"xxx","use_ssh_key":0,"description":"生产服务器","tags":"prod,web"}`}</pre>
              </div>
              <textarea
                value={importData}
                onChange={(e) => setImportData(e.target.value)}
                placeholder="每行一个 JSON 对象..."
                rows={8}
                className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:border-primary text-text-primary font-mono text-sm"
              />
              {importResult && (
                <div className="mt-4 p-4 bg-background rounded-lg">
                  <h4 className="font-medium text-text-primary mb-2">导入结果</h4>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <span className="text-2xl font-bold text-status-success">
                        {importResult.success}
                      </span>
                      <p className="text-xs text-text-secondary">成功</p>
                    </div>
                    <div>
                      <span className="text-2xl font-bold text-status-failed">
                        {importResult.failed}
                      </span>
                      <p className="text-xs text-text-secondary">失败</p>
                    </div>
                    <div>
                      <span className="text-2xl font-bold text-text-secondary">
                        {importResult.skipped}
                      </span>
                      <p className="text-xs text-text-secondary">跳过(重复)</p>
                    </div>
                  </div>
                  {importResult.details && importResult.details.length > 0 && (
                    <div className="mt-3 max-h-40 overflow-y-auto">
                      {importResult.details.map((d: any, i: number) => (
                        <div key={i} className="flex items-center justify-between py-1 text-xs">
                          <span>
                            {d.name} ({d.hostname})
                          </span>
                          <span
                            className={
                              d.status === 'success'
                                ? 'text-status-success'
                                : d.status === 'duplicate'
                                  ? 'text-text-secondary'
                                  : 'text-status-failed'
                            }
                          >
                            {d.status === 'success'
                              ? '✓ 成功'
                              : d.status === 'duplicate'
                                ? '跳过'
                                : `✗ ${d.error}`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => setIsImportModalOpen(false)}
                  className="flex-1 px-4 py-2 bg-surface border border-border text-text-primary rounded-lg hover:bg-background transition-colors"
                >
                  关闭
                </button>
                <button
                  onClick={handleImport}
                  disabled={!importData}
                  className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <Upload className="w-4 h-4" />
                  导入
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 分组管理模态框 */}
        {isGroupModalOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-surface rounded-xl p-6 w-full max-w-md mx-4">
              <h3 className="text-xl font-bold text-text-primary mb-6">
                {editingGroup ? '编辑分组' : '新建分组'}
              </h3>
              <form onSubmit={handleGroupSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    分组名称 *
                  </label>
                  <input
                    type="text"
                    value={groupFormData.name}
                    onChange={(e) =>
                      setGroupFormData({ ...groupFormData, name: e.target.value })
                    }
                    placeholder="例如: 生产环境"
                    className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:border-primary text-text-primary"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">父分组</label>
                  <select
                    value={groupFormData.parent_id}
                    onChange={(e) =>
                      setGroupFormData({ ...groupFormData, parent_id: e.target.value })
                    }
                    className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:border-primary text-text-primary"
                  >
                    <option value="">无 (根分组)</option>
                    {(groupsData || []).map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">描述</label>
                  <textarea
                    value={groupFormData.description}
                    onChange={(e) =>
                      setGroupFormData({ ...groupFormData, description: e.target.value })
                    }
                    placeholder="分组描述..."
                    rows={3}
                    className="w-full px-4 py-2 bg-background border border-border rounded-lg focus:outline-none focus:border-primary text-text-primary"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => {
                      setIsGroupModalOpen(false);
                      setEditingGroup(null);
                    }}
                    className="flex-1 px-4 py-2 bg-surface border border-border text-text-primary rounded-lg hover:bg-background transition-colors"
                  >
                    取消
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {editingGroup ? '保存更改' : '创建分组'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* AI 命令生成模态框 */}
        <AiCommandSection
          isOpen={isAiCommandModalOpen}
          aiCommandServer={aiCommandServer}
          aiPrompt={aiPrompt}
          onAiPromptChange={setAiPrompt}
          aiGeneratedCommand={aiGeneratedCommand}
          onAiGeneratedCommandChange={setAiGeneratedCommand}
          aiCommandExplanation={aiCommandExplanation}
          aiGenerationError={aiGenerationError}
          isAiGenerating={isAiGenerating}
          selectedAiAgent={selectedAiAgent}
          showAiCommandConfirm={showAiCommandConfirm}
          onClose={() => {
            setIsAiCommandModalOpen(false);
            setAiPrompt('');
            setAiGeneratedCommand('');
            setAiCommandExplanation('');
            setAiGenerationError('');
            setShowAiCommandConfirm(false);
          }}
          onGenerate={handleAiGenerateCommand}
          onExecute={handleExecuteAiCommand}
          onConfirmExecute={confirmExecuteAiCommand}
          onCancelConfirm={() => setShowAiCommandConfirm(false)}
        />

        {/* 删除确认弹窗 */}
        {isDeleteConfirmOpen && pendingDeleteServer && (
          <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]"
            onClick={() => {
              setIsDeleteConfirmOpen(false);
              setPendingDeleteServer(null);
            }}
          >
            <div
              className="bg-gradient-to-br from-surface/70 to-background/70 backdrop-blur-xl rounded-xl p-6 w-full max-w-md mx-4 border border-red-500/20"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-lg font-bold text-red-400 mb-4 flex items-center gap-2">
                <AlertTriangle className="w-5 h-5" />
                删除服务器
              </h3>
              <p className="text-text-secondary mb-6">
                确定要删除服务器{' '}
                <span className="text-text-primary font-medium">{pendingDeleteServer.name}</span>{' '}
                吗？此操作不可撤销。
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setIsDeleteConfirmOpen(false);
                    setPendingDeleteServer(null);
                  }}
                  className="flex-1 px-4 py-2 bg-surface border border-border text-text-primary rounded-lg hover:bg-background transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => deleteMutation.mutate(pendingDeleteServer.id)}
                  className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  确认删除
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 合规检查选项弹窗 */}
        {showComplianceOptions && selectedServer && (
          <div
            className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60]"
            onClick={() => setShowComplianceOptions(false)}
          >
            <div
              className="bg-surface rounded-xl p-6 w-full max-w-md mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
                    <ShieldCheck className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-text-primary">合规检查</h3>
                    <p className="text-sm text-text-secondary mt-1">
                      {selectedServer.name} ({selectedServer.hostname})
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setShowComplianceOptions(false)}
                  className="p-2 hover:bg-background rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-text-secondary" />
                </button>
              </div>

              <div className="space-y-6">
                {/* AI 智能分析开关 */}
                <div className="p-4 bg-background rounded-lg border border-border">
                  <label className="flex items-center justify-between cursor-pointer">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-text-primary">AI 智能分析</span>
                        {complianceOptions.useAI && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded-full font-medium">
                            推荐
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-text-tertiary mt-1">
                        {complianceOptions.useAI
                          ? '🤖 对检查结果进行智能分析，给出专业建议'
                          : '⚡ 仅执行命令，检查速度提升 60%'}
                      </span>
                    </div>
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={complianceOptions.useAI}
                        onChange={(e) =>
                          setComplianceOptions((prev) => ({ ...prev, useAI: e.target.checked }))
                        }
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-surface border-2 border-border rounded-full peer peer-checked:bg-primary peer-checked:border-primary transition-all">
                        <div className="w-4 h-4 bg-white rounded-full shadow-md absolute top-0.5 left-0.5 peer-checked:translate-x-5 transition-transform"></div>
                      </div>
                    </div>
                  </label>
                </div>

                {/* 并发数选择 */}
                <div className="p-4 bg-background rounded-lg border border-border">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <span className="text-sm font-medium text-text-primary">并发执行数</span>
                      <p className="text-xs text-text-tertiary mt-1">同时执行的检查命令数量</p>
                    </div>
                    <span className="text-lg font-bold text-primary">
                      {complianceOptions.concurrency}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    {[3, 5, 8, 10].map((num) => (
                      <button
                        key={num}
                        onClick={() =>
                          setComplianceOptions((prev) => ({ ...prev, concurrency: num }))
                        }
                        className={clsx(
                          'flex-1 py-2 rounded-lg text-sm font-medium transition-all',
                          complianceOptions.concurrency === num
                            ? 'bg-primary text-white'
                            : 'bg-surface text-text-secondary hover:text-text-primary border border-border',
                        )}
                      >
                        {num}
                      </button>
                    ))}
                  </div>
                  <div className="flex justify-between mt-2 text-xs text-text-tertiary">
                    <span>较慢（稳定）</span>
                    <span>推荐</span>
                    <span>较快（对服务器压力大）</span>
                  </div>
                </div>

                {/* 预计时间提示 */}
                <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                  <p className="text-sm text-blue-300">
                    ⏱️ 预计执行时间：约{' '}
                    <strong>
                      {complianceOptions.useAI
                        ? 15 + (10 - complianceOptions.concurrency) * 2
                        : 3 + (10 - complianceOptions.concurrency)}
                    </strong>{' '}
                    秒
                  </p>
                </div>
              </div>

              {/* 操作按钮 */}
              <div className="flex gap-3 mt-6">
                <button
                  onClick={() => setShowComplianceOptions(false)}
                  className="flex-1 px-4 py-2 bg-surface border border-border text-text-primary rounded-lg hover:bg-background transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={startComplianceCheck}
                  disabled={isRunningCompliance}
                  className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {isRunningCompliance ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      检查中...
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      开始检查
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
