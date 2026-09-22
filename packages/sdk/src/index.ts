/**
 * @recado/client —— Headless 客户端 SDK。
 *
 * 定位（决策 D12）：**纯 HTTP API 封装，不含任何 UI**。
 * 评论列表与输入框由使用方自行实现。
 *
 * 设计约束（见 .specs/development-standards.md §4.4 与 requirements.md §6 M9）：
 * - 只调用 Server Route 形态的公开 API（`/api/v1/*`），不触碰 Server Function
 * - 无浏览器全局依赖，可在 SSR 流程中直接调用
 * - 支持注入自定义 fetch，便于测试与 Edge 运行时
 * - 错误类型化：失败分支携带 `@recado/shared` 的稳定错误码
 *
 * 状态：P1 交付，当前为占位骨架。
 */

import type { DomainError, Result } from '@recado/shared';

export type RecadoClientOptions = {
  /** API 根地址，如 `https://comments.example.com` */
  endpoint: string;
  /** 站点标识（公开的 site key，非密钥） */
  siteKey: string;
  /** 自定义 fetch，便于 SSR / Edge / 测试注入 */
  fetch?: typeof globalThis.fetch;
};

export type HealthPayload = {
  status: string;
};

export type RecadoClient = {
  readonly endpoint: string;
  readonly siteKey: string;
  /** 健康检查（占位，用于验证骨架连通性） */
  health: () => Promise<Result<HealthPayload, DomainError>>;
};

/**
 * 响应体的运行时校验。
 *
 * 不直接对 `response.json()` 的结果做类型断言 —— 它的静态类型是 `any`，
 * 断言会绕过运行时校验，也会被 lint 拦下。
 */
function isHealthPayload(value: unknown): value is HealthPayload {
  if (typeof value !== 'object' || value === null) return false;
  return typeof Reflect.get(value, 'status') === 'string';
}

export function createClient(options: RecadoClientOptions): RecadoClient {
  const doFetch = options.fetch ?? globalThis.fetch;
  const base = options.endpoint.replace(/\/$/, '');

  return {
    endpoint: base,
    siteKey: options.siteKey,

    async health() {
      try {
        const response = await doFetch(`${base}/api/v1/health`, {
          headers: { 'X-Recado-Site': options.siteKey },
        });

        if (!response.ok) {
          return {
            data: null,
            error: {
              reason: 'INTERNAL_UNEXPECTED',
              message: `Health check failed with HTTP ${response.status}`,
            },
          };
        }

        const body: unknown = await response.json();

        if (!isHealthPayload(body)) {
          return {
            data: null,
            error: {
              reason: 'INTERNAL_UNEXPECTED',
              message: 'Health check returned an unexpected payload',
            },
          };
        }

        return { data: body, error: null };
      } catch (cause) {
        // 网络失败是**预期**的，用 Result 包装而非向上抛（见 development-standards §6.4）
        return {
          data: null,
          error: {
            reason: 'INTERNAL_UNEXPECTED',
            message: 'Health check request failed',
            details: cause instanceof Error ? cause.message : String(cause),
          },
        };
      }
    },
  };
}
