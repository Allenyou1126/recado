/**
 * siteMiddleware —— 由 `X-Recado-Site` 解析站点。
 *
 * site key 是**公开标识，不是密钥**：它只用来选出「这次请求属于哪个站点」。
 * 真正的跨域防线是来源白名单（originMiddleware）与限流 + 人工审核，
 * 部署文档会明确写出这一威胁模型，不制造虚假安全感
 * （见 .specs/requirements.md §7.1）。
 */

import { resolveActiveSiteByKey } from '@recado/core';
import { createMiddleware } from '@tanstack/react-start';

import { errorResponse } from '../http/respond';
import { dbMiddleware } from './db';

/** 站点标识请求头（公开端点用） */
export const SITE_KEY_HEADER = 'x-recado-site';

export const siteMiddleware = createMiddleware({ type: 'request' })
  .middleware([dbMiddleware])
  .server(async ({ next, context, request }) => {
    const resolved = await resolveActiveSiteByKey(context.db, request.headers.get(SITE_KEY_HEADER));

    if (resolved.error) {
      // 只记 reason，不记 key 本身 —— 日志里不出现站点标识原文
      context.logger.warn({ reason: resolved.error.reason }, 'site resolution failed');
      return errorResponse(resolved.error);
    }

    return next({ context: { site: resolved.data } });
  });
