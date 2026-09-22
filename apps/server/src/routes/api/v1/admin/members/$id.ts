import { updateMemberAsAdmin, type MemberError } from '@recado/core';
import { AdminUpdateMemberInputSchema, err, ok, type AdminUpdateMemberInput } from '@recado/shared';
import { createFileRoute } from '@tanstack/react-router';

import { ADMIN_API_MIDDLEWARE } from '../../../../../lib/http/admin-route';
import { clientIp } from '../../../../../lib/http/client-ip';
import { createHandler } from '../../../../../lib/http/handler';
import { methodNotAllowed } from '../../../../../lib/http/method-not-allowed';
import { readJsonBody, type RequestBodyError } from '../../../../../lib/http/request';

/**
 * `PATCH /api/v1/admin/members/:id` —— 调整成员的审核声誉。
 *
 * 「解除待审」与「清零垃圾计数」是站长日常最需要的两个动作：
 * 自动降级会误伤，必须有人工纠正的入口（M5）。
 */
const updateMember = createHandler<
  AdminSiteContext,
  { id: string },
  MemberError | RequestBodyError,
  { id: string }
>(
  async (context, request, params) => {
    const body = await readJsonBody<AdminUpdateMemberInput>(request, AdminUpdateMemberInputSchema);
    if (body.error) return err(body.error);

    const updated = await updateMemberAsAdmin(
      { db: context.db, siteId: context.site.id, actorId: context.actor.id, ip: clientIp(request) },
      params.id,
      body.data,
    );

    if (updated.error) return err(updated.error);

    return ok({ id: updated.data.id });
  },
  { operation: 'admin.members.update' },
);

export const Route = createFileRoute('/api/v1/admin/members/$id')({
  server: {
    middleware: [...ADMIN_API_MIDDLEWARE],
    handlers: {
      PATCH: updateMember,
      ANY: async () => methodNotAllowed(['PATCH']),
    },
  },
});
