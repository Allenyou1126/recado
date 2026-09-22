/**
 * csrfMiddleware —— 管理端写操作的 CSRF 防护。
 *
 * **Server Route 默认不受框架 CSRF 保护**（框架的中间件只过滤 Server Function），
 * 所以这里必须自己做（硬性约束 / §8.4）。
 *
 * 两道校验：
 *
 * 1. **Origin 校验**：来源必须是同源（或显式配置的管理台地址）
 * 2. **双重提交**：Cookie 里的 `recado_csrf` 与请求头 `X-Recado-CSRF-Token` 必须一致
 *
 * ⚠️ **只对 Cookie 认证生效**：Bearer 认证没有「浏览器自动携带凭证」的问题，
 * 强制它带 CSRF 头只会让脚本调用无谓地复杂。
 * ⚠️ 登录 / 回调 / 登出这三条路由**不能**挂这个中间件 —— 登录时还没有会话与 CSRF
 * Cookie，挂上会导致永远无法登录。
 */

import { createMiddleware } from '@tanstack/react-start';

import { readCookie } from '../cookies.server';
import { errorResponse } from '../http/respond';
import { actorMiddleware } from './actor';

/** CSRF 双重提交用的 Cookie 与请求头名 */
export const CSRF_COOKIE = 'recado_csrf';
export const CSRF_HEADER = 'x-recado-csrf-token';

/** 需要防护的方法（安全方法按 RFC 9110 直接放行） */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const csrfMiddleware = createMiddleware({ type: 'request' })
  // 声明对 actor 的依赖：既要拿到认证来源，也让 context 带上完整类型
  .middleware([actorMiddleware])
  .server(async ({ next, context, request }) => {
    if (!UNSAFE_METHODS.has(request.method.toUpperCase())) {
      return next();
    }

    // 只有 Cookie 认证需要 CSRF 防护
    if (context.authVia !== 'cookie') {
      return next();
    }

    const origin = request.headers.get('origin');

    if (origin !== null && !isSameOrigin(origin, request)) {
      context.logger.warn({ origin }, 'csrf origin mismatch');
      return errorResponse({ reason: 'FORBIDDEN_ORIGIN_NOT_ALLOWED', message: 'Origin mismatch' });
    }

    const cookieToken = readCookie(request, CSRF_COOKIE);
    const headerToken = request.headers.get(CSRF_HEADER)?.trim();

    if (cookieToken === null || headerToken === undefined || cookieToken !== headerToken) {
      context.logger.warn('csrf token mismatch');
      return errorResponse({
        reason: 'FORBIDDEN_CSRF_TOKEN_INVALID',
        message: 'CSRF token mismatch',
      });
    }

    return next();
  });

/** 同源判定：协议 + 主机 + 端口一致 */
function isSameOrigin(origin: string, request: Request): boolean {
  try {
    const target = new URL(request.url);
    const source = new URL(origin);

    return source.protocol === target.protocol && source.host === target.host;
  } catch {
    return false;
  }
}
