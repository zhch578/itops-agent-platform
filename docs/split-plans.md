# 大文件拆分方案

> 本文档为 TraeCN IDE 提供精确的拆分指导。
> 原则：不改变逻辑，不改变 API，每个新文件一个独立职责。

---

## 1. `Servers.tsx` (2,559 行) — 拆分 5 个文件

### 现状
单体页面，包含：类型定义、SSH 密钥管理、命令执行、AI 命令生成、合规检查、服务器分组、导入导出、选中等所有功能。

### 拆分方案

```
modules/servers/pages/
├── Servers.tsx              ← 主入口 (~200 行)：Tab 切换 + Modal 装配
├── types.ts                 ← 所有 interface/type（L19-L82）
├── ServerListSection.tsx    ← 服务器表格/列表渲染 + 搜索/筛选
├── ServerFormModal.tsx      ← 新增/编辑服务器表单 Modal
├── SshKeySection.tsx        ← SSH 密钥管理子页面
├── CommandSection.tsx       ← 命令执行 + 结果展示
├── AiCommandSection.tsx     ← AI 生成命令对话
├── ComplianceSection.tsx    ← 合规检查 + 报告
├── ServerGroupSection.tsx   ← 服务器分组树
└── useServerActions.ts      ← 抽取所有 handler (handleSubmit,handleDelete,handleTestConnection…)
```

### 关键映射
| 原代码段 | 行范围 | 目标文件 |
|---------|--------|---------|
| `interface Server / ServerGroup / ...` | L19-L82 | `types.ts` |
| 所有 `const [xxx, setXxx] = useState` | L88-L163 | `useServerActions.ts` (或留在主入口) |
| `resetForm`, `handleSubmit`, `handleEdit` | L457-L520 | `useServerActions.ts` |
| SSH 密钥相关 (Tags, Dropdown) | L155-L250 | `SshKeySection.tsx` |
| 命令执行 (handleExecuteCommand) | L526-L540 | `CommandSection.tsx` |
| AI 命令生成 (handleAiGenerateCommand) | L581-L650 | `AiCommandSection.tsx` |
| 合规检查 (handleRunCompliance) | L542-L580 | `ComplianceSection.tsx` |
| 服务器分组 (GroupTree) | L752-L784 | `ServerGroupSection.tsx` |
| `renderTabContent` | L784-L1082 | 分发给各 Section 文件 |
| 导入导出 (handleImport) | L717-L750 | `ServerListSection.tsx` |

### import 路径示例
```typescript
// Servers.tsx
import type { Server, ServerGroup } from './types';
import { ServerListSection } from './ServerListSection';
import { useServerActions } from './useServerActions';

// 其他 Section 文件
import type { Server } from '../types';
import { api } from '../../../../lib/api';
```

---

## 2. `Settings.tsx` (1,680 行) — 拆分 6 文件

### 现状
单一设置页面，包含所有系统配置（通用、安全、通知、模型、备份、外观等），通过 Tab 切换。

### 拆分方案

```
modules/infra/pages/
├── Settings.tsx             ← 主入口 (~80 行)：Tab 切换 + import 子页面
├── settings/
│   ├── GeneralSettings.tsx  ← 通用设置（系统名称、时区、语言）
│   ├── SecuritySettings.tsx ← 安全配置（密码策略、会话超时、2FA）
│   ├── NotificationSettings.tsx ← 通知渠道配置
│   ├── ModelSettings.tsx    ← AI 模型配置（原导入 AIModels）
│   └── BackupSettings.tsx   ← 备份策略
```

### 注意点
- `Settings.tsx` L12 有 `import AIModels from './AIModels'`→ 改为 `from '../../ai/pages/AIModels'`
- 各 tab 内容按 `activeTab === 'xxx'` 条件渲染 → 改为 `<ModelSettings />` 组件

---

## 3. `Containers.tsx` (1,667 行) — 拆分 4 文件

```
modules/containers/pages/
├── Containers.tsx           ← 主入口：容器列表 + 操作按钮
├── ContainerDetail.tsx      ← 容器详情/日志/监控 Tab
├── ImageSection.tsx         ← 镜像管理（搜索、拉取、删除）
├── VolumeSection.tsx        ← 卷管理
```

---

## 4. `Kubernetes.tsx` (1,458 行) — 拆分 4 文件

```
modules/kubernetes/pages/
├── Kubernetes.tsx           ← 主入口：集群概览 + 导航
├── k8s/
│   ├── PodList.tsx
│   ├── ServiceList.tsx
│   └── NodeList.tsx
```

---

## 5. `remediationService.ts` (1,426 行) — 拆分 4 文件

```
modules/auto/services/
├── RemediationService.ts    ← 主入口：编排 + 分发（~200 行）
├── remediation/
│   ├── policyEngine.ts      ← 策略匹配、条件评估
│   ├── executionTracker.ts  ← 执行记录、进度跟踪
│   └── remediationActions.ts ← 具体修复动作（重启服务、清理磁盘等）
```

### 注意
- 需要更新 `routes/remediation.ts` 中的 import
- 保持 `remediationService.ts` 对外暴露的接口不变

---

## 6. `VirtualMachines.tsx` (1,347 行) — 拆分 3 文件

```
modules/containers/pages/
├── VirtualMachines.tsx      ← VM 列表概览
├── VmCreateWizard.tsx       ← 创建 VM 向导
├── VmDetailPanel.tsx        ← VM 详情 / 控制台 / 快照
```

---

## 7. `BigScreenDashboard.tsx` (1,299 行) — 拆分 4 文件

```
modules/monitor/pages/
├── BigScreenDashboard.tsx   ← 主布局 + 数据聚合
├── dashboard/
│   ├── MetricCard.tsx       ← 单个指标卡片
│   ├── TopologyWidget.tsx   ← 拓扑图部件
│   └── AlertWidget.tsx      ← 告警滚动条
```

---

## 8. `proxmoxAdapter.ts` (1,238 行) — 拆分 3 文件

```
modules/containers/services/vmManagement/
├── proxmoxAdapter.ts        ← 主入口：API 调用分发
├── proxmox/
│   ├── nodeOps.ts           ← 节点操作（list, status, reboot）
│   ├── vmOps.ts             ← VM CRUD + 快照
│   └── storageOps.ts        ← 存储管理
```

---

## 9. `Agents.tsx` (1,203 行) — 拆分 3 文件

```
modules/ai/pages/
├── Agents.tsx               ← Agent 列表 + 筛选搜索
├── AgentDetail.tsx          ← Agent 详情 / 配置 / 测试
├── AgentChat.tsx            ← 与 Agent 对话界面
```

---

## 10. `kvmAdapter.ts` (1,094 行) — 拆分 3 文件

```
modules/containers/services/vmManagement/
├── kvmAdapter.ts            ← 主入口
├── kvm/
│   ├── domainOps.ts         ← 虚拟机域操作
│   ├── networkOps.ts        ← 虚拟网络管理
│   └── storageOps.ts        ← 存储池/卷管理
```

---

## 11. `vendorAdapter.ts` (1,074 行) — 拆分 4 文件

```
modules/network/services/
├── vendorAdapter.ts         ← 主入口 + 工厂
├── vendors/
│   ├── cisco.ts             ← Cisco IOS/NX-OS 命令
│   ├── huawei.ts            ← Huawei VRP 命令
│   └── h3c.ts               ← H3C Comware 命令
```

---

## 12. `llmService.ts` (917 行) — 拆分 3 文件

```
modules/ai/services/
├── llmService.ts            ← 对外接口 (保持不变)
├── llm/
│   ├── modelClient.ts       ← 各模型 API 调用 (Doubao/OpenAI)
│   ├── circuitBreaker.ts    ← 熔断器 + 重试逻辑
│   └── timeoutManager.ts    ← 超时控制 + AbortSignal
```

---

## 13. `workflowExecutor.ts` (878 行) — 拆分 3 文件

```
modules/workflow/services/
├── workflowExecutor.ts      ← 主入口：执行编排
├── executor/
│   ├── nodeExecutors.ts     ← 各节点类型执行器（HTTP,SSH,Script,AI,Wait…）
│   └── stateManager.ts      ← 工作流状态持久化 + 恢复
```

---

## 14. `backupService.ts` (876 行) — 拆分 3 文件

```
modules/infra/services/
├── backupService.ts         ← 主入口：备份策略 + 调度
├── backup/
│   ├── backupExecutors.ts   ← 各类备份执行器 (DB/File/Docker Volume)
│   └── backupCleanup.ts     ← 保留策略 + 清理
```

---

## 执行顺序建议

```
第一优先（前端大页）：Servers(2559) → Settings(1680) → Containers(1667) → Kubernetes(1458)
第二优先（后端大服务）：remediation(1426) → proxmoxAdapter(1238) → llmService(917)
第三优先（后续）：kvmAdapter(1094) → vendorAdapter(1074) → workflowExecutor(878)
```

每个拆分遵循流程：
1. `git mv` 或复制原文件 → 2. 提取代码段 → 3. 更新 import → 4. `npm run build` 验证 → 5. 删除原段
