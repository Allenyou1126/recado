import {
  changeCommentStatus,
  editCommentContent,
  findCommentById,
  findMemberEmail,
  toAdminComment,
  type CommentError,
} from '@recado/core';
import {
  AdminUpdateCommentInputSchema,
  err,
  ok,
  type AdminComment,
  type AdminUpdateCommentInput,
} from '@recado/shared';
import { createFileRoute } from '@tanstack/react-router';

import { ADMIN_API_MIDDLEWARE } from '../../../../../lib/http/admin-route';
import { clientIp } from '../../../../../lib/http/client-ip';
import { createHandler } from '../../../../../lib/http/handler';
import { methodNotAllowed } from '../../../../../lib/http/method-not-allowed';
import { readJsonBody, type RequestBodyError } from '../../../../../lib/http/request';

/**
 * `PATCH /api/v1/admin/comments/:id` —— 改状态 / 改原文。
 *
 * 两条路径都走领域服务，因此副作用（声誉计数、物化计数、审计日志）一致 ——
 * 管理台、REST API、CLI 三条调用路径共享同一套业务规则（见开发规范 §2.3）。
 *
 * 删除同样是改状态（`status: 'deleted'`），且**不级联**子回复（决策 Q-04）。
 */
const updateComment = createHandler<
  AdminSiteContext,
  AdminComment,
  RequestBodyError | CommentError,
  { id: string }
>(
  async (context, request, params) => {
    const body = await readJsonBody<AdminUpdateCommentInput>(
      request,
      AdminUpdateCommentInputSchema,
    );
    if (body.error) return err(body.error);

    const moderation = {
      db: context.db,
      site: context.site,
      actorId: context.actor.id,
      ip: clientIp(request),
    };

    // 改原文（重新渲染）与改状态是两件事，可以同时发生
    if (body.data.content !== undefined) {
      const edited = await editCommentContent(moderation, params.id, body.data.content);
      if (edited.error) return err(edited.error);
    }

    if (body.data.status !== undefined) {
      const changed = await changeCommentStatus(moderation, params.id, body.data.status);
      if (changed.error) return err(changed.error);
    }

    const fresh = await findCommentById(context.db, context.site.id, params.id);
    if (!fresh) {
      return err({ reason: 'NOT_FOUND_COMMENT', message: 'Comment not found' });
    }

    const email = await findMemberEmail(context.db, context.site.id, fresh.memberId);

    return ok(toAdminComment(fresh, email ?? ''));
  },
  { operation: 'admin.comments.update' },
);

export const Route = createFileRoute('/api/v1/admin/comments/$id')({
  server: {
    middleware: [...ADMIN_API_MIDDLEWARE],
    handlers: {
      PATCH: updateComment,
      ANY: async () => methodNotAllowed(['PATCH']),
    },
  },
});
