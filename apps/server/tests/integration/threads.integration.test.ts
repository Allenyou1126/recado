import { countCommentAdded, countCommentRemoved, ensureThread, getThreadMeta } from '@recado/core';
import { comments, members, sites, threads, type DbClient } from '@recado/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureTestDatabase, openTestDatabase } from '../helpers/test-db';

let client: DbClient;
let siteId: string;

beforeAll(async () => {
  await ensureTestDatabase();
  client = openTestDatabase();
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await client.db.execute(sql`TRUNCATE TABLE sites CASCADE`);
  const [site] = await client.db
    .insert(sites)
    .values({ key: 'rc_threads00000000000001', name: '线程测试站' })
    .returning();
  if (!site) throw new Error('插入站点失败');
  siteId = site.id;
});

describe('threads upsert（T4.2）', () => {
  it('同一站点同一 path 只产生一条线程', async () => {
    const first = await ensureThread(client.db, siteId, '/posts/1');
    const second = await ensureThread(client.db, siteId, '/posts/1', { title: '标题' });

    expect(second.id).toBe(first.id);
    expect(second.title).toBe('标题');

    const rows = await client.db.select().from(threads);
    expect(rows).toHaveLength(1);
  });

  it('后续不带 title 的请求不会清空已上报的 url / title', async () => {
    await ensureThread(client.db, siteId, '/posts/2', {
      url: 'https://blog.example.com/2',
      title: '二',
    });
    const again = await ensureThread(client.db, siteId, '/posts/2');

    expect(again.url).toBe('https://blog.example.com/2');
    expect(again.title).toBe('二');
  });

  it('不同 path 是不同线程', async () => {
    await ensureThread(client.db, siteId, '/posts/3');
    await ensureThread(client.db, siteId, '/posts/4');

    const rows = await client.db.select().from(threads);
    expect(rows).toHaveLength(2);
  });

  it('物化计数随已发布评论增减，最近评论时间只在新增时推进', async () => {
    const thread = await ensureThread(client.db, siteId, '/posts/5');

    await countCommentAdded(client.db, siteId, thread.id);
    const afterAdd = await getThreadMeta(client.db, siteId, '/posts/5');

    expect(afterAdd.data?.commentCount).toBe(1);
    expect(afterAdd.data?.lastCommentAt).not.toBeNull();

    const before = afterAdd.data?.lastCommentAt;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await countCommentAdded(client.db, siteId, thread.id);
    const afterSecond = await getThreadMeta(client.db, siteId, '/posts/5');
    expect(afterSecond.data?.commentCount).toBe(2);
    expect(afterSecond.data?.lastCommentAt).not.toBe(before);

    const lastSeen = afterSecond.data?.lastCommentAt;
    await countCommentRemoved(client.db, siteId, thread.id);
    const afterRemove = await getThreadMeta(client.db, siteId, '/posts/5');
    // 删除不把「最近评论时间」往回拨
    expect(afterRemove.data?.commentCount).toBe(1);
    expect(afterRemove.data?.lastCommentAt).toBe(lastSeen);
  });

  it('计数不会被减成负数', async () => {
    const thread = await ensureThread(client.db, siteId, '/posts/6');

    await countCommentRemoved(client.db, siteId, thread.id);
    await countCommentRemoved(client.db, siteId, thread.id);

    const meta = await getThreadMeta(client.db, siteId, '/posts/6');
    expect(meta.data?.commentCount).toBe(0);
  });

  it('线程元信息在没有任何评论时返回零值而不是报错', async () => {
    const meta = await getThreadMeta(client.db, siteId, '/never-commented');

    expect(meta.error).toBeNull();
    expect(meta.data).toEqual({
      path: '/never-commented',
      url: null,
      title: null,
      commentCount: 0,
      lastCommentAt: null,
    });
  });
});

describe('线程与评论的关联', () => {
  it('删除站点会级联清掉线程与成员', async () => {
    const thread = await ensureThread(client.db, siteId, '/posts/7');
    await client.db.insert(members).values({ siteId, email: 'a@example.com' });

    await client.db.execute(sql`DELETE FROM sites WHERE id = ${siteId}`);

    expect(await client.db.select().from(threads)).toHaveLength(0);
    expect(await client.db.select().from(members)).toHaveLength(0);
    expect(await client.db.select().from(comments)).toHaveLength(0);
    expect(thread.id).toBeTruthy();
  });
});
