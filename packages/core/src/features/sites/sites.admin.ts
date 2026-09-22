/**
 * sites 功能的**管理端**服务：站点 CRUD、key 轮换、可见站点列表。
 *
 * 与公开侧的区别：这里每一次写操作都要写审计日志，并且必须携带操作主体。
 * 权限判定（这个主体能不能动这个站点）不在这里 —— 那是接口层
 * `siteScopeMiddleware` 的职责，服务层只收「已经确认有权限」的站点。
 */

import { sites, type DbExecutor, type Site } from '@recado/db';
import { err, ok, type Result } from '@recado/shared';
import { and, count, desc, eq, inArray } from 'drizzle-orm';

import { AuditActions, recordAudit } from '../audit/audit.service';
import type { AccessScope } from '../auth/access-scope';
import { findSiteById, insertSite, updateSite, updateSiteKey } from './sites.data';
import { SiteErrors, type SiteError } from './sites.errors';
import { AllowedOriginSchema, parseSiteSettings, type SiteSettings } from './sites.schema';
import { generateSiteKey, normalizeAllowedOrigins } from './sites.service';

export type AdminAuditContext = {
  actorId: string | null;
  ip?: string | null;
};

/** 主体可见的站点列表（实例级看全部，站点级只看被授权的） */
export async function listVisibleSites(
  db: DbExecutor,
  scope: AccessScope,
  query: { limit: number; offset: number; status?: 'active' | 'disabled' | undefined },
): Promise<{ sites: Site[]; total: number }> {
  const filters = [
    scope.type === 'instance'
      ? undefined
      : // 空站点列表用恒假条件表达，而不是省略条件（省略就等于放行）
        inArray(
          sites.id,
          scope.siteIds.length > 0 ? scope.siteIds : ['00000000-0000-0000-0000-000000000000'],
        ),
    query.status === undefined ? undefined : eq(sites.status, query.status),
  ].filter((value) => value !== undefined);

  const where = filters.length === 0 ? undefined : and(...filters);

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(sites)
      .where(where)
      .orderBy(desc(sites.createdAt))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ value: count() }).from(sites).where(where),
  ]);

  return { sites: rows, total: totals[0]?.value ?? 0 };
}

export type CreateSiteForAdminInput = {
  name: string;
  allowedOrigins: string[];
  settings: Partial<SiteSettings>;
};

/** 创建站点并签发 site key（管理台入口，与 CLI 共用同一套规则） */
export async function createSiteAsAdmin(
  db: DbExecutor,
  audit: AdminAuditContext,
  input: CreateSiteForAdminInput,
): Promise<Result<Site, SiteError>> {
  const invalid = input.allowedOrigins.filter(
    (origin) => !AllowedOriginSchema.safeParse(origin.trim().toLowerCase()).success,
  );

  if (invalid.length > 0) {
    return err(SiteErrors.invalidOrigin(invalid[0] ?? ''));
  }

  const settings = { ...parseSiteSettings({}), ...input.settings };
  const allowedOrigins = normalizeAllowedOrigins(input.allowedOrigins);

  // 唯一约束才是权威判定：不先查后插（并发下有竞态），冲突就换一个 key 重试
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const key = generateSiteKey();

    const site = await insertSite(db, {
      key,
      name: input.name,
      allowedOrigins,
      settings,
    });

    await recordAudit(db, {
      action: AuditActions.siteCreated,
      actorId: audit.actorId,
      siteId: site.id,
      targetType: 'site',
      targetId: site.id,
      diff: { name: site.name, allowedOrigins },
      ip: audit.ip ?? null,
    });

    return ok(site);
  }

  return err(SiteErrors.keyGenerationFailed());
}

export type UpdateSiteForAdminInput = {
  name?: string;
  status?: 'active' | 'disabled';
  allowedOrigins?: string[];
  settings?: Partial<SiteSettings>;
};

/** 更新站点；只写传了的字段，并留审计 */
export async function updateSiteAsAdmin(
  db: DbExecutor,
  audit: AdminAuditContext,
  siteId: string,
  input: UpdateSiteForAdminInput,
): Promise<Result<Site, SiteError>> {
  const current = await findSiteById(db, siteId);
  if (!current) return err(SiteErrors.notFound(siteId));

  if (input.allowedOrigins !== undefined) {
    const invalid = input.allowedOrigins.filter(
      (origin) => !AllowedOriginSchema.safeParse(origin.trim().toLowerCase()).success,
    );

    if (invalid.length > 0) return err(SiteErrors.invalidOrigin(invalid[0] ?? ''));
  }

  const settings =
    input.settings === undefined
      ? undefined
      : { ...parseSiteSettings(current.settings), ...input.settings };

  const updated = await updateSite(db, siteId, {
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.allowedOrigins === undefined
      ? {}
      : { allowedOrigins: normalizeAllowedOrigins(input.allowedOrigins) }),
    ...(settings === undefined ? {} : { settings }),
  });

  if (!updated) return err(SiteErrors.notFound(siteId));

  await recordAudit(db, {
    action: AuditActions.siteUpdated,
    actorId: audit.actorId,
    siteId,
    targetType: 'site',
    targetId: siteId,
    // 只记「改了哪些字段」，不记整份配置：配置里可能带 SMTP 之类的敏感值
    diff: { fields: Object.keys(input) },
    ip: audit.ip ?? null,
  });

  return ok(updated);
}

/** 轮换 site key：旧 key 立即失效，并留审计 */
export async function rotateSiteKeyAsAdmin(
  db: DbExecutor,
  audit: AdminAuditContext,
  siteId: string,
): Promise<Result<Site, SiteError>> {
  const updated = await updateSiteKey(db, siteId, generateSiteKey());

  if (!updated) return err(SiteErrors.notFound(siteId));

  await recordAudit(db, {
    action: AuditActions.siteKeyRotated,
    actorId: audit.actorId,
    siteId,
    targetType: 'site',
    targetId: siteId,
    // 不记录 key 本身：审计日志不是存放凭据的地方
    diff: null,
    ip: audit.ip ?? null,
  });

  return ok(updated);
}
