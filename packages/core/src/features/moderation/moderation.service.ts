/**
 * moderation 功能的服务层：评论状态判定。
 *
 * 本文件在阶段 4 只负责「新评论的初始状态」，阶段 5 会在这里补齐
 * 状态机、邮箱声誉的原子副作用与审计。
 *
 * 状态语义（requirements.md §5.4）：
 *
 * - 公开可见：仅 `approved`
 * - 审核模式 `none` 全放行 / `first_time` 首次评论待审 / `all` 全部待审
 * - 被标记过垃圾的邮箱（`reviewRequired`）无论站点模式如何一律进 `pending`
 */

import type { CommentStatus, Member } from '@recado/db';

import type { AuditMode } from '../sites/sites.schema';

/** 评论状态机（阶段 4 只用到 approved / pending） */
export const COMMENT_STATUSES = ['approved', 'pending', 'spam', 'deleted'] as const;

/** 判定新评论的初始状态 */
export function determineInitialStatus(
  member: Pick<Member, 'reviewRequired' | 'commentCount'>,
  auditMode: AuditMode,
): CommentStatus {
  // 声誉降级优先于站点模式：被标记过垃圾的邮箱一律先审
  if (member.reviewRequired) return 'pending';

  switch (auditMode) {
    case 'none':
      return 'approved';
    case 'first_time':
      // 该邮箱在本站点的第一条评论才需要审
      return member.commentCount === 0 ? 'pending' : 'approved';
    case 'all':
      return 'pending';
  }
}
