import { findOutboxItem, retryOutboxItem } from '@recado/core';
import { err, ok } from '@recado/shared';
import { createFileRoute } from '@tanstack/react-router';

import { ADMIN_API_MIDDLEWARE } from '../../../../../../lib/http/admin-route';
import { createHandler } from '../../../../../../lib/http/handler';
import { methodNotAllowed } from '../../../../../../lib/http/method-not-allowed';

/**
 * `POST /api/v1/admin/outbox/:id/retry` —— 手动重发。
 *
 * 只允许重发 `failed` 的任务：`sent` 重发会重复打扰收件人，
 * `queued` 本来就会被 worker 取走。
 */
const retry = createHandler<
  AdminSiteContext,
  { retried: boolean },
  { reason: string; message: string },
  { id: string }
>(
  async (context, _request, params) => {
    const item = await findOutboxItem(context.db, params.id);

    // 先确认这条任务属于本站点：跨站重发是典型的越权路径
    if (!item || item.siteId !== context.site.id) {
      return err({ reason: 'NOT_FOUND_OUTBOX', message: 'Outbox item not found' });
    }

    const retried = await retryOutboxItem(context.db, context.site.id, params.id);

    if (!retried) {
      return err({
        reason: 'CONFLICT_OUTBOX_NOT_RETRYABLE',
        message: 'Only failed deliveries can be retried',
      });
    }

    return ok({ retried: true });
  },
  { operation: 'admin.outbox.retry' },
);

export const Route = createFileRoute('/api/v1/admin/outbox/$id/retry')({
  server: {
    middleware: [...ADMIN_API_MIDDLEWARE],
    handlers: {
      POST: retry,
      ANY: async () => methodNotAllowed(['POST']),
    },
  },
});
