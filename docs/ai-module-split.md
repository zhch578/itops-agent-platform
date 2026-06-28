# ai/ 模块拆子域方案

## 现状
`backend/src/modules/ai/` — 41 文件, 11,920 行（全项目最大模块）
已有 3 个子目录（edge/, multiAgent/, providers/），但 17 个服务文件仍然平铺在 services/ 下。

## 目标结构

```
modules/ai/
├── README.md                           ← 已创建
├── routes/                             ← 8 路由文件（保持不变）
├── prompts/                            ← 保持不变
├── services/
│   ├── index.ts                        ← 统一导出，保持外部兼容
│   ├── llm/                            ← LLM 调用层 (3 文件)
│   │   ├── llmService.ts               ← 主入口（拆后 ~200 行）
│   │   ├── modelClient.ts              ← 多模型 API 调用
│   │   ├── circuitBreaker.ts           ← 熔断 + 重试
│   │   └── timeoutManager.ts           ← 超时控制
│   ├── agents/                         ← Agent 管理 (4 文件)
│   │   ├── agentExecutor.ts            ← Agent 执行引擎
│   │   ├── agentToolRegistry.ts        ← 工具注册
│   │   ├── copilotService.ts           ← Copilot 服务
│   │   └── multiAgentCollaboration.ts  ← 多 Agent 编排
│   ├── rca/                            ← 根因分析 (2 文件)
│   │   ├── rootCauseAnalysisService.ts ← 根因分析
│   │   └── localRuleEngine.ts          ← 本地规则引擎
│   ├── remediation/                    ← 自动修复 (2 文件)
│   │   ├── aiRemediationService.ts     ← AI 修复建议
│   │   └── enhancedRAGService.ts       ← RAG 增强检索
│   ├── knowledge/                      ← 知识库 (2 文件)
│   │   ├── knowledgeService.ts         ← (若存在或新建)
│   │   └── qanythingService.ts         ← QAnything 集成
│   ├── models/                         ← 模型管理 (1 文件)
│   │   └── aiModelService.ts           ← 模型配置
│   ├── edge/                           ← 保持不变 (3 文件)
│   ├── multiAgent/                     ← 保持不变 (6 文件)
│   └── providers/                      ← 保持不变 (5 文件)
```

## 迁移步骤

### Step 1: 创建目录
```
mkdir services/llm services/agents services/rca services/remediation services/knowledge services/models
```

### Step 2: 移动/复制文件
| 原文件 | 目标 |
|--------|------|
| `services/llmService.ts` | → `services/llm/llmService.ts` |
| `services/llmService.test.ts` | → `services/llm/llmService.test.ts` |
| `services/agentExecutor.ts` | → `services/agents/agentExecutor.ts` |
| `services/agentExecutor.test.ts` | → `services/agents/` |
| `services/agentToolRegistry.ts` | → `services/agents/` |
| `services/copilotService.ts` | → `services/agents/` |
| `services/multiAgentCollaboration.ts` | → `services/agents/` |
| `services/multiAgentCollaboration.test.ts` | → `services/agents/` |
| `services/rootCauseAnalysisService.ts` | → `services/rca/` |
| `services/rootCauseAnalysisService.test.ts` | → `services/rca/` |
| `services/localRuleEngine.ts` | → `services/rca/` |
| `services/localRuleEngine.test.ts` | → `services/rca/` |
| `services/aiRemediationService.ts` | → `services/remediation/` |
| `services/enhancedRAGService.ts` | → `services/remediation/` |
| `services/qanythingService.ts` | → `services/knowledge/` |
| `services/aiModelService.ts` | → `services/models/` |
| `services/aiModelService.test.ts` | → `services/models/` |

### Step 3: 创建统一导出
`services/index.ts`:
```typescript
// LLM
export { llmService } from './llm/llmService';
// Agents
export { agentExecutor } from './agents/agentExecutor';
export { multiAgentCollaboration } from './agents/multiAgentCollaboration';
// RCA
export { rootCauseAnalysisService } from './rca/rootCauseAnalysisService';
export { localRuleEngine } from './rca/localRuleEngine';
// ... 以此类推
```

### Step 4: 更新所有下游 import
受影响文件：
- `routes/` 下 8 个路由文件
- 同模块跨子域引用（如 `multiAgentCollaboration.ts` 引用 `llmService.ts`）

引用路径示例：
```typescript
// 旧: import { llmService } from '../services/llmService';
// 新: import { llmService } from '../services/llm/llmService';
```

### Step 5: 更新 app.ts
检查 `app.ts` 中是否直接 import 了 `ai/services/*`，更新路径。

## 验证
```bash
cd backend && npx tsc --noEmit  # 检查编译
npx vitest run ai/               # 运行 AI 模块测试
```

## 注意
- `multiAgent/` 和 `providers/` 已有自己的目录结构，保持不变
- 不要改动 `prompts/` 目录
- 保持对外接口（函数签名、导出名）不变，只改文件位置
