/**
 * labels / member_labels —— 站点级展示徽章与多对多关联。
 *
 * 设计要点（见 .specs/requirements.md §5.2、决策 D7）：
 *
 * - 标签**仅用于前端展示**，不参与审核判定 —— 审核声誉在 `members.spam_count`
 *   / `review_required`，两套结构刻意分开（Waline 把两者混在一个自由文本字段里，
 *   语义会打架）
 * - 用关联表而非 `members.label_id` 单外键：一个成员可能同时是「站长」和「作者」，
 *   单外键会逼着站长在多个徽章间二选一
 */

import { integer, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

import { admins } from './admins';
import { members } from './members';
import { sites } from './sites';

export const labels = pgTable(
  'labels',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),

    /** 如「站长」「作者」「友链」 */
    name: text('name').notNull(),

    /** 前端徽章配色；留空则由前端决定 */
    color: text('color'),

    /** 展示排序，小的在前 */
    sort: integer('sort').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('labels_site_id_name_unique').on(table.siteId, table.name)],
);

export const memberLabels = pgTable(
  'member_labels',
  {
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),

    labelId: uuid('label_id')
      .notNull()
      .references(() => labels.id, { onDelete: 'cascade' }),

    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),

    /** 操作者；管理员被清理后保留指派关系，只丢失操作者线索 */
    assignedBy: uuid('assigned_by').references(() => admins.id, { onDelete: 'set null' }),
  },
  (table) => [primaryKey({ columns: [table.memberId, table.labelId] })],
);

export type Label = typeof labels.$inferSelect;
export type NewLabel = typeof labels.$inferInsert;
export type MemberLabel = typeof memberLabels.$inferSelect;
export type NewMemberLabel = typeof memberLabels.$inferInsert;
