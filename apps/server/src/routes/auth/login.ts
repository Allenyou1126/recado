import { createFileRoute } from '@tanstack/react-router';

import { OIDC_FLOW_COOKIE, serializeCookie, signValue } from '../../lib/cookies.server';
import { baseMiddleware } from '../../lib/middleware/base';
import { createAuthorizationRequest } from '../../lib/oidc.server';

/**
 * `GET /auth/login` —— 302 到 IdP。
 *
 * OIDC 流程态（state / nonce / PKCE verifier）放在**签名过的短时效 Cookie** 里：
 * 无状态、不需要额外的服务端存储，又不能被篡改。有效期 10 分钟够走完一次登录，
 * 也限制了流程态被长期持有的风险。
 *
 * ⚠️ 这条路由**不能**挂 actor/siteScope/CSRF 中间件：此刻用户还没有会话与
 * CSRF Cookie，挂上会导致永远无法登录。
 */

const FLOW_TTL_SECONDS = 600;

export const Route = createFileRoute('/auth/login')({
  server: {
    // 只需要 env / requestId / logger —— 登录阶段还没有站点上下文
    middleware: [baseMiddleware],
    handlers: {
      GET: async ({ context }) => {
        const request = await createAuthorizationRequest(context.env);

        const flow = signValue(
          JSON.stringify({
            state: request.state,
            nonce: request.nonce,
            codeVerifier: request.codeVerifier,
          }),
          context.env.SESSION_SECRET,
        );

        const headers = new Headers({
          location: request.url,
          'cache-control': 'no-store',
        });

        headers.append(
          'set-cookie',
          serializeCookie(OIDC_FLOW_COOKIE, flow, {
            httpOnly: true,
            secure: context.env.NODE_ENV === 'production',
            sameSite: 'Lax',
            maxAgeSeconds: FLOW_TTL_SECONDS,
          }),
        );

        return new Response(null, { status: 302, headers });
      },

      ANY: async () =>
        new Response(null, { status: 405, headers: { Allow: 'GET, HEAD, OPTIONS' } }),
    },
  },
});
