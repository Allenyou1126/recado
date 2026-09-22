import { createFileRoute } from '@tanstack/react-router';

/**
 * 健康检查端点。
 *
 * 注意 `ANY` 处理器：框架对未匹配的 HTTP 方法**不会**返回 405，
 * 而是让请求落到路由层，返回 `200 text/html`（SSR 应用外壳）。
 * 因此每个 API 路由都必须显式声明 `ANY` —— 见 AGENTS.md 硬性约束。
 */
export const Route = createFileRoute('/api/v1/health')({
  server: {
    handlers: {
      GET: async () =>
        Response.json({ status: 'ok' }, { status: 200, headers: { 'Cache-Control': 'no-store' } }),

      ANY: async () =>
        new Response(null, {
          status: 405,
          headers: { Allow: 'GET, HEAD, OPTIONS' },
        }),
    },
  },
});
