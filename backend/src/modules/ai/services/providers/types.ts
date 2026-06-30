/**
 * Provider 类型定义
 */

// Provider 接口
export interface Provider {
  name: string;
  description: string;
  version: string;
  methods: ProviderMethod[];
  initialize?(config: Record<string, unknown>): Promise<void>;
}

// Provider 方法定义
export interface ProviderMethod {
  name: string;
  description: string;
  inputs: MethodParameter[];
  outputs: MethodParameter[];
  examples: MethodExample[];
}

// 方法参数
export interface MethodParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'any';
  description?: string;
  required?: boolean;
  default?: unknown;
}

// 方法示例
export interface MethodExample {
  title: string;
  description?: string;
  inputs: Record<string, unknown>;
  outputs?: Record<string, unknown>;
}

// Provider 配置
export interface ProviderConfig {
  enabled: boolean;
  config: Record<string, unknown>;
}

// Provider 执行结果
export interface ProviderResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: Record<string, unknown>;
}
