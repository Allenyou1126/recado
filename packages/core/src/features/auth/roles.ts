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
 * 从 claims 里取角色名。
 *
 * **claim 名先按整名匹配**，匹配不到才按点分路径逐段下钻。原因：IdP 的 claim 名
 * 常常自带 `.` 或 `:`（Zitadel 的 `urn:zitadel:iam:org:project:roles`、Auth0 的
 * `https://example.com/roles`），按点拆分永远取不到那个键。
 *
 * **两种形状都接受**：
 *
 * - 字符串数组 —— Keycloak 的 `realm_access.roles`、通用的 `groups`
 * - **以角色名为键的对象** —— Zitadel 断言角色时的形状
 *   （`{ "recado.OWNER": { "<组织 id>": "<主域名>" } }`，值只说明「在哪个组织拥有
 *   该角色」，我们只要键）
 *
 * 路径取不到、或类型不是上面两种时返回空数组而不是抛异常 ——
 * IdP 的 claims 结构不在我们的控制之内。
 */
export function readRolesFromClaims(claims: Record<string, unknown>, claimPath: string): string[] {
  const value = readClaimValue(claims, claimPath);

  if (Array.isArray(value)) {
    return value.filter((role): role is string => typeof role === 'string');
  }

  if (isRecord(value)) {
    return Object.keys(value);
  }

  return [];
}

/** 取 claim 值：整名优先，其次点分路径；路径上任何一段不是对象就返回 undefined */
function readClaimValue(claims: Record<string, unknown>, claimPath: string): unknown {
  if (Object.hasOwn(claims, claimPath)) {
    return claims[claimPath];
  }

  const segments = claimPath.split('.').filter((segment) => segment.length > 0);

  let current: unknown = claims;

  for (const segment of segments) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }

  return current;
}

/** 对象类型守卫：避免对 `unknown` 做 `as` 断言（开发规范禁止强制断言） */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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
