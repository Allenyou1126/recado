/**
 * threads 功能的数据访问层（Repo）。
 *
 * **参数约定**：`siteId` 紧跟 `db`（.specs/development-standards.md §7.2）。
 */

import { threads, type DbExecutor, type Thread } from '@recado/db';
import { and, eq, inArray, sql } from 'drizzle-orm';

/**
 * 按 `(site_id, path)` upsert 线程，并顺带更新前端上报的 url / title。
 *
 * 单条 `ON CONFLICT DO UPDATE` 而不是「先查再插」：并发发表同一篇文章的评论时，
 * 后者会撞唯一约束。
 */
export async function upsertThread(
  db: DbExecutor,
  siteId: string,
  path: string,
  meta: { url?: string | null; title?: string | null } = {},
): Promise<Thread> {
  const [row] = await db
    .insert(threads)
    .values({ siteId, path, url: meta.url ?? null, title: meta.title ?? null })
    .onConflictDoUpdate({
      target: [threads.siteId, threads.path],
      // 只在这次确实上报了值时覆盖，避免后续不带 title 的请求把已有信息清空
      set: {
        url: sql`coalesce(${meta.url ?? null}, ${threads.url})`,
        title: sql`coalesce(${meta.title ?? null}, ${threads.title})`,
      },
    })
    .returning();

  if (!row) throw new Error('upsertThread 未返回线程行');
  return row;
}

export async function findThreadByPath(
  db: DbExecutor,
  siteId: string,
  path: string,
): Promise<Thread | undefined> {
  return db.query.threads.findFirst({
    where: and(eq(threads.siteId, siteId), eq(threads.path, path)),
  });
}

/** 批量取线程（批量评论数走它，O(1) 读物化计数） */
export async function findThreadsByPaths(
  db: DbExecutor,
  siteId: string,
  paths: readonly string[],
): Promise<Thread[]> {
  if (paths.length === 0) return [];

  return db
    .select()
    .from(threads)
    .where(and(eq(threads.siteId, siteId), inArray(threads.path, [...paths])));
}

/**
 * 维护物化计数。
 *
 * `delta` 为 +1（新评论通过）或 -1（评论被删/标垃圾），
 * `last_comment_at` 只在新增时推进 —— 删除不该把「最近评论时间」往回拨。
 */
export async function addThreadCommentCount(
  db: DbExecutor,
  siteId: string,
  threadId: string,
  delta: number,
  options: { touchLastCommentAt?: boolean } = {},
): Promise<void> {
  await db
    .update(threads)
    .set({
      commentCount: sql`greatest(${threads.commentCount} + ${delta}, 0)`,
      ...(options.touchLastCommentAt === true ? { lastCommentAt: sql`now()` } : {}),
    })
    .where(and(eq(threads.siteId, siteId), eq(threads.id, threadId)));
}
