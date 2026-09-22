import { ok, type AdminIdentity } from '@recado/shared';
import { createFileRoute } from '@tanstack/react-router';

import { ADMIN_ACTOR_MIDDLEWARE } from '../../../../lib/http/admin-route';
import { createHandler } from '../../../../lib/http/handler';
import { methodNotAllowed } from '../../../../lib/http/method-not-allowed';

/**
 * `GET /api/v1/admin/me` —— 当前管理员。
 *
 * 刻意**不回显 `oidc_subject`**：它是内部标识，前端用不上，
 * 回显只会扩大泄漏面（验收项「不回显 oidc_subject 等内部标识」）。
 *
 * 返回 `scope` 与命中角色，管理台据此决定「站点选择器里列哪些站点」，
 * 也让「我为什么能看到这个站点」有据可查。
 */
const getMe = createHandler<ActorContext, AdminIdentity, never>(
  async (context) =>
    ok({
      id: context.actor.id,
      kind: context.actor.kind,
      email: context.actor.email,
      displayName: context.actor.displayName,
      scope: context.scope,
      matchedRoles: context.matchedRoles,
    }),
  { operation: 'admin.me' },
);

export const Route = createFileRoute('/api/v1/admin/me')({
  server: {
    middleware: [...ADMIN_ACTOR_MIDDLEWARE],
    handlers: {
      GET: getMe,
      ANY: async () => methodNotAllowed(['GET']),
    },
  },
});
