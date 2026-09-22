/**
 * labels 功能的服务层。
 *
 * 标签是**展示徽章**（D7）：随评论响应返回 `{name, color}`，前端自行决定怎么渲染。
 * 它不影响审核 —— 「把这个人标成站长」与「这个人的评论要不要先审」是两件事。
 */

import type { DbExecutor, Label } from '@recado/db';
import { err, ok, type Result } from '@recado/shared';

import { AuditActions, recordAudit } from '../audit/audit.service';
import {
  assignLabel,
  deleteLabel,
  findLabelById,
  insertLabel,
  listLabels,
  unassignLabel,
  updateLabel,
} from './labels.data';
import { LabelErrors, type LabelError } from './labels.errors';

export type LabelContext = {
  db: DbExecutor;
  siteId: string;
  actorId: string | null;
  ip?: string | null;
};

export async function listSiteLabels(db: DbExecutor, siteId: string): Promise<Label[]> {
  return listLabels(db, siteId);
}

export async function createLabel(
  ctx: LabelContext,
  input: { name: string; color?: string | null; sort?: number },
): Promise<Result<Label, LabelError>> {
  const name = input.name.trim();
  if (name.length === 0) return err(LabelErrors.nameRequired());

  const existing = await listLabels(ctx.db, ctx.siteId);
  if (existing.some((label) => label.name === name)) {
    return err(LabelErrors.nameTaken(name));
  }

  const label = await insertLabel(ctx.db, ctx.siteId, {
    name,
    color: input.color ?? null,
    sort: input.sort ?? 0,
  });

  await recordAudit(ctx.db, {
    action: AuditActions.labelAssigned,
    actorId: ctx.actorId,
    siteId: ctx.siteId,
    targetType: 'label',
    targetId: label.id,
    diff: { created: true, name },
    ip: ctx.ip ?? null,
  });

  return ok(label);
}

export async function editLabel(
  ctx: LabelContext,
  labelId: string,
  input: { name?: string; color?: string | null; sort?: number },
): Promise<Result<Label, LabelError>> {
  const label = await findLabelById(ctx.db, ctx.siteId, labelId);
  if (!label) return err(LabelErrors.notFound(labelId));

  const updated = await updateLabel(ctx.db, ctx.siteId, labelId, {
    ...(input.name === undefined ? {} : { name: input.name.trim() }),
    ...(input.color === undefined ? {} : { color: input.color }),
    ...(input.sort === undefined ? {} : { sort: input.sort }),
  });

  if (!updated) return err(LabelErrors.notFound(labelId));

  return ok(updated);
}

/** 删除标签：关联表随之级联，成员的其它标签不受影响 */
export async function removeLabel(
  ctx: LabelContext,
  labelId: string,
): Promise<Result<null, LabelError>> {
  const removed = await deleteLabel(ctx.db, ctx.siteId, labelId);
  if (!removed) return err(LabelErrors.notFound(labelId));

  await recordAudit(ctx.db, {
    action: AuditActions.labelUnassigned,
    actorId: ctx.actorId,
    siteId: ctx.siteId,
    targetType: 'label',
    targetId: labelId,
    diff: { deleted: true },
    ip: ctx.ip ?? null,
  });

  return ok(null);
}

/** 指派 / 取消指派 */
export async function setMemberLabel(
  ctx: LabelContext,
  memberId: string,
  labelId: string,
  assigned: boolean,
): Promise<Result<null, LabelError>> {
  const label = await findLabelById(ctx.db, ctx.siteId, labelId);
  if (!label) return err(LabelErrors.notFound(labelId));

  if (assigned) {
    await assignLabel(ctx.db, memberId, labelId, ctx.actorId);
  } else {
    await unassignLabel(ctx.db, memberId, labelId);
  }

  await recordAudit(ctx.db, {
    action: assigned ? AuditActions.labelAssigned : AuditActions.labelUnassigned,
    actorId: ctx.actorId,
    siteId: ctx.siteId,
    targetType: 'member',
    targetId: memberId,
    diff: { label: label.name, assigned },
    ip: ctx.ip ?? null,
  });

  return ok(null);
}
