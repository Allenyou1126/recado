import { listCommentReplies, type CommentError } from '@recado/core';
import { err, ListRepliesQuerySchema, type ListRepliesQuery, type ReplyPage } from '@recado/shared';
import { createFileRoute } from '@tanstack/react-router';

import { PUBLIC_API_MIDDLEWARE } from '../../../../../lib/http/api-route';
import { createHandler } from '../../../../../lib/http/handler';
import { methodNotAllowed } from '../../../../../lib/http/method-not-allowed';
import { readQuery, type RequestBodyError } from '../../../../../lib/http/request';

/**
 * 回复分页：`GET /api/v1/comments/:id/replies`。
 *
 * 这是相对 Waline 的关键改进：Waline 把单页所有回复一次性无界加载，
 * 热门文章的回复既无法分页也无法懒加载。这里回复**独立分页**，
 * 不受顶层评论分页影响（M2）。
 *
 * 返回 `flat` 形态（每条带 `parentId`），前端自行组装树 ——
 * `tree` 形态属 P1。
 */
const getReplies = createHandler<
  SiteContext,
  ReplyPage,
  RequestBodyError | CommentError,
  { id: string }
>(
  async (context, request, params) => {
    const query = readQuery<ListRepliesQuery>(request, ListRepliesQuerySchema);
    if (query.error) return err(query.error);

    return listCommentReplies({ db: context.db, site: context.site }, params.id, {
      sort: query.data.sort,
      page: query.data.page,
      pageSize: query.data.pageSize,
    });
  },
  { operation: 'comments.replies' },
);

export const Route = createFileRoute('/api/v1/comments/$id/replies')({
  server: {
    middleware: [...PUBLIC_API_MIDDLEWARE],
    handlers: {
      GET: getReplies,
      ANY: async () => methodNotAllowed(['GET']),
    },
  },
});
