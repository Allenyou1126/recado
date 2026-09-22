/**
 * sites 功能的数据访问层（Repo）。
 *
 * 只有这一层能出现 Drizzle 查询（.specs/development-standards.md §7.1）。
 *
 * 参数约定：涉及站点的查询，`siteId` 紧跟在 `db` 之后 —— 便于评审时一眼看出
 * 是否漏了租户隔离（§7.2）。`findSiteByKey` 是例外：它正是**用来解析出**
 * siteId 的那一步，因此只有 `db` 与 key。
 */

import { sites, type Database } from '@recado/db';
import { eq } from 'drizzle-orm';

/** 按公开 site key 查找站点（site key 是公开标识，不是密钥） */
export async function findSiteByKey(db: Database, key: string) {
  return db.query.sites.findFirst({ where: eq(sites.key, key) });
}
