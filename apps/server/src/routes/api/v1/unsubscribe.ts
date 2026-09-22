import { unsubscribeByToken } from '@recado/core';
import { createFileRoute } from '@tanstack/react-router';

import { dbMiddleware } from '../../../lib/middleware/db';

/**
 * `GET /api/v1/unsubscribe?token=…` —— 邮件里的退订链接。
 *
 * ⚠️ **这条公开端点刻意不校验 site key 与来源头**：它是在邮件客户端里点开的，
 * 既带不了自定义请求头，也未必有 Origin。凭据是 token 本身 ——
 * 不可猜测、按站点存储、长期有效（需求：每封邮件都带，不设过期）。
 *
 * 返回一张 HTML 结果页而不是 JSON：点链接的是人，不是脚本。
 */
export const Route = createFileRoute('/api/v1/unsubscribe')({
  server: {
    middleware: [dbMiddleware],
    handlers: {
      GET: async ({ context, request }) => {
        const token = new URL(request.url).searchParams.get('token') ?? '';

        if (token.length === 0) {
          return htmlPage('退订链接无效', '链接里没有退订凭据，请直接回复邮件说明。', 400);
        }

        const result = await unsubscribeByToken(context.db, token);

        if (result.error) {
          context.logger.warn('unsubscribe token not found');
          return htmlPage('退订链接无效', '这个链接无法识别，可能已被替换或拼写有误。', 404);
        }

        context.logger.info({ siteId: result.data.siteId }, 'recipient unsubscribed');

        return htmlPage(
          '已退订',
          '该邮箱不会再收到这个站点的评论通知邮件。若想重新订阅，请再次在该站点留言。',
          200,
        );
      },

      ANY: async () =>
        new Response(null, { status: 405, headers: { Allow: 'GET, HEAD, OPTIONS' } }),
    },
  },
});

/** 极简结果页：不引入模板引擎，也不需要站点样式 */
function htmlPage(title: string, message: string, status: number): Response {
  const body = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
</head>
<body style="margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:#fafafa;color:#222">
<main style="max-width:32rem;padding:2rem;text-align:center">
<h1 style="font-size:1.25rem;margin:0 0 .75rem">${title}</h1>
<p style="margin:0;color:#555;line-height:1.6">${message}</p>
</main>
</body>
</html>`;

  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
