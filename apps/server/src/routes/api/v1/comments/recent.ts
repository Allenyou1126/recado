import { listRecent } from '@recado/core';
import { err, RecentCommentsQuerySchema, type PublicComment } from '@recado/shared';
import { createFileRoute } from '@tanstack/react-router';

import { PUBLIC_API_MIDDLEWARE } from '../../../../lib/http/api-route';
import { createHandler } from '../../../../lib/http/handler';
import { methodNotAllowed } from '../../../../lib/http/method-not-allowed';
import { readQuery, type RequestBodyError } from '../../../../lib/http/request';

/**
 * 最近评论：`GET /api/v1/comments/recent?limit=10`。
 *
 * 跨 path，供「最新评论」侧边栏组件使用（M2 P1，但实现成本极低且被后台概览复用）。
 */
const getRecent = createHandler<SiteContext, PublicComment[], RequestBodyError>(
  async (context, request) => {
    const query = readQuery<{ limit: number }>(request, RecentCommentsQuerySchema);
    if (query.error) return err(query.error);

    return listRecent({ db: context.db, site: context.site }, query.data.limit);
  },
  { operation: 'comments.recent' },
);

export const Route = createFileRoute('/api/v1/comments/recent')({
  server: {
    middleware: [...PUBLIC_API_MIDDLEWARE],
    handlers: {
      GET: getRecent,
      ANY: async () => methodNotAllowed(['GET']),
    },
  },
});
