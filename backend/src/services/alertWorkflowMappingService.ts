import { logger } from '../utils/logger';

interface AlertContext {
  id: string;
  source: string;
  severity: string;
  rawSeverity?: string;
  title: string;
  content: string;
  tags?: string | string[];
}

interface MappingResult {
  mappingId: string;
  workflowId: string;
  workflowName: string;
  taskId: string;
}

class AlertWorkflowMappingService {
  /**
   * 根据告警匹配第一个符合条件的工作流并触发执行
   * 当前为占位实现，后续可扩展为完整的告警→工作流映射引擎
   */
  triggerFirstMatchingWorkflow(alert: AlertContext): MappingResult | null {
    try {
      logger.info(`[AlertWorkflowMapping] 尝试匹配告警: ${alert.id} (${alert.source}/${alert.severity})`);
      // TODO: 实现完整的告警映射规则匹配逻辑
      // 当前返回 null 表示未匹配到任何工作流
      return null;
    } catch (error) {
      logger.error(`[AlertWorkflowMapping] 匹配失败:`, error);
      return null;
    }
  }
}

export const alertWorkflowMappingService = new AlertWorkflowMappingService();
