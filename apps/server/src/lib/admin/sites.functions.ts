import { listVisibleSites } from '@recado/core';
import type { Database } from '@recado/db';
import { createServerFn } from '@tanstack/react-start';

import { actorFunctionMiddleware } from '../middleware/actor-function';

/**
 * 站点列表（SSR 数据加载）。
 *
 * 与 `/api/v1/admin/sites` 的区别：这条走 Server Function，只服务管理台自己的
 * 页面加载，享受端到端类型安全；对外形态仍在 Server Route 上（§4.4）。
 */
export const listSitesFn = createServerFn({ method: 'GET' })
  .middleware([actorFunctionMiddleware])
  .handler(async ({ context }) => {
    const admin = context as unknown as {
      db: Database;
      scope: { type: 'instance' } | { type: 'site'; siteIds: string[] };
    };

    const { sites, total } = await listVisibleSites(admin.db, admin.scope, {
      limit: 100,
      offset: 0,
    });

    return {
      sites: sites.map((site) => ({
        id: site.id,
        name: site.name,
        status: site.status,
        key: site.key,
        allowedOrigins: site.allowedOrigins,
      })),
      total,
    };
  });
