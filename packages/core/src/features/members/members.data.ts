/**
 * members 功能的数据访问层（Repo）。
 *
 * **参数约定**：`siteId` 紧跟 `db`（见 .specs/development-standards.md §7.2）。
 */

import { members, type DbExecutor, type Member } from '@recado/db';
import { and, eq, sql } from 'drizzle-orm';

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
