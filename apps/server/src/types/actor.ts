/**
 * 管理台主体与权限范围。
 *
 * 与 .specs/development-standards.md §4.1 的 `ActorContext` 对应。
 *
 * ⚠️ 本系统**不存储任何角色授予关系**（决策 D15 / Q-06）：
 * `Actor` 只描述「谁登录过」，权限边界由 `AccessScope` 在每次认证时
 * 从 OIDC token 的 claims 现算。因此这里没有 role / permission 字段。
 */

/** 已认证主体（人类或机器，均来自 OIDC） */
export type Actor = {
  /** 仅供展示与审计，**不参与授权判定**（决策 Q-18） */
  kind: 'human' | 'machine';
  /** `admins.id`，用于审计日志关联 */
  id: string;
  /** OIDC `(iss, sub)`，存为 `iss#sub`；机器主体为 client ID */
  subject: string;
  /** 来自 ID Token claims；机器主体可能为空 */
  email: string | null;
  displayName: string | null;
};

/**
 * 主体可访问的范围。
 *
 * - `instance`：`<前缀>.OWNER`，全实例
 * - `site`：`<前缀>.ADMIN.<站点 UUID>`，仅列出的站点
 */
export type AccessScope = { type: 'instance' } | { type: 'site'; siteIds: readonly string[] };

/** 判断主体是否有权访问某站点 —— 「已登录」不等于「可访问任意站点」 */
export function scopeAllowsSite(scope: AccessScope, siteId: string): boolean {
  return scope.type === 'instance' || scope.siteIds.includes(siteId);
}
