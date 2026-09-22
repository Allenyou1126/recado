import { setMemberLabel, type LabelError } from '@recado/core';
import { AdminAssignLabelInputSchema, err, ok, type AdminAssignLabelInput } from '@recado/shared';
import { createFileRoute } from '@tanstack/react-router';

import { ADMIN_API_MIDDLEWARE } from '../../../../../../lib/http/admin-route';
import { clientIp } from '../../../../../../lib/http/client-ip';
import { createHandler } from '../../../../../../lib/http/handler';
import { methodNotAllowed } from '../../../../../../lib/http/method-not-allowed';
import { readJsonBody, type RequestBodyError } from '../../../../../../lib/http/request';

/**
 * `POST /api/v1/admin/members/:id/labels` —— 指派 / 取消展示标签。
 *
 * 标签**仅供展示**（决策 D7），不影响审核 —— 「标成站长」与「要不要先审」
 * 是两个独立维度，这也是 Waline 把两者混在一个自由文本字段里的教训。
 */
const assign = createHandler<
  AdminSiteContext,
  { assigned: boolean },
  LabelError | RequestBodyError,
  { id: string }
>(
  async (context, request, params) => {
    const body = await readJsonBody<AdminAssignLabelInput>(request, AdminAssignLabelInputSchema);
    if (body.error) return err(body.error);

    const result = await setMemberLabel(
      { db: context.db, siteId: context.site.id, actorId: context.actor.id, ip: clientIp(request) },
      params.id,
      body.data.labelId,
      body.data.assigned,
    );

    if (result.error) return err(result.error);

    return ok({ assigned: body.data.assigned });
  },
  { operation: 'admin.members.label' },
);

export const Route = createFileRoute('/api/v1/admin/members/$id/labels')({
  server: {
    middleware: [...ADMIN_API_MIDDLEWARE],
    handlers: {
      POST: assign,
      ANY: async () => methodNotAllowed(['POST']),
    },
  },
});
