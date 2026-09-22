/**
 * 路由处理器的统一包装。
 *
 * 这是「`try/catch` 只用于边界」这条纪律的落地位置
 * （见 .specs/development-standards.md §6.4）：
 *
 * - **可预期的业务失败**由 Service 用 `Result` 返回，走 `errorResponse`；
 * - **未预期的异常**（驱动报错、代码 bug）在这里被兜住，
 *   记录 `requestId` 与堆栈到日志，响应体只给 `INTERNAL_UNEXPECTED`，
 *   绝不把堆栈或数据库原始错误返回给客户端。
 */

import { domainError, type DomainError, type Result } from '@recado/shared';

import { createdResponse, errorResponse, okResponse, type JsonInit } from './respond';

/** 至少需要 requestId 与 logger 才能兜住异常并留下可关联的日志 */
export type HandlerBaseContext = Pick<BaseContext, 'requestId' | 'logger'>;

export type HandlerOptions = JsonInit & {
  /** 成功时的状态码，默认 200 */
  successStatus?: number;
  /** 记录日志时使用的操作名，便于检索 */
  operation?: string;
};

const INTERNAL_ERROR = domainError('INTERNAL_UNEXPECTED', 'Internal error');

/**
 * 把「业务函数」包装成「Server Route handler」。
 *
 * ```ts
 * const getComments = createHandler<SiteContext, CommentPage, CommentError>(
 *   async (ctx) => CommentService.list(ctx, query),
 *   { operation: 'comments.list' },
 * );
 *
 * export const Route = createFileRoute('/api/v1/comments')({
 *   server: { middleware: [baseMiddleware, dbMiddleware, siteMiddleware], handlers: { GET: getComments } },
 * });
 * ```
 */
export function createHandler<TCtx extends HandlerBaseContext, TData, TError extends DomainError>(
  fn: (context: TCtx) => Promise<Result<TData, TError>>,
  options: HandlerOptions = {},
): (context: TCtx) => Promise<Response> {
  return async (context: TCtx): Promise<Response> => {
    try {
      const result = await fn(context);

      if (result.error) {
        // 业务失败是**预期**的，按 warn 记录即可，不打堆栈
        context.logger.warn(
          { requestId: context.requestId, reason: result.error.reason },
          options.operation ? `${options.operation} failed` : 'request failed',
        );
        return errorResponse(result.error);
      }

      return options.successStatus === 201
        ? createdResponse(result.data, options)
        : okResponse(result.data, options);
    } catch (cause) {
      context.logger.error(
        { err: cause, requestId: context.requestId, operation: options.operation },
        'unhandled error',
      );
      return errorResponse(INTERNAL_ERROR);
    }
  };
}
