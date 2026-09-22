import { normalizeEmail, resolveMember } from '@recado/core';
import { members, sites, type DbClient } from '@recado/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureTestDatabase, openTestDatabase } from '../helpers/test-db';

let client: DbClient;
let siteId: string;
let otherSiteId: string;

beforeAll(async () => {
  await ensureTestDatabase();
  client = openTestDatabase();
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await client.db.execute(sql`TRUNCATE TABLE sites CASCADE`);

  const inserted = await client.db
    .insert(sites)
    .values([
      { key: 'rc_members00000000000001', name: '成员测试站' },
      { key: 'rc_members00000000000002', name: '另一个站点' },
    ])
    .returning();

  const [first, second] = inserted;
  if (!first || !second) throw new Error('插入站点失败');
  siteId = first.id;
  otherSiteId = second.id;
});

describe('normalizeEmail', () => {
  it('去空白并转小写', () => {
    expect(normalizeEmail('  Alice@Example.COM ')).toBe('alice@example.com');
  });

  it('不做「去掉 Gmail 点号」这类归一 —— 那会合并两个真实存在的地址', () => {
    expect(normalizeEmail('a.lice@gmail.com')).toBe('a.lice@gmail.com');
  });
});

describe('邮箱归并（T4.1）', () => {
  it('同站同邮箱落到同一档案，大小写不敏感', async () => {
    const first = await resolveMember(client.db, siteId, {
      email: 'alice@example.com',
      nickname: 'Alice',
    });
    const second = await resolveMember(client.db, siteId, {
      email: 'ALICE@Example.com',
      nickname: 'Alice 2',
    });

    expect(second.id).toBe(first.id);

    const rows = await client.db.select().from(members);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.nickname).toBe('Alice 2');
  });

  it('昵称与网址取最近一次使用的值', async () => {
    await resolveMember(client.db, siteId, {
      email: 'bob@example.com',
      nickname: 'Bob',
      website: 'https://bob.example.com',
    });
    const updated = await resolveMember(client.db, siteId, {
      email: 'bob@example.com',
      nickname: 'Bobby',
    });

    expect(updated.nickname).toBe('Bobby');
    // 这次没填网址，应当保留上一次的
    expect(updated.website).toBe('https://bob.example.com');
  });

  it('不同站点同邮箱是两个档案（决策 Q-03：隔离到站点级）', async () => {
    const here = await resolveMember(client.db, siteId, { email: 'carol@example.com' });
    const there = await resolveMember(client.db, otherSiteId, { email: 'carol@example.com' });

    expect(there.id).not.toBe(here.id);

    const rows = await client.db.select().from(members);
    expect(rows).toHaveLength(2);
  });

  it('并发 upsert 同一邮箱不会炸唯一约束', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        resolveMember(client.db, siteId, { email: 'race@example.com' }),
      ),
    );

    const ids = new Set(results.map((member) => member.id));
    expect(ids.size).toBe(1);
  });

  it('档案带审核声誉字段，默认未被降级', async () => {
    const member = await resolveMember(client.db, siteId, { email: 'dave@example.com' });

    expect(member.spamCount).toBe(0);
    expect(member.reviewRequired).toBe(false);
    expect(member.commentCount).toBe(0);
  });
});
