/**
 * originMiddleware —— 公开端点的来源校验。
 *
 * 判定规则集中在 `@recado/core` 的 `evaluateOrigin`（纯函数、可单测），
 * 这里只负责取头、映射错误与注入结果 —— 不要在路由里各写一遍
 * （见 .specs/development-standards.md §8.5）。
 *
 * ⚠️ 管理端点**不检查来源头**（决策 Q-12），因此管理端点不要挂本中间件。
 * ⚠️ 来源校验挡不住有意的服务端伪造（curl 就能伪造 Origin），
 * 真正的防线是限流与人工审核。
 */

import { evaluateOrigin } from '@recado/core';
import { createMiddleware } from '@tanstack/react-start';

import { errorResponse } from '../http/respond';
import { recordOriginRejection } from '../origin-audit.server';
import { siteMiddleware } from './site';

export const originMiddleware = createMiddleware({ type: 'request' })
  .middleware([siteMiddleware])
  .server(async ({ next, context, request }) => {
    const evaluated = evaluateOrigin(context.site, {
      origin: request.headers.get('origin'),
      referer: request.headers.get('referer'),
    });

    if (evaluated.error) {
      context.logger.warn(
        { reason: evaluated.error.reason, siteId: context.site.id },
        'origin rejected',
      );

      // 自检工具的数据来源：站长看不到访客的控制台，只能靠这里
      recordOriginRejection({
        siteId: context.site.id,
        origin:
          evaluated.error.details !== undefined &&
          typeof evaluated.error.details === 'object' &&
          evaluated.error.details !== null &&
          'origin' in evaluated.error.details
            ? String(Reflect.get(evaluated.error.details, 'origin'))
            : (request.headers.get('origin') ?? request.headers.get('referer')),
        reason: evaluated.error.reason,
        path: new URL(request.url).pathname,
      });

      return errorResponse(evaluated.error);
    }

    return next({ context: { origin: evaluated.data } });
  });
