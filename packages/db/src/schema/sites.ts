/**
 * sites —— 站点（租户）表。
 *
 * 设计要点（见 .specs/requirements.md §5.2）：
 * - `id` 是**站点的唯一标识**，同时是 OIDC 角色名中 `<站点 UUID>` 的取值（决策 D17）
 * - 没有 slug 字段：站点标识一律用 UUID，改名不影响 IdP 侧授权
 * - `name` 仅作后台展示，不参与任何标识、URL 或授权
 * - 站点级配置集中在 `settings` jsonb，可在后台修改而无需重新部署
 */

import { jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const siteStatus = pgEnum('site_status', ['active', 'disabled']);

export const sites = pgTable('sites', {
  id: uuid('id').primaryKey().defaultRandom(),

  /** 公开的 site key，形如 rc_<随机串>。前端持有，故**不是密钥** */
  key: text('key').notNull().unique(),

  /** 展示名 —— 仅后台展示用 */
  name: text('name').notNull(),

  status: siteStatus('status').notNull().default('active'),

  /** 来源域名白名单，支持精确域与 *.example.com 通配 */
  allowedOrigins: jsonb('allowed_origins').$type<string[]>().notNull().default([]),

  /** 站点级配置，结构见 .specs/requirements.md §5.3 */
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Site = typeof sites.$inferSelect;
export type NewSite = typeof sites.$inferInsert;
