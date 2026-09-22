/**
 * actorMiddleware —— 管理端点的主体解析。
 *
 * 两条认证路径（决策 D16 / Q-07）：
 *
 * | 来源 | 凭证 | 权限来源 |
 * | --- | --- | --- |
 * | 浏览器 | 会话 Cookie（不透明 token，服务端存哈希） | 登录时写入会话的角色快照 |
 * | 脚本 / CI | `Authorization: Bearer <OIDC access token>` | **每次验签现算** |
 *
 * ⚠️ 管理端点**不检查来源头**（决策 Q-12）：它们不使用 Cookie 之外的跨域凭证，
 * 且脚本调用根本没有 Origin。CSRF 由 csrfMiddleware 单独负责。
 */

import { authorizeBearer, resolveSessionActor, type SessionActor } from '@recado/core';
import { err } from '@recado/shared';
import { createMiddleware } from '@tanstack/react-start';

import { SESSION_COOKIE, readCookie } from '../cookies.server';
import { errorResponse } from '../http/respond';
import { verifyBearerToken } from '../oidc.server';
import { dbMiddleware } from './db';

/** 从 `Authorization: Bearer <token>` 里取 token */
export function readBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header === null) return null;

  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== 'bearer') return null;

  const token = rest.join('').trim();
  return token.length > 0 ? token : null;
}

export type ActorResolution =
  | { via: 'cookie'; result: Awaited<ReturnType<typeof resolveSessionActor>> }
  | { via: 'bearer'; result: Awaited<ReturnType<typeof authorizeBearer>> }
  | { via: 'none' };

/** 解析主体；供中间件与测试复用 */
export async function resolveActor(context: DbContext, request: Request): Promise<ActorResolution> {
  const bearer = readBearerToken(request);

  if (bearer !== null) {
    const verified = await verifyBearerToken(context.env, bearer);
    if (verified.error) return { via: 'bearer', result: err(verified.error) };

    return {
      via: 'bearer',
      result: await authorizeBearer(context.db, {
        identity: verified.data.identity,
        roles: verified.data.roles,
        rolePrefix: context.env.OIDC_ROLE_PREFIX,
      }),
    };
  }

  const cookie = readCookie(request, SESSION_COOKIE);
  if (cookie === null) return { via: 'none' };

  return {
    via: 'cookie',
    result: await resolveSessionActor(context.db, cookie, context.env.OIDC_ROLE_PREFIX),
  };
}

export const actorMiddleware = createMiddleware({ type: 'request' })
  .middleware([dbMiddleware])
  .server(async ({ next, context, request }) => {
    const resolved = await resolveActor(context, request);

    if (resolved.via === 'none') {
      context.logger.warn('admin request without credentials');
      return errorResponse({
        reason: 'AUTH_SESSION_INVALID',
        message: 'Authentication required',
      });
    }

    if (resolved.result.error) {
      context.logger.warn({ reason: resolved.result.error.reason }, 'actor resolution failed');
      return errorResponse(resolved.result.error);
    }

    const actor: SessionActor = resolved.result.data;

    return next({
      context: {
        actor: actor.actor,
        scope: actor.scope,
        // 认证来源要传给 CSRF 中间件：只有 Cookie 认证才需要双重提交校验
        authVia: resolved.via,
      },
    });
  });
