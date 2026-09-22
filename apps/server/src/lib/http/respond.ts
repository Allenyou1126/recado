/**
 * Result → HTTP Response 的统一出口。
 *
 * 这一层只做两件事（见 .specs/development-standards.md §6）：
 *
 * 1. **不泄漏**：失败响应只含 `{ error: { reason, message, details? } }`，
 *    绝不带堆栈、SQL 原文或数据库驱动错误。
 * 2. **映射**：错误码 → 状态码复用 `@recado/shared` 的 `statusForReason`，
 *    新增错误码只要遵守前缀约定就自动落到正确的状态码，不需要改这里。
 */

import { statusForReason, type DomainError, type Result } from '@recado/shared';

export const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

/** API 响应一律不缓存：内容随审核状态变化，缓存会放出已删除的评论 */
export const NO_STORE = 'no-store';

export type JsonInit = {
  status?: number;
  headers?: Record<string, string>;
};

/** 构造 JSON 响应；`headers` 会覆盖默认值（如 CORS 头） */
export function jsonResponse(body: unknown, init: JsonInit = {}): Response {
  const headers = new Headers({
    'content-type': JSON_CONTENT_TYPE,
    'cache-control': NO_STORE,
  });

  for (const [name, value] of Object.entries(init.headers ?? {})) {
    headers.set(name, value);
  }

  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

/** 200 `{ data }` */
export function okResponse(data: unknown, init: JsonInit = {}): Response {
  return jsonResponse({ data }, { ...init, status: init.status ?? 200 });
}

/** 201 `{ data }` */
export function createdResponse(data: unknown, init: JsonInit = {}): Response {
  return jsonResponse({ data }, { ...init, status: init.status ?? 201 });
}

/** 失败信封；状态码由错误码前缀推导 */
export function errorResponse(error: DomainError, init: JsonInit = {}): Response {
  return jsonResponse({ error }, { ...init, status: init.status ?? statusForReason(error.reason) });
}

/** Result → Response；需要自定义状态码时传 `init.status` */
export function resultToResponse<TData, TError extends DomainError>(
  result: Result<TData, TError>,
  init: JsonInit = {},
): Response {
  if (result.error) {
    return errorResponse(result.error);
  }

  return okResponse(result.data, init);
}
