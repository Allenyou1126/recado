/**
 * labels 功能的数据访问层（Repo）：站点级展示徽章的 CRUD 与指派。
 *
 * 标签**仅用于展示**（决策 D7），不参与审核判定 —— 审核声誉在
 * `members.spam_count` / `review_required`，两套结构刻意分开。
 */

import { labels, memberLabels, type DbExecutor, type Label } from '@recado/db';
import { and, asc, eq, inArray } from 'drizzle-orm';

export async function listLabels(db: DbExecutor, siteId: string): Promise<Label[]> {
  return db
    .select()
    .from(labels)
    .where(eq(labels.siteId, siteId))
    .orderBy(asc(labels.sort), asc(labels.name));
}

export async function findLabelById(
  db: DbExecutor,
  siteId: string,
  labelId: string,
): Promise<Label | undefined> {
  return db.query.labels.findFirst({
    where: and(eq(labels.siteId, siteId), eq(labels.id, labelId)),
  });
}

export async function insertLabel(
  db: DbExecutor,
  siteId: string,
  values: { name: string; color: string | null; sort: number },
): Promise<Label> {
  const [row] = await db
    .insert(labels)
    .values({ siteId, ...values })
    .returning();

  if (!row) throw new Error('insertLabel 未返回标签行');
  return row;
}

export async function updateLabel(
  db: DbExecutor,
  siteId: string,
  labelId: string,
  values: { name?: string; color?: string | null; sort?: number },
): Promise<Label | undefined> {
  const [row] = await db
    .update(labels)
    .set(values)
    .where(and(eq(labels.siteId, siteId), eq(labels.id, labelId)))
    .returning();

  return row;
}

export async function deleteLabel(
  db: DbExecutor,
  siteId: string,
  labelId: string,
): Promise<boolean> {
  const rows = await db
    .delete(labels)
    .where(and(eq(labels.siteId, siteId), eq(labels.id, labelId)))
    .returning({ id: labels.id });

  return rows.length > 0;
}

/**
 * 指派标签。
 *
 * 复合主键天然去重；`onConflictDoNothing` 让重复指派变成幂等操作，
 * 后台连点两次不会报错。
 */
export async function assignLabel(
  db: DbExecutor,
  memberId: string,
  labelId: string,
  assignedBy: string | null,
): Promise<void> {
  await db.insert(memberLabels).values({ memberId, labelId, assignedBy }).onConflictDoNothing();
}

export async function unassignLabel(
  db: DbExecutor,
  memberId: string,
  labelId: string,
): Promise<void> {
  await db
    .delete(memberLabels)
    .where(and(eq(memberLabels.memberId, memberId), eq(memberLabels.labelId, labelId)));
}

/** 批量取成员的标签：后台列表一次查完，避免 N+1 */
export async function findLabelsByMemberIds(
  db: DbExecutor,
  siteId: string,
  memberIds: readonly string[],
): Promise<Map<string, Label[]>> {
  if (memberIds.length === 0) return new Map();

  const rows = await db
    .select({
      memberId: memberLabels.memberId,
      id: labels.id,
      name: labels.name,
      color: labels.color,
      sort: labels.sort,
      siteId: labels.siteId,
      createdAt: labels.createdAt,
    })
    .from(memberLabels)
    .innerJoin(labels, eq(labels.id, memberLabels.labelId))
    .where(and(eq(labels.siteId, siteId), inArray(memberLabels.memberId, [...memberIds])));

  const result = new Map<string, Label[]>();

  for (const row of rows) {
    const bucket = result.get(row.memberId) ?? [];
    bucket.push({
      id: row.id,
      siteId: row.siteId,
      name: row.name,
      color: row.color,
      sort: row.sort,
      createdAt: row.createdAt,
    });
    result.set(row.memberId, bucket);
  }

  return result;
}
