/**
 * rendering 功能特有的错误定义。
 *
 * 渲染是**用户输入驱动的 CPU 工作**，因此错误分成两类：
 * 输入问题（`VALIDATION_*`，属于调用方的错）与运行时问题（`INTERNAL_*`）。
 */

import { domainError, type DomainError } from '@recado/shared';

export type RenderError =
  | DomainError<'VALIDATION_CONTENT_TOO_LONG'>
  | DomainError<'VALIDATION_CONTENT_EMPTY'>
  | DomainError<'INTERNAL_RENDER_TIMEOUT'>
  | DomainError<'INTERNAL_RENDER_FAILED'>;

export const RenderErrors = {
  empty: () => domainError('VALIDATION_CONTENT_EMPTY', 'Content is empty'),

  tooLong: (bytes: number, limit: number) =>
    domainError('VALIDATION_CONTENT_TOO_LONG', `Content exceeds the ${limit} bytes limit`, {
      bytes,
      limit,
    }),

  timedOut: (ms: number) =>
    domainError('INTERNAL_RENDER_TIMEOUT', `Rendering did not finish within ${ms}ms`, { ms }),

  /** 不把底层错误信息带进响应体：可能包含库内部路径与实现细节 */
  failed: () => domainError('INTERNAL_RENDER_FAILED', 'Markdown rendering failed'),
} as const;
