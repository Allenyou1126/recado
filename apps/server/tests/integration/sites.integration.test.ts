/**
 * 真实 PostgreSQL 集成测试。
 *
 * 覆盖阶段 0 的验收项：「集成测试能连真实 Postgres 跑通」，
 * 并且验证站点解析这条**带租户隔离**的查询路径。
 *
 * 前置：`docker compose -f docker/compose.yaml up -d postgres`
 */

import { evaluateOrigin, resolveActiveSiteByKey } from '@recado/core';
import { sites, type DbClient } from '@recado/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureTestDatabase, openTestDatabase } from '../helpers/test-db';

let client: DbClient;

beforeAll(async () => {
  await ensureTestDatabase();
  client = openTestDatabase();
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await client.db.execute(sql`TRUNCATE TABLE sites CASCADE`);
});

type SiteSeed = {
  key: string;
  name?: string;
  status?: 'active' | 'disabled';
  allowedOrigins?: string[];
  settings?: Record<string, unknown>;
};

async function seedSite(seed: SiteSeed) {
  const [row] = await client.db
    .insert(sites)
    .values({
      key: seed.key,
      name: seed.name ?? '测试站点',
      status: seed.status ?? 'active',
      allowedOrigins: seed.allowedOrigins ?? [],
      settings: seed.settings ?? {},
    })
    .returning();

  if (!row) throw new Error('seedSite 没有返回插入的行');
  return row;
}

describe('resolveActiveSiteByKey', () => {
  it('按 site key 解析出站点', async () => {
    await seedSite({ key: 'rc_active0000000000000001', name: '博客' });

    const result = await resolveActiveSiteByKey(client.db, 'rc_active0000000000000001');

    expect(result.error).toBeNull();
    expect(result.data?.name).toBe('博客');
  });

  it('忽略 key 两端空白', async () => {
    await seedSite({ key: 'rc_trim00000000000000001' });

    const result = await resolveActiveSiteByKey(client.db, '  rc_trim00000000000000001  ');

    expect(result.error).toBeNull();
  });

  it('缺 key 返回 VALIDATION_SITE_KEY_REQUIRED', async () => {
    const result = await resolveActiveSiteByKey(client.db, null);

    expect(result.error?.reason).toBe('VALIDATION_SITE_KEY_REQUIRED');
  });

  it('未知 key 返回 NOT_FOUND_SITE，且不回显 key', async () => {
    const result = await resolveActiveSiteByKey(client.db, 'rc_unknown00000000000001');

    expect(result.error?.reason).toBe('NOT_FOUND_SITE');
    expect(result.error?.details).toBeUndefined();
  });

  it('停用的站点返回 FORBIDDEN_SITE_DISABLED', async () => {
    const site = await seedSite({ key: 'rc_disabled000000000001', status: 'disabled' });

    const result = await resolveActiveSiteByKey(client.db, 'rc_disabled000000000001');

    expect(result.error?.reason).toBe('FORBIDDEN_SITE_DISABLED');
    expect(result.error?.details).toEqual({ id: site.id });
  });
});

describe('站点来源策略（来自数据库的真实配置）', () => {
  it('用库里存的白名单与 originPolicy 判定来源', async () => {
    const site = await seedSite({
      key: 'rc_origin000000000000001',
      allowedOrigins: ['https://blog.example.com', '*.example.org'],
      settings: { originPolicy: 'strict' },
    });
    const resolved = await resolveActiveSiteByKey(client.db, site.key);

    expect(resolved.error).toBeNull();
    if (resolved.error) return;

    const allowed = evaluateOrigin(resolved.data, {
      origin: 'https://a.example.org',
      referer: null,
    });
    const blocked = evaluateOrigin(resolved.data, {
      origin: 'https://evil.example.net',
      referer: null,
    });
    const noOrigin = evaluateOrigin(resolved.data, { origin: null, referer: null });

    expect(allowed.data).toEqual({ allowed: true, raw: 'https://a.example.org' });
    expect(blocked.error?.reason).toBe('FORBIDDEN_ORIGIN_NOT_ALLOWED');
    expect(noOrigin.error?.reason).toBe('FORBIDDEN_ORIGIN_MISSING');
  });

  it('lenient 站点在没有来源头时放行', async () => {
    const site = await seedSite({
      key: 'rc_lenient0000000000001',
      settings: { originPolicy: 'lenient' },
    });

    const result = evaluateOrigin(site, { origin: null, referer: null });

    expect(result.data).toEqual({ allowed: false, raw: null });
  });
});
