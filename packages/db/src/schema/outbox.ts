/**
 * outbox / unsubscribes —— 邮件投递队列与退订。
 *
 * 设计要点（见 .specs/requirements.md §5.2、§6 M6）：
 *
 * - 评论写入**只入队**，投递由 worker 异步完成。Waline 在评论写入请求内串行
 *   await 所有通知渠道，直接导致发评论变慢 —— 这是 M6 要解决的核心问题
 * - `dedupe_key` 唯一：同一事件重复入队只保留一条（幂等）
 * - 发信配置是**站点级**的（决策 Q-10），因此每条任务都带 `site_id`
 * - 退订 `token` 不可猜测且长期有效（每封邮件都带，不设过期）
 */

import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { comments } from './comments';
import { sites } from './sites';
import { citext } from './types';

export const outboxType = pgEnum('outbox_type', [
  'admin_new_comment',
  'reply',
  'mention',
  'pending_reminder',
  'test',
]);

export const outboxStatus = pgEnum('outbox_status', [
  'queued',
  'sending',
  'sent',
  'failed',
  'skipped',
]);

export const outbox = pgTable('outbox', {
  id: uuid('id').primaryKey().defaultRandom(),

  type: outboxType('type').notNull(),

  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id, { onDelete: 'cascade' }),

  /** 关联的评论；`test` 这类无上下文的邮件为空 */
  commentId: uuid('comment_id').references(() => comments.id, { onDelete: 'set null' }),

  toEmail: text('to_email').notNull(),
  subject: text('subject').notNull(),

  /** 模板标识；集中管理，后台可预览（阶段 6） */
  template: text('template').notNull(),
  /** 模板变量 */
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),

  status: outboxStatus('status').notNull().default('queued'),

  attempts: integer('attempts').notNull().default(0),
  /** 最近一次失败原因（脱敏后）；成功后清空 */
  lastError: text('last_error'),

  /** 幂等键：同一事件重复入队只有一条 */
  dedupeKey: text('dedupe_key').notNull().unique(),

  /** 下次尝试时间；指数退避靠它实现 */
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp('sent_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const unsubscribeScope = pgEnum('unsubscribe_scope', ['site']);

export const unsubscribes = pgTable('unsubscribes', {
  id: uuid('id').primaryKey().defaultRandom(),

  siteId: uuid('site_id')
    .notNull()
    .references(() => sites.id, { onDelete: 'cascade' }),

  /** citext：与 members.email 用同一种比较语义，退订才能可靠命中 */
  email: citext('email').notNull(),

  /** 邮件里的退订凭据；不可猜测且长期有效 */
  token: text('token').notNull().unique(),

  /** 目前只有站点级；保留字段以便将来扩展为实例级 */
  scope: unsubscribeScope('scope').notNull().default('site'),

  /** 触发退订的那封邮件对应的评论 */
  sourceCommentId: uuid('source_comment_id').references(() => comments.id, {
    onDelete: 'set null',
  }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type OutboxItem = typeof outbox.$inferSelect;
export type NewOutboxItem = typeof outbox.$inferInsert;
export type OutboxType = OutboxItem['type'];
export type OutboxStatus = OutboxItem['status'];
export type Unsubscribe = typeof unsubscribes.$inferSelect;
export type NewUnsubscribe = typeof unsubscribes.$inferInsert;
