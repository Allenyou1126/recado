/**
 * threads —— 文章评论线程。
 *
 * 设计要点（见 .specs/requirements.md §5.2）：
 *
 * - 唯一约束 `(site_id, path)`：同一站点下同一篇文章只有一条线程
 * - `comment_count` 是**物化计数**，在事务内维护：批量评论数与文章维度管理
 *   因此是 O(1) 查询，不需要 `COUNT(*)` 扫评论表
 *
 * 为什么要有独立线程表：Waline 直接用 `Comment.url` 字符串聚合，没有文章维度，
 * 导致评论数统计与「最近评论」都要扫评论表。这是本项目明确要改进的一点。
 */

import { integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { sites } from './sites';

export const threads = pgTable(
  'threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),

    /** 文章标识，来自前端（默认 `location.pathname`） */
    path: text('path').notNull(),

    /** 可选，由前端上报，用于后台展示与邮件链接 */
    url: text('url'),
    title: text('title'),

    /** 已发布（`approved`）评论数，事务内维护 */
    commentCount: integer('comment_count').notNull().default(0),

    /** 最近一条已发布评论的时间 */
    lastCommentAt: timestamp('last_comment_at', { withTimezone: true }),
  },
  (table) => [unique('threads_site_id_path_unique').on(table.siteId, table.path)],
);

export type Thread = typeof threads.$inferSelect;
export type NewThread = typeof threads.$inferInsert;
