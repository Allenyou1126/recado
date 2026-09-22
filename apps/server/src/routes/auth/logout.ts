import { endSession } from '@recado/core';
import { createFileRoute } from '@tanstack/react-router';

import { SESSION_COOKIE, readCookie, serializeCookie } from '../../lib/cookies.server';
import { dbMiddleware } from '../../lib/middleware/db';

/**
 * `POST /auth/logout` —— 本地登出。
 *
 * 会话是服务端状态，因此登出必须**吊销服务端会话行**，而不只是清 Cookie ——
 * 否则被复制走的 Cookie 在有效期內仍然可用（对比 Waline 的 JWT：清掉本地存储
 * 就等于登出，token 本身依旧有效）。
 *
 * RP-Initiated Logout（跳回 IdP 一并登出）属 P1，`buildLogoutUrl` 已留好入口。
 */
export const Route = createFileRoute('/auth/logout')({
  server: {
    middleware: [dbMiddleware],
    handlers: {
      POST: async ({ context, request }) => {
        const token = readCookie(request, SESSION_COOKIE);

        if (token !== null) {
          await endSession(context.db, token);
          context.logger.info('admin logged out');
        }

        const headers = new Headers({ 'cache-control': 'no-store' });
        headers.append('set-cookie', serializeCookie(SESSION_COOKIE, '', { maxAgeSeconds: 0 }));

        return new Response(null, { status: 204, headers });
      },

      ANY: async () => new Response(null, { status: 405, headers: { Allow: 'POST, OPTIONS' } }),
    },
  },
});
