/**
 * audit_logs —— 管理操作留痕。
 *
 * 覆盖：标记垃圾、状态变更、删除、批量操作、内容编辑、配置修改、标签变更、
 * 站点创建与 key 轮换、管理员变更（.specs/requirements.md §5.2）。
 *
 * ⚠️ `site_id` / `admin_id` 都是 **nullable + on delete set null**，不是 cascade：
 * 审计日志的意义在于目标被删除之后仍然可查，跟着一起消失就失去价值了。
 * 站点与管理员在本系统里都是停用（`disabled`）而非删除，所以关联通常仍在。
 */

import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { admins } from './admins';
import { sites } from './sites';
import { inet } from './types';

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** 操作主体；机器主体也在 admins 表里有一行（决策 Q-18） */
    adminId: uuid('admin_id').references(() => admins.id, { onDelete: 'set null' }),

    siteId: uuid('site_id').references(() => sites.id, { onDelete: 'set null' }),

    /** 稳定动作名，形如 `comment.mark_spam` / `site.rotate_key` */
    action: text('action').notNull(),

    /** 目标类型与标识，形如 `comment` + 评论 uuid */
    targetType: text('target_type'),
    targetId: uuid('target_id'),

    /** 变更前后快照；只放可安全留存的字段，禁止写入邮箱明文、token 等 */
    diff: jsonb('diff').$type<Record<string, unknown>>(),

    ip: inet('ip'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_logs_site_id_created_at_idx').on(table.siteId, table.createdAt),
    index('audit_logs_admin_id_created_at_idx').on(table.adminId, table.createdAt),
    index('audit_logs_target_idx').on(table.targetType, table.targetId),
  ],
);

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
