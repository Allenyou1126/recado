/**
 * auth 功能的服务层：会话生命周期与主体解析。
 *
 * 会话是**服务端状态**：不透明 token 的哈希落库，浏览器只拿到原文 Cookie，
 * 因此可过期、可吊销、可强制下线（对比 Waline 永不过期且不可吊销的 JWT）。
 *
 * 事务边界在这里，但**不在此处做网络 IO** —— OIDC 的 token 交换在接口层完成，
 * 拿到 claims 之后才进入这里。
 */

import { createHash, randomBytes } from 'node:crypto';

import type { Admin, DbExecutor } from '@recado/db';
import { err, ok, type Result } from '@recado/shared';

import type { AccessScope } from './access-scope';
import {
  findActiveSession,
  findAdminById,
  findSession,
  insertSession,
  revokeAllSessionsForAdmin,
  revokeSession,
  touchSession,
  upsertAdmin,
  type AdminIdentity,
} from './auth.data';
import { AuthErrors, type AuthError } from './auth.errors';
import { resolveAccessScope } from './roles';

/**
 * 会话默认有效期：7 天。
 *
 * 实际值由 `SESSION_TTL_HOURS` 配置覆盖；这个常量只是缺省值。
 * 由于权限快照存在会话里，这个时长同时决定「IdP 撤销角色后最晚多久生效」。
 */
export const DEFAULT_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

/** token 随机部分长度（32 字节 ≈ 256 bit，不可猜测） */
const SESSION_TOKEN_BYTES = 32;

/** 生成不透明会话 token（原文只存在于客户端 Cookie） */
export function createSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
}

/**
 * token → 主键。
 *
 * 库里存哈希而不是原文：数据库被读走也不能直接冒用会话。
 * 这里用 SHA-256 而不是 bcrypt/argon2 —— token 是 256 bit 的均匀随机值，
 * 不存在被爆破或彩虹表命中的可能，不需要慢哈希（慢哈希只会拖慢每个请求）。
 */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type SessionActor = {
  actor: {
    kind: 'human' | 'machine';
    /** `admins.id` */
    id: string;
    subject: string;
    email: string | null;
    displayName: string | null;
  };
  scope: AccessScope;
  /** 命中的角色名，用于诊断 CLI 与审计 */
  matchedRoles: string[];
};

/**
 * 登录成功后建档并开会话。
 *
 * ⚠️ 无匹配角色时**不建会话**（决策 Q-17）—— 这是安全语义，不是 UX 取舍：
 * 「登录成功但没有权限」与「没有登录」在服务端必须表现得完全一样。
 */
export async function startSession(
  db: DbExecutor,
  params: {
    identity: AdminIdentity;
    /** IdP 返回的全部角色名 */
    roles: readonly string[];
    rolePrefix: string;
    ip: string | null;
    userAgent: string | null;
    /** 会话有效期（秒）；来自 `SESSION_TTL_HOURS` 配置 */
    ttlSeconds?: number;
    now?: Date;
  },
): Promise<Result<{ token: string; expiresAt: Date; actor: SessionActor }, AuthError>> {
  const { matchedRoles, scope } = resolveAccessScope(params.roles, params.rolePrefix);

  if (scope === null) {
    return err(AuthErrors.noMatchingRole(params.roles));
  }

  const admin = await upsertAdmin(db, params.identity);
  const token = createSessionToken();
  const now = params.now ?? new Date();
  const ttlSeconds = params.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS;
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  await insertSession(db, {
    id: hashSessionToken(token),
    adminId: admin.id,
    expiresAt,
    roles: matchedRoles,
    ip: params.ip,
    userAgent: params.userAgent,
  });

  return ok({
    token,
    expiresAt,
    actor: {
      actor: toActor(admin),
      scope,
      matchedRoles,
    },
  });
}

/**
 * 用会话 token 解析出主体。
 *
 * 权限范围来自登录时写进会话的**角色快照**（需求 §3.2）：
 * 每次请求都回查 IdP 会把认证变成网络瓶颈，而本系统不存角色授予关系、
 * 无法从库里现算。
 *
 * ⚠️ **撤销语义**（如实说明，不制造虚假安全感）：IdP 侧撤销角色后，
 * 已建立的浏览器会话最长保持到 `expires_at`。需要立即失效时：
 * - 用 `revokeSessionsOfAdmin` 强制下线（会话行被吊销后**下一次请求即失效**）
 * - 或让高风险操作走 Bearer token —— 那条路径每次都验签并现算角色
 */
export async function resolveSessionActor(
  db: DbExecutor,
  token: string,
  rolePrefix: string,
): Promise<Result<SessionActor, AuthError>> {
  const session = await findSession(db, hashSessionToken(token));

  if (!session) return err(AuthErrors.sessionInvalid());
  if (session.revokedAt !== null) return err(AuthErrors.sessionRevoked());
  if (session.expiresAt.getTime() <= Date.now()) return err(AuthErrors.sessionExpired());

  const admin = await findAdminById(db, session.adminId);
  if (!admin || admin.status !== 'active') return err(AuthErrors.sessionInvalid());

  const { matchedRoles, scope } = resolveAccessScope(session.roles, rolePrefix);
  if (scope === null) return err(AuthErrors.noMatchingRole(session.roles));

  await touchSession(db, session.id, new Date());

  return ok({ actor: toActor(admin), scope, matchedRoles });
}

/**
 * Bearer token 认证（脚本 / CI 走 OIDC client credentials）。
 *
 * 与浏览器会话的区别：**每次请求都现算角色**，因此 IdP 侧一撤销就立即生效。
 * 代价是每次要验签（JWKS 有缓存，不是每次都拉）。
 */
export async function authorizeBearer(
  db: DbExecutor,
  params: { identity: AdminIdentity; roles: readonly string[]; rolePrefix: string },
): Promise<Result<SessionActor, AuthError>> {
  const { matchedRoles, scope } = resolveAccessScope(params.roles, params.rolePrefix);

  if (scope === null) return err(AuthErrors.noMatchingRole(params.roles));

  const admin = await upsertAdmin(db, params.identity);

  return ok({ actor: toActor(admin), scope, matchedRoles });
}

/** 登出：吊销当前会话 */
export async function endSession(db: DbExecutor, token: string): Promise<void> {
  await revokeSession(db, hashSessionToken(token));
}

/** 强制下线某管理员的全部会话 */
export async function revokeSessionsOfAdmin(db: DbExecutor, adminId: string): Promise<number> {
  return revokeAllSessionsForAdmin(db, adminId);
}

/** 仅用于诊断：会话是否仍然有效 */
export async function isSessionActive(db: DbExecutor, token: string): Promise<boolean> {
  return (await findActiveSession(db, hashSessionToken(token))) !== undefined;
}

function toActor(admin: Admin): SessionActor['actor'] {
  return {
    kind: admin.kind,
    id: admin.id,
    subject: admin.oidcSubject,
    email: admin.email,
    displayName: admin.displayName,
  };
}

export type { AdminIdentity };
