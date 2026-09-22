import { startSession } from '@recado/core';
import { createFileRoute } from '@tanstack/react-router';

import {
  OIDC_FLOW_COOKIE,
  SESSION_COOKIE,
  readCookie,
  serializeCookie,
  verifySignedValue,
} from '../../lib/cookies.server';
import { clientIp } from '../../lib/http/client-ip';
import { errorResponse } from '../../lib/http/respond';
import { dbMiddleware } from '../../lib/middleware/db';
import { completeAuthorization } from '../../lib/oidc.server';

/**
 * `GET /auth/callback` —— OIDC 回调。
 *
 * ⚠️ 无匹配角色时**拒绝登录且不建会话**（决策 Q-17）。这是安全语义：
 * 「登录成功但没有权限」与「没有登录」在服务端必须表现一致，
 * 否则就留下了一个「半登录」状态。
 *
 * 失败一律回到登录页并附错误码，不把 IdP 的原始错误透给浏览器。
 */

export const Route = createFileRoute('/auth/callback')({
  server: {
    middleware: [dbMiddleware],
    handlers: {
      GET: async ({ context, request }) => {
        const url = new URL(request.url);
        const flowCookie = readCookie(request, OIDC_FLOW_COOKIE);

        if (flowCookie === null) {
          return errorResponse(
            { reason: 'AUTH_OIDC_FAILED', message: 'Missing OIDC flow cookie' },
            { status: 400 },
          );
        }

        const raw = verifySignedValue(flowCookie, context.env.SESSION_SECRET);
        if (raw === null) {
          return errorResponse(
            { reason: 'AUTH_OIDC_FAILED', message: 'Invalid OIDC flow cookie' },
            { status: 400 },
          );
        }

        const checks: unknown = JSON.parse(raw);
        if (
          typeof checks !== 'object' ||
          checks === null ||
          typeof Reflect.get(checks, 'state') !== 'string' ||
          typeof Reflect.get(checks, 'nonce') !== 'string' ||
          typeof Reflect.get(checks, 'codeVerifier') !== 'string'
        ) {
          return errorResponse(
            { reason: 'AUTH_OIDC_FAILED', message: 'Malformed OIDC flow state' },
            { status: 400 },
          );
        }

        const completed = await completeAuthorization(context.env, url.href, {
          state: String(Reflect.get(checks, 'state')),
          nonce: String(Reflect.get(checks, 'nonce')),
          codeVerifier: String(Reflect.get(checks, 'codeVerifier')),
        });

        if (completed.error) {
          context.logger.warn({ reason: completed.error.reason }, 'oidc callback failed');
          return errorResponse(completed.error);
        }

        const session = await startSession(context.db, {
          identity: completed.data.identity,
          roles: completed.data.roles,
          rolePrefix: context.env.OIDC_ROLE_PREFIX,
          ttlSeconds: context.env.SESSION_TTL_HOURS * 3600,
          ip: clientIp(request),
          userAgent: request.headers.get('user-agent'),
        });

        if (session.error) {
          // 无匹配角色：明确告知，但不产生任何会话
          context.logger.warn({ reason: session.error.reason }, 'login rejected');
          return errorResponse(session.error, { status: 403 });
        }

        context.logger.info(
          { adminId: session.data.actor.actor.id, roles: session.data.actor.matchedRoles },
          'admin logged in',
        );

        const headers = new Headers({ location: '/admin', 'cache-control': 'no-store' });

        headers.append(
          'set-cookie',
          serializeCookie(SESSION_COOKIE, session.data.token, {
            httpOnly: true,
            secure: context.env.NODE_ENV === 'production',
            sameSite: 'Lax',
            maxAgeSeconds: context.env.SESSION_TTL_HOURS * 3600,
          }),
        );

        // 流程态用完即弃
        headers.append(
          'set-cookie',
          serializeCookie(OIDC_FLOW_COOKIE, '', { maxAgeSeconds: 0, path: '/' }),
        );

        return new Response(null, { status: 302, headers });
      },

      ANY: async () =>
        new Response(null, { status: 405, headers: { Allow: 'GET, HEAD, OPTIONS' } }),
    },
  },
});
