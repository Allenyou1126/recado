/**
 * auth 功能的数据访问层（Repo）。
 *
 * `admins` 表刻意不存 role（决策 D15）：权限完全由 IdP 角色在每次认证时计算。
 * 这里只记录「谁登录过」，用于审计关联与登录历史。
 */

import { admins, sessions, type Admin, type DbExecutor, type Session } from '@recado/db';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';

export type AdminIdentity = {
  /** `(iss, sub)`，存 `iss#sub`；机器主体为 client ID */
  oidcSubject: string;
  kind: 'human' | 'machine';
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
};

/** 登录时 upsert 管理员档案：首次写入 first_login_at，之后只推进 last_login_at */
export async function upsertAdmin(db: DbExecutor, identity: AdminIdentity): Promise<Admin> {
  const [row] = await db
    .insert(admins)
    .values({
      oidcSubject: identity.oidcSubject,
      kind: identity.kind,
      email: identity.email,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
    })
    .onConflictDoUpdate({
      target: admins.oidcSubject,
      set: {
        email: identity.email,
        displayName: identity.displayName,
        avatarUrl: identity.avatarUrl,
        lastLoginAt: sql`now()`,
      },
    })
    .returning();

  if (!row) throw new Error('upsertAdmin 未返回管理员行');
  return row;
}

export async function findAdminBySubject(
  db: DbExecutor,
  oidcSubject: string,
): Promise<Admin | undefined> {
  return db.query.admins.findFirst({ where: eq(admins.oidcSubject, oidcSubject) });
}

/** 新建会话；`id` 存的是 token 的哈希，不是 token 原文 */
export async function insertSession(
  db: DbExecutor,
  values: {
    id: string;
    adminId: string;
    expiresAt: Date;
    /** 命中的角色名快照（见 sessions.roles 的说明） */
    roles: readonly string[];
    ip: string | null;
    userAgent: string | null;
  },
): Promise<Session> {
  const [row] = await db
    .insert(sessions)
    .values({ ...values, roles: [...values.roles] })
    .returning();

  if (!row) throw new Error('insertSession 未返回会话行');
  return row;
}

/** 取仍然有效的会话（未吊销且未过期） */
export async function findActiveSession(
  db: DbExecutor,
  sessionId: string,
): Promise<Session | undefined> {
  return db.query.sessions.findFirst({
    where: and(
      eq(sessions.id, sessionId),
      isNull(sessions.revokedAt),
      gt(sessions.expiresAt, new Date()),
    ),
  });
}

/** 取会话（不论是否有效），用于区分「不存在 / 过期 / 已吊销」 */
export async function findSession(db: DbExecutor, sessionId: string): Promise<Session | undefined> {
  return db.query.sessions.findFirst({ where: eq(sessions.id, sessionId) });
}

export async function touchSession(
  db: DbExecutor,
  sessionId: string,
  lastSeenAt: Date,
): Promise<void> {
  await db.update(sessions).set({ lastSeenAt }).where(eq(sessions.id, sessionId));
}

/**
 * 吊销会话（登出 / 强制下线）。
 *
 * 用 `revoked_at` 而不是删除行：保留吊销痕迹才能回答「这个会话什么时候失效的」。
 */
export async function revokeSession(db: DbExecutor, sessionId: string): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

/** 吊销某管理员的全部会话（强制下线） */
export async function revokeAllSessionsForAdmin(db: DbExecutor, adminId: string): Promise<number> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(sessions.adminId, adminId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });

  return rows.length;
}

export async function findAdminById(db: DbExecutor, adminId: string): Promise<Admin | undefined> {
  return db.query.admins.findFirst({ where: eq(admins.id, adminId) });
}
