/**
 * IdP 角色 → 权限范围的映射（决策 D15 / Q-06）。
 *
 * 命名约定：
 *
 * | IdP 角色名 | 含义 | 权限 |
 * | --- | --- | --- |
 * | `<前缀>.OWNER` | 全实例管理员 | 所有站点的全部管理权限 |
 * | `<前缀>.ADMIN.<站点 UUID>` | 站点管理员 | 仅该站点的评论、成员、标签、配置 |
 * | （无匹配角色） | — | **拒绝登录，不产生会话**（Q-17） |
 *
 * 本系统**不存储任何角色授予关系**，因此这个纯函数就是授权的全部真相 ——
 * 它必须是可单测的、无副作用的（见 .specs/development-standards.md §1.2）。
 */

import type { AccessScope } from './access-scope';

/** 站点 UUID 的形状校验：角色名里写的是 UUID 而不是 slug（Q-16） */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RoleMatch = {
  /** 命中的角色名（用于审计与诊断 CLI） */
  matchedRoles: string[];
  /** 权限范围；无命中时为 null */
  scope: AccessScope | null;
};

/**
 * 从 claims 里按「点分路径」取角色数组。
 *
 * 路径可配（默认 `roles`），以兼容 `groups` 与 Keycloak 的嵌套结构
 * （如 `realm_access.roles`）。路径上的任何一段不是对象就返回空数组，
 * 而不是抛异常 —— IdP 的 claims 结构不在我们的控制之内。
 */
export function readRolesFromClaims(claims: Record<string, unknown>, claimPath: string): string[] {
  const segments = claimPath.split('.').filter((segment) => segment.length > 0);

  let current: unknown = claims;

  for (const segment of segments) {
    if (typeof current !== 'object' || current === null) return [];
    current = (current as Record<string, unknown>)[segment];
  }

  if (!Array.isArray(current)) return [];

  return current.filter((value): value is string => typeof value === 'string');
}

/**
 * 把角色名映射成权限范围。
 *
 * 同时命中 OWNER 与若干 ADMIN 时取 OWNER（更高权限），
 * 但 `matchedRoles` 保留全部命中项，便于诊断 CLI 如实展示。
 */
export function resolveAccessScope(roles: readonly string[], prefix: string): RoleMatch {
  const ownerRole = `${prefix}.OWNER`;
  const adminPrefix = `${prefix}.ADMIN.`;

  const matchedRoles: string[] = [];
  const siteIds = new Set<string>();
  let isOwner = false;

  for (const role of roles) {
    if (role === ownerRole) {
      isOwner = true;
      matchedRoles.push(role);
      continue;
    }

    if (role.startsWith(adminPrefix)) {
      const siteId = role.slice(adminPrefix.length);

      // 站点段必须是 UUID：写错的角色名应当被忽略，而不是当成一个永远匹配不上的站点
      if (!UUID_PATTERN.test(siteId)) continue;

      siteIds.add(siteId.toLowerCase());
      matchedRoles.push(role);
    }
  }

  if (isOwner) {
    return { matchedRoles, scope: { type: 'instance' } };
  }

  if (siteIds.size > 0) {
    return { matchedRoles, scope: { type: 'site', siteIds: [...siteIds] } };
  }

  return { matchedRoles, scope: null };
}
