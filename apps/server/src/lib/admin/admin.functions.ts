/**
 * 管理台的 SSR 数据加载（Server Function）。
 *
 * 按开发规范 §4.4 的选型规则：
 * - **页面数据加载**用 Server Function（享受端到端类型安全）
 * - **变更操作**走 `/api/v1/admin/*` 的 Server Route（统一 CSRF 与会话校验）
 *
 * ⚠️ loader 是同构的，因此页面 loader 只能调这些函数，绝不能直接摸数据库
 * （§9.2 的红线）。这里已经在服务端，所有查询都经过 `siteScope` 的同一套判定。
 */

import {
  listAuditLogs,
  listCommentsForAdmin,
  listMembersForAdmin,
  listOutbox,
  listSiteLabels,
  listUnsubscribes,
  listVisibleSites,
  scopeAllowsSite,
  siteSettings,
  summarizeByStatus,
  type AccessScope,
} from '@recado/core';
import type { Database } from '@recado/db';
import { createServerFn } from '@tanstack/react-start';

import { actorFunctionMiddleware } from '../middleware/actor-function';
import { listOriginRejections } from '../origin-audit.server';

/** 服务端函数拿到的上下文（由 actorFunctionMiddleware 注入） */
type AdminFnContext = {
  db: Database;
  actor: {
    id: string;
    kind: 'human' | 'machine';
    email: string | null;
    displayName: string | null;
  };
  scope: AccessScope;
  matchedRoles: string[];
};

/**
 * 站点范围校验。
 *
 * 与 `siteScopeMiddleware` 同一套判定 —— 「已登录」不等于「可访问任意站点」，
 * 这条规则在 SSR 数据加载路径上同样成立。
 */
async function assertSite(db: Database, scope: AccessScope, siteId: string) {
  if (!scopeAllowsSite(scope, siteId)) {
    throw new Error('FORBIDDEN_SITE_SCOPE');
  }

  const { getSiteById } = await import('@recado/core');
  const site = await getSiteById(db, siteId);

  if (!site) throw new Error('NOT_FOUND_SITE');

  return site;
}

/** 当前主体 + 可见站点（站点选择器的数据源） */
export const getSessionFn = createServerFn({ method: 'GET' })
  .middleware([actorFunctionMiddleware])
  .handler(async ({ context }) => {
    const admin = context as unknown as AdminFnContext;
    const { sites } = await listVisibleSites(admin.db, admin.scope, { limit: 100, offset: 0 });

    return {
      actor: admin.actor,
      scope: admin.scope,
      matchedRoles: admin.matchedRoles,
      sites: sites.map((site) => ({ id: site.id, name: site.name, status: site.status })),
    };
  });

/** 仪表盘统计 */
export const getDashboardFn = createServerFn({ method: 'GET' })
  .middleware([actorFunctionMiddleware])
  .validator((input: { siteId: string }) => input)
  .handler(async ({ context, data }) => {
    const admin = context as unknown as AdminFnContext;
    const site = await assertSite(admin.db, admin.scope, data.siteId);

    const counts = await summarizeByStatus({ db: admin.db, site });

    return {
      site: { id: site.id, name: site.name, status: site.status },
      counts,
      settings: siteSettings(site),
      key: site.key,
      allowedOrigins: site.allowedOrigins,
    };
  });

/** 后台评论列表 */
export const listCommentsFn = createServerFn({ method: 'GET' })
  .middleware([actorFunctionMiddleware])
  .validator(
    (input: {
      siteId: string;
      path?: string;
      status?: 'approved' | 'pending' | 'spam' | 'deleted';
      keyword?: string;
      page: number;
      pageSize: number;
    }) => input,
  )
  .handler(async ({ context, data }) => {
    const admin = context as unknown as AdminFnContext;
    const site = await assertSite(admin.db, admin.scope, data.siteId);

    return listCommentsForAdmin(
      { db: admin.db, site },
      {
        ...(data.path === undefined || data.path.length === 0 ? {} : { path: data.path }),
        ...(data.status === undefined ? {} : { status: data.status }),
        ...(data.keyword === undefined || data.keyword.length === 0
          ? {}
          : { keyword: data.keyword }),
        sort: 'latest',
        page: data.page,
        pageSize: data.pageSize,
      },
    );
  });

/** 成员列表 */
export const listMembersFn = createServerFn({ method: 'GET' })
  .middleware([actorFunctionMiddleware])
  .validator((input: { siteId: string; search?: string; page: number; pageSize: number }) => input)
  .handler(async ({ context, data }) => {
    const admin = context as unknown as AdminFnContext;
    await assertSite(admin.db, admin.scope, data.siteId);

    return listMembersForAdmin(admin.db, data.siteId, data);
  });

/** 标签列表 */
export const listLabelsFn = createServerFn({ method: 'GET' })
  .middleware([actorFunctionMiddleware])
  .validator((input: { siteId: string }) => input)
  .handler(async ({ context, data }) => {
    const admin = context as unknown as AdminFnContext;
    await assertSite(admin.db, admin.scope, data.siteId);

    return listSiteLabels(admin.db, data.siteId);
  });

/** 邮件投递日志 */
export const listOutboxFn = createServerFn({ method: 'GET' })
  .middleware([actorFunctionMiddleware])
  .validator(
    (input: {
      siteId: string;
      status?: 'queued' | 'sending' | 'sent' | 'failed' | 'skipped';
      page: number;
      pageSize: number;
    }) => input,
  )
  .handler(async ({ context, data }) => {
    const admin = context as unknown as AdminFnContext;
    await assertSite(admin.db, admin.scope, data.siteId);

    const { rows, total } = await listOutbox(admin.db, data.siteId, {
      status: data.status,
      limit: data.pageSize,
      offset: (data.page - 1) * data.pageSize,
    });

    // 退信原因与收件人只对管理员可见，这里显式构造，不透传行对象
    return {
      items: rows.map((row) => ({
        id: row.id,
        type: row.type,
        status: row.status,
        toEmail: row.toEmail,
        subject: row.subject,
        attempts: row.attempts,
        lastError: row.lastError,
        scheduledAt: row.scheduledAt.toISOString(),
        sentAt: row.sentAt?.toISOString() ?? null,
      })),
      total,
    };
  });

/** 退订列表 */
export const listUnsubscribesFn = createServerFn({ method: 'GET' })
  .middleware([actorFunctionMiddleware])
  .validator((input: { siteId: string; page: number; pageSize: number }) => input)
  .handler(async ({ context, data }) => {
    const admin = context as unknown as AdminFnContext;
    await assertSite(admin.db, admin.scope, data.siteId);

    const { rows, total } = await listUnsubscribes(admin.db, data.siteId, {
      limit: data.pageSize,
      offset: (data.page - 1) * data.pageSize,
    });

    return {
      items: rows.map((row) => ({
        id: row.id,
        email: row.email,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
    };
  });

/** 审计日志 */
export const listAuditLogsFn = createServerFn({ method: 'GET' })
  .middleware([actorFunctionMiddleware])
  .validator((input: { siteId: string; action?: string; page: number; pageSize: number }) => input)
  .handler(async ({ context, data }) => {
    const admin = context as unknown as AdminFnContext;
    await assertSite(admin.db, admin.scope, data.siteId);

    const { rows, total } = await listAuditLogs(admin.db, {
      siteId: data.siteId,
      action: data.action,
      limit: data.pageSize,
      offset: (data.page - 1) * data.pageSize,
    });

    return {
      items: rows.map((row) => ({
        id: row.id,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        // 序列化成字符串：Server Function 的返回值会被跨序列化传输，
        // 而 `Record<string, unknown>` 里的 unknown 无法通过可序列化校验
        diff: row.diff === null ? null : JSON.stringify(row.diff),
        createdAt: row.createdAt.toISOString(),
      })),
      total,
    };
  });

/** 来源校验自检：最近被拒绝的 Origin */
export const listOriginRejectionsFn = createServerFn({ method: 'GET' })
  .middleware([actorFunctionMiddleware])
  .validator((input: { siteId: string }) => input)
  .handler(async ({ context, data }) => {
    const admin = context as unknown as AdminFnContext;
    await assertSite(admin.db, admin.scope, data.siteId);

    return listOriginRejections(data.siteId);
  });
