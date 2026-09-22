/**
 * 审核、声誉与审计的集成测试（阶段 5）。
 *
 * 覆盖验收项：
 * - 标记垃圾后，该邮箱在本站点的**下一条**评论自动进入 pending
 * - 恢复为 approved 后，声誉计数与线程计数**对称回滚**
 * - 批量操作部分失败时返回明细，且不留下部分写入
 * - 关键词检索匹配的是**原文**，不是渲染后的 HTML
 */

import {
  AuditActions,
  batchChangeStatus,
  canTransition,
  changeCommentStatus,
  createComment,
  determineInitialStatus,
  editCommentContent,
  getThreadMeta,
  listAdminComments,
  listComments,
  queryAuditLogs,
  siteSettings,
  type CommentContext,
  type ModerationContext,
} from '@recado/core';
import { comments, members, sites, type DbClient, type Site } from '@recado/db';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureTestDatabase, openTestDatabase } from '../helpers/test-db';

let client: DbClient;
let site: Site;

const PATH = '/posts/moderated';

beforeAll(async () => {
  await ensureTestDatabase();
  client = openTestDatabase();
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await client.db.execute(sql`TRUNCATE TABLE sites CASCADE`);
  await client.db.execute(sql`TRUNCATE TABLE audit_logs CASCADE`);

  const [row] = await client.db
    .insert(sites)
    .values({
      key: 'rc_moderation000000000001',
      name: '审核测试站',
      settings: { minIntervalSeconds: 0, spamThreshold: 1 },
    })
    .returning();
  if (!row) throw new Error('插入站点失败');
  site = row;
});

const commentCtx = (): CommentContext => ({ db: client.db, site });
const modCtx = (): ModerationContext => ({
  db: client.db,
  site,
  actorId: null,
  ip: '203.0.113.9',
});

async function seedComment(content = '评论内容', email = 'alice@example.com') {
  const result = await createComment(commentCtx(), {
    path: PATH,
    content,
    email,
    nickname: 'Alice',
    ip: '203.0.113.9',
    userAgent: 'vitest',
  });

  if (result.error) throw new Error(`发表失败：${result.error.reason}`);
  return result.data;
}

describe('状态机（T5.1）', () => {
  it('合法转移表与非法转移', () => {
    expect(canTransition('pending', 'approved')).toBe(true);
    expect(canTransition('approved', 'spam')).toBe(true);
    expect(canTransition('spam', 'approved')).toBe(true);
    expect(canTransition('spam', 'pending')).toBe(false);
    // 软删是终点：本系统不提供恢复已删除评论
    expect(canTransition('deleted', 'approved')).toBe(false);
    expect(canTransition('approved', 'deleted')).toBe(true);
  });

  it('非法转移返回 CONFLICT_INVALID_STATUS_TRANSITION 且不改动数据', async () => {
    const created = await seedComment();
    await changeCommentStatus(modCtx(), created.id, 'deleted');

    const again = await changeCommentStatus(modCtx(), created.id, 'approved');

    expect(again.error?.reason).toBe('CONFLICT_INVALID_STATUS_TRANSITION');
    const [row] = await client.db.select().from(comments).where(eq(comments.id, created.id));
    expect(row?.status).toBe('deleted');
  });

  it('审核模式 none / first_time / all 的初始状态', () => {
    const fresh = { reviewRequired: false, commentCount: 0 };
    const known = { reviewRequired: false, commentCount: 3 };
    const flagged = { reviewRequired: true, commentCount: 3 };

    expect(determineInitialStatus(fresh, 'none')).toBe('approved');
    expect(determineInitialStatus(fresh, 'first_time')).toBe('pending');
    expect(determineInitialStatus(known, 'first_time')).toBe('approved');
    expect(determineInitialStatus(known, 'all')).toBe('pending');
    // 声誉降级优先于站点模式
    expect(determineInitialStatus(flagged, 'none')).toBe('pending');
  });
});

describe('标记垃圾的原子副作用（T5.3）与声誉（T5.4）', () => {
  it('标记垃圾后计数下降、spam_count 上升、审计留痕', async () => {
    const created = await seedComment();

    const result = await changeCommentStatus(modCtx(), created.id, 'spam');

    expect(result.data).toMatchObject({ from: 'approved', to: 'spam', spamCount: 1 });

    // 线程与成员的已发布计数都要 -1
    const meta = await getThreadMeta(client.db, site.id, PATH);
    expect(meta.data?.commentCount).toBe(0);

    const [member] = await client.db
      .select()
      .from(members)
      .where(and(eq(members.siteId, site.id), eq(members.email, 'alice@example.com')));
    expect(member?.commentCount).toBe(0);
    expect(member?.spamCount).toBe(1);

    // 公开列表不再包含它
    const list = await listComments(commentCtx(), { path: PATH, sort: 'latest', page: 1 });
    expect(list.data?.total).toBe(0);

    const audit = await queryAuditLogs(client.db, { siteId: site.id, limit: 10, offset: 0 });
    expect(audit.rows.map((row) => row.action)).toContain(AuditActions.commentStatusChanged);
  });

  it('被标记垃圾后，该邮箱的下一条评论自动进入 pending', async () => {
    const first = await seedComment('第一条');
    await changeCommentStatus(modCtx(), first.id, 'spam');

    const second = await seedComment('第二条');

    expect(second.content).toContain('第二条');

    const [row] = await client.db
      .select()
      .from(comments)
      .where(and(eq(comments.siteId, site.id), eq(comments.contentMd, '第二条')));
    expect(row?.status).toBe('pending');

    // pending 不出现在公开列表
    const list = await listComments(commentCtx(), { path: PATH, sort: 'latest', page: 1 });
    expect(list.data?.total).toBe(0);
  });

  it('恢复为 approved 时声誉与线程计数对称回滚', async () => {
    const created = await seedComment('第一条');
    await changeCommentStatus(modCtx(), created.id, 'spam');

    const restored = await changeCommentStatus(modCtx(), created.id, 'approved');

    expect(restored.data).toMatchObject({ to: 'approved', spamCount: 0, reviewRequired: false });

    const meta = await getThreadMeta(client.db, site.id, PATH);
    expect(meta.data?.commentCount).toBe(1);

    const [member] = await client.db
      .select()
      .from(members)
      .where(and(eq(members.siteId, site.id), eq(members.email, 'alice@example.com')));
    expect(member?.spamCount).toBe(0);
    expect(member?.reviewRequired).toBe(false);
    expect(member?.commentCount).toBe(1);

    // 恢复后该邮箱的新评论重新放行
    const next = await seedComment('恢复后的评论');
    const [row] = await client.db
      .select()
      .from(comments)
      .where(and(eq(comments.siteId, site.id), eq(comments.contentMd, '恢复后的评论')));
    expect(row?.status).toBe('approved');
    expect(next.id).toBeTruthy();
  });

  it('spamThreshold=2 时第一次标记还不降级', async () => {
    const [lenientSite] = await client.db
      .insert(sites)
      .values({
        key: 'rc_moderation000000000002',
        name: '阈值 2 的站',
        settings: { minIntervalSeconds: 0, spamThreshold: 2 },
      })
      .returning();
    if (!lenientSite) throw new Error('插入站点失败');

    const created = await createComment(
      { db: client.db, site: lenientSite },
      {
        path: PATH,
        content: '评论',
        email: 'bob@example.com',
        nickname: 'Bob',
        ip: null,
        userAgent: null,
      },
    );
    if (created.error) throw new Error('发表失败');

    const result = await changeCommentStatus(
      { db: client.db, site: lenientSite, actorId: null },
      created.data.id,
      'spam',
    );

    expect(result.data?.spamCount).toBe(1);
    expect(result.data?.reviewRequired).toBe(false);
    expect(siteSettings(lenientSite).spamThreshold).toBe(2);
  });
});

describe('批量操作（T5.6）', () => {
  it('全部合法时整批生效', async () => {
    const first = await seedComment('一', 'a@example.com');
    const second = await seedComment('二', 'b@example.com');

    const result = await batchChangeStatus(modCtx(), [first.id, second.id], 'spam');

    expect(result.data).toMatchObject({ requested: 2, applied: 2, failures: [] });
  });

  it('存在非法项时返回明细，且**不留下部分写入**', async () => {
    const good = await seedComment('好的一条', 'a@example.com');
    const alsoGood = await seedComment('另一条', 'b@example.com');
    const deleted = await seedComment('已删除的', 'c@example.com');
    await changeCommentStatus(modCtx(), deleted.id, 'deleted');

    // 把 deleted 一起提交：它无法再转到 spam
    const result = await batchChangeStatus(modCtx(), [good.id, alsoGood.id, deleted.id], 'spam');

    expect(result.error?.reason).toBe('CONFLICT_BATCH_PARTIAL_FAILURE');
    expect(result.error?.failures).toEqual([
      {
        commentId: deleted.id,
        reason: 'CONFLICT_INVALID_STATUS_TRANSITION',
        details: { from: 'deleted', to: 'spam' },
      },
    ]);

    // 合法项也没有被改：批量操作要么全成要么全不成
    const rows = await client.db.select().from(comments).where(eq(comments.siteId, site.id));
    expect(rows.every((row) => row.status === 'approved' || row.status === 'deleted')).toBe(true);
  });

  it('不存在的评论计入失败明细', async () => {
    const result = await batchChangeStatus(
      modCtx(),
      ['00000000-0000-0000-0000-000000000000'],
      'spam',
    );

    expect(result.error?.failures[0]?.reason).toBe('NOT_FOUND_COMMENT');
  });
});

describe('管理员编辑评论（T5.7）', () => {
  it('改原文后重新渲染 HTML 并留审计', async () => {
    const created = await seedComment('原始内容');

    const result = await editCommentContent(modCtx(), created.id, '改过的 **新内容**');
    expect(result.error).toBeNull();

    const [row] = await client.db.select().from(comments).where(eq(comments.id, created.id));
    expect(row?.contentMd).toBe('改过的 **新内容**');
    expect(row?.contentHtml).toContain('<strong>新内容</strong>');
    // 字节数同步更新
    expect(row?.contentBytes).toBe(new TextEncoder().encode('改过的 **新内容**').length);

    const audit = await queryAuditLogs(client.db, { siteId: site.id, limit: 10, offset: 0 });
    expect(audit.rows.map((item) => item.action)).toContain(AuditActions.commentEdited);
  });

  it('编辑后内容超长会被拒绝', async () => {
    const created = await seedComment('短内容');

    const result = await editCommentContent(modCtx(), created.id, 'a'.repeat(20_000));

    expect(result.error?.reason).toBe('VALIDATION_CONTENT_TOO_LONG');
  });
});

describe('删除（T5.8）', () => {
  it('删除顶层评论不级联，子回复保留并渲染占位', async () => {
    const root = await seedComment('顶层', 'root@example.com');
    const reply = await createComment(commentCtx(), {
      path: PATH,
      content: '子回复',
      email: 'reply@example.com',
      nickname: 'Reply',
      parentId: root.id,
      ip: null,
      userAgent: null,
    });
    if (reply.error) throw new Error('回复失败');

    await changeCommentStatus(modCtx(), root.id, 'deleted');

    const list = await listComments(commentCtx(), { path: PATH, sort: 'latest', page: 1 });
    expect(list.data?.total).toBe(1);

    const placeholder = list.data?.comments[0];
    expect(placeholder?.status).toBe('deleted');
    // 占位不回显署名与正文
    expect(placeholder?.nickname).toBeNull();
    expect(placeholder?.content).toBe('');
    // 子回复仍在
    expect(placeholder?.replies).toHaveLength(1);
    expect(placeholder?.replies?.[0]?.content).toContain('子回复');
  });

  it('删除后线程计数不再包含它', async () => {
    const root = await seedComment('顶层', 'root@example.com');
    await changeCommentStatus(modCtx(), root.id, 'deleted');

    const meta = await getThreadMeta(client.db, site.id, PATH);
    expect(meta.data?.commentCount).toBe(0);
  });
});

describe('管理端列表与关键词检索（T5.5 / T5.10）', () => {
  it('按状态与路径筛选', async () => {
    const approved = await seedComment('已通过', 'a@example.com');
    const spam = await seedComment('垃圾', 'b@example.com');
    await changeCommentStatus(modCtx(), spam.id, 'spam');
    expect(approved.id).toBeTruthy();

    const spams = await listAdminComments(commentCtx(), {
      status: 'spam',
      sort: 'latest',
      limit: 50,
      offset: 0,
    });
    const others = await listAdminComments(commentCtx(), {
      path: '/posts/nowhere',
      sort: 'latest',
      limit: 50,
      offset: 0,
    });

    expect(spams.total).toBe(1);
    expect(spams.rows[0]?.contentMd).toBe('垃圾');
    expect(others.total).toBe(0);
  });

  it('关键词检索匹配**原文**而不是渲染后的 HTML', async () => {
    await seedComment('这里有 **加粗** 的内容', 'a@example.com');

    // 原文里的字面量可以命中
    const byMd = await listAdminComments(commentCtx(), {
      keyword: '**加粗**',
      sort: 'latest',
      limit: 50,
      offset: 0,
    });
    // HTML 里的标签检索不到（说明查的是原文）
    const byHtml = await listAdminComments(commentCtx(), {
      keyword: '<strong>',
      sort: 'latest',
      limit: 50,
      offset: 0,
    });

    expect(byMd.total).toBe(1);
    expect(byHtml.total).toBe(0);
  });

  it('管理端列表带站点隔离', async () => {
    await seedComment('本站评论', 'a@example.com');

    const otherSite = await listAdminComments(
      { db: client.db, site: { ...site, id: '00000000-0000-0000-0000-000000000000' } },
      { sort: 'latest', limit: 50, offset: 0 },
    );

    expect(otherSite.total).toBe(0);
  });
});

describe('审计日志（T5.9）', () => {
  it('记录操作主体、动作、目标与 diff，并按站点隔离', async () => {
    const created = await seedComment('审计用评论', 'a@example.com');
    await changeCommentStatus(modCtx(), created.id, 'spam');

    const logs = await queryAuditLogs(client.db, { siteId: site.id, limit: 10, offset: 0 });
    const entry = logs.rows.find((row) => row.targetId === created.id);

    expect(entry).toBeDefined();
    expect(entry?.action).toBe(AuditActions.commentStatusChanged);
    expect(entry?.targetType).toBe('comment');
    expect(entry?.diff).toMatchObject({ from: 'approved', to: 'spam' });

    const otherSiteLogs = await queryAuditLogs(client.db, {
      siteId: '00000000-0000-0000-0000-000000000000',
      limit: 10,
      offset: 0,
    });
    expect(otherSiteLogs.total).toBe(0);
  });
});
