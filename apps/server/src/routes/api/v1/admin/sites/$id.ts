import { updateSiteAsAdmin, type SiteError } from '@recado/core';
import { AdminUpdateSiteInputSchema, err, ok, type AdminUpdateSiteInput } from '@recado/shared';
import { createFileRoute } from '@tanstack/react-router';

import { ADMIN_API_MIDDLEWARE } from '../../../../../lib/http/admin-route';
import { clientIp } from '../../../../../lib/http/client-ip';
import { createHandler } from '../../../../../lib/http/handler';
import { methodNotAllowed } from '../../../../../lib/http/method-not-allowed';
import { readJsonBody, type RequestBodyError } from '../../../../../lib/http/request';

/**
 * `PATCH /api/v1/admin/sites/:id` —— 更新站点（名称 / 状态 / 白名单 / 配置）。
 *
 * 走 `ADMIN_API_MIDDLEWARE`：目标站点由 `X-Recado-Site-Id` 指定，
 * siteScope 会先确认主体对该站点有权限 —— 站点管理员不能改别的站点。
 * `:id` 与请求头不一致时以请求头为准并直接拒绝，避免两个来源打架。
 */

const updateSite = createHandler<
  AdminSiteContext,
  { id: string },
  SiteError | RequestBodyError | { reason: string; message: string },
  { id: string }
>(
  async (context, request, params) => {
    if (params.id !== context.site.id) {
      return err({
        reason: 'VALIDATION_SITE_ID_MISMATCH',
        message: 'Path site id does not match the X-Recado-Site-Id header',
      });
    }

    const body = await readJsonBody<AdminUpdateSiteInput>(request, AdminUpdateSiteInputSchema);
    if (body.error) return err(body.error);

    const updated = await updateSiteAsAdmin(
      context.db,
      { actorId: context.actor.id, ip: clientIp(request) },
      context.site.id,
      body.data,
    );

    if (updated.error) return err(updated.error);

    return ok({ id: updated.data.id });
  },
  { operation: 'admin.sites.update' },
);

export const Route = createFileRoute('/api/v1/admin/sites/$id')({
  server: {
    middleware: [...ADMIN_API_MIDDLEWARE],
    handlers: {
      PATCH: updateSite,
      ANY: async () => methodNotAllowed(['PATCH']),
    },
  },
});
