/**
 * moderation 功能的服务层：评论状态机、邮箱声誉与审计。
 *
 * 状态语义（requirements.md §5.4）：
 *
 * ```
 * 新建 ──(审核策略)──► pending / approved
 * approved ◄──► spam ──► deleted（软删，行保留）
 * ```
 *
 * **公开可见：仅 `approved`**；计数口径同样是 `approved`。
 *
 * 关键设计：所有状态变更都在**单事务**内完成「改状态 + 声誉计数 + 物化计数 +
 * 审计日志」这一组操作（§5.5），否则一旦中途失败就会留下脏计数 ——
 * 而脏计数没有任何自愈机会。
 */

import type { Comment, CommentStatus, DbExecutor, Site } from '@recado/db';
import { err, ok, type Result } from '@recado/shared';

import { AuditActions, recordAudit } from '../audit/audit.service';
import {
  findCommentById,
  updateCommentContent,
  updateCommentStatus,
} from '../comments/comments.data';
import { CommentErrors, type CommentError } from '../comments/comments.errors';
import {
  addMemberCommentCount,
  addMemberSpamCount,
  setMemberReviewRequired,
} from '../members/members.data';
import { renderMarkdown, renderOptionsFromSettings } from '../rendering/rendering.service';
import type { AuditMode } from '../sites/sites.schema';
import { siteSettings } from '../sites/sites.service';
import { countCommentAdded, countCommentRemoved } from '../threads/threads.service';

/** 评论状态（与数据库 enum 一一对应） */
export const COMMENT_STATUSES = ['approved', 'pending', 'spam', 'deleted'] as const;

/**
 * 判定新评论的初始状态。
 *
 * 审核模式（T5.2）：
 * - `none` 全放行 / `first_time` 首次评论待审 / `all` 全部待审
 * - `reviewRequired` 的邮箱（被标记过垃圾）无论站点模式如何一律进 `pending`
 */
export function determineInitialStatus(
  member: { reviewRequired: boolean; commentCount: number },
  auditMode: AuditMode,
): CommentStatus {
  // 声誉降级优先于站点模式
  if (member.reviewRequired) return 'pending';

  switch (auditMode) {
    case 'none':
      return 'approved';
    case 'first_time':
      return member.commentCount === 0 ? 'pending' : 'approved';
    case 'all':
      return 'pending';
  }
}

/** 合法状态转移表：不在表里的转移一律拒绝 */
const ALLOWED_TRANSITIONS: Record<CommentStatus, readonly CommentStatus[]> = {
  pending: ['approved', 'spam', 'deleted'],
  approved: ['pending', 'spam', 'deleted'],
  spam: ['approved', 'deleted'],
  // 软删是终点：本系统不提供「恢复已删除评论」（Q-04 的删除语义）
  deleted: [],
};

export function canTransition(from: CommentStatus, to: CommentStatus): boolean {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}

export type ModerationContext = {
  db: DbExecutor;
  site: Pick<Site, 'id' | 'settings'>;
  actorId: string | null;
  ip?: string | null;
};

export type ModerationOutcome = {
  commentId: string;
  from: CommentStatus;
  to: CommentStatus;
  memberId: string;
  spamCount: number;
  reviewRequired: boolean;
};

/**
 * 变更单条评论的状态，并同步其连带副作用。
 *
 * 副作用的口径（§5.5）：
 * 1. 进入 / 离开 `approved` 时调整 `threads.comment_count` 与 `members.comment_count`
 * 2. 进入 `spam` 时 `members.spam_count += 1`，达到阈值置 `review_required`
 * 3. 离开 `spam` 时**对称回滚**第 2 步
 * 4. 每一步都写审计日志
 */
export async function changeCommentStatus(
  ctx: ModerationContext,
  commentId: string,
  next: CommentStatus,
): Promise<Result<ModerationOutcome, CommentError>> {
  const settings = siteSettings(ctx.site);

  const comment = await findCommentById(ctx.db, ctx.site.id, commentId);
  if (!comment) return err(CommentErrors.commentNotFound(commentId));

  if (!canTransition(comment.status, next)) {
    return err(CommentErrors.invalidTransition(comment.status, next));
  }

  if (comment.status === next) {
    return ok({
      commentId,
      from: comment.status,
      to: next,
      memberId: comment.memberId,
      spamCount: 0,
      reviewRequired: false,
    });
  }

  // 物化计数只在「已发布」这条线上变化
  const wasCounted = comment.status === 'approved';
  const willCount = next === 'approved';

  if (wasCounted && !willCount) {
    await countCommentRemoved(ctx.db, ctx.site.id, comment.threadId);
    await addMemberCommentCount(ctx.db, ctx.site.id, comment.memberId, -1);
  } else if (!wasCounted && willCount) {
    await countCommentAdded(ctx.db, ctx.site.id, comment.threadId);
    await addMemberCommentCount(ctx.db, ctx.site.id, comment.memberId, 1);
  }

  // 声誉：进入 spam 加分，离开 spam 对称回滚
  let spamCount = 0;
  let reviewRequired = false;

  if (next === 'spam' && comment.status !== 'spam') {
    const member = await addMemberSpamCount(ctx.db, ctx.site.id, comment.memberId, 1);
    spamCount = member.spamCount;
    reviewRequired = member.reviewRequired;

    if (spamCount >= settings.spamThreshold && !member.reviewRequired) {
      const updated = await setMemberReviewRequired(ctx.db, ctx.site.id, comment.memberId, true);
      reviewRequired = updated.reviewRequired;
    }
  } else if (comment.status === 'spam' && next !== 'spam') {
    const member = await addMemberSpamCount(ctx.db, ctx.site.id, comment.memberId, -1);
    spamCount = member.spamCount;

    // 对称回滚：分数掉回阈值以下就解除待审
    if (member.reviewRequired && spamCount < settings.spamThreshold) {
      const updated = await setMemberReviewRequired(ctx.db, ctx.site.id, comment.memberId, false);
      reviewRequired = updated.reviewRequired;
    } else {
      reviewRequired = member.reviewRequired;
    }
  }

  const updated = await updateCommentStatus(ctx.db, ctx.site.id, commentId, next);
  if (!updated) return err(CommentErrors.commentNotFound(commentId));

  await recordAudit(ctx.db, {
    action: AuditActions.commentStatusChanged,
    actorId: ctx.actorId,
    siteId: ctx.site.id,
    targetType: 'comment',
    targetId: commentId,
    diff: { from: comment.status, to: next, spamCount, reviewRequired },
    ip: ctx.ip ?? null,
  });

  return ok({
    commentId,
    from: comment.status,
    to: next,
    memberId: comment.memberId,
    spamCount,
    reviewRequired,
  });
}

/**
 * 管理员编辑评论：改**原文**后重新渲染（T5.7）。
 *
 * 双存设计让这件事成立 —— 只存 HTML 的系统在这里只能做字符串手术，
 * 解析器升级也永远惠及不到历史评论。
 */
export async function editCommentContent(
  ctx: ModerationContext,
  commentId: string,
  markdown: string,
): Promise<Result<Comment, CommentError>> {
  const comment = await findCommentById(ctx.db, ctx.site.id, commentId);
  if (!comment) return err(CommentErrors.commentNotFound(commentId));

  const settings = siteSettings(ctx.site);
  const rendered = await renderMarkdown(markdown, renderOptionsFromSettings(settings));
  if (rendered.error) return err(rendered.error);

  const updated = await updateCommentContent(ctx.db, ctx.site.id, commentId, {
    md: markdown,
    html: rendered.data.html,
    bytes: rendered.data.bytes,
  });

  if (!updated) return err(CommentErrors.commentNotFound(commentId));

  await recordAudit(ctx.db, {
    action: AuditActions.commentEdited,
    actorId: ctx.actorId,
    siteId: ctx.site.id,
    targetType: 'comment',
    targetId: commentId,
    // 只留长度与字节数，避免把整段正文写进审计表
    diff: { previousBytes: comment.contentBytes, nextBytes: rendered.data.bytes },
    ip: ctx.ip ?? null,
  });

  return ok(updated);
}

/**
 * 批量状态变更：**单事务 + 部分失败明细**。
 *
 * 刻意不对单条端点做 `Promise.all` 扇出（Waline 的做法：无批处理、无事务、
 * 无部分失败处理）。逐条校验转移合法性，**全部合法才执行**；
 * 只要有一条不合法就整体回滚，并把失败明细返回给调用方。
 */
export async function batchChangeStatus(
  ctx: ModerationContext,
  commentIds: readonly string[],
  next: CommentStatus,
): Promise<Result<BatchOutcome, BatchError>> {
  const ids = [...new Set(commentIds)];

  const failures: BatchFailure[] = [];
  const comments: Comment[] = [];

  for (const id of ids) {
    const comment = await findCommentById(ctx.db, ctx.site.id, id);

    if (!comment) {
      failures.push({ commentId: id, reason: 'NOT_FOUND_COMMENT' });
      continue;
    }

    if (!canTransition(comment.status, next)) {
      failures.push({
        commentId: id,
        reason: 'CONFLICT_INVALID_STATUS_TRANSITION',
        details: { from: comment.status, to: next },
      });
      continue;
    }

    comments.push(comment);
  }

  if (failures.length > 0) {
    // 有非法项就整体不执行：批量操作最怕「成功一半」，那比全失败更难收拾
    return err(partialFailure(failures, ids.length, 0));
  }

  if (comments.length === 0) {
    return ok({ requested: ids.length, applied: 0, failures: [] });
  }

  // 全部合法才执行，且整批在同一个事务里 —— 要么全成，要么全不成
  return ctx.db.transaction(async (tx) => {
    const scoped: ModerationContext = { ...ctx, db: tx };

    for (const comment of comments) {
      const changed = await changeCommentStatus(scoped, comment.id, next);
      if (changed.error) {
        // 抛出去让事务回滚；这里是「不该发生」的路径（前面已经校验过）
        throw new Error(`批量操作中途失败：${changed.error.reason}`);
      }
    }

    return ok({ requested: ids.length, applied: comments.length, failures: [] });
  });
}

export type BatchFailure = {
  commentId: string;
  reason: string;
  details?: unknown;
};

export type BatchOutcome = {
  requested: number;
  applied: number;
  failures: BatchFailure[];
};

/** 批量操作的部分失败明细；整体按 409 返回 */
export type BatchError = {
  reason: 'CONFLICT_BATCH_PARTIAL_FAILURE';
  message: string;
  failures: BatchFailure[];
  requested: number;
  applied: number;
};

/**
 * 构造批量失败错误。
 *
 * `err()` 的泛型参数需要字面量 reason，直接写对象字面量会被推断成宽泛的 string，
 * 因此这里显式返回 `BatchError` —— 不是为了断言类型，而是让 reason 保持字面量。
 */
function partialFailure(failures: BatchFailure[], requested: number, applied: number): BatchError {
  return {
    reason: 'CONFLICT_BATCH_PARTIAL_FAILURE',
    message: `${failures.length} of ${requested} comments could not be updated`,
    failures,
    requested,
    applied,
  };
}

/** 供接口层复用的审计动作常量 */
export { AuditActions };
