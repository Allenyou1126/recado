import { rotateSiteKeyAsAdmin, type SiteError } from '@recado/core';
import { err, ok } from '@recado/shared';
import { createFileRoute } from '@tanstack/react-router';

import { ADMIN_API_MIDDLEWARE } from '../../../../../../lib/http/admin-route';
import { clientIp } from '../../../../../../lib/http/client-ip';
import { createHandler } from '../../../../../../lib/http/handler';
import { methodNotAllowed } from '../../../../../../lib/http/method-not-allowed';

/**
 * `POST /api/v1/admin/sites/:id/rotate-key` —— 轮换 site key。
 *
 * **旧 key 立即失效**：刻意不做新旧并行有效期，否则「轮换」就退化成
 * 「再加一个 key」，站点失去明确的失效语义。
 *
 * 这是破坏性操作，管理台必须二次确认并说明影响范围（T8.9）。
 */
const rotate = createHandler<
  AdminSiteContext,
  { key: string },
  SiteError | { reason: string; message: string },
  { id: string }
>(
  async (context, request, params) => {
    if (params.id !== context.site.id) {
      return err({
        reason: 'VALIDATION_SITE_ID_MISMATCH',
        message: 'Path site id does not match the X-Recado-Site-Id header',
      });
    }

    const rotated = await rotateSiteKeyAsAdmin(
      context.db,
      { actorId: context.actor.id, ip: clientIp(request) },
      context.site.id,
    );

    if (rotated.error) return err(rotated.error);

    return ok({ key: rotated.data.key });
  },
  { operation: 'admin.sites.rotate_key' },
);

export const Route = createFileRoute('/api/v1/admin/sites/$id/rotate-key')({
  server: {
    middleware: [...ADMIN_API_MIDDLEWARE],
    handlers: {
      POST: rotate,
      ANY: async () => methodNotAllowed(['POST']),
    },
  },
});
