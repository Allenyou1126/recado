/**
 * comments 功能的服务层：发表、回复、列表、计数。
 *
 * 事务边界在这一层（.specs/development-standards.md §7.3）：发表评论要同时写
 * comment、upsert thread、更新两处物化计数、维护成员档案，**必须在一个事务内**。
 * 事务里不做网络 IO —— 渲染（CPU 活）也放在事务**之前**，让事务尽可能短。
 */

import type { Comment, DbExecutor, Site } from '@recado/db';
import { err, ok, type AdminComment, type PublicComment, type Result } from '@recado/shared';

import { findEmailsByMemberIds } from '../members/members.data';
import { resolveMember } from '../members/members.service';
import { determineInitialStatus } from '../moderation/moderation.service';
import {
  enqueueCommentNotifications,
  loadMemberEmail,
} from '../notifications/notifications.service';
import { renderMarkdown, renderOptionsFromSettings } from '../rendering/rendering.service';
import { siteSettings } from '../sites/sites.service';
import { countCommentAdded, ensureThread } from '../threads/threads.service';
import {
  countCommentsByPaths,
  countCommentsByStatus,
  findCommentById as findCommentByIdRepo,
  countRepliesByRoots,
  findAncestry,
  findLastCommentAtByIp,
  insertComment,
  listAdminComments as listAdminCommentsRepo,
  listRecentComments,
  listReplies,
  listTopLevelComments,
  loadReplyPreviews,
  type AdminListQuery,
  type ListParams,
} from './comments.data';
import { CommentErrors, type CommentError } from './comments.errors';

/** 发表评论需要的依赖：数据库 + 目标站点（不传整个 HTTP 上下文） */
export type CommentContext = {
  db: DbExecutor;
  site: Pick<Site, 'id' | 'name' | 'settings'>;
  /** 站点对外基地址，用于拼邮件里的链接；省略时不带链接 */
  publicBaseUrl?: string | undefined;
};

export type CreateCommentParams = {
  path: string;
  content: string;
  email: string;
  nickname?: string | undefined;
  website?: string | undefined;
  parentId?: string | undefined;
  url?: string | undefined;
  title?: string | undefined;
  /** 仅管理员可见；日志与公开响应都不带它 */
  ip: string | null;
  userAgent: string | null;
};

/**
 * 发表评论（或回复）。
 *
 * 流程与 .specs/requirements.md §8.4 的请求生命周期一致：
 * 校验 → 状态判定 → 渲染 → 单事务写入。返回**显式构造**的公开对象。
 */
export async function createComment(
  ctx: CommentContext,
  params: CreateCommentParams,
): Promise<Result<PublicComment, CommentError>> {
  const settings = siteSettings(ctx.site);

  // 1. 站点级必填项：邮箱恒为必填（决策 D18），昵称可按站点关闭
  if (settings.requireNickname && (params.nickname?.trim().length ?? 0) === 0) {
    return err(CommentErrors.nicknameRequired());
  }

  // 2. 长度 / 空内容 / 超时由渲染管线判定；渲染是 CPU 活，放在事务之外
  const rendered = await renderMarkdown(params.content, renderOptionsFromSettings(settings));
  if (rendered.error) {
    return err(rendered.error);
  }

  const member = await resolveMember(ctx.db, ctx.site.id, {
    email: params.email,
    nickname: params.nickname,
    website: params.website,
  });

  const status = determineInitialStatus(member, settings.auditMode);

  const created = await ctx.db.transaction(async (tx) => {
    const thread = await ensureThread(tx, ctx.site.id, params.path, {
      url: params.url ?? null,
      title: params.title ?? null,
    });

    const placement = await resolvePlacement(
      tx,
      ctx.site.id,
      thread.id,
      params.parentId,
      settings.maxDepth,
    );
    if (placement.error) return placement;

    const comment = await insertComment(tx, {
      siteId: ctx.site.id,
      threadId: thread.id,
      path: params.path,
      rootId: placement.data.rootId,
      parentId: placement.data.parentId,
      replyToMemberId: placement.data.replyToMemberId,
      memberId: member.id,
      // 发表时快照：评论是历史记录，署名不应随后续修改而变
      authorNickname: params.nickname?.trim() || null,
      authorWebsite: params.website?.trim() || null,
      contentMd: params.content,
      contentHtml: rendered.data.html,
      contentBytes: rendered.data.bytes,
      status,
      ip: params.ip,
      userAgent: params.userAgent,
    });

    // 只有已发布的评论才计入物化计数（§5.4 计数口径）
    if (status === 'approved') {
      await countCommentAdded(tx, ctx.site.id, thread.id);
    }

    return ok({
      comment,
      threadUrl: thread.url,
      replyToMemberId: placement.data.replyToMemberId,
      replyToNickname: placement.data.replyToNickname,
    });
  });

  if (created.error) return created;

  // ⚠️ 通知入队在**事务提交之后**：事务内写队列会在回滚时留下幽灵任务，
  // 而事务内做网络 IO 更是明令禁止。入队本身只是一条 INSERT，很快。
  const replyToEmail =
    created.data.replyToMemberId === null
      ? null
      : await loadMemberEmail(ctx.db, ctx.site.id, created.data.replyToMemberId);

  // 作者邮箱用于「自己回复自己不发通知」的判定
  const authorEmail = await loadMemberEmail(ctx.db, ctx.site.id, created.data.comment.memberId);

  await enqueueCommentNotifications(
    {
      db: ctx.db,
      site: ctx.site,
      publicBaseUrl: ctx.publicBaseUrl ?? '',
    },
    {
      commentId: created.data.comment.id,
      path: created.data.comment.path,
      threadUrl: created.data.threadUrl,
      authorNickname: created.data.comment.authorNickname,
      authorEmail,
      contentHtml: created.data.comment.contentHtml,
      status: created.data.comment.status === 'approved' ? 'approved' : 'pending',
      replyToMemberId: created.data.replyToMemberId,
      replyToEmail,
    },
  );

  return ok(
    toPublicComment(created.data.comment, { replyToNickname: created.data.replyToNickname }),
  );
}

type Placement = {
  rootId: string | null;
  parentId: string | null;
  replyToMemberId: string | null;
  replyToNickname: string | null;
};

/**
 * 推导回复落点（决策：`maxDepth` 默认 2，可配 1–5）。
 *
 * 超出深度时**挂到允许的最深祖先**，但 `replyTo` 仍然记录被回复的那个人 ——
 * 这样「回复 @xxx」的语义不会丢，只是缩进层级被压平（需求 M2）。
 */
async function resolvePlacement(
  tx: DbExecutor,
  siteId: string,
  threadId: string,
  parentId: string | undefined,
  maxDepth: number,
): Promise<Result<Placement, CommentError>> {
  if (parentId === undefined) {
    return ok({ rootId: null, parentId: null, replyToMemberId: null, replyToNickname: null });
  }

  const ancestry = await findAncestry(tx, siteId, parentId);
  const directParent = ancestry[0];

  // 父评论不存在，或不属于本站点（findAncestry 已按 site_id 过滤）
  if (!directParent) {
    return err(CommentErrors.parentNotFound(parentId));
  }

  const parent = await findCommentById(tx, siteId, directParent.id);
  if (!parent || parent.threadId !== threadId) {
    // 跨线程回复会让线程树错乱，直接拒绝
    return err(CommentErrors.parentNotFound(parentId));
  }

  const parentDepth = ancestry.length;
  const maxParentDepth = Math.max(maxDepth - 1, 0);

  // ancestry 由近及远：0 是直接父评论
  const targetIndex = parentDepth <= maxParentDepth ? 0 : parentDepth - maxParentDepth;
  const attachTo = ancestry[targetIndex] ?? directParent;

  return ok({
    rootId: attachTo.parentId ?? attachTo.id,
    parentId: attachTo.id,
    // 保留真实被回复者，即使缩进被压平
    replyToMemberId: directParent.memberId,
    replyToNickname: parent.authorNickname,
  });
}

/**
 * 公开响应白名单。
 *
 * **显式构造，禁止透传数据库行**：comments 行里有 `email`（经 members）、`ip`、
 * `user_agent`，透传就会泄漏（见 .specs/development-standards.md §8.1）。
 */
export function toPublicComment(
  row: Comment,
  options: {
    replyToNickname?: string | null;
    labels?: ReadonlyArray<{ name: string; color: string | null }>;
    replies?: PublicComment[];
    hasMoreReplies?: boolean;
  } = {},
): PublicComment {
  const isDeleted = row.status === 'deleted';

  return {
    id: row.id,
    path: row.path,
    rootId: row.rootId,
    parentId: row.parentId,
    replyTo: row.replyToMemberId === null ? null : { nickname: options.replyToNickname ?? null },
    // 被删除的评论不再回显署名与正文，只留骨架给前端渲染占位
    nickname: isDeleted ? null : row.authorNickname,
    website: isDeleted ? null : row.authorWebsite,
    content: isDeleted ? '' : row.contentHtml,
    status: isDeleted ? 'deleted' : 'approved',
    createdAt: row.createdAt.toISOString(),
    labels: [...(options.labels ?? [])],
    ...(options.replies === undefined ? {} : { replies: options.replies }),
    ...(options.hasMoreReplies === undefined ? {} : { hasMoreReplies: options.hasMoreReplies }),
  };
}

export type ListCommentsParams = {
  path?: string | undefined;
  threadId?: string | undefined;
  sort: 'latest' | 'oldest';
  page: number;
  /** 省略时用站点配置的 pageSize；服务端强制封顶 maxPageSize */
  pageSize?: number | undefined;
};

/** 评论列表：顶层分页 + 每条顶层评论内联前 N 条回复 */
export async function listComments(ctx: CommentContext, params: ListCommentsParams) {
  const settings = siteSettings(ctx.site);
  const pageSize = Math.min(params.pageSize ?? settings.pageSize, settings.maxPageSize);
  const offset = (params.page - 1) * pageSize;

  const listParams: ListParams = {
    path: params.path,
    threadId: params.threadId,
    sort: params.sort,
    limit: pageSize,
    offset,
  };

  const { rows, total } = await listTopLevelComments(ctx.db, ctx.site.id, listParams);
  const rootIds = rows.map((row) => row.id);

  const [replies, replyCounts] = await Promise.all([
    loadReplyPreviews(ctx.db, ctx.site.id, rootIds, settings.repliesPreview),
    countRepliesByRoots(ctx.db, ctx.site.id, rootIds),
  ]);

  const repliesByRoot = new Map<string, Comment[]>();
  for (const reply of replies) {
    if (reply.rootId === null) continue;
    const bucket = repliesByRoot.get(reply.rootId) ?? [];
    bucket.push(reply);
    repliesByRoot.set(reply.rootId, bucket);
  }

  const comments = rows.map((row) => {
    const inline = repliesByRoot.get(row.id) ?? [];
    const totalReplies = replyCounts.get(row.id) ?? 0;

    return toPublicComment(row, {
      replies: inline.map((reply) => toPublicComment(reply)),
      hasMoreReplies: totalReplies > inline.length,
    });
  });

  return ok({
    comments,
    page: params.page,
    pageSize,
    total,
    totalPages: Math.max(Math.ceil(total / pageSize), 1),
  });
}

/** 回复分页：完整回复独立拉取，**不受顶层分页限制**（M2 的改进点） */
export async function listCommentReplies(
  ctx: CommentContext,
  rootId: string,
  params: { sort: 'latest' | 'oldest'; page: number; pageSize?: number | undefined },
) {
  const settings = siteSettings(ctx.site);
  const pageSize = Math.min(params.pageSize ?? settings.pageSize, settings.maxPageSize);
  const offset = (params.page - 1) * pageSize;

  const root = await findCommentById(ctx.db, ctx.site.id, rootId);
  if (!root || root.status !== 'approved') {
    return err(CommentErrors.commentNotFound(rootId));
  }

  const { rows, total } = await listReplies(ctx.db, ctx.site.id, rootId, {
    sort: params.sort,
    limit: pageSize,
    offset,
  });

  return ok({
    rootId,
    replies: rows.map((row) => toPublicComment(row)),
    page: params.page,
    pageSize,
    total,
    totalPages: Math.max(Math.ceil(total / pageSize), 1),
  });
}

/** 批量评论数：一次查询多个 path */
export async function countComments(ctx: CommentContext, paths: readonly string[]) {
  const counts = await countCommentsByPaths(ctx.db, ctx.site.id, paths);

  const result: Record<string, number> = {};
  let total = 0;

  for (const path of paths) {
    const value = counts.get(path) ?? 0;
    result[path] = value;
    total += value;
  }

  return ok({ counts: result, total });
}

/** 最近评论（跨 path，供侧边栏组件） */
export async function listRecent(ctx: CommentContext, limit: number) {
  const rows = await listRecentComments(ctx.db, ctx.site.id, limit);

  return ok(rows.map((row) => toPublicComment(row)));
}

/**
 * 限流：同 IP 同站点最小间隔。
 *
 * 这是**可用性保护**，不是反垃圾（requirements.md §6 M5）：
 * 无验证码、无第三方反垃圾是明确决策（Q-11），这里只挡住「同一个人反复按提交」。
 * 基于数据库而非内存计数，多实例部署下同样有效。
 */
export async function checkRateLimit(
  ctx: CommentContext,
  ip: string | null,
): Promise<Result<null, CommentError>> {
  const { minIntervalSeconds } = siteSettings(ctx.site);

  if (minIntervalSeconds <= 0 || ip === null) return ok(null);

  const lastAt = await findLastCommentAtByIp(ctx.db, ctx.site.id, ip);
  if (lastAt === null) return ok(null);

  const elapsedSeconds = (Date.now() - lastAt.getTime()) / 1000;
  if (elapsedSeconds >= minIntervalSeconds) return ok(null);

  return err(CommentErrors.tooFrequent(Math.ceil(minIntervalSeconds - elapsedSeconds)));
}

/**
 * 批量重渲染用：直接更新渲染结果（原文不变）。
 *
 * 与「管理员编辑评论」的区别：这里**不改原文**，只是用当前管线重放 HTML ——
 * 双存设计让解析器升级能惠及历史评论。
 */
export { updateCommentContent } from './comments.data';

/**
 * 后台评论列表：全维度筛选（站点 / 路径 / 状态 / 关键词 / 时间范围）。
 *
 * 关键词查的是 `content_md`（**原文**），不是渲染后的 HTML —— 一期用 ILIKE，
 * `tsvector` 属 P1（决策 Q-15）。搜 HTML 会得到「搜 `**加粗**` 搜不到」这种怪现象。
 */
export async function listAdminComments(ctx: CommentContext, query: AdminListQuery) {
  return listAdminCommentsRepo(ctx.db, ctx.site.id, query);
}

/**
 * 管理端评论视图。
 *
 * 与公开视图的差别只有一处：**管理员可以看到 email / ip / user_agent**
 * （§5.2 明确「仅管理员可见」）。因此这里也必须显式构造 ——
 * 直接透传数据库行会让「以后新增的敏感列」自动出现在后台接口里。
 */
export function toAdminComment(
  row: Comment,
  email: string,
  labels: ReadonlyArray<{ name: string; color: string | null }> = [],
): AdminComment {
  return {
    ...toPublicComment(row, { labels }),
    status: row.status,
    memberId: row.memberId,
    email,
    ip: row.ip,
    userAgent: row.userAgent,
    contentMd: row.contentMd,
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt === null ? null : row.deletedAt.toISOString(),
  };
}

/** 后台评论列表：一次补齐成员邮箱，避免逐条查库 */
export async function listCommentsForAdmin(
  ctx: CommentContext,
  query: Omit<AdminListQuery, 'limit' | 'offset'> & { page: number; pageSize: number },
) {
  const { rows, total } = await listAdminCommentsRepo(ctx.db, ctx.site.id, {
    ...query,
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  });

  const emails = await findEmailsByMemberIds(
    ctx.db,
    ctx.site.id,
    rows.map((row) => row.memberId),
  );

  return {
    comments: rows.map((row) => toAdminComment(row, emails.get(row.memberId) ?? '')),
    total,
    page: query.page,
    pageSize: query.pageSize,
    totalPages: Math.max(Math.ceil(total / query.pageSize), 1),
  };
}

/** 站点级状态计数（仪表盘与待审队列） */
export async function summarizeByStatus(ctx: CommentContext) {
  return countCommentsByStatus(ctx.db, ctx.site.id);
}

/**
 * 按 id 取评论（已带站点隔离）。
 *
 * 供接口层在「改原文 / 改状态」之后回读最新行，组装管理端视图。
 */
export async function findCommentById(
  db: CommentContext['db'],
  siteId: string,
  commentId: string,
): Promise<Comment | null> {
  return (await findCommentByIdRepo(db, siteId, commentId)) ?? null;
}
