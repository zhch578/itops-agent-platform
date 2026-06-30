/**
 * AI Services - 统一导出入口
 *
 * 保持对外兼容：所有子模块的公共 API 均在此重新导出。
 * 外部模块可直接从 ../services/ 导入，无需关心内部子目录结构。
 */

// ── LLM 调用层 ──
export {
  callDoubaoAPI,
  callOpenAIAPI,
  callLocalAIAPI,
  generateCompletion,
  executeAgentWithLLM,
  checkLLMAvailability,
  getCircuitBreaker,
  circuitBreakers,
  startCircuitBreakerCleanup,
  stopCircuitBreakerCleanup,
  getCircuitBreakerStats,
} from './llm/llmService';

// ── Agent 管理 ──
export { executeAgentNode, getThinkingSteps } from './agents/agentExecutor';
export { agentToolRegistry } from './agents/agentToolRegistry';
export type { AgentTool } from './agents/agentToolRegistry';
export { copilotService } from './agents/copilotService';
export {
  MultiAgentOrchestrator,
  AgentMessageBus,
} from './agents/multiAgentCollaboration';
export type {
  CollaborationMessage,
  AgentCollaborationContext,
} from './agents/multiAgentCollaboration';

// ── 根因分析 (RCA) ──
export { rootCauseAnalysisService } from './rca/rootCauseAnalysisService';
export { localRuleEngine, LocalRuleEngine } from './rca/localRuleEngine';

// ── 自动修复 ──
export { aiRemediationService } from './remediation/aiRemediationService';
export { default as EnhancedRAGService } from './remediation/enhancedRAGService';

// ── 知识库 ──
export { qanythingService } from './knowledge/qanythingService';

// ── 模型管理 ──
export {
  getEffectiveApiKey,
  getEffectiveApiBase,
  getAllModels,
  getEnabledModels,
  getModelById,
  getDefaultModel,
  createModel,
  updateModel,
  deleteModel,
  reorderModels,
  testModelConnectivity,
  migrateOldConfigToAIModels,
  migrateOldAgents,
} from './models/aiModelService';
export type {
  AIModel,
  CreateAIModelDTO,
  UpdateAIModelDTO,
} from './models/aiModelService';
