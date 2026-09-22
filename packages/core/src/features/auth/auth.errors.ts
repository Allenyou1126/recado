/**
 * auth 功能特有的错误定义。
 *
 * 注意错误码的语义边界：`AUTH_*` 是「未认证 / 凭证失效」，
 * `FORBIDDEN_*` 是「已认证但没有权限」。两者对前端的处理完全不同
 * （重新登录 vs 提示无权限），因此不能混用。
 */

import { domainError, type DomainError } from '@recado/shared';

export type AuthError =
  | DomainError<'AUTH_SESSION_INVALID'>
  | DomainError<'AUTH_SESSION_EXPIRED'>
  | DomainError<'AUTH_SESSION_REVOKED'>
  | DomainError<'AUTH_NO_MATCHING_ROLE'>
  | DomainError<'AUTH_OIDC_FAILED'>
  | DomainError<'FORBIDDEN_ROLE_REQUIRED'>
  | DomainError<'FORBIDDEN_SITE_SCOPE'>
  | DomainError<'FORBIDDEN_CSRF_TOKEN_INVALID'>;

export const AuthErrors = {
  sessionInvalid: () => domainError('AUTH_SESSION_INVALID', 'Session token is invalid'),

  sessionExpired: () => domainError('AUTH_SESSION_EXPIRED', 'Session has expired'),

  sessionRevoked: () => domainError('AUTH_SESSION_REVOKED', 'Session has been revoked'),

  /**
   * 无匹配角色（决策 Q-17）：拒绝登录且**不建会话**。
   * 这是「首次部署锁死」风险的来源，部署文档把它列为第一步前置条件。
   */
  noMatchingRole: (roles: readonly string[]) =>
    domainError('AUTH_NO_MATCHING_ROLE', 'No role matched the configured prefix', {
      // 回显角色名有助于排查 IdP 侧配置；角色名本身不是秘密
      roles: [...roles],
    }),

  oidcFailed: (stage: string) =>
    domainError('AUTH_OIDC_FAILED', `OIDC ${stage} step failed`, { stage }),

  roleRequired: () => domainError('FORBIDDEN_ROLE_REQUIRED', 'This endpoint requires a role'),

  /** 「已登录」不等于「可访问任意站点」（T7.5） */
  siteScope: (siteId: string) =>
    domainError('FORBIDDEN_SITE_SCOPE', 'Actor has no permission on this site', { siteId }),

  csrfToken: () => domainError('FORBIDDEN_CSRF_TOKEN_INVALID', 'CSRF token mismatch'),
} as const;
