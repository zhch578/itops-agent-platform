/**
 * AI 模块前端路由定义
 */
import { lazy } from 'react';

const Agents = lazy(() => import('./pages/Agents'));
const Knowledge = lazy(() => import('./pages/Knowledge'));
const RootCauseAnalysis = lazy(() => import('./pages/RootCauseAnalysis'));
const AIRootCause = lazy(() => import('./pages/AIRootCause'));
const RCADetail = lazy(() => import('./pages/RCADetail'));
const AIInsights = lazy(() => import('./pages/AIInsights'));
const AIModels = lazy(() => import('./pages/AIModels'));
const AiRemediations = lazy(() => import('./pages/AiRemediations'));

export const aiRoutes = [
  { path: 'agents', element: Agents },
  { path: 'agents/tools', element: Agents },
  { path: 'knowledge', element: Knowledge },
  { path: 'root-cause-analysis', element: RootCauseAnalysis },
  { path: 'ai-root-cause', element: AIRootCause },
  { path: 'ai-root-cause/:id', element: RCADetail },
  { path: 'ai-insights', element: AIInsights },
  { path: 'ai-models', element: AIModels },
  { path: 'ai-remediations', element: AiRemediations },
];
