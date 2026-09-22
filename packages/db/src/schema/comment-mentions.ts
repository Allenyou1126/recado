/**
 * comment_mentions —— @提及记录。
 *
 * 用途：追踪「这条评论里的 @某人 通知是否已经发出」，便于失败重发与审计
 * （.specs/requirements.md §5.2）。
 *
 * 主键取 `(comment_id, mentioned_member_id)`：同一评论对同一个人只应有一条记录，
 * 复合主键天然去重，也让重发变成对 `notified_at` 的更新而不是插入新行。
 *
 * ⚠️ 提及解析必须走 **AST 层**（渲染管线阶段 2），不能用正则扫原文 ——
 * 代码块里的 `@` 会骗过正则。
 */

import { pgTable, primaryKey, timestamp, uuid } from 'drizzle-orm/pg-core';

import { comments } from './comments';
import { members } from './members';

export const commentMentions = pgTable(
  'comment_mentions',
  {
    commentId: uuid('comment_id')
      .notNull()
      .references(() => comments.id, { onDelete: 'cascade' }),

    mentionedMemberId: uuid('mentioned_member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),

    /** 通知发出时间；为空表示尚未发出（或发送失败待重试） */
    notifiedAt: timestamp('notified_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.commentId, table.mentionedMemberId] })],
);

export type CommentMention = typeof commentMentions.$inferSelect;
export type NewCommentMention = typeof commentMentions.$inferInsert;
