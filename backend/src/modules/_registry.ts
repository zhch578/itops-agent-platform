/**
 * 模块路由自动注册器
 *
 * 新增模块只需：
 * 1. 在模块目录下创建 routes.ts（导出 Router）
 * 2. 在此文件中添加一行配置
 *
 * 无需手动修改 app.ts
 */

import { Express, Router } from 'express';
import { rateLimiter } from '../middleware/rateLimiter';
import { webhookIpFilter } from '../middleware/rateLimiter';
import { authenticateToken, requirePasswordChange } from '../middleware/auth';

// === 模块路由导入 ===
import aiRoutes from './ai/routes';
import alertRoutes from './alerts/routes';
import autoRoutes from './auto/routes';
import containerRoutes from './containers/routes';
import databaseRoutes from './database/routes';
import dcRoutes from './dc/routes';
import infraRoutes from './infra/routes';
import kubernetesRoutes from './kubernetes/routes';
import monitorRoutes from './monitor/routes';
import networkRoutes from './network/routes';
import serverRoutes from './servers/routes';
import workflowRoutes from './workflow/routes';

// === Auth 模块：auth 路由公开，user 路由受保护 ===
import authOnlyRoutes from './auth/routes/authRoutes';
import userRoutes from './auth/routes/userRoutes';

// === 特殊路由：挂载在 /api 根路径下 ===
import alertAutoRouter from './alerts/routes/alertAutoRoutes';
import linkageRouter from './infra/routes/linkageRoutes';
import networkDiscoveryRouter from './network/routes/networkDiscoveryRoutes';
import alertCorrelationRouter from './alerts/routes/alertCorrelationRoutes';

// === Webhook 路由：公开且 IP 过滤 ===
import webhookRoutes from './infra/routes/webhookRoutes';

interface ModuleConfig {
  path: string;
  router: Router;
  options?: { public?: boolean; webhook?: boolean; noRateLimit?: boolean };
}

/**
 * 模块路由配置表
 */
const modules: ModuleConfig[] = [
  // === 公开路由：auth + webhook ===
  { path: '/api/auth', router: authOnlyRoutes, options: { public: true } },
  { path: '/api/webhooks', router: webhookRoutes, options: { webhook: true } },

  // === 受保护路由（需要认证） ===
  { path: '/api', router: aiRoutes },
  { path: '/api', router: alertRoutes },
  { path: '/api', router: autoRoutes },
  { path: '/api', router: containerRoutes },
  { path: '/api', router: databaseRoutes },
  { path: '/api', router: dcRoutes },
  { path: '/api', router: infraRoutes },
  { path: '/api', router: kubernetesRoutes },
  { path: '/api', router: monitorRoutes },
  { path: '/api', router: networkRoutes },
  { path: '/api', router: serverRoutes },
  { path: '/api', router: workflowRoutes },
  { path: '/api/users', router: userRoutes },

  // === 受保护特殊路由 ===
  { path: '/api', router: alertAutoRouter },
  { path: '/api', router: linkageRouter },
  { path: '/api', router: networkDiscoveryRouter },
  { path: '/api', router: alertCorrelationRouter },
];

/**
 * 注册所有模块路由到 Express 应用
 * 正确顺序：先公开路由，再加认证，再加受保护路由！
 */
export function registerAllModules(app: Express): void {
  // 1. 注册公开/ webhook 路由，无需认证！
  for (const mod of modules) {
    if (mod.options?.webhook) {
      app.use(mod.path, webhookIpFilter, rateLimiter, mod.router);
    } else if (mod.options?.public) {
      app.use(mod.path, rateLimiter, mod.router);
    }
  }

  // 2. 添加认证中间件，对后续所有受保护路由生效！
  app.use(authenticateToken);

  // 3. 添加密码变更检查中间件！
  app.use(requirePasswordChange);

  // 4. 注册所有受保护路由！
  for (const mod of modules) {
    if (!mod.options?.public && !mod.options?.webhook) {
      if (mod.options?.noRateLimit) {
        app.use(mod.path, mod.router);
      } else {
        app.use(mod.path, rateLimiter, mod.router);
      }
    }
  }
}
