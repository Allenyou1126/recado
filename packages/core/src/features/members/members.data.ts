/**
 * members 功能的数据访问层（Repo）。
 *
 * **参数约定**：`siteId` 紧跟 `db`（见 .specs/development-standards.md §7.2）。
 */

import { members, type DbExecutor, type Member } from '@recado/db';
import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';

/** 按邮箱查成员；`email` 是 citext，大小写不敏感 */
export async function findMemberByEmail(
  db: DbExecutor,
  siteId: string,
  email: string,
): Promise<Member | undefined> {
  return db.query.members.findFirst({
    where: and(eq(members.siteId, siteId), eq(members.email, email)),
  });
}

export type MemberProfile = {
  email: string;
  nickname: string | null;
  website: string | null;
  avatarUrl: string | null;
};

/**
 * 按 `(site_id, email)` upsert 成员档案。
 *
 * 用一条 `INSERT ... ON CONFLICT DO UPDATE` 而不是「先查再插」：
 * 并发下后者会撞唯一约束，且需要自己处理重试。
 * `nickname` / `website` 取**最近一次**使用的值（M3 邮箱归并）。
 */
export async function upsertMember(
  db: DbExecutor,
  siteId: string,
  profile: MemberProfile,
): Promise<Member> {
  const [row] = await db
    .insert(members)
    .values({
      siteId,
      email: profile.email,
      nickname: profile.nickname,
      website: profile.website,
      avatarUrl: profile.avatarUrl,
    })
    .onConflictDoUpdate({
      target: [members.siteId, members.email],
      set: {
        // COALESCE：这次没填昵称时保留上一次的值，而不是把它清空
        nickname: sql`coalesce(${profile.nickname}, ${members.nickname})`,
        website: sql`coalesce(${profile.website}, ${members.website})`,
        avatarUrl: sql`coalesce(${profile.avatarUrl}, ${members.avatarUrl})`,
        lastSeenAt: sql`now()`,
      },
    })
    .returning();

  if (!row) throw new Error('upsertMember 未返回成员行');
  return row;
}

/** 站点内已发布评论数 ±1（发表 / 删除 / 恢复时维护） */
export async function addMemberCommentCount(
  db: DbExecutor,
  siteId: string,
  memberId: string,
  delta: number,
): Promise<void> {
  await db
    .update(members)
    .set({ commentCount: sql`greatest(${members.commentCount} + ${delta}, 0)` })
    .where(and(eq(members.siteId, siteId), eq(members.id, memberId)));
}

/**
 * 审核声誉计数 ±1，并回传更新后的档案。
 *
 * 返回整行而不是只返回计数：调用方紧接着要判断是否达到阈值，
 * 再查一次纯属浪费往返。
 */
export async function addMemberSpamCount(
  db: DbExecutor,
  siteId: string,
  memberId: string,
  delta: number,
): Promise<Member> {
  const [row] = await db
    .update(members)
    .set({ spamCount: sql`greatest(${members.spamCount} + ${delta}, 0)` })
    .where(and(eq(members.siteId, siteId), eq(members.id, memberId)))
    .returning();

  if (!row) throw new Error('addMemberSpamCount 未命中成员');
  return row;
}

/** 手动或自动设置「该邮箱后续评论需先审」 */
export async function setMemberReviewRequired(
  db: DbExecutor,
  siteId: string,
  memberId: string,
  required: boolean,
): Promise<Member> {
  const [row] = await db
    .update(members)
    .set({ reviewRequired: required })
    .where(and(eq(members.siteId, siteId), eq(members.id, memberId)))
    .returning();

  if (!row) throw new Error('setMemberReviewRequired 未命中成员');
  return row;
}

/** 成员列表（后台用）：按邮箱/昵称搜索、按站点隔离 */
export async function listMembers(
  db: DbExecutor,
  siteId: string,
  query: { search?: string | undefined; limit: number; offset: number },
): Promise<{ rows: Member[]; total: number }> {
  const search = query.search?.trim();
  const scope = and(
    eq(members.siteId, siteId),
    search === undefined || search.length === 0
      ? undefined
      : or(ilike(members.email, `%${search}%`), ilike(members.nickname, `%${search}%`)),
  );

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(members)
      .where(scope)
      .orderBy(desc(members.lastSeenAt))
      .limit(query.limit)
      .offset(query.offset),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(members)
      .where(scope),
  ]);

  return { rows, total: totals[0]?.value ?? 0 };
}

/** 按 id 取成员（同样带站点隔离） */
export async function findMemberById(
  db: DbExecutor,
  siteId: string,
  memberId: string,
): Promise<Member | undefined> {
  return db.query.members.findFirst({
    where: and(eq(members.siteId, siteId), eq(members.id, memberId)),
  });
}

/** 批量取成员邮箱：后台列表一次查完，避免 N+1 */
export async function findEmailsByMemberIds(
  db: DbExecutor,
  siteId: string,
  memberIds: readonly string[],
): Promise<Map<string, string>> {
  if (memberIds.length === 0) return new Map();

  const rows = await db
    .select({ id: members.id, email: members.email })
    .from(members)
    .where(and(eq(members.siteId, siteId), inArray(members.id, [...memberIds])));

  return new Map(rows.map((row) => [row.id, row.email]));
}

/** 直接设置垃圾计数（管理员手动清零/纠正） */
export async function setMemberSpamCount(
  db: DbExecutor,
  siteId: string,
  memberId: string,
  value: number,
): Promise<Member> {
  const [row] = await db
    .update(members)
    .set({ spamCount: Math.max(value, 0) })
    .where(and(eq(members.siteId, siteId), eq(members.id, memberId)))
    .returning();

  if (!row) throw new Error('setMemberSpamCount 未命中成员');
  return row;
}
