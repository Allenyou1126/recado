import { resolveEmojiMap, siteSettings, toPublicSiteConfig, type SiteError } from '@recado/core';
import { ok, type PublicSiteConfig } from '@recado/shared';
import { createFileRoute } from '@tanstack/react-router';

import { PUBLIC_API_MIDDLEWARE } from '../../../lib/http/api-route';
import { createHandler } from '../../../lib/http/handler';
import { methodNotAllowed } from '../../../lib/http/method-not-allowed';

/**
 * 站点公开配置：`GET /api/v1/config`。
 *
 * 前端拿它一次拿到渲染评论区所需的全部信息（深度、字数上限、分页、表情包、
 * 必填字段），避免把站点配置硬编码进前端或额外开一堆细粒度端点。
 *
 * 响应**显式构造**：`settings` 里同时住着 `notifyEmails`、`smtp` 这类内部配置，
 * 直接透传数据库行迟早会泄漏（见 .specs/development-standards.md §8.1）。
 */

const getConfig = createHandler<SiteContext, PublicSiteConfig, SiteError>(
  async (context) => {
    const settings = siteSettings(context.site);

    // 合并内置表情包与站点自定义包；前端只需拿到最终映射
    const emojis = resolveEmojiMap(settings.emojis);

    return ok(toPublicSiteConfig(context.site, emojis));
  },
  { operation: 'site.config' },
);

export const Route = createFileRoute('/api/v1/config')({
  server: {
    middleware: [...PUBLIC_API_MIDDLEWARE],
    handlers: {
      GET: getConfig,

      // 未匹配的方法不会自动 405，必须显式兜住（AGENTS.md 硬性约束）
      ANY: async () => methodNotAllowed(['GET']),
    },
  },
});
