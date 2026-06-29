import express from 'express';
import cors from 'cors';
import path from 'path';
import { initializeDatabase } from './models/database';
import { healthService } from './modules/monitor/services/healthService';
import { selfMonitorService } from './modules/monitor/services/selfMonitorService';
import { authenticateToken, requirePasswordChange } from './middleware/auth';
import { registerAllModules } from './modules/_registry';
import { backupService } from './modules/infra/services/backupService';
import { reportService } from './modules/infra/services/reportService';
import { dockerService } from './modules/containers/services/dockerService';
import { composeService } from './modules/infra/services/composeService';

const app = express();
const PORT = process.env.PORT || 3001;

const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
const corsOptions = {
  origin: [
    frontendUrl,
    'http://localhost:5173',
    'http://localhost:3000'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, '../../frontend/dist')));

const initApp = async () => {
  try {
    console.log('正在初始化数据库...');
    await initializeDatabase();
    console.log('数据库初始化成功！');

    console.log('正在初始化自监控...');
    selfMonitorService.init();
    console.log('自监控初始化成功！');

    console.log('正在启动定时备份...');
    backupService.init();
    console.log('定时备份启动成功！');

    console.log('正在初始化 Compose 数据库表...');
    composeService.ensureTables();
    console.log('Compose 表初始化成功！');

    console.log('正在启动报告联动...');
    reportService.init();
    console.log('报告联动启动成功！');

    console.log('正在初始化 Docker 连接...');
    const dockerReady = await dockerService.init();
    if (dockerReady) {
      console.log('Docker 连接初始化成功！');
    } else {
      console.log('Docker 不可用，容器管理功能将受限');
    }

    console.log('正在初始化定期重启...');
    const now = new Date();
    const nextRestart = new Date(now);
    nextRestart.setDate(now.getDate() + 1);
    nextRestart.setHours(3, 0, 0, 0);
    const restartDelay = nextRestart.getTime() - now.getTime();
    setTimeout(() => {
      console.log('定期重启触发中...');
      process.exit(0);
    }, restartDelay);
    console.log('定期重启已设置在 ' + nextRestart);

    console.log('正在注册模块路由...');
    registerAllModules(app);
    console.log('模块路由注册成功！');

    console.log('正在启动服务...');
    app.listen(PORT, () => {
      console.log(`🚀 服务已启动在 http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('服务启动失败:', error);
    process.exit(1);
  }
};

app.get('/health', async (req, res) => {
  const health = await healthService.checkHealth();
  const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
  res.status(statusCode).json(health);
});

app.get('/health/live', (req, res) => {
  res.json({ status: 'alive', timestamp: new Date().toISOString() });
});

app.get('/health/ready', async (req, res) => {
  const health = await healthService.checkHealth();
  const isReady = health.status === 'healthy' || health.status === 'degraded';
  res.status(isReady ? 200 : 503).json({
    ready: isReady,
    status: health.status,
    checks: health.checks
  });
});

initApp();

export default app;
