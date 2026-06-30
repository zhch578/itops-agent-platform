/**
 * 服务容器 - 统一的服务生命周期管理
 * 
 * 解决 app.ts 中星型依赖问题，提供：
 * - 声明式服务注册（名称 + 工厂函数 + 依赖）
 * - 按依赖顺序自动初始化
 * - 按逆序优雅关闭
 * - 类型安全的服务获取
 */

import { logger } from '../utils/logger';

interface ServiceDescriptor<T = any> {
  name: string;
  factory: (ctx: ServiceContainer) => T | Promise<T>;
  dependencies?: string[];
  init?: (instance: T) => void | Promise<void>;
  shutdown?: (instance: T) => void | Promise<void>;
}

interface ServiceEntry<T = any> {
  descriptor: ServiceDescriptor<T>;
  instance?: T;
  initialized: boolean;
}

export class ServiceContainer {
  private services = new Map<string, ServiceEntry>();
  private initOrder: string[] = [];

  /**
   * 注册服务
   * 
   * @param name - 服务名称
   * @param factory - 工厂函数，接收容器实例，返回服务实例
   * @param dependencies - 依赖的其他服务名称列表
   * @param lifecycle - 生命周期钩子 { init, shutdown }
   */
  register<T>(
    name: string,
    factory: (ctx: ServiceContainer) => T | Promise<T>,
    dependencies: string[] = [],
    lifecycle?: {
      init?: (instance: T) => void | Promise<void>;
      shutdown?: (instance: T) => void | Promise<void>;
    }
  ): void {
    if (this.services.has(name)) {
      logger.warn(`[ServiceContainer] Service "${name}" already registered, skipping`);
      return;
    }

    this.services.set(name, {
      descriptor: {
        name,
        factory,
        dependencies,
        init: lifecycle?.init,
        shutdown: lifecycle?.shutdown,
      },
      initialized: false,
    });

    logger.debug(`[ServiceContainer] Registered service: ${name}`);
  }

  /**
   * 获取服务实例（懒加载）
   */
  get<T>(name: string): T {
    const entry = this.services.get(name);
    if (!entry) {
      throw new Error(`[ServiceContainer] Service "${name}" not registered`);
    }

    if (!entry.instance) {
      throw new Error(`[ServiceContainer] Service "${name}" not initialized yet. Call initAll() first.`);
    }

    return entry.instance as T;
  }

  /**
   * 安全获取服务实例（可能返回 undefined）
   */
  tryGet<T>(name: string): T | undefined {
    const entry = this.services.get(name);
    if (!entry || !entry.instance) {
      return undefined;
    }
    return entry.instance as T;
  }

  /**
   * 按依赖顺序初始化所有服务
   */
  async initAll(): Promise<void> {
    logger.info('[ServiceContainer] Starting service initialization...');

    const sorted = this.topologicalSort();
    this.initOrder = sorted;

    for (const name of sorted) {
      const entry = this.services.get(name)!;
      if (entry.initialized) continue;

      try {
        logger.debug(`[ServiceContainer] Initializing: ${name}`);
        const instance = await entry.descriptor.factory(this);
        entry.instance = instance;

        if (entry.descriptor.init) {
          await entry.descriptor.init(instance);
        }

        entry.initialized = true;
        logger.debug(`[ServiceContainer] Initialized: ${name}`);
      } catch (error) {
        logger.error(`[ServiceContainer] Failed to initialize "${name}"`, error as Error);
        throw error;
      }
    }

    logger.info(`[ServiceContainer] All ${sorted.length} services initialized`);
  }

  /**
   * 按逆序优雅关闭所有服务
   */
  async shutdownAll(): Promise<void> {
    logger.info('[ServiceContainer] Starting service shutdown...');

    const reversed = [...this.initOrder].reverse();

    for (const name of reversed) {
      const entry = this.services.get(name);
      if (!entry || !entry.initialized || !entry.instance) continue;

      try {
        if (entry.descriptor.shutdown) {
          logger.debug(`[ServiceContainer] Shutting down: ${name}`);
          await entry.descriptor.shutdown(entry.instance);
        }
        entry.initialized = false;
        entry.instance = undefined;
      } catch (error) {
        logger.error(`[ServiceContainer] Error shutting down "${name}"`, error as Error);
      }
    }

    logger.info('[ServiceContainer] All services shut down');
  }

  /**
   * 拓扑排序 - 确保依赖先于被依赖者初始化
   */
  private topologicalSort(): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const result: string[] = [];

    const visit = (name: string) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) {
        throw new Error(`[ServiceContainer] Circular dependency detected involving "${name}"`);
      }

      visiting.add(name);
      const entry = this.services.get(name);
      if (entry?.descriptor.dependencies) {
        for (const dep of entry.descriptor.dependencies) {
          if (!this.services.has(dep)) {
            throw new Error(`[ServiceContainer] Unknown dependency "${dep}" for service "${name}"`);
          }
          visit(dep);
        }
      }
      visiting.delete(name);
      visited.add(name);
      result.push(name);
    };

    for (const name of this.services.keys()) {
      visit(name);
    }

    return result;
  }

  /**
   * 获取所有已注册的服务名称
   */
  getServiceNames(): string[] {
    return Array.from(this.services.keys());
  }

  /**
   * 检查服务是否已初始化
   */
  isInitialized(name: string): boolean {
    return this.services.get(name)?.initialized ?? false;
  }
}

// 全局单例
export const container = new ServiceContainer();
