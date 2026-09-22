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

import type { SessionActor } from '@recado/core';
import { createMiddleware } from '@tanstack/react-start';

import { errorResponse } from '../http/respond';
import { resolveActorFromRequest } from './actor-shared';
import { dbMiddleware } from './db';

export const actorMiddleware = createMiddleware({ type: 'request' })
  .middleware([dbMiddleware])
  .server(async ({ next, context, request }) => {
    const resolved = await resolveActorFromRequest({
      env: context.env,
      db: context.db,
      request,
    });

    if (resolved === null) {
      context.logger.warn('admin request without credentials');
      return errorResponse({
        reason: 'AUTH_SESSION_INVALID',
        message: 'Authentication required',
      });
    }

    const actor: SessionActor = resolved;

    return next({
      context: {
        actor: actor.actor,
        scope: actor.scope,
        // 认证来源要传给 CSRF 中间件：只有 Cookie 认证才需要双重提交校验
        authVia: resolved.via,
        matchedRoles: actor.matchedRoles,
      },
    });
  });
