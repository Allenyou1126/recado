/**
 * Server Function 用的主体解析中间件。
 *
 * 为什么不能复用请求中间件（actorMiddleware）：请求中间件挂在**路由**的
 * `server.middleware` 上，只对 Server Route 生效；Server Function 走的是
 * 另一条管线（`handlerType === 'serverFn'`）。而框架的全局请求中间件需要
 * 创建 `src/start.ts` —— 那是明令禁止的（会静默丢失 CSRF 保护）。
 *
 * 因此这里自包含地把整条链做完：配置 → 数据库 → 主体与权限范围。
 * 解析逻辑与 actorMiddleware 共用 `resolveActorFromRequest`，不存在两套实现。
 */

import { createMiddleware } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';

import { getEnv } from '../../config/env.server';
import { getDbClient } from '../db.server';
import { createLogger } from '../logger.server';
import { resolveRequestId } from '../request-id.server';
import { resolveActorFromRequest } from './actor-shared';

export const actorFunctionMiddleware = createMiddleware({ type: 'function' }).server(
  async ({ next }) => {
    // Server Function 的中间件拿不到 `request` 形参，只能从 h3 事件里取
    const request = getRequest();
    const env = getEnv();
    const { db } = getDbClient(env.DATABASE_URL);

    const requestId = resolveRequestId(request);
    const logger = createLogger(env, { bindings: { requestId } });

    const resolved = await resolveActorFromRequest({ env, db, request });

    if (resolved === null) {
      // Server Function 的错误以 Result 表达更麻烦，这里直接抛出并由调用方
      // （管理台 loader）捕获后跳登录页 —— 它本来就不是安全边界
      throw new Error('AUTH_REQUIRED');
    }

    return next({
      context: {
        env,
        db,
        requestId,
        logger,
        actor: resolved.actor,
        scope: resolved.scope,
        authVia: resolved.via,
        matchedRoles: resolved.matchedRoles,
      },
    });
  },
);
