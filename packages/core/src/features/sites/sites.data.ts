/**
 * sites 功能的数据访问层（Repo）。
 *
 * 只有这一层能出现 Drizzle 查询（.specs/development-standards.md §7.1）。
 *
 * **参数约定**：`siteId` 紧跟在 `db` 之后，便于评审时一眼看出是否漏了租户隔离（§7.2）。
 * `findSiteByKey` 是唯一例外 —— 它正是**用来解析出** siteId 的那一步。
 */

import { sites, type Database, type NewSite, type Site } from '@recado/db';
import { eq } from 'drizzle-orm';

/** 按公开 site key 查找站点（site key 是公开标识，不是密钥） */
export async function findSiteByKey(db: Database, key: string): Promise<Site | undefined> {
  return db.query.sites.findFirst({ where: eq(sites.key, key) });
}

/** 按站点 id 查找 */
export async function findSiteById(db: Database, siteId: string): Promise<Site | undefined> {
  return db.query.sites.findFirst({ where: eq(sites.id, siteId) });
}

/** 插入站点 */
export async function insertSite(db: Database, values: NewSite): Promise<Site> {
  const [row] = await db.insert(sites).values(values).returning();

  if (!row) throw new Error('insertSite 未返回插入的行');
  return row;
}

/** 轮换 site key（旧 key 立即失效） */
export async function updateSiteKey(
  db: Database,
  siteId: string,
  key: string,
): Promise<Site | undefined> {
  const [row] = await db
    .update(sites)
    .set({ key, updatedAt: new Date() })
    .where(eq(sites.id, siteId))
    .returning();

  return row;
}

/** 更新站点可写字段（不含 key：key 有单独的轮换入口） */
export async function updateSite(
  db: Database,
  siteId: string,
  patch: Partial<Pick<Site, 'name' | 'status' | 'allowedOrigins' | 'settings'>>,
): Promise<Site | undefined> {
  const [row] = await db
    .update(sites)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(sites.id, siteId))
    .returning();

  return row;
}
