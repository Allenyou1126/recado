/**
 * comments 功能特有的错误定义。
 *
 * 渲染失败（内容为空 / 超长 / 超时）也归在这里：对调用方来说它们都是
 * 「这次发表没成功」，由接口层统一映射成状态码。
 */

import { domainError, type DomainError } from '@recado/shared';

import type { RenderError } from '../rendering/rendering.errors';

export type CommentError =
  | RenderError
  | DomainError<'VALIDATION_NICKNAME_REQUIRED'>
  | DomainError<'NOT_FOUND_PARENT_COMMENT'>
  | DomainError<'NOT_FOUND_COMMENT'>
  | DomainError<'RATE_LIMITED_TOO_FREQUENT'>;

export const CommentErrors = {
  nicknameRequired: () =>
    domainError('VALIDATION_NICKNAME_REQUIRED', 'Nickname is required by this site'),

  /** 父评论不存在，或不属于本站点 / 本线程 */
  parentNotFound: (parentId: string) =>
    domainError('NOT_FOUND_PARENT_COMMENT', 'Parent comment not found', { parentId }),

  commentNotFound: (commentId: string) =>
    domainError('NOT_FOUND_COMMENT', 'Comment not found', { commentId }),

  tooFrequent: (retryAfterSeconds: number) =>
    domainError('RATE_LIMITED_TOO_FREQUENT', 'You are commenting too fast', { retryAfterSeconds }),
} as const;
