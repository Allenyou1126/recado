/**
 * siteScopeMiddleware —— 校验主体对目标站点有权限。
 *
 * 「已登录」不等于「可访问任意站点」（硬性约束）：持有
 * `<前缀>.ADMIN.<站点A>` 的账号不能读写站点 B 的数据。
 *
 * 站点标识从环境头 `X-Recado-Site-Id`（UUID）或路径参数 `siteId` 取 ——
 * 管理端不复用公开端的 site key 解析路径：site key 是前端公开标识，
 * 管理端要的是明确的站点 UUID（决策 D17）。
 */

import { getSiteById, scopeAllowsSite } from '@recado/core';
import { createMiddleware } from '@tanstack/react-start';

import { errorResponse } from '../http/respond';
import { actorMiddleware } from './actor';

/** 管理端点声明目标站点的请求头 */
export const SITE_ID_HEADER = 'x-recado-site-id';

export const siteScopeMiddleware = createMiddleware({ type: 'request' })
  .middleware([actorMiddleware])
  .server(async ({ next, context, request }) => {
    const siteId = request.headers.get(SITE_ID_HEADER)?.trim();

    if (siteId === undefined || siteId.length === 0) {
      return errorResponse({
        reason: 'VALIDATION_SITE_ID_REQUIRED',
        message: `Missing ${SITE_ID_HEADER} header`,
      });
    }

    // 先判权限再看站点是否存在：无权限的主体不该通过错误信息探测站点是否存在
    if (!scopeAllowsSite(context.scope, siteId)) {
      context.logger.warn({ siteId, actorId: context.actor.id }, 'site scope denied');
      return errorResponse({
        reason: 'FORBIDDEN_SITE_SCOPE',
        message: 'Actor has no permission on this site',
      });
    }

    const site = await getSiteById(context.db, siteId);
    if (!site) {
      return errorResponse({ reason: 'NOT_FOUND_SITE', message: 'Site not found' });
    }

    return next({ context: { site } });
  });
