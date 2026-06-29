/**
 * 服务注册中心（组装层 / Composition Root）
 * 
 * 位于 src/ 根级别，不在 core/ 中
 * 原因：它负责组装所有模块，按照架构约束规则，
 * 组装层可以依赖所有模块，而 core/ 不能依赖 modules/
 * 
 * 参照 ongrid 的 cmd/ 层（assembly layer）模式
 */

import { container } from './core/serviceContainer';
import { db } from './models/database';
import { logger } from './utils/logger';

// 服务导入
import { initAlertService } from './modules/alerts/services/alertService';
import { reportService } from './modules/infra/services/reportService';
import { copilotService } from './modules/ai/services/agents/copilotService';
import { rootCauseAnalysisService } from './modules/ai/services/rca/rootCauseAnalysisService';
import { schedulerService } from './modules/workflow/services/schedulerService';
import { notificationService } from './modules/infra/services/notificationService';
import { remediationService } from './modules/auto/services/remediationService';
import { backupService } from './modules/infra/services/backupService';
import { credentialService } from './modules/auth/services/credentialService';
import { queueService } from './modules/workflow/services/queueService';
import { selfMonitorService } from './modules/monitor/services/selfMonitorService';
import { snmpPollingService } from './modules/network/services/snmpPollingService';
import { alertAutoAnalyzer } from './modules/alerts/services/alertAutoAnalyzer';
import { alertCorrelationService } from './modules/alerts/services/alertCorrelationService';
import { alertAutoResponseService } from './modules/alerts/services/alertAutoResponse/alertAutoResponseService';
import { dockerService } from './modules/containers/services/dockerService';
import { configTemplateService } from './modules/infra/services/configTemplateService';
import { composeService } from './modules/infra/services/composeService';
import { registryService } from './modules/containers/services/registryService';
import { kubernetesService } from './modules/kubernetes/services/kubernetesService';
import { autoScaleService } from './modules/auto/services/autoScaleService';
import { vmMigrationService } from './modules/containers/services/vmMigrationService';
import { vmSnapshotSchedulerService } from './modules/containers/services/vmSnapshotSchedulerService';
import { multiHostDockerService } from './modules/containers/services/multiHostDockerService';
import { initTokenBlacklist } from './modules/auth/services/tokenBlacklist';
import { startCircuitBreakerCleanup } from './modules/ai/services/llm/llmService';
import { startDCStatusPush, stopDCStatusPush } from './modules/dc/services/dcStatusService';
import { initializeProviders } from './modules/ai/services/providers';

/**
 * 注册所有服务到容器
 */
export function registerAllServices(): void {
  // === 无依赖的基础服务 ===

  container.register('credentialService', () => {
    credentialService.init();
    return credentialService;
  }, [], {
    shutdown: () => { /* noop */ }
  });

  container.register('tokenBlacklist', () => {
    initTokenBlacklist();
    return { name: 'tokenBlacklist' };
  });

  container.register('providers', () => {
    initializeProviders();
    return { name: 'providers' };
  });

  // === 核心业务服务 ===

  container.register('alertService', () => {
    initAlertService();
    return { name: 'alertService' };
  });

  container.register('reportService', () => {
    reportService.init();
    return reportService;
  }, [], {
    shutdown: () => { /* noop */ }
  });

  container.register('copilotService', () => {
    copilotService.init();
    return copilotService;
  });

  container.register('rootCauseAnalysisService', () => {
    rootCauseAnalysisService.init();
    return rootCauseAnalysisService;
  });

  container.register('schedulerService', () => {
    schedulerService.init();
    return schedulerService;
  }, [], {
    shutdown: () => schedulerService.shutdown()
  });

  container.register('notificationService', () => {
    notificationService.init();
    return notificationService;
  });

  container.register('remediationService', () => {
    remediationService.init();
    return remediationService;
  });

  container.register('backupService', () => {
    backupService.init();
    return backupService;
  }, [], {
    shutdown: () => backupService.stopAutoBackup()
  });

  // === 异步任务服务 ===

  container.register('queueService', () => {
    queueService.init();
    return queueService;
  }, [], {
    shutdown: async () => { await queueService.shutdown(); }
  });

  container.register('selfMonitorService', () => {
    selfMonitorService.init();
    return selfMonitorService;
  }, [], {
    shutdown: () => selfMonitorService.shutdown()
  });

  // === 监控与轮询服务 ===

  container.register('snmpPollingService', () => {
    snmpPollingService.start();
    return snmpPollingService;
  }, [], {
    shutdown: () => { /* stop handled elsewhere */ }
  });

  container.register('alertAutoAnalyzer', () => {
    alertAutoAnalyzer.start();
    return alertAutoAnalyzer;
  }, [], {
    shutdown: () => { /* stop handled elsewhere */ }
  });

  container.register('alertCorrelationService', () => {
    alertCorrelationService.start();
    return alertCorrelationService;
  }, [], {
    shutdown: () => alertCorrelationService.stop()
  });

  container.register('alertAutoResponseService', () => {
    alertAutoResponseService.start();
    return alertAutoResponseService;
  });

  // === 容器与虚拟化服务 ===

  container.register('dockerService', () => {
    dockerService.init().catch((err: Error) => {
      logger.warn('Docker service initialization failed (non-fatal)', err);
    });
    return dockerService;
  });

  container.register('configTemplateService', () => {
    configTemplateService.init();
    return configTemplateService;
  });

  // P0-P3: 确保数据库表存在
  container.register('containerVMTables', () => {
    composeService.ensureTables();
    registryService.ensureTables();
    kubernetesService.ensureTables();
    autoScaleService.ensureTables();
    vmMigrationService.ensureTables();
    vmSnapshotSchedulerService.ensureTables();
    multiHostDockerService.ensureTables();
    return { name: 'containerVMTables' };
  });

  // === 基础设施 ===

  container.register('circuitBreaker', () => {
    startCircuitBreakerCleanup();
    return { name: 'circuitBreaker' };
  });

  container.register('dcStatusPush', (ctx) => {
    // io 实例由 app.ts 在注册前注入
    const io = (ctx as any).__io;
    if (io) {
      startDCStatusPush(io, 5000);
    }
    return { name: 'dcStatusPush' };
  }, [], {
    shutdown: () => stopDCStatusPush()
  });
}

/**
 * 便捷函数：初始化所有服务
 */
export async function initAllServices(): Promise<void> {
  registerAllServices();
  await container.initAll();
}

/**
 * 便捷函数：关闭所有服务
 */
export async function shutdownAllServices(): Promise<void> {
  await container.shutdownAll();
}
