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
  | DomainError<'VALIDATION_INVALID_ORIGIN'>
  | DomainError<'VALIDATION_SITE_KEY_REQUIRED'>
  | DomainError<'FORBIDDEN_SITE_DISABLED'>
  | DomainError<'FORBIDDEN_ORIGIN_MISSING'>
  | DomainError<'FORBIDDEN_ORIGIN_NOT_ALLOWED'>
  | DomainError<'INTERNAL_SITE_KEY_GENERATION_FAILED'>;

export const SiteErrors = {
  notFound: (id: string) => domainError('NOT_FOUND_SITE', 'Site not found', { id }),

  /** 按 site key 查找未命中：不回显 key，避免它被写进日志或错误上报 */
  notFoundByKey: () => domainError('NOT_FOUND_SITE', 'Unknown site key'),

  keyExists: (key: string) =>
    domainError('CONFLICT_SITE_KEY_EXISTS', 'Site key already exists', { key }),

  keyRequired: () => domainError('VALIDATION_SITE_KEY_REQUIRED', 'Missing X-Recado-Site header'),

  disabled: (id: string) => domainError('FORBIDDEN_SITE_DISABLED', 'Site is disabled', { id }),

  invalidOrigin: (origin: string) =>
    domainError('VALIDATION_INVALID_ORIGIN', 'Invalid allowed origin pattern', { origin }),

  /** 无来源头，且站点 originPolicy 为 strict（决策 Q-12） */
  originMissing: () =>
    domainError(
      'FORBIDDEN_ORIGIN_MISSING',
      'Request has no Origin/Referer header and this site rejects origin-less requests',
    ),

  originNotAllowed: (origin: string) =>
    domainError('FORBIDDEN_ORIGIN_NOT_ALLOWED', 'Origin is not in the site allow-list', { origin }),

  /** 连续多次撞上 site key 唯一约束；概率极低，出现即说明随机源或库有问题 */
  keyGenerationFailed: () =>
    domainError('INTERNAL_SITE_KEY_GENERATION_FAILED', 'Could not generate a unique site key'),
} as const;
