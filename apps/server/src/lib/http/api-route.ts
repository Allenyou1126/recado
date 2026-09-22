/**
 * 公开 API 路由的骨架。
 *
 * 把「公开端点必须挂哪几条中间件」收敛到一处：单条路由漏挂某一环时，
 * 表现往往是**静默的**（比如漏了 originMiddleware 就少了一道来源校验），
 * 集中声明比逐条复制粘贴可靠。
 *
 * ⚠️ 顺序即执行顺序，且不可调换 `cors` 与 `origin`：
 * cors 必须在 origin **之前**，否则来源被拒的 403 不带 CORS 头，
 * 前端只能看到浏览器那句不可读的报错。
 */

import { baseMiddleware } from '../middleware/base';
import { corsMiddleware } from '../middleware/cors';
import { dbMiddleware } from '../middleware/db';
import { originMiddleware } from '../middleware/origin';
import { siteMiddleware } from '../middleware/site';

/**
 * 公开端点的标准中间件链：env → db → site → cors → origin。
 *
 * 用 `as const` 保留元组类型：框架靠中间件的 `~types` 推导 handler 的
 * `ctx.context`，退化成普通数组会让类型提示全丢。
 */
export const PUBLIC_API_MIDDLEWARE = [
  baseMiddleware,
  dbMiddleware,
  siteMiddleware,
  corsMiddleware,
  originMiddleware,
] as const;
