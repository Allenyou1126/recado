/**
 * members 功能的**管理端**服务：成员列表、审核声誉调整、标签展示。
 *
 * 隐私边界：成员的 `email` 只在管理端出现，公开 API 永远不返回（§8.1）。
 * 成员列表会明确标注邮箱，因为「按邮箱归并」正是这个系统的身份模型，
 * 站长必须能看到它才能做人工判断。
 */

import type { DbExecutor, Member } from '@recado/db';
import { err, ok, type Result } from '@recado/shared';

import { AuditActions, recordAudit } from '../audit/audit.service';
import { findLabelsByMemberIds } from '../labels/labels.data';
import {
  findMemberById,
  listMembers,
  setMemberReviewRequired,
  setMemberSpamCount,
} from './members.data';
import { MemberErrors, type MemberError } from './members.errors';

export type MemberAdminContext = {
  db: DbExecutor;
  siteId: string;
  actorId: string | null;
  ip?: string | null;
};

export type MemberWithLabels = Member & {
  labels: Array<{ id: string; name: string; color: string | null }>;
};

/** 成员列表（后台）：按邮箱/昵称搜索，附带展示标签 */
export async function listMembersForAdmin(
  db: DbExecutor,
  siteId: string,
  query: { search?: string | undefined; page: number; pageSize: number },
): Promise<{ members: MemberWithLabels[]; total: number }> {
  const { rows, total } = await listMembers(db, siteId, {
    search: query.search,
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  });

  // 标签一次性批量取回，避免每行一次查询
  const labelsByMember = await findLabelsByMemberIds(
    db,
    siteId,
    rows.map((member) => member.id),
  );

  return {
    members: rows.map((member) => ({
      ...member,
      labels: (labelsByMember.get(member.id) ?? []).map((label) => ({
        id: label.id,
        name: label.name,
        color: label.color,
      })),
    })),
    total,
  };
}

export type MemberUpdateInput = {
  /** 手动解除 / 设置待审（覆盖自动判定） */
  reviewRequired?: boolean;
  /** 清零或调整垃圾计数 */
  spamCount?: number;
};

/** 调整成员档案；每一步都留审计 */
export async function updateMemberAsAdmin(
  ctx: MemberAdminContext,
  memberId: string,
  input: MemberUpdateInput,
): Promise<Result<Member, MemberError>> {
  const member = await findMemberById(ctx.db, ctx.siteId, memberId);
  if (!member) return err(MemberErrors.notFound(memberId));

  let current = member;

  if (input.reviewRequired !== undefined && input.reviewRequired !== member.reviewRequired) {
    current = await setMemberReviewRequired(ctx.db, ctx.siteId, memberId, input.reviewRequired);
  }

  if (input.spamCount !== undefined) {
    current = await setMemberSpamCount(ctx.db, ctx.siteId, memberId, input.spamCount);
  }

  if (Object.keys(input).length > 0) {
    await recordAudit(ctx.db, {
      action: AuditActions.memberUpdated,
      actorId: ctx.actorId,
      siteId: ctx.siteId,
      targetType: 'member',
      targetId: memberId,
      // 审计里不写邮箱明文：需要关联时用 memberId
      diff: {
        reviewRequired: current.reviewRequired,
        spamCount: current.spamCount,
      },
      ip: ctx.ip ?? null,
    });
  }

  return ok(current);
}

/** 成员详情（含标签） */
export async function getMemberForAdmin(
  db: DbExecutor,
  siteId: string,
  memberId: string,
): Promise<MemberWithLabels | undefined> {
  const member = await findMemberById(db, siteId, memberId);
  if (!member) return undefined;

  const labelsByMember = await findLabelsByMemberIds(db, siteId, [memberId]);

  return {
    ...member,
    labels: (labelsByMember.get(memberId) ?? []).map((label) => ({
      id: label.id,
      name: label.name,
      color: label.color,
    })),
  };
}
