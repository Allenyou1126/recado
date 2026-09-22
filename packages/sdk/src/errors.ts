/**
 * SDK 的错误模型。
 *
 * 与 HTTP 层共用同一套错误码（`@recado/shared`），因此调用方可以稳定地
 * `switch (error.reason)` 分支，而不必解析文案。
 *
 * 除了服务端返回的业务错误，客户端还会有三类**本地**失败：
 * 网络不可达、超时、响应体不符合契约。它们同样用 `Result` 表达 ——
 * SDK 的公开方法一律不抛异常（`AbortSignal` 的取消除外，那是调用方自己的意图）。
 */

import type { DomainError } from '@recado/shared';

/** 本地失败码：网络、超时、响应不符合契约 */
export type ClientLocalErrorReason =
  | 'CLIENT_NETWORK_FAILED'
  | 'CLIENT_TIMEOUT'
  | 'CLIENT_INVALID_RESPONSE';

/**
 * SDK 可能返回的错误：服务端错误码（`@recado/shared` 的稳定枚举）或本地失败码。
 *
 * 用 `string & {}` 而不是裸 `string`：后者会把三个本地码吞掉，
 * 字面量就失去提示作用了。
 */
export type ClientError = DomainError<ClientLocalErrorReason | (string & {})>;

export const ClientErrors = {
  network: (cause: unknown): ClientError => ({
    reason: 'CLIENT_NETWORK_FAILED',
    message: 'Request failed before reaching the server',
    details: cause instanceof Error ? cause.message : String(cause),
  }),

  timeout: (timeoutMs: number): ClientError => ({
    reason: 'CLIENT_TIMEOUT',
    message: `Request did not finish within ${timeoutMs}ms`,
    details: { timeoutMs },
  }),

  invalidResponse: (detail: string): ClientError => ({
    reason: 'CLIENT_INVALID_RESPONSE',
    message: 'Server response did not match the expected contract',
    details: { detail },
  }),
} as const;
