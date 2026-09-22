/**
 * 评论读写核心的集成测试（阶段 4）。
 *
 * 覆盖验收项：
 * - 端到端：发表 → 列表 → 回复 → 计数正确
 * - 公开响应**不含** `email` / `ip` / `user_agent`
 * - **跨站点隔离**：用 A 站的数据上下文读写 B 站数据必须失败
 * - 回复分页在热门评论下正常工作（顶层分页与回复分页互不干扰）
 * - 邮箱必填：缺失由 schema 拒绝（见 unit/comment-schema 测试）
 */

import {
  checkRateLimit,
  countComments,
  createComment,
  getThreadMeta,
  listCommentReplies,
  listComments,
  listRecent,
  parseSiteSettings,
  resolveActiveSiteByKey,
  siteSettings,
  type CommentContext,
} from '@recado/core';
import { sites, type DbClient, type Site } from '@recado/db';
import { CreateCommentInputSchema } from '@recado/shared';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureTestDatabase, openTestDatabase } from '../helpers/test-db';

let client: DbClient;
let siteA: Site;
let siteB: Site;

const PATH = '/posts/hello';

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
      {
        key: 'rc_comments0000000000001',
        name: 'A 站',
        allowedOrigins: ['https://a.example.com'],
        settings: { originPolicy: 'strict' },
      },
      {
        key: 'rc_comments0000000000002',
        name: 'B 站',
        allowedOrigins: ['https://b.example.com'],
        settings: { originPolicy: 'strict' },
      },
    ])
    .returning();

  const [first, second] = inserted;
  if (!first || !second) throw new Error('插入站点失败');
  siteA = first;
  siteB = second;
});

function ctxOf(site: Site): CommentContext {
  return { db: client.db, site };
}

async function post(
  site: Site,
  params: {
    content: string;
    email?: string;
    nickname?: string;
    parentId?: string;
    path?: string;
    website?: string;
    ip?: string | null;
  },
) {
  return createComment(ctxOf(site), {
    path: params.path ?? PATH,
    content: params.content,
    email: params.email ?? 'alice@example.com',
    nickname: params.nickname ?? 'Alice',
    website: params.website,
    parentId: params.parentId,
    ip: params.ip ?? '203.0.113.9',
    userAgent: 'vitest',
  });
}

async function postOk(site: Site, params: Parameters<typeof post>[1]) {
  const result = await post(site, params);
  if (result.error) throw new Error(`发表失败：${result.error.reason}`);
  return result.data;
}

describe('发表评论（T4.3）', () => {
  it('发表后进入列表，并维护线程与成员的物化计数', async () => {
    const created = await postOk(siteA, { content: '你好 **世界**' });

    expect(created.content).toContain('<strong>世界</strong>');

    const list = await listComments(ctxOf(siteA), { path: PATH, sort: 'latest', page: 1 });
    expect(list.data?.total).toBe(1);
    expect(list.data?.comments[0]?.id).toBe(created.id);

    const meta = await getThreadMeta(client.db, siteA.id, PATH);
    expect(meta.data?.commentCount).toBe(1);
    expect(meta.data?.lastCommentAt).not.toBeNull();
  });

  it('邮箱是必填的硬性字段（决策 D18）', () => {
    const parsed = CreateCommentInputSchema.safeParse({ path: PATH, content: 'hi' });

    expect(parsed.success).toBe(false);
  });

  it('站点可要求昵称：开启时缺昵称被拒', async () => {
    const [strictSite] = await client.db
      .insert(sites)
      .values({
        key: 'rc_comments0000000000003',
        name: '要昵称的站',
        settings: { requireNickname: true },
      })
      .returning();
    if (!strictSite) throw new Error('插入站点失败');

    const result = await post(strictSite, { content: 'hi', nickname: '' });

    expect(result.error?.reason).toBe('VALIDATION_NICKNAME_REQUIRED');
  });

  it('关闭昵称必填后可以匿名发言', async () => {
    const [looseSite] = await client.db
      .insert(sites)
      .values({
        key: 'rc_comments0000000000004',
        name: '不要昵称的站',
        settings: { requireNickname: false },
      })
      .returning();
    if (!looseSite) throw new Error('插入站点失败');

    const created = await post(looseSite, { content: 'hi', nickname: '' });

    expect(created.error).toBeNull();
    expect(created.data?.nickname).toBeNull();
  });

  it('审核模式 all 时新评论是 pending，不出现在公开列表里', async () => {
    const [moderated] = await client.db
      .insert(sites)
      .values({
        key: 'rc_comments0000000000005',
        name: '全审站',
        settings: { auditMode: 'all' },
      })
      .returning();
    if (!moderated) throw new Error('插入站点失败');

    const created = await post(moderated, { content: 'hi' });
    const list = await listComments(ctxOf(moderated), { path: PATH, sort: 'latest', page: 1 });

    expect(created.data).not.toBeNull();
    expect(list.data?.total).toBe(0);
    expect(list.data?.comments).toEqual([]);
  });

  it('内容超长被拒，且写入前就失败', async () => {
    const result = await post(siteA, { content: 'a'.repeat(20_000) });

    expect(result.error?.reason).toBe('VALIDATION_CONTENT_TOO_LONG');
    expect(await client.db.select().from(sql`comments`)).toHaveLength(0);
  });
});

describe('回复与嵌套深度（T4.4）', () => {
  it('回复的 rootId 指向顶层祖先', async () => {
    const root = await postOk(siteA, { content: '顶层' });
    const reply = await postOk(siteA, { content: '一层回复', parentId: root.id });

    expect(reply.rootId).toBe(root.id);
    expect(reply.parentId).toBe(root.id);
    expect(reply.replyTo).toEqual({ nickname: 'Alice' });
  });

  it('超过 maxDepth 时挂到允许的最深祖先，但保留被回复者', async () => {
    const root = await postOk(siteA, { content: '顶层' });
    const first = await postOk(siteA, { content: '一层', parentId: root.id });
    const second = await postOk(siteA, { content: '二层', parentId: first.id, nickname: 'Bob' });
    // maxDepth 默认 2：第三层应当被压回顶层之下
    const third = await postOk(siteA, { content: '三层', parentId: second.id, nickname: 'Carol' });

    expect(second.parentId).toBe(root.id);
    expect(third.parentId).toBe(root.id);
    expect(third.rootId).toBe(root.id);
    // 缩进被压平，但「回复的是谁」没有丢
    expect(third.replyTo).toEqual({ nickname: 'Bob' });
  });

  it('maxDepth=3 时允许真正的三层嵌套', async () => {
    const [deepSite] = await client.db
      .insert(sites)
      .values({ key: 'rc_comments0000000000006', name: '深站', settings: { maxDepth: 3 } })
      .returning();
    if (!deepSite) throw new Error('插入站点失败');

    const root = await postOk(deepSite, { content: 'L1' });
    const first = await postOk(deepSite, { content: 'L2', parentId: root.id });
    const second = await postOk(deepSite, { content: 'L3', parentId: first.id });
    const third = await postOk(deepSite, { content: 'L4', parentId: second.id });

    expect(second.parentId).toBe(first.id);
    // 第四层被压到第二层
    expect(third.parentId).toBe(first.id);
  });

  it('父评论不存在时返回 NOT_FOUND_PARENT_COMMENT', async () => {
    const result = await post(siteA, {
      content: '回复一个不存在的评论',
      parentId: '00000000-0000-0000-0000-000000000000',
    });

    expect(result.error?.reason).toBe('NOT_FOUND_PARENT_COMMENT');
  });

  it('不能回复其它站点的评论（跨站隔离）', async () => {
    const other = await postOk(siteB, { content: 'B 站的评论' });

    const result = await post(siteA, { content: '越站回复', parentId: other.id });

    expect(result.error?.reason).toBe('NOT_FOUND_PARENT_COMMENT');
  });
});

describe('列表查询（T4.5）与回复分页（T4.6）', () => {
  it('顶层评论内联前 repliesPreview 条回复并给出 hasMoreReplies', async () => {
    const root = await postOk(siteA, { content: '顶层' });
    for (let index = 0; index < 5; index += 1) {
      await postOk(siteA, { content: `回复 ${index}`, parentId: root.id });
    }

    const list = await listComments(ctxOf(siteA), { path: PATH, sort: 'latest', page: 1 });
    const first = list.data?.comments[0];

    expect(first?.replies).toHaveLength(3);
    expect(first?.hasMoreReplies).toBe(true);
  });

  it('回复分页独立于顶层分页，能取到全部回复', async () => {
    const root = await postOk(siteA, { content: '顶层' });
    for (let index = 0; index < 25; index += 1) {
      await postOk(siteA, { content: `回复 ${index}`, parentId: root.id });
    }

    const page1 = await listCommentReplies(ctxOf(siteA), root.id, {
      sort: 'oldest',
      page: 1,
      pageSize: 10,
    });
    const page3 = await listCommentReplies(ctxOf(siteA), root.id, {
      sort: 'oldest',
      page: 3,
      pageSize: 10,
    });

    expect(page1.data?.total).toBe(25);
    expect(page1.data?.totalPages).toBe(3);
    expect(page1.data?.replies).toHaveLength(10);
    expect(page3.data?.replies).toHaveLength(5);
    // 顶层分页只有 1 条
    const list = await listComments(ctxOf(siteA), { path: PATH, sort: 'latest', page: 1 });
    expect(list.data?.total).toBe(1);
  });

  it('sort=oldest / latest 的顺序相反', async () => {
    await postOk(siteA, { content: '第一条' });
    await postOk(siteA, { content: '第二条' });

    const latest = await listComments(ctxOf(siteA), { path: PATH, sort: 'latest', page: 1 });
    const oldest = await listComments(ctxOf(siteA), { path: PATH, sort: 'oldest', page: 1 });

    expect(latest.data?.comments[0]?.content).toContain('第二条');
    expect(oldest.data?.comments[0]?.content).toContain('第一条');
  });

  it('pageSize 被站点配置封顶，不信任客户端传值', async () => {
    const [smallSite] = await client.db
      .insert(sites)
      .values({ key: 'rc_comments0000000000007', name: '小分页站', settings: { maxPageSize: 2 } })
      .returning();
    if (!smallSite) throw new Error('插入站点失败');

    for (let index = 0; index < 5; index += 1) {
      await postOk(smallSite, { content: `评论 ${index}` });
    }

    const list = await listComments(ctxOf(smallSite), {
      path: PATH,
      sort: 'latest',
      page: 1,
      pageSize: 100,
    });

    expect(list.data?.pageSize).toBe(2);
    expect(list.data?.comments).toHaveLength(2);
  });

  it('分页越界返回空数组而不是报错', async () => {
    await postOk(siteA, { content: '只有一条' });

    const list = await listComments(ctxOf(siteA), { path: PATH, sort: 'latest', page: 5 });

    expect(list.data?.comments).toEqual([]);
    expect(list.data?.total).toBe(1);
  });
});

describe('批量评论数（T4.7）、最近评论（T4.8）与线程元信息（T4.9）', () => {
  it('一次查询多个 path，未评论过的返回 0', async () => {
    await postOk(siteA, { content: 'A 文章评论', path: '/a' });
    await postOk(siteA, { content: 'A 文章第二条', path: '/a' });
    await postOk(siteA, { content: 'B 文章评论', path: '/b' });

    const counts = await countComments(ctxOf(siteA), ['/a', '/b', '/never']);

    expect(counts.data).toEqual({
      counts: { '/a': 2, '/b': 1, '/never': 0 },
      total: 3,
    });
  });

  it('最近评论跨 path 且只含已发布评论', async () => {
    await postOk(siteA, { content: '旧', path: '/a' });
    await postOk(siteA, { content: '新', path: '/b' });

    const recent = await listRecent(ctxOf(siteA), 10);

    expect(recent.data).toHaveLength(2);
    expect(recent.data?.[0]?.content).toContain('新');
  });

  it('线程元信息返回评论数与最近评论时间', async () => {
    await postOk(siteA, { content: '一' });
    await postOk(siteA, { content: '二' });

    const meta = await getThreadMeta(client.db, siteA.id, PATH);

    expect(meta.data?.commentCount).toBe(2);
    expect(meta.data?.lastCommentAt).toEqual(expect.any(String));
  });
});

describe('限流（T4.10）', () => {
  it('同 IP 同站点在最小间隔内再次发表被拒，并给出重试间隔', async () => {
    const [limitedSite] = await client.db
      .insert(sites)
      .values({
        key: 'rc_comments0000000000008',
        name: '限流站',
        settings: { minIntervalSeconds: 60 },
      })
      .returning();
    if (!limitedSite) throw new Error('插入站点失败');

    await postOk(limitedSite, { content: '第一条', ip: '198.51.100.7' });

    const blocked = await checkRateLimit({ db: client.db, site: limitedSite }, '198.51.100.7');
    const other = await checkRateLimit({ db: client.db, site: limitedSite }, '198.51.100.8');

    expect(blocked.error?.reason).toBe('RATE_LIMITED_TOO_FREQUENT');
    expect(blocked.error?.details).toMatchObject({ retryAfterSeconds: expect.any(Number) });
    // 换个 IP 不受影响
    expect(other.error).toBeNull();
  });

  it('minIntervalSeconds=0 时关闭限流', async () => {
    const site = { ...siteA, settings: { minIntervalSeconds: 0 } };

    await postOk(siteA, { content: '第一条', ip: '198.51.100.9' });

    expect((await checkRateLimit({ db: client.db, site }, '198.51.100.9')).error).toBeNull();
  });
});

describe('公开响应白名单（T4.11）', () => {
  it('响应对象不含 email / ip / user_agent / memberId', async () => {
    await postOk(siteA, { content: '敏感字段检查' });

    const list = await listComments(ctxOf(siteA), { path: PATH, sort: 'latest', page: 1 });
    const serialized = JSON.stringify(list.data);

    for (const secret of [
      'email',
      'alice@example.com',
      'ip',
      '203.0.113.9',
      'userAgent',
      'vitest',
      'memberId',
    ]) {
      expect(serialized, `公开响应里出现了 ${secret}`).not.toContain(secret);
    }
  });

  it('跨站点隔离：A 站的上下文看不到 B 站的数据', async () => {
    await postOk(siteA, { content: 'A 站的评论' });
    await postOk(siteB, { content: 'B 站的评论' });

    const aList = await listComments(ctxOf(siteA), { path: PATH, sort: 'latest', page: 1 });
    const bList = await listComments(ctxOf(siteB), { path: PATH, sort: 'latest', page: 1 });

    expect(aList.data?.comments[0]?.content).toContain('A 站');
    expect(bList.data?.comments[0]?.content).toContain('B 站');
    expect(aList.data?.total).toBe(1);
    expect(bList.data?.total).toBe(1);

    // 用 A 站的 site key 解析出的站点只能看到 A 站的数据
    const resolved = await resolveActiveSiteByKey(client.db, siteB.key);
    expect(resolved.data?.id).toBe(siteB.id);
  });

  it('用 A 站 site key 不能读取 B 站线程的评论数', async () => {
    await postOk(siteB, { content: 'B 站的评论' });

    const counts = await countComments(ctxOf(siteA), [PATH]);

    expect(counts.data?.counts[PATH]).toBe(0);
  });
});

describe('站点配置与渲染选项的联动', () => {
  it('关闭代码高亮后评论里的代码块不高亮', async () => {
    const [plainSite] = await client.db
      .insert(sites)
      .values({
        key: 'rc_comments0000000000009',
        name: '不高亮站',
        settings: { codeHighlight: false, math: false },
      })
      .returning();
    if (!plainSite) throw new Error('插入站点失败');

    const created = await postOk(plainSite, { content: '```js\nconst a = 1;\n```' });

    expect(created.content).not.toContain('class="shiki');
  });

  it('站点配置经 parseSiteSettings 归一化后读到的是默认值', () => {
    expect(siteSettings(siteA).maxDepth).toBe(2);
    expect(parseSiteSettings(siteA.settings).pageSize).toBe(20);
  });
});
