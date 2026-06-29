import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import bodyParser from 'body-parser';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { initializeDatabase, setIOInstance, db } from './models/database';
import { setupWebSocket } from './shared/websocket/handler';
import { registerAllModules } from './modules/_registry';
import { container } from './core/serviceContainer';
import { registerAllServices } from './serviceRegistry';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { authenticateToken, requirePasswordChange } from './middleware/auth';
import { traceMiddleware } from './middleware/trace';
import { env } from './utils/env';
import { logger } from './utils/logger';
import { healthService } from './modules/monitor/services/healthService';
import { selfMonitorService } from './modules/monitor/services/selfMonitorService';
import { setServerInstances } from './modules/infra/services/restartService';
import { timeoutApproval } from './modules/workflow/services/workflowExecutor';
import { vncProxyService } from './modules/network/services/vncProxyService';

const app = express();
const httpServer = createServer(app);

const io = new SocketIOServer(httpServer, {
  cors: {
    origin: env.ALLOWED_ORIGINS,
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 1e6, // 1MB max message size to prevent memory exhaustion
  pingTimeout: 60000,
  pingInterval: 25000
});

setServerInstances(httpServer, io);

app.use(helmet());
app.use(traceMiddleware);
app.use(morgan('combined'));
app.use(cors({
  origin: env.ALLOWED_ORIGINS,
  credentials: true
}));

app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

async function initializeApp() {
  await initializeDatabase();

  // 注入 io 实例到容器（供 dcStatusPush 等服务使用）
  (container as any).__io = io;

  // 使用服务容器统一初始化所有服务
  registerAllServices();
  await container.initAll();

  // 凭证迁移（依赖 credentialService 初始化完成）
  try {
    const credentialService = container.get<any>('credentialService');
    const migrationResult = credentialService.migrateFromSettings();
    if (migrationResult.migrated > 0) {
      logger.warn(`⚠️ Migrated ${migrationResult.migrated} API keys from plaintext settings to encrypted credentials`);
    }
  } catch (migrationError) {
    logger.warn('Credential migration encountered errors (non-fatal)', migrationError as Error);
  }

  startApprovalTimeoutChecker();
  
  logger.info('✅ Application initialization complete');
}

setupWebSocket(io);
setIOInstance(io);
vncProxyService.initialize(io);

// 公开路由 - 通过 _registry.ts 自动注册
// 健康检查 - 不需要认证
app.get('/health', async (_req, res) => {
  const health = await healthService.checkHealth();
  const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
  res.status(statusCode).json(health);
});

app.get('/health/live', (_req, res) => {
  res.json({ status: 'alive', timestamp: new Date().toISOString() });
});

app.get('/health/ready', async (_req, res) => {
  const health = await healthService.checkHealth();
  const isReady = health.status === 'healthy' || health.status === 'degraded';
  res.status(isReady ? 200 : 503).json({
    ready: isReady,
    status: health.status,
    checks: health.checks
  });
});

// 以下所有路由都需要认证
app.use(authenticateToken);

// 健康检查接口（已认证）- 无需强制改密码检查
app.get('/api/health/summary', (_req, res) => {
  const summary = healthService.getHealthSummary();
  res.json({ success: true, data: summary });
});
app.get('/api/health/history', (_req, res) => {
  const history = healthService.getHealthHistory();
  res.json({ success: true, data: history });
});
app.get('/api/health/monitor', async (_req, res) => {
  const report = selfMonitorService.getLastReport();
  if (!report) {
    res.json({ success: false, message: 'No monitor report yet, service still initializing' });
    return;
  }
  res.json({ success: true, data: report });
});
app.get('/api/health/monitor/alerts', (_req, res) => {
  const alerts = selfMonitorService.getAlertHistory();
  res.json({ success: true, data: alerts });
});

// 以下所有路由需要检查是否已修改初始密码
app.use(requirePasswordChange);

// === 自动注册所有模块路由 ===
// 新增模块只需在 modules/_registry.ts 中添加配置，无需修改此文件
registerAllModules(app);

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = env.PORT;
const HOST = process.env.HOST || '0.0.0.0';

// 审批超时检查器
let approvalTimeoutInterval: NodeJS.Timeout | null = null;

function startApprovalTimeoutChecker() {
  // 每 30 秒检查一次超时的审批请求
  approvalTimeoutInterval = setInterval(async () => {
    try {
      const expiredApprovals = db.prepare(`
        SELECT id FROM approval_requests
        WHERE status = 'pending'
        AND timeout_at IS NOT NULL
        AND timeout_at < datetime('now', 'localtime')
      `).all() as Array<{ id: string }>;

      for (const approval of expiredApprovals) {
        logger.info(`⏰ Approval ${approval.id} timed out, processing...`);
        await timeoutApproval(approval.id);
      }
    } catch (error) {
      logger.error('Error in approval timeout checker:', error);
    }
  }, 30000);

  logger.info('✅ Approval timeout checker started (checking every 30s)');
}

// 等待数据库初始化完成后再启动 HTTP 服务器，避免竞态
async function startServer() {
  await initializeApp();
  
  httpServer.listen(PORT, HOST, () => {
    logger.info(`🚀 ITOps Agent Platform Backend running on ${HOST}:${PORT}`);
    logger.info(`📡 WebSocket server ready`);
    logger.info(`🌍 Environment: ${env.NODE_ENV}`);
  });
}

startServer().catch(error => {
  logger.error('❌ Failed to start server', error);
  process.exit(1);
});

const gracefulShutdown = async (signal: string) => {
  logger.info(`${signal} received, starting graceful shutdown...`);
  
  const shutdownTimeout = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 30000);

  // 停止审批超时检查器
  if (approvalTimeoutInterval) {
    clearInterval(approvalTimeoutInterval);
  }

  try {
    await Promise.all([
      new Promise<void>((resolve) => httpServer.close(() => {
        logger.info('HTTP server closed');
        resolve();
      })),
      new Promise<void>((resolve) => io.close(() => {
        logger.info('WebSocket server closed');
        resolve();
      }))
    ]);

    // 使用服务容器统一关闭所有服务
    await container.shutdownAll();

    db.close();
    logger.info('Database connection closed');

    logger.shutdown();
    clearTimeout(shutdownTimeout);
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown', error as Error);
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled Promise Rejection', reason instanceof Error ? reason : new Error(String(reason)));
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', error);
  process.exit(1);
});

export { app, io };
