/**
 * HTTP 响应信封 —— API 契约的一部分。
 *
 * 成功：`{ data: T }`
 * 失败：`{ error: { reason, message, details? } }`
 *
 * 为什么统一信封：SDK 只需实现一处解包；错误码是稳定枚举，可据此分支
 * （见 .specs/development-standards.md §6.2）。
 *
 * 本文件是**契约**，可以进入客户端 bundle（SDK 需要）。
 */

import type { DomainError } from './errors';

/** 成功响应体 */
export type ApiSuccess<TData> = { data: TData };

/** 失败响应体 */
export type ApiFailure<TReason extends string = string> = { error: DomainError<TReason> };

export function apiSuccess<TData>(data: TData): ApiSuccess<TData> {
  return { data };
}
