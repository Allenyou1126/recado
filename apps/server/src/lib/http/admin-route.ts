/**
 * 管理端 API 路由的骨架。
 *
 * 中间件顺序：env → db → **actor**（认证）→ **siteScope**（授权）→ **csrf**（写操作）。
 *
 * 三条与公开端不同的约定（决策 Q-12）：
 * - **不检查来源头**：脚本调用根本没有 Origin，且管理端不使用跨域凭证
 * - 目标是 `X-Recado-Site-Id` 指定的站点 UUID，而不是公开端的 site key
 * - 写操作要过 CSRF 双重提交
 */

import { actorMiddleware } from '../middleware/actor';
import { baseMiddleware } from '../middleware/base';
import { csrfMiddleware } from '../middleware/csrf';
import { dbMiddleware } from '../middleware/db';
import { siteScopeMiddleware } from '../middleware/site-scope';

export const ADMIN_API_MIDDLEWARE = [
  baseMiddleware,
  dbMiddleware,
  actorMiddleware,
  siteScopeMiddleware,
  csrfMiddleware,
] as const;

/**
 * 只需要登录、不需要站点范围的端点（`/admin/me`）用的链。
 *
 * 依赖声明要精确到最低层级：`/me` 与具体站点无关，
 * 硬塞 siteScope 会逼调用方传一个无意义的站点 id。
 */
export const ADMIN_ACTOR_MIDDLEWARE = [baseMiddleware, dbMiddleware, actorMiddleware] as const;
