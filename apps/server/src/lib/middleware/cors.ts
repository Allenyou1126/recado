/**
 * corsMiddleware —— 公开端点的跨域支持。
 *
 * 位置：`site` 之后、`origin` **之前**。放在 origin 之前是有意的 ——
 * 这样连「来源被拒」的 403 响应也能带上 CORS 头，前端才看得到我们的错误信封；
 * 若放在 origin 之后，被拒的站点只会看到浏览器那句不可读的 CORS 报错。
 *
 * 预检（`OPTIONS`）在这里直接应答，不再往下走：路由因此不必各自实现
 * `OPTIONS` 处理器，也不会误落到 `ANY → 405`。
 *
 * ⚠️ **预检必须在生产构建下验证**：`vite dev` 会拦截 `OPTIONS` 并绕过这里的处理器
 * （见 requirements.md §8.2）。对应的自动化测试在 tests/http/ 下，跑的是生产产物。
 */

import { evaluateOrigin } from '@recado/core';
import { createMiddleware } from '@tanstack/react-start';

import { preflightResponse, withCorsHeaders } from '../http/cors';
import { errorResponse } from '../http/respond';
import { siteMiddleware } from './site';

export const corsMiddleware = createMiddleware({ type: 'request' })
  .middleware([siteMiddleware])
  .server(async ({ next, context, request }) => {
    const origin = request.headers.get('origin');

    if (request.method === 'OPTIONS') {
      // 预检也走一遍来源判定：白名单之外的来源应当在这里就被挡下，
      // 而不是先放行预检、等真实请求再来一次 403
      const evaluated = evaluateOrigin(context.site, {
        origin,
        referer: request.headers.get('referer'),
      });

      if (evaluated.error) {
        context.logger.warn(
          { reason: evaluated.error.reason, siteId: context.site.id },
          'preflight rejected',
        );
        return withCorsHeaders(errorResponse(evaluated.error), origin);
      }

      return preflightResponse(origin);
    }

    const result = await next();

    return { ...result, response: withCorsHeaders(result.response, origin) };
  });
