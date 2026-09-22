/**
 * members —— 站点内评论者档案。
 *
 * 设计要点（见 .specs/requirements.md §5.2）：
 *
 * - 身份归并键是 `(site_id, email)`，`email` 用 **citext** 比较：
 *   大小写不同不应产生重复档案
 * - `spam_count` / `review_required` 是**审核声誉**，作用域为站点级（决策 Q-03），
 *   与「展示徽章」（`member_labels`，决策 D7）是两套独立结构，不要混用
 * - `email` **永不返回给公开 API**
 */

import {
  boolean,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

import { sites } from './sites';

/**
 * PostgreSQL 的 `citext` 扩展类型（大小写不敏感文本）。
 *
 * drizzle-orm 0.45 未内置该类型，用 `customType` 声明。
 * ⚠️ 迁移里必须带 `CREATE EXTENSION IF NOT EXISTS citext;`
 */
export const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

export const members = pgTable(
  'members',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),

    /** 身份归并键。**永不返回给公开 API** */
    email: citext('email').notNull(),

    /** 最近一次使用的值（评论行上另有发表时快照） */
    nickname: text('nickname'),
    website: text('website'),

    /** 为空时按邮箱取 Gravatar（站点可配 avatarBaseUrl） */
    avatarUrl: text('avatar_url'),

    /** 该邮箱被标记垃圾的评论数（审核声誉，与展示标签分离） */
    spamCount: integer('spam_count').notNull().default(0),

    /** 为真时该邮箱的新评论一律进 `pending`，直到人工解除 */
    reviewRequired: boolean('review_required').notNull().default(false),

    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),

    /** 已发布（`approved`）评论数 */
    commentCount: integer('comment_count').notNull().default(0),
  },
  (table) => [
    unique('members_site_id_email_unique').on(table.siteId, table.email),
    // 后台按邮箱搜索/关联用
    index('members_email_idx').on(table.email),
  ],
);

export type Member = typeof members.$inferSelect;
export type NewMember = typeof members.$inferInsert;
