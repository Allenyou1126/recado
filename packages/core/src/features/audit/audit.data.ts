/**
 * audit 功能的数据访问层（Repo）。
 *
 * 审计日志覆盖：标记垃圾、状态变更、删除、批量操作、内容编辑、配置修改、
 * 标签变更、站点创建与 key 轮换、管理员变更（requirements.md §5.2）。
 *
 * 写入永远发生在**业务事务内**：审计与业务改动要么一起成功，要么一起回滚 ——
 * 「操作成功了但没留下痕迹」比不审计更危险。
 */

import { auditLogs, type AuditLog, type DbExecutor, type NewAuditLog } from '@recado/db';
import { and, desc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';

export async function insertAuditLog(db: DbExecutor, values: NewAuditLog): Promise<void> {
  await db.insert(auditLogs).values(values);
}

export type AuditQuery = {
  siteId?: string | undefined;
  action?: string | undefined;
  targetType?: string | undefined;
  targetId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  limit: number;
  offset: number;
};

function auditScope(query: AuditQuery): SQL | undefined {
  return and(
    query.siteId === undefined ? undefined : eq(auditLogs.siteId, query.siteId),
    query.action === undefined ? undefined : eq(auditLogs.action, query.action),
    query.targetType === undefined ? undefined : eq(auditLogs.targetType, query.targetType),
    query.targetId === undefined ? undefined : eq(auditLogs.targetId, query.targetId),
    query.from === undefined ? undefined : gte(auditLogs.createdAt, query.from),
    query.to === undefined ? undefined : lte(auditLogs.createdAt, query.to),
  );
}

export async function listAuditLogs(
  db: DbExecutor,
  query: AuditQuery,
): Promise<{ rows: AuditLog[]; total: number }> {
  const scope = auditScope(query);

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(auditLogs)
      .where(scope)
      .orderBy(desc(auditLogs.createdAt))
      .limit(query.limit)
      .offset(query.offset),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(scope),
  ]);

  return { rows, total: totals[0]?.value ?? 0 };
}
