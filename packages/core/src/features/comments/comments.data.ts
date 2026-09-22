/**
 * comments 功能的数据访问层（Repo）。
 *
 * **参数约定**：`siteId` 紧跟 `db`（.specs/development-standards.md §7.2）。
 *
 * 可见性规则集中在一处（`visibleCommentCondition`）：公开查询只看得到
 * `approved`，**以及**「被删但有子回复」的占位评论 —— 后者是决策 Q-04 的要求：
 * 删除顶层评论不级联，子回复保留，父位置显示「该评论已删除」。
 */

import { comments, threads, type Comment, type DbExecutor, type NewComment } from '@recado/db';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  lte,
  sql,
  type SQL,
  gte,
  ilike,
} from 'drizzle-orm';

/**
 * 公开可见条件：approved，或「已删除但仍有子评论」的占位。
 *
 * 占位规则是决策 Q-04 的要求：删除顶层评论**不级联**，子回复保留，
 * 父位置显示「该评论已删除」。只删到自己、下面什么都没留的评论不该出现在列表里。
 *
 * 用 `sql` 直接写而不是 `or(...)`：后者的返回类型是 `SQL | undefined`，
 * 为了收窄类型就得加断言 —— 断言是本仓库明令禁止的（AGENTS.md）。
 */
export function visibleCommentCondition(): SQL {
  return sql`(
    ${comments.status} = 'approved'
    or (
      ${comments.status} = 'deleted'
      and exists (
        select 1 from comments child
        where child.parent_id = ${comments.id}
          and child.status in ('approved', 'deleted')
      )
    )
  )`;
}

export async function insertComment(db: DbExecutor, values: NewComment): Promise<Comment> {
  const [row] = await db.insert(comments).values(values).returning();

  if (!row) throw new Error('insertComment 未返回评论行');
  return row;
}

export async function findCommentById(
  db: DbExecutor,
  siteId: string,
  commentId: string,
): Promise<Comment | undefined> {
  return db.query.comments.findFirst({
    where: and(eq(comments.siteId, siteId), eq(comments.id, commentId)),
  });
}

/**
 * 取某条评论的祖先链，**由近及远**（[父, 祖父, …, 根]）。
 *
 * 用递归 CTE 而不是在应用里逐层查询：层级上限虽然是 5，但逐层查库在
 * 每条回复上都要多打几次往返，而且需要额外的循环与错误分支。
 */
export async function findAncestry(
  db: DbExecutor,
  siteId: string,
  commentId: string,
): Promise<Array<{ id: string; memberId: string; parentId: string | null }>> {
  const result = await db.execute<{
    id: string;
    member_id: string;
    parent_id: string | null;
    distance: number;
  }>(sql`
    with recursive ancestry as (
      select id, member_id, parent_id, 1 as distance
      from comments
      where id = ${commentId} and site_id = ${siteId}
      union all
      select c.id, c.member_id, c.parent_id, a.distance + 1
      from comments c
      join ancestry a on c.id = a.parent_id
      where c.site_id = ${siteId}
    )
    select id, member_id, parent_id, distance from ancestry order by distance asc
  `);

  return result.rows.map((row) => ({
    id: row.id,
    memberId: row.member_id,
    parentId: row.parent_id,
  }));
}

export type ListParams = {
  path?: string;
  threadId?: string;
  sort: 'latest' | 'oldest';
  limit: number;
  offset: number;
};

function listOrder(sort: 'latest' | 'oldest') {
  return sort === 'latest' ? desc(comments.createdAt) : asc(comments.createdAt);
}

/** 顶层评论分页（含「已删除但仍有回复」的占位） */
export async function listTopLevelComments(
  db: DbExecutor,
  siteId: string,
  params: ListParams,
): Promise<{ rows: Comment[]; total: number }> {
  const scope = and(
    eq(comments.siteId, siteId),
    isNull(comments.parentId),
    params.path !== undefined ? eq(comments.path, params.path) : undefined,
    params.threadId !== undefined ? eq(comments.threadId, params.threadId) : undefined,
    visibleCommentCondition(),
  );

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(comments)
      .where(scope)
      .orderBy(listOrder(params.sort))
      .limit(params.limit)
      .offset(params.offset),
    db.select({ value: count() }).from(comments).where(scope),
  ]);

  return { rows, total: totals[0]?.value ?? 0 };
}

/**
 * 批量取每条顶层评论的前 N 条回复。
 *
 * 一条 `row_number()` 窗口查询搞定，而不是「循环里按 root 查」——
 * 后者是典型的 N+1，热门文章上会直接打满数据库连接。
 */
export async function loadReplyPreviews(
  db: DbExecutor,
  siteId: string,
  rootIds: readonly string[],
  perRoot: number,
): Promise<Comment[]> {
  if (rootIds.length === 0 || perRoot <= 0) return [];

  const ranked = db.$with('ranked').as(
    db
      .select({
        ...getTableColumns(comments),
        rank: sql<number>`row_number() over (partition by ${comments.rootId} order by ${comments.createdAt} asc)`.as(
          'rank',
        ),
      })
      .from(comments)
      .where(
        and(
          eq(comments.siteId, siteId),
          inArray(comments.rootId, [...rootIds]),
          eq(comments.status, 'approved'),
        ),
      ),
  );

  const rows = await db
    .with(ranked)
    .select()
    .from(ranked)
    .where(lte(ranked.rank, perRoot))
    .orderBy(ranked.rootId, ranked.createdAt);

  return rows.map(({ rank: _rank, ...comment }) => comment);
}

/** 每条顶层评论的回复总数（用于 hasMoreReplies） */
export async function countRepliesByRoots(
  db: DbExecutor,
  siteId: string,
  rootIds: readonly string[],
): Promise<Map<string, number>> {
  if (rootIds.length === 0) return new Map();

  const rows = await db
    .select({ rootId: comments.rootId, value: count() })
    .from(comments)
    .where(
      and(
        eq(comments.siteId, siteId),
        inArray(comments.rootId, [...rootIds]),
        visibleCommentCondition(),
      ),
    )
    .groupBy(comments.rootId);

  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.rootId !== null) counts.set(row.rootId, row.value);
  }

  return counts;
}

/** 某条顶层评论的回复分页（完整回复，不受顶层分页限制） */
export async function listReplies(
  db: DbExecutor,
  siteId: string,
  rootId: string,
  params: { sort: 'latest' | 'oldest'; limit: number; offset: number },
): Promise<{ rows: Comment[]; total: number }> {
  const scope = and(
    eq(comments.siteId, siteId),
    eq(comments.rootId, rootId),
    visibleCommentCondition(),
  );

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(comments)
      .where(scope)
      .orderBy(listOrder(params.sort))
      .limit(params.limit)
      .offset(params.offset),
    db.select({ value: count() }).from(comments).where(scope),
  ]);

  return { rows, total: totals[0]?.value ?? 0 };
}

/** 批量评论数：走 threads 的物化计数，O(1) */
export async function countCommentsByPaths(
  db: DbExecutor,
  siteId: string,
  paths: readonly string[],
): Promise<Map<string, number>> {
  if (paths.length === 0) return new Map();

  const rows = await db
    .select({ path: threads.path, value: threads.commentCount })
    .from(threads)
    .where(and(eq(threads.siteId, siteId), inArray(threads.path, [...paths])));

  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.path, row.value);
  }

  return counts;
}

/** 最近评论（跨 path，供侧边栏组件） */
export async function listRecentComments(
  db: DbExecutor,
  siteId: string,
  limit: number,
): Promise<Comment[]> {
  return db
    .select()
    .from(comments)
    .where(and(eq(comments.siteId, siteId), eq(comments.status, 'approved')))
    .orderBy(desc(comments.createdAt))
    .limit(limit);
}

/**
 * 同一 IP + 站点最近一次发表评论的时间。
 *
 * 限流用：`minIntervalSeconds` 是**可用性保护**，不是反垃圾
 * （见 requirements.md §6 M5），因此这里只做最小间隔判定，不做黑名单。
 */
export async function findLastCommentAtByIp(
  db: DbExecutor,
  siteId: string,
  ip: string,
): Promise<Date | null> {
  const result = await db
    .select({ createdAt: comments.createdAt })
    .from(comments)
    .where(and(eq(comments.siteId, siteId), eq(comments.ip, ip)))
    .orderBy(desc(comments.createdAt))
    .limit(1);

  return result[0]?.createdAt ?? null;
}

/** 变更评论状态（软删时同时写 deleted_at） */
export async function updateCommentStatus(
  db: DbExecutor,
  siteId: string,
  commentId: string,
  status: Comment['status'],
): Promise<Comment | undefined> {
  const [row] = await db
    .update(comments)
    .set({
      status,
      updatedAt: new Date(),
      deletedAt: status === 'deleted' ? new Date() : null,
    })
    .where(and(eq(comments.siteId, siteId), eq(comments.id, commentId)))
    .returning();

  return row;
}

/**
 * 管理员编辑评论：**改原文后重新渲染**。
 *
 * 双存设计（`content_md` + `content_html`）让这件事成为可能 ——
 * 只存 HTML 的系统在这里只能做字符串手术。
 */
export async function updateCommentContent(
  db: DbExecutor,
  siteId: string,
  commentId: string,
  content: { md: string; html: string; bytes: number },
): Promise<Comment | undefined> {
  const [row] = await db
    .update(comments)
    .set({
      contentMd: content.md,
      contentHtml: content.html,
      contentBytes: content.bytes,
      updatedAt: new Date(),
    })
    .where(and(eq(comments.siteId, siteId), eq(comments.id, commentId)))
    .returning();

  return row;
}

export type AdminListQuery = {
  path?: string | undefined;
  status?: Comment['status'] | undefined;
  /** 关键词检索基于**原文**（content_md），一期用 ILIKE（决策 Q-15） */
  keyword?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  sort: 'latest' | 'oldest';
  limit: number;
  offset: number;
};

function adminScope(siteId: string, query: AdminListQuery): SQL | undefined {
  const keyword = query.keyword?.trim();

  return and(
    eq(comments.siteId, siteId),
    query.path === undefined ? undefined : eq(comments.path, query.path),
    query.status === undefined ? undefined : eq(comments.status, query.status),
    keyword === undefined || keyword.length === 0
      ? undefined
      : ilike(comments.contentMd, `%${keyword}%`),
    query.from === undefined ? undefined : gte(comments.createdAt, query.from),
    query.to === undefined ? undefined : lte(comments.createdAt, query.to),
  );
}

/** 后台评论列表：全维度筛选（Waline 的管理台没有路径/站点筛选，这是明确要补的） */
export async function listAdminComments(
  db: DbExecutor,
  siteId: string,
  query: AdminListQuery,
): Promise<{ rows: Comment[]; total: number }> {
  const scope = adminScope(siteId, query);

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(comments)
      .where(scope)
      .orderBy(query.sort === 'latest' ? desc(comments.createdAt) : asc(comments.createdAt))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ value: count() }).from(comments).where(scope),
  ]);

  return { rows, total: totals[0]?.value ?? 0 };
}

/** 站点级状态计数（仪表盘用） */
export async function countCommentsByStatus(
  db: DbExecutor,
  siteId: string,
): Promise<Record<Comment['status'], number>> {
  const rows = await db
    .select({ status: comments.status, value: count() })
    .from(comments)
    .where(eq(comments.siteId, siteId))
    .groupBy(comments.status);

  const result: Record<Comment['status'], number> = {
    approved: 0,
    pending: 0,
    spam: 0,
    deleted: 0,
  };

  for (const row of rows) {
    result[row.status] = row.value;
  }

  return result;
}
