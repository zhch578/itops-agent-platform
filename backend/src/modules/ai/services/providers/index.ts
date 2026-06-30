/**
 * Providers 模块
 */

export * from './types';
export * from './ProviderRegistry';
export * from './builtins';
export * from './extended';

import { providerRegistry } from './ProviderRegistry';
import {
  httpProvider,
  httpMethods,
  notifyProvider,
  notifyMethods,
  scriptProvider,
  scriptMethods,
  databaseProvider,
  databaseMethods
} from './builtins';
import {
  registerExtendedProviders
} from './extended';

/**
 * 初始化所有内置 Provider
 */
export function initializeProviders(): void {
  providerRegistry.register(httpProvider, httpMethods);
  providerRegistry.register(notifyProvider, notifyMethods);
  providerRegistry.register(scriptProvider, scriptMethods);
  providerRegistry.register(databaseProvider, databaseMethods);
  registerExtendedProviders(providerRegistry);
}
