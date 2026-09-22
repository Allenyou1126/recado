import { checkRateLimit, createComment, listComments, type CommentError } from '@recado/core';
import {
  CreateCommentInputSchema,
  err,
  ListCommentsQuerySchema,
  type CommentPage,
  type CreateCommentInput,
  type ListCommentsQuery,
  type PublicComment,
} from '@recado/shared';
import { createFileRoute } from '@tanstack/react-router';

import { PUBLIC_API_MIDDLEWARE } from '../../../../lib/http/api-route';
import { clientIp } from '../../../../lib/http/client-ip';
import { createHandler } from '../../../../lib/http/handler';
import { methodNotAllowed } from '../../../../lib/http/method-not-allowed';
import { readJsonBody, readQuery, type RequestBodyError } from '../../../../lib/http/request';

/**
 * 评论列表与发表：`GET|POST /api/v1/comments`。
 *
 * 两条都是**公开端点**（site key + 来源校验），用 Server Route 而不是 Server Function ——
 * Server Function 有 4 重阻断，第三方站点根本调不通（requirements.md §8.2）。
 *
 * 列表只返回 `approved`（以及「已删除但仍留有回复」的占位）；
 * `pending` / `spam` 永远不出现在公开响应里。
 */

type CreateRouteError = RequestBodyError | CommentError;

const postComment = createHandler<SiteContext, PublicComment, CreateRouteError>(
  async (context, request) => {
    const body = await readJsonBody<CreateCommentInput>(request, CreateCommentInputSchema);
    if (body.error) return err(body.error);

    const ip = clientIp(request);

    // 限流属于可用性保护（M5），失败时给出重试间隔
    const limited = await checkRateLimit({ db: context.db, site: context.site }, ip);
    if (limited.error) return err(limited.error);

    return createComment(
      { db: context.db, site: context.site },
      {
        path: body.data.path,
        content: body.data.content,
        email: body.data.email,
        nickname: body.data.nickname,
        website: body.data.website,
        parentId: body.data.parentId,
        url: body.data.url,
        title: body.data.title,
        ip,
        userAgent: request.headers.get('user-agent'),
      },
    );
  },
  { operation: 'comments.create', successStatus: 201 },
);

const getComments = createHandler<SiteContext, CommentPage, RequestBodyError>(
  async (context, request) => {
    const query = readQuery<ListCommentsQuery>(request, ListCommentsQuerySchema);
    if (query.error) return err(query.error);

    return listComments(
      { db: context.db, site: context.site },
      {
        path: query.data.path,
        threadId: query.data.threadId,
        sort: query.data.sort,
        page: query.data.page,
        pageSize: query.data.pageSize,
      },
    );
  },
  { operation: 'comments.list' },
);

export const Route = createFileRoute('/api/v1/comments/')({
  server: {
    middleware: [...PUBLIC_API_MIDDLEWARE],
    handlers: {
      GET: getComments,
      POST: postComment,

      // 未匹配的方法不会自动 405，必须显式兜住（AGENTS.md 硬性约束）
      ANY: async () => methodNotAllowed(['GET', 'POST']),
    },
  },
});
