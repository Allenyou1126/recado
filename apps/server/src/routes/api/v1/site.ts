import { ok } from '@recado/shared';
import { createFileRoute } from '@tanstack/react-router';

import { PUBLIC_API_MIDDLEWARE } from '../../../lib/http/api-route';
import { createHandler } from '../../../lib/http/handler';
import { methodNotAllowed } from '../../../lib/http/method-not-allowed';

/**
 * 示例受保护路由 —— 阶段 0 用来验证整条中间件链：
 *
 * - 缺 / 错 site key → 统一错误信封（400 / 404）
 * - 站点被停用 → 403
 * - 非白名单来源 → 403
 * - 正确请求 → 200 + `{ data }`
 *
 * 只返回**显式构造**的公开字段：站点 id 与展示名。
 * 绝不把数据库行透传出去（邮箱、配置、SMTP 密码都在同一行里）。
 *
 * 阶段 3 的 `GET /api/v1/config` 会取代它，届时本路由删除。
 */

type PublicSite = {
  id: string;
  name: string;
  status: 'active' | 'disabled';
};

const getSite = createHandler<SiteContext, PublicSite, never>(
  async (context) =>
    ok({
      id: context.site.id,
      name: context.site.name,
      status: context.site.status,
    }),
  { operation: 'site.self' },
);

export const Route = createFileRoute('/api/v1/site')({
  server: {
    // 顺序即执行顺序：env → db → site → origin
    middleware: [...PUBLIC_API_MIDDLEWARE],
    handlers: {
      GET: getSite,

      // 未匹配的方法不会自动 405，必须显式兜住（AGENTS.md 硬性约束）
      ANY: async () => methodNotAllowed(['GET']),
    },
  },
});
