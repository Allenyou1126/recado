/**
 * sites 功能特有的错误定义。
 *
 * 每个功能模块把自己的错误 reason 声明成一个联合类型 —— 调用方 switch 它时
 * 用 `satisfies never` 做穷尽检查：新增 reason 却忘记处理会**编译失败**。
 * 这是 Result 模式的核心收益（见 .specs/development-standards.md §6.3）。
 */

import { domainError, type DomainError } from '@recado/shared';

export type SiteError =
  | DomainError<'NOT_FOUND_SITE'>
  | DomainError<'CONFLICT_SITE_KEY_EXISTS'>
  | DomainError<'VALIDATION_INVALID_ORIGIN'>;

export const SiteErrors = {
  notFound: (id: string) => domainError('NOT_FOUND_SITE', 'Site not found', { id }),

  keyExists: (key: string) =>
    domainError('CONFLICT_SITE_KEY_EXISTS', 'Site key already exists', { key }),

  invalidOrigin: (origin: string) =>
    domainError('VALIDATION_INVALID_ORIGIN', 'Invalid allowed origin pattern', { origin }),
} as const;
