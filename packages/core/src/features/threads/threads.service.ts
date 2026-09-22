/**
 * threads 功能的服务层。
 *
 * 线程表的存在意义是让「评论数」与「最近评论」变成 O(1) 查询
 * （Waline 没有文章维度，统计都要扫评论表）。因此计数的维护必须**和评论写入
 * 在同一个事务里**，否则一旦不一致就再也没有自愈机会。
 */

import type { Database, Thread } from '@recado/db';
import type { Result } from '@recado/shared';
import { ok } from '@recado/shared';

import type { SiteError } from '../sites/sites.errors';
import { addThreadCommentCount, findThreadByPath, upsertThread } from './threads.data';

/** 找到或创建线程；同一站点同一 path 只有一条 */
export async function ensureThread(
  db: Database,
  siteId: string,
  path: string,
  meta: { url?: string | null; title?: string | null } = {},
): Promise<Thread> {
  return upsertThread(db, siteId, path, meta);
}

/** 已发布评论 +1 */
export async function countCommentAdded(
  db: Database,
  siteId: string,
  threadId: string,
): Promise<void> {
  await addThreadCommentCount(db, siteId, threadId, 1, { touchLastCommentAt: true });
}

/** 已发布评论 -1（删除 / 标记垃圾 / 转为待审） */
export async function countCommentRemoved(
  db: Database,
  siteId: string,
  threadId: string,
): Promise<void> {
  await addThreadCommentCount(db, siteId, threadId, -1);
}

/** 线程元信息；线程不存在时返回零值而不是 404 —— 没人评论过的文章是正常状态 */
export async function getThreadMeta(
  db: Database,
  siteId: string,
  path: string,
): Promise<Result<ThreadMeta, SiteError>> {
  const thread = await findThreadByPath(db, siteId, path);

  return ok({
    path,
    url: thread?.url ?? null,
    title: thread?.title ?? null,
    commentCount: thread?.commentCount ?? 0,
    lastCommentAt: thread?.lastCommentAt?.toISOString() ?? null,
  });
}

export type ThreadMeta = {
  path: string;
  url: string | null;
  title: string | null;
  commentCount: number;
  lastCommentAt: string | null;
};
