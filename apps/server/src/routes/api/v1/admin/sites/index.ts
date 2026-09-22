import { createSiteAsAdmin, listVisibleSites, type SiteError } from '@recado/core';
import {
  AdminCreateSiteInputSchema,
  domainError,
  err,
  ok,
  type AdminCreateSiteInput,
  type DomainError,
} from '@recado/shared';
import { createFileRoute } from '@tanstack/react-router';

import { ADMIN_ACTOR_MIDDLEWARE } from '../../../../../lib/http/admin-route';
import { clientIp } from '../../../../../lib/http/client-ip';
import { createHandler } from '../../../../../lib/http/handler';
import { methodNotAllowed } from '../../../../../lib/http/method-not-allowed';
import { readJsonBody, type RequestBodyError } from '../../../../../lib/http/request';

/**
 * `GET|POST /api/v1/admin/sites` —— 站点列表 / 创建。
 *
 * 列表只返回**主体可见**的站点：实例级看全部，站点级只看被授权的。
 * 这是 siteScope 之外的第二道防线 —— 即便某个端点漏挂校验，
 * 站点名也不会漏出去。
 *
 * 创建是实例级操作（没有任何站点范围可言），因此挂的是
 * `ADMIN_ACTOR_MIDDLEWARE` + handler 内的实例级判定。
 */

const listSites = createHandler<
  ActorContext,
  {
    sites: Array<{
      id: string;
      name: string;
      status: 'active' | 'disabled';
      allowedOrigins: string[];
      key: string;
    }>;
    total: number;
  },
  { reason: string; message: string }
>(async (context) => {
  const { sites, total } = await listVisibleSites(context.db, context.scope, {
    limit: 100,
    offset: 0,
  });

  return ok({
    // 站点 key 对管理员可见（它就是后台要复制给前端的东西）
    sites: sites.map((site) => ({
      id: site.id,
      name: site.name,
      status: site.status,
      allowedOrigins: site.allowedOrigins,
      key: site.key,
    })),
    total,
  });
});

type CreateSiteError = SiteError | RequestBodyError | DomainError<'FORBIDDEN_ROLE_REQUIRED'>;

const createSite = createHandler<ActorContext, { id: string }, CreateSiteError>(
  async (context, request) => {
    // 站点 CRUD 是**实例级**权限：站点管理员不该能新建站点
    if (context.scope.type !== 'instance') {
      return err(
        domainError('FORBIDDEN_ROLE_REQUIRED', 'Creating sites requires instance permission'),
      );
    }

    const body = await readJsonBody<AdminCreateSiteInput>(request, AdminCreateSiteInputSchema);
    if (body.error) return err(body.error);

    const created = await createSiteAsAdmin(
      context.db,
      { actorId: context.actor.id, ip: clientIp(request) },
      {
        name: body.data.name,
        allowedOrigins: body.data.allowedOrigins,
        settings: body.data.settings,
      },
    );

    if (created.error) return err(created.error);

    return ok({ id: created.data.id });
  },
  { operation: 'admin.sites.create', successStatus: 201 },
);

export const Route = createFileRoute('/api/v1/admin/sites/')({
  server: {
    middleware: [...ADMIN_ACTOR_MIDDLEWARE],
    handlers: {
      GET: listSites,
      POST: createSite,
      ANY: async () => methodNotAllowed(['GET', 'POST']),
    },
  },
});
