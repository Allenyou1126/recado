/**
 * admins / sessions —— 管理台主体与会话。
 *
 * 设计要点（见 .specs/requirements.md §5.2、§3.2）：
 *
 * - `admins` **刻意不存 `role` 字段**：权限完全由 IdP 角色在每次认证时计算
 *   （决策 D15 / Q-06），本表只记录「谁登录过」，用于审计关联与登录历史
 * - 不存密码、不存 TOTP 密钥、不存社交账号列
 * - `kind`（human / machine）**仅供展示与审计，不参与授权判定**（决策 Q-18）
 * - 会话是**服务端状态**：可过期、可吊销、可强制下线。表里存的是
 *   token 的**哈希**而不是 token 本身 —— 库被读走也不能直接冒用会话
 */

import { index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { inet } from './types';

export const adminKind = pgEnum('admin_kind', ['human', 'machine']);
export const adminStatus = pgEnum('admin_status', ['active', 'disabled']);

export const admins = pgTable(
  'admins',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** OIDC `(iss, sub)` 组合，存 `iss#sub`；机器主体为 client ID */
    oidcSubject: text('oidc_subject').notNull().unique(),

    /** 仅用于展示与审计，不参与授权 */
    kind: adminKind('kind').notNull(),

    /** 来自 ID Token claims；机器主体可为空 */
    email: text('email'),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),

    status: adminStatus('status').notNull().default('active'),

    firstLoginAt: timestamp('first_login_at', { withTimezone: true }).notNull().defaultNow(),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('admins_email_idx').on(table.email)],
);

export const sessions = pgTable(
  'sessions',
  {
    /** **token 的 SHA-256 哈希**（不透明 token 原文只存在于客户端 Cookie） */
    id: text('id').primaryKey(),

    adminId: uuid('admin_id')
      .notNull()
      .references(() => admins.id, { onDelete: 'cascade' }),

    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** 非空表示已被主动吊销（登出、强制下线） */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),

    ip: inet('ip'),
    userAgent: text('user_agent'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('sessions_admin_id_idx').on(table.adminId)],
);

export type Admin = typeof admins.$inferSelect;
export type NewAdmin = typeof admins.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
