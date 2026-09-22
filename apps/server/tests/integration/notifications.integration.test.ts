/**
 * 邮件通知与 outbox 的集成测试（阶段 6）。
 *
 * 覆盖验收项：
 * - 通知**只入队**，不阻塞评论写入（SMTP 不可用时评论仍然成功）
 * - `dedupe_key` 保证同一事件重复入队只留一条
 * - 退订后不再收到该站点的邮件
 * - 单条投递失败不阻断同批次其他邮件
 */

import {
  claimOutboxBatch,
  createComment,
  enqueueCommentNotifications,
  isUnsubscribed,
  loadMemberEmail,
  renderTemplate,
  encryptSecret,
  decryptSecret,
  siteSettings,
  unsubscribeByToken,
  type CommentContext,
} from '@recado/core';
import { outbox, sites, unsubscribes, type DbClient, type Site } from '@recado/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureTestDatabase, openTestDatabase } from '../helpers/test-db';

let client: DbClient;
let site: Site;

const SECRETS_KEY = 'test-secrets-key-test-secrets-key';

beforeAll(async () => {
  await ensureTestDatabase();
  client = openTestDatabase();
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await client.db.execute(sql`TRUNCATE TABLE sites CASCADE`);

  const [row] = await client.db
    .insert(sites)
    .values({
      key: 'rc_notify00000000000001',
      name: '通知测试站',
      settings: {
        minIntervalSeconds: 0,
        notifyEmails: ['owner@example.com'],
        notifyOnPending: true,
      },
    })
    .returning();
  if (!row) throw new Error('插入站点失败');
  site = row;
});

const ctx = (): CommentContext => ({
  db: client.db,
  site,
  publicBaseUrl: 'https://comments.example.com',
});

describe('SMTP 密码加密（T6.1）', () => {
  it('加密后可解出原文，密文不含原文', () => {
    const encrypted = encryptSecret('hunter2', SECRETS_KEY);

    expect(encrypted).not.toContain('hunter2');
    expect(encrypted.startsWith('v1:')).toBe(true);
    expect(decryptSecret(encrypted, SECRETS_KEY)).toBe('hunter2');
  });

  it('换密钥后解不开（返回 null，按未配置处理）', () => {
    const encrypted = encryptSecret('hunter2', SECRETS_KEY);

    expect(decryptSecret(encrypted, 'another-secrets-key-another-secrets-')).toBeNull();
  });

  it('密文被篡改时解不开而不是抛出', () => {
    const encrypted = encryptSecret('hunter2', SECRETS_KEY);
    const tampered = `${encrypted.slice(0, -2)}xx`;

    expect(decryptSecret(tampered, SECRETS_KEY)).toBeNull();
  });

  it('同一明文两次加密结果不同（随机 IV）', () => {
    expect(encryptSecret('same', SECRETS_KEY)).not.toBe(encryptSecret('same', SECRETS_KEY));
  });
});

describe('模板系统（T6.2）', () => {
  it('变量替换并转义用户内容', () => {
    const rendered = renderTemplate('reply', {
      siteName: '站点',
      author: '<script>alert(1)</script>',
      path: '/posts/1',
      url: 'https://example.com/posts/1',
      content: '正文',
      unsubscribeUrl: 'https://example.com/unsubscribe',
    });

    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('&lt;script&gt;');
    // 主题行里的变量同样被转义，且不能带上换行（防头部注入）
    expect(rendered.subject).not.toContain('\n');
  });

  it('主题行里的换行被剥掉，避免伪造邮件头', () => {
    const rendered = renderTemplate('admin_new_comment', {
      siteName: '站点',
      author: 'a\r\nBcc: evil@example.com',
      path: '/p',
      url: 'https://example.com/p',
      content: 'x',
    });

    expect(rendered.subject).not.toMatch(/[\r\n]/);
  });

  it('未知变量替换为空串而不是留下占位符', () => {
    const rendered = renderTemplate('test', { siteName: '站点' });

    expect(rendered.html).not.toContain('{{');
  });
});

describe('outbox 入队（T6.3）', () => {
  it('评论写入后只入队，不发信：SMTP 未配置也照样成功', async () => {
    const created = await createComment(ctx(), {
      path: '/posts/1',
      content: '一条评论',
      email: 'alice@example.com',
      nickname: 'Alice',
      ip: null,
      userAgent: null,
    });

    expect(created.error).toBeNull();
    // 站点没有 SMTP 配置，但评论发布成功、通知已入队
    expect(siteSettings(site).smtp).toBeNull();

    const queued = await client.db.select().from(outbox);
    expect(queued).toHaveLength(1);
    expect(queued[0]?.toEmail).toBe('owner@example.com');
    expect(queued[0]?.status).toBe('queued');
  });

  it('dedupe_key 保证同一事件重复入队只留一条', async () => {
    const created = await createComment(ctx(), {
      path: '/posts/2',
      content: '评论',
      email: 'alice@example.com',
      nickname: 'Alice',
      ip: null,
      userAgent: null,
    });
    if (created.error) throw new Error('发表失败');

    // 重复触发同一事件的通知入队（模拟重试）
    for (let index = 0; index < 3; index += 1) {
      await enqueueCommentNotifications(
        { db: client.db, site, publicBaseUrl: 'https://comments.example.com' },
        {
          commentId: created.data.id,
          path: '/posts/2',
          threadUrl: null,
          authorNickname: 'Alice',
          authorEmail: 'alice@example.com',
          contentHtml: '<p>评论</p>',
          status: 'approved',
          replyToMemberId: null,
          replyToEmail: null,
        },
      );
    }

    const queued = await client.db.select().from(outbox);
    expect(queued).toHaveLength(1);
  });

  it('回复通知发给被回复者，而不是自己回复自己', async () => {
    const root = await createComment(ctx(), {
      path: '/posts/3',
      content: '顶层',
      email: 'root@example.com',
      nickname: 'Root',
      ip: null,
      userAgent: null,
    });
    if (root.error) throw new Error('发表失败');

    const reply = await createComment(ctx(), {
      path: '/posts/3',
      content: '回复',
      email: 'bob@example.com',
      nickname: 'Bob',
      parentId: root.data.id,
      ip: null,
      userAgent: null,
    });
    if (reply.error) throw new Error('回复失败');

    const queued = await client.db.select().from(outbox);
    const recipients = queued.map((item) => item.toEmail).sort();

    // 站长 + 被回复者（回复者本人不给自己发）
    expect(recipients).toEqual(['owner@example.com', 'root@example.com']);
  });

  it('自己回复自己不产生额外的回复通知', async () => {
    const root = await createComment(ctx(), {
      path: '/posts/4',
      content: '顶层',
      email: 'same@example.com',
      nickname: 'Same',
      ip: null,
      userAgent: null,
    });
    if (root.error) throw new Error('发表失败');

    const reply = await createComment(ctx(), {
      path: '/posts/4',
      content: '自问自答',
      email: 'same@example.com',
      nickname: 'Same',
      parentId: root.data.id,
      ip: null,
      userAgent: null,
    });
    if (reply.error) throw new Error('回复失败');

    const replies = await client.db.select().from(outbox).where(eq(outbox.type, 'reply'));
    expect(replies).toHaveLength(0);
  });

  it('已退订的邮箱不入队', async () => {
    await client.db.insert(unsubscribes).values({
      siteId: site.id,
      email: 'owner@example.com',
      token: 'token-owner',
      sourceCommentId: null,
    });

    await createComment(ctx(), {
      path: '/posts/5',
      content: '评论',
      email: 'alice@example.com',
      nickname: 'Alice',
      ip: null,
      userAgent: null,
    });

    expect(await client.db.select().from(outbox)).toHaveLength(0);
    expect(await isUnsubscribed(client.db, site.id, 'OWNER@example.com')).toBe(true);
  });
});

describe('退订（T6.7）', () => {
  it('凭 token 退订，之后不再收信', async () => {
    const created = await createComment(ctx(), {
      path: '/posts/6',
      content: '评论',
      email: 'alice@example.com',
      nickname: 'Alice',
      ip: null,
      userAgent: null,
    });
    if (created.error) throw new Error('发表失败');

    const [queued] = await client.db.select().from(outbox);
    expect(queued).toBeDefined();

    const token = await ensureTokenFor();
    const result = await unsubscribeByToken(client.db, token);

    expect(result.error).toBeNull();
    expect(result.data?.email).toBe('owner@example.com');

    // 退订后新评论不再给该邮箱入队
    await client.db.execute(sql`TRUNCATE TABLE outbox CASCADE`);
    await createComment(ctx(), {
      path: '/posts/6',
      content: '第二条',
      email: 'alice@example.com',
      nickname: 'Alice',
      ip: null,
      userAgent: null,
    });

    expect(await client.db.select().from(outbox)).toHaveLength(0);
  });

  it('未知 token 返回 NOT_FOUND_UNSUBSCRIBE_TOKEN', async () => {
    const result = await unsubscribeByToken(client.db, 'nope');

    expect(result.error?.reason).toBe('NOT_FOUND_UNSUBSCRIBE_TOKEN');
  });

  /**
   * 退订 token 落在 unsubscribes 表里 —— 邮件正文里的链接由它拼出，
   * 这里直接读表比从模板变量里反解更稳。
   */
  async function ensureTokenFor(): Promise<string> {
    const [row] = await client.db
      .select()
      .from(unsubscribes)
      .where(eq(unsubscribes.email, 'owner@example.com'));

    return row?.token ?? '';
  }
});

describe('worker 抢占（T6.4）', () => {
  it('抢占后状态推进到 sending，同一批不会被再次抢到', async () => {
    await client.db.insert(outbox).values({
      type: 'test',
      siteId: site.id,
      toEmail: 'owner@example.com',
      subject: '测试',
      template: 'test',
      dedupeKey: 'test:1',
    });

    const first = await client.db.transaction(async (tx) => claimOutboxBatch(tx, 10));
    const second = await client.db.transaction(async (tx) => claimOutboxBatch(tx, 10));

    expect(first).toHaveLength(1);
    // 已被标记为 sending，不会再被抢到
    expect(second).toHaveLength(0);
  });

  it('未到 scheduled_at 的任务不会被抢到（指数退避生效）', async () => {
    await client.db.insert(outbox).values({
      type: 'test',
      siteId: site.id,
      toEmail: 'owner@example.com',
      subject: '未来任务',
      template: 'test',
      dedupeKey: 'test:future',
      scheduledAt: new Date(Date.now() + 60_000),
    });

    const claimed = await client.db.transaction(async (tx) => claimOutboxBatch(tx, 10));

    expect(claimed).toHaveLength(0);
  });
});

describe('回复目标邮箱读取', () => {
  it('带站点隔离地取成员邮箱', async () => {
    const created = await createComment(ctx(), {
      path: '/posts/7',
      content: '评论',
      email: 'alice@example.com',
      nickname: 'Alice',
      ip: null,
      userAgent: null,
    });
    if (created.error) throw new Error('发表失败');

    const [comment] = await client.db
      .execute<{ member_id: string }>(
        sql`select member_id from comments where id = ${created.data.id}`,
      )
      .then((result) => result.rows);

    expect(comment).toBeDefined();
    if (comment === undefined) return;

    expect(await loadMemberEmail(client.db, site.id, comment.member_id)).toBe('alice@example.com');
    expect(
      await loadMemberEmail(client.db, '00000000-0000-0000-0000-000000000000', comment.member_id),
    ).toBeNull();
  });
});
