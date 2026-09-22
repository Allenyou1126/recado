/**
 * comments —— 评论。
 *
 * 设计要点（见 .specs/requirements.md §5.2）：
 *
 * - **原文 `content_md` 与渲染结果 `content_html` 双存**。这是 Waline 最昂贵的
 *   一个教训：只存 HTML 会导致解析器修复后无法重渲染、无法对原文做检索、
 *   无法让管理员以原文编辑
 * - **作者快照**（`author_nickname` / `author_website`）：评论是历史记录，署名
 *   不应随后续修改而变；同时让公开查询完全不必触碰含邮箱的 `members` 表
 * - `path` 冗余自 thread，避免列表查询回表
 * - `search_vector`（tsvector）属 P1（决策 Q-15），一期用 ILIKE，本表暂不建该列
 */

import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { uuidv7 } from '../lib/uuid';
import { members } from './members';
import { sites } from './sites';
import { threads } from './threads';
import { inet } from './types';

export const commentStatus = pgEnum('comment_status', ['approved', 'pending', 'spam', 'deleted']);

export const comments = pgTable(
  'comments',
  {
    /** v7：时间有序，分页与索引都受益（RFC 9562） */
    id: uuid('id')
      .primaryKey()
      .$defaultFn(() => uuidv7()),

    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),

    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),

    /** 冗余自 thread，公开列表查询因此不必回表 */
    path: text('path').notNull(),

    /** 顶层祖先，用于按线程聚合；顶层评论自身为 null */
    rootId: uuid('root_id').references((): AnyPgColumn => comments.id, { onDelete: 'set null' }),

    /** 直接父评论；顶层评论为 null */
    parentId: uuid('parent_id').references((): AnyPgColumn => comments.id, {
      onDelete: 'set null',
    }),

    /** 被回复者，驱动回复通知与前端「回复 @xxx」 */
    replyToMemberId: uuid('reply_to_member_id').references(() => members.id, {
      onDelete: 'set null',
    }),

    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),

    /** 发表时快照，不随 member 后续修改而变化 */
    authorNickname: text('author_nickname'),
    authorWebsite: text('author_website'),

    /** **权威原文** */
    contentMd: text('content_md').notNull(),

    /** 服务端渲染 + 消毒后的结果（缓存列，可随时由 content_md 重放） */
    contentHtml: text('content_html').notNull(),

    /** 原文字节数：长度约束与后台展示都用它 */
    contentBytes: integer('content_bytes').notNull(),

    status: commentStatus('status').notNull().default('pending'),

    /** 仅管理员可见 */
    ip: inet('ip'),
    userAgent: text('user_agent'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /** 软删时间；行始终保留（决策 Q-04：不级联删除子回复） */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    /**
     * 索引按 requirements.md §5.2 的清单**逐项落地，不因当前规模小而省略** ——
     * 索引是设计正确性的一部分，不是规模优化（决策 Q-15）。
     */

    /** 公开列表：按 path 取某篇文章的已发布评论，按时间倒序分页 */
    index('comments_site_id_path_status_created_at_idx').on(
      table.siteId,
      table.path,
      table.status,
      table.createdAt.desc(),
    ),

    /** 后台筛选与「最近评论」：按站点 + 状态，时间倒序 */
    index('comments_site_id_status_created_at_idx').on(
      table.siteId,
      table.status,
      table.createdAt.desc(),
    ),

    /** 回复分页：按顶层祖先取回复 */
    index('comments_root_id_created_at_idx').on(table.rootId, table.createdAt),

    /** 成员维度：后台查看某邮箱的全部评论 */
    index('comments_member_id_idx').on(table.memberId),

    // GIN(search_vector) 属 P1（Q-15）：一期关键词检索用 ILIKE，暂不建该列与索引
  ],
);

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
export type CommentStatus = Comment['status'];
