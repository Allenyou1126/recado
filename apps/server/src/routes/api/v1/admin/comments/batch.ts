import { batchChangeStatus, type BatchError } from '@recado/core';
import {
  AdminBatchCommentsInputSchema,
  err,
  ok,
  type AdminBatchCommentsInput,
  type AdminBatchResult,
} from '@recado/shared';
import { createFileRoute } from '@tanstack/react-router';

import { ADMIN_API_MIDDLEWARE } from '../../../../../lib/http/admin-route';
import { clientIp } from '../../../../../lib/http/client-ip';
import { createHandler } from '../../../../../lib/http/handler';
import { methodNotAllowed } from '../../../../../lib/http/method-not-allowed';
import { readJsonBody, type RequestBodyError } from '../../../../../lib/http/request';

/**
 * `POST /api/v1/admin/comments/batch` —— 批量改状态。
 *
 * **单事务 + 部分失败明细**：服务端一次处理，不对单条端点做 `Promise.all` 扇出
 * （Waline 的做法：无批处理、无事务、无部分失败处理）。
 *
 * 存在非法项时整批不执行并返回逐条原因（409）—— 批量操作最怕「成功一半」。
 */
const batchUpdate = createHandler<
  AdminSiteContext,
  AdminBatchResult,
  RequestBodyError | BatchError
>(
  async (context, request) => {
    const body = await readJsonBody<AdminBatchCommentsInput>(
      request,
      AdminBatchCommentsInputSchema,
    );
    if (body.error) return err(body.error);

    const result = await batchChangeStatus(
      {
        db: context.db,
        site: context.site,
        actorId: context.actor.id,
        ip: clientIp(request),
      },
      body.data.ids,
      body.data.status,
    );

    if (result.error) return err(result.error);

    return ok(result.data);
  },
  { operation: 'admin.comments.batch' },
);

export const Route = createFileRoute('/api/v1/admin/comments/batch')({
  server: {
    middleware: [...ADMIN_API_MIDDLEWARE],
    handlers: {
      POST: batchUpdate,
      ANY: async () => methodNotAllowed(['POST']),
    },
  },
});
