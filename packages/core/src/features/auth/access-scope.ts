/**
 * 权限范围。
 *
 * 与 `apps/server/src/types/actor.ts` 里的同名类型保持一致的语义：
 * 本系统不存角色授予关系，权限完全由 IdP 角色在每次认证时现算（决策 D15）。
 *
 * 定义在 `core` 而不是 `server`：判定逻辑（roles.ts）是纯领域规则，
 * 必须能脱离框架单测。
 */
export type AccessScope = { type: 'instance' } | { type: 'site'; siteIds: readonly string[] };

/** 判断权限范围是否覆盖某站点 —— 「已登录」不等于「可访问任意站点」 */
export function scopeAllowsSite(scope: AccessScope, siteId: string): boolean {
  return scope.type === 'instance' || scope.siteIds.includes(siteId.toLowerCase());
}
