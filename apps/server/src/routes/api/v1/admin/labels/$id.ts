import { editLabel, removeLabel, type LabelError } from '@recado/core';
import { AdminLabelInputSchema, err, ok, type AdminLabelInput } from '@recado/shared';
import { createFileRoute } from '@tanstack/react-router';

import { ADMIN_API_MIDDLEWARE } from '../../../../../lib/http/admin-route';
import { clientIp } from '../../../../../lib/http/client-ip';
import { createHandler } from '../../../../../lib/http/handler';
import { methodNotAllowed } from '../../../../../lib/http/method-not-allowed';
import { readJsonBody, type RequestBodyError } from '../../../../../lib/http/request';

/**
 * `PATCH|DELETE /api/v1/admin/labels/:id`。
 *
 * 删除标签会级联清掉指派关系，但**不影响成员的评论与声誉** ——
 * 删除前管理台必须提示影响范围（T8.9）。
 */
const update = createHandler<
  AdminSiteContext,
  { id: string },
  LabelError | RequestBodyError,
  { id: string }
>(
  async (context, request, params) => {
    const body = await readJsonBody<Partial<AdminLabelInput>>(
      request,
      AdminLabelInputSchema.partial(),
    );
    if (body.error) return err(body.error);

    const updated = await editLabel(
      { db: context.db, siteId: context.site.id, actorId: context.actor.id, ip: clientIp(request) },
      params.id,
      body.data,
    );

    if (updated.error) return err(updated.error);

    return ok({ id: updated.data.id });
  },
  { operation: 'admin.labels.update' },
);

const remove = createHandler<AdminSiteContext, { id: string }, LabelError, { id: string }>(
  async (context, request, params) => {
    const result = await removeLabel(
      { db: context.db, siteId: context.site.id, actorId: context.actor.id, ip: clientIp(request) },
      params.id,
    );

    if (result.error) return err(result.error);

    return ok({ id: params.id });
  },
  { operation: 'admin.labels.delete' },
);

export const Route = createFileRoute('/api/v1/admin/labels/$id')({
  server: {
    middleware: [...ADMIN_API_MIDDLEWARE],
    handlers: {
      PATCH: update,
      DELETE: remove,
      ANY: async () => methodNotAllowed(['PATCH', 'DELETE']),
    },
  },
});
