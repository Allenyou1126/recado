import { Link, Outlet, createFileRoute, redirect, useNavigate } from '@tanstack/react-router';

import { getSessionFn } from '../../lib/admin/admin.functions';

/**
 * `_authed` 布局路由。
 *
 * ⚠️ `beforeLoad` 里的跳转**只是 UX 优化，不是安全边界**（开发规范 §9.1）。
 * 真正的校验在服务端的 `actorMiddleware` / `siteScopeMiddleware` 与
 * Server Function 的 `actorFunctionMiddleware` 里 —— 三处共用同一套解析实现。
 *
 * 这里做的是另一件有价值的事：**一次拿到会话与可见站点列表**，
 * 供站点选择器使用，避免每个页面各查一遍。
 */
export const Route = createFileRoute('/_authed')({
  beforeLoad: async () => {
    try {
      return await getSessionFn();
    } catch {
      // 未登录或会话失效：跳登录页，回来时还能回到原本想去的页面
      throw redirect({ to: '/auth/login' });
    }
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { actor, sites } = Route.useRouteContext();
  const navigate = useNavigate();

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-200 pb-4">
        <div className="flex items-center gap-6">
          <Link to="/admin" className="text-lg font-semibold tracking-tight">
            Recado 管理台
          </Link>

          <nav aria-label="主导航" className="flex flex-wrap gap-4 text-sm text-neutral-600">
            <Link to="/admin" activeProps={{ className: 'text-neutral-900 font-medium' }}>
              概览
            </Link>
            <Link to="/admin/comments" activeProps={{ className: 'text-neutral-900 font-medium' }}>
              评论
            </Link>
            <Link to="/admin/members" activeProps={{ className: 'text-neutral-900 font-medium' }}>
              成员
            </Link>
            <Link to="/admin/sites" activeProps={{ className: 'text-neutral-900 font-medium' }}>
              站点
            </Link>
            <Link to="/admin/email" activeProps={{ className: 'text-neutral-900 font-medium' }}>
              邮件
            </Link>
            <Link to="/admin/audit" activeProps={{ className: 'text-neutral-900 font-medium' }}>
              审计
            </Link>
            <Link to="/admin/origins" activeProps={{ className: 'text-neutral-900 font-medium' }}>
              来源自检
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-3 text-sm text-neutral-500">
          <span>{actor.displayName ?? actor.email ?? actor.kind}</span>
          <button
            type="button"
            className="underline underline-offset-4 hover:text-neutral-800"
            onClick={() => {
              void fetch('/auth/logout', { method: 'POST' }).then(() => {
                void navigate({ to: '/', replace: true });
              });
            }}
          >
            退出
          </button>
        </div>
      </header>

      {sites.length === 0 ? (
        <p className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          当前账号没有任何可见站点。请确认 IdP 侧已授予
          <code className="mx-1">*.OWNER</code> 或
          <code className="mx-1">*.ADMIN.&lt;站点 UUID&gt;</code> 角色。
        </p>
      ) : (
        <Outlet />
      )}
    </div>
  );
}
