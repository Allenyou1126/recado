import { createLabel, listSiteLabels, type LabelError } from '@recado/core';
import { AdminLabelInputSchema, err, ok, type AdminLabelInput } from '@recado/shared';
import { createFileRoute } from '@tanstack/react-router';

import { ADMIN_API_MIDDLEWARE } from '../../../../../lib/http/admin-route';
import { clientIp } from '../../../../../lib/http/client-ip';
import { createHandler } from '../../../../../lib/http/handler';
import { methodNotAllowed } from '../../../../../lib/http/method-not-allowed';
import { readJsonBody, type RequestBodyError } from '../../../../../lib/http/request';

/** `GET|POST /api/v1/admin/labels` —— 站点级展示标签的列表与创建 */
const list = createHandler<AdminSiteContext, Awaited<ReturnType<typeof listSiteLabels>>, never>(
  async (context) => ok(await listSiteLabels(context.db, context.site.id)),
  { operation: 'admin.labels.list' },
);

const create = createHandler<AdminSiteContext, { id: string }, LabelError | RequestBodyError>(
  async (context, request) => {
    const body = await readJsonBody<AdminLabelInput>(request, AdminLabelInputSchema);
    if (body.error) return err(body.error);

    const created = await createLabel(
      { db: context.db, siteId: context.site.id, actorId: context.actor.id, ip: clientIp(request) },
      body.data,
    );

    if (created.error) return err(created.error);

    return ok({ id: created.data.id });
  },
  { operation: 'admin.labels.create', successStatus: 201 },
);

export const Route = createFileRoute('/api/v1/admin/labels/')({
  server: {
    middleware: [...ADMIN_API_MIDDLEWARE],
    handlers: {
      GET: list,
      POST: create,
      ANY: async () => methodNotAllowed(['GET', 'POST']),
    },
  },
});
