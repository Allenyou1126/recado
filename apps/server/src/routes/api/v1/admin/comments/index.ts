import { listCommentsForAdmin, siteSettings } from '@recado/core';
import {
  AdminListCommentsQuerySchema,
  err,
  type AdminCommentPage,
  type AdminListCommentsQuery,
} from '@recado/shared';
import { createFileRoute } from '@tanstack/react-router';

import { ADMIN_API_MIDDLEWARE } from '../../../../../lib/http/admin-route';
import { createHandler } from '../../../../../lib/http/handler';
import { methodNotAllowed } from '../../../../../lib/http/method-not-allowed';
import { readQuery, type RequestBodyError } from '../../../../../lib/http/request';

/**
 * `GET /api/v1/admin/comments` —— 后台评论列表。
 *
 * 全维度筛选：站点（由 `X-Recado-Site-Id` 决定）+ 路径 + 状态 + 关键词 + 时间范围。
 * Waline 的管理台**没有任何路径/站点筛选**，这是明确要补的短板。
 *
 * 与公开列表的三点不同：
 * - 能看到 `pending` / `spam` / `deleted`
 * - 能看到 `email` / `ip` / `user_agent`（§5.2：仅管理员可见）
 * - 关键词查的是**原文** `content_md`（一期 ILIKE，Q-15）
 */
const listComments = createHandler<AdminSiteContext, AdminCommentPage, RequestBodyError>(
  async (context, request) => {
    const query = readQuery<AdminListCommentsQuery>(request, AdminListCommentsQuerySchema);
    if (query.error) return err(query.error);

    const settings = siteSettings(context.site);
    const pageSize = Math.min(query.data.pageSize ?? settings.pageSize, settings.maxPageSize);

    return {
      data: await listCommentsForAdmin(
        { db: context.db, site: context.site },
        {
          path: query.data.path,
          status: query.data.status,
          keyword: query.data.keyword,
          from: parseDate(query.data.from),
          to: parseDate(query.data.to),
          sort: query.data.sort,
          page: query.data.page,
          pageSize,
        },
      ),
      error: null,
    };
  },
  { operation: 'admin.comments.list' },
);

/** 时间范围筛选：非法日期按「不筛选」处理，而不是 500 */
function parseDate(value: string | undefined): Date | undefined {
  if (value === undefined) return undefined;

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export const Route = createFileRoute('/api/v1/admin/comments/')({
  server: {
    middleware: [...ADMIN_API_MIDDLEWARE],
    handlers: {
      GET: listComments,
      ANY: async () => methodNotAllowed(['GET']),
    },
  },
});
