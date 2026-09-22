import { countComments } from '@recado/core';
import { CountCommentsQuerySchema, err, type CommentCounts } from '@recado/shared';
import { createFileRoute } from '@tanstack/react-router';

import { PUBLIC_API_MIDDLEWARE } from '../../../../lib/http/api-route';
import { createHandler } from '../../../../lib/http/handler';
import { methodNotAllowed } from '../../../../lib/http/method-not-allowed';
import { readQuery, type RequestBodyError } from '../../../../lib/http/request';

/**
 * 批量评论数：`GET /api/v1/comments/count?paths=a,b,c`。
 *
 * 走 `threads.comment_count` 物化计数，100 个 path 也是一次查询
 * （§7.2 的目标：100 个 path < 100ms）。不存在的 path 返回 0 而不是缺项 ——
 * 前端遍历请求结果时不必区分「没有这条」与「这条没人评论」。
 */
const getCounts = createHandler<SiteContext, CommentCounts, RequestBodyError>(
  async (context, request) => {
    const query = readQuery<{ paths: string[] }>(request, CountCommentsQuerySchema);
    if (query.error) return err(query.error);

    return countComments({ db: context.db, site: context.site }, query.data.paths);
  },
  { operation: 'comments.count' },
);

export const Route = createFileRoute('/api/v1/comments/count')({
  server: {
    middleware: [...PUBLIC_API_MIDDLEWARE],
    handlers: {
      GET: getCounts,
      ANY: async () => methodNotAllowed(['GET']),
    },
  },
});
