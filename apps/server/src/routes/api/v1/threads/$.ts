import { getThreadMeta, type SiteError, type ThreadMeta } from '@recado/core';
import { domainError, err, type DomainError } from '@recado/shared';
import { createFileRoute } from '@tanstack/react-router';

import { PUBLIC_API_MIDDLEWARE } from '../../../../lib/http/api-route';
import { createHandler } from '../../../../lib/http/handler';
import { methodNotAllowed } from '../../../../lib/http/method-not-allowed';

/** 本路由可能的失败：没给出 path（校验错）或站点解析失败 */
type ThreadMetaError = SiteError | DomainError<'VALIDATION_INVALID_QUERY'>;

/**
 * 线程元信息：`GET /api/v1/threads/<path>`。
 *
 * 用 splat 路由（`/threads/*`）而不是 `:path`：文章标识本身**含斜杠**
 * （默认取 `location.pathname`，形如 `/posts/hello`），
 * 普通动态段只能匹配一段，会把 `/posts` 与 `/hello` 拆开。
 *
 * 没有评论过的文章返回零值而不是 404 —— 那是正常状态，前端不必写分支。
 */
const getMeta = createHandler<SiteContext, ThreadMeta, ThreadMetaError, { _splat?: string }>(
  async (context, _request, params) => {
    const path = params._splat;

    if (path === undefined || path.length === 0) {
      return err(domainError('VALIDATION_INVALID_QUERY', 'Missing thread path'));
    }

    // splat 不带前导斜杠，补回来以对齐前端上报的 `location.pathname`
    return getThreadMeta(context.db, context.site.id, `/${path}`);
  },
  { operation: 'threads.meta' },
);

export const Route = createFileRoute('/api/v1/threads/$')({
  server: {
    middleware: [...PUBLIC_API_MIDDLEWARE],
    handlers: {
      GET: getMeta,
      ANY: async () => methodNotAllowed(['GET']),
    },
  },
});
