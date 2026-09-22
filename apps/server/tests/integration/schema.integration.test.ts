/**
 * 表结构、约束与索引的**清点测试**。
 *
 * requirements.md §5.2 的验收项是「表结构、约束、索引与 §5.2 逐项一致」。
 * 逐项人工核对会随时间漂移，这里改为对着真实数据库断言清单：
 * 少一个索引、漏一个唯一约束都会让这个测试红掉。
 */

import { admins, auditLogs, comments, members, sites, threads, type DbClient } from '@recado/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ensureTestDatabase, openTestDatabase } from '../helpers/test-db';

/** 展开错误链：drizzle 的包装错误把驱动原始信息放在 `cause` 上 */
function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);

  const cause: unknown = error.cause;
  const causeText = cause instanceof Error ? cause.message : '';

  return `${error.message} ${causeText}`;
}

let client: DbClient;

beforeAll(async () => {
  await ensureTestDatabase();
  client = openTestDatabase();
});

afterAll(async () => {
  await client.close();
});

async function indexNames(table: string): Promise<string[]> {
  const result = await client.db.execute<{ indexname: string }>(
    sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = ${table}`,
  );

  return result.rows.map((row) => row.indexname).sort();
}

async function columnNames(table: string): Promise<string[]> {
  const result = await client.db.execute<{ column_name: string }>(
    sql`SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${table}`,
  );

  return result.rows.map((row) => row.column_name).sort();
}

describe('§5.2 表清单', () => {
  it('12 张业务表全部存在', async () => {
    const result = await client.db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );

    // 过滤掉 drizzle 自己的迁移记录表；在 JS 里过滤而不是写 LIKE 转义，
    // 免得被 standard_conforming_strings 这类连接级设置影响
    const tables = result.rows
      .map((row) => row.table_name)
      .filter((name) => !name.startsWith('__'))
      .sort();

    expect(tables).toEqual([
      'admins',
      'audit_logs',
      'comment_mentions',
      'comments',
      'labels',
      'member_labels',
      'members',
      'outbox',
      'sessions',
      'sites',
      'threads',
      'unsubscribes',
    ]);
  });

  it('启用 citext 扩展（members.email 依赖它做大小写不敏感归并）', async () => {
    const result = await client.db.execute<{ extname: string }>(
      sql`SELECT extname FROM pg_extension WHERE extname = 'citext'`,
    );

    expect(result.rows).toHaveLength(1);
  });
});

describe('§5.2 索引与约束清单', () => {
  it('comments 的四条索引一条不少（GIN(search_vector) 属 P1）', async () => {
    const names = await indexNames('comments');

    expect(names).toEqual(
      expect.arrayContaining([
        'comments_pkey',
        'comments_site_id_path_status_created_at_idx',
        'comments_site_id_status_created_at_idx',
        'comments_root_id_created_at_idx',
        'comments_member_id_idx',
      ]),
    );
    expect(names.some((name) => name.includes('search_vector'))).toBe(false);
  });

  it('comments 双存原文与渲染结果', async () => {
    const columns = await columnNames('comments');

    expect(columns).toEqual(
      expect.arrayContaining([
        'content_md',
        'content_html',
        'content_bytes',
        'author_nickname',
        'author_website',
        'ip',
        'user_agent',
        'deleted_at',
      ]),
    );
  });

  it('members 有 (site_id, email) 唯一约束与 email 索引', async () => {
    const names = await indexNames('members');

    expect(names).toEqual(
      expect.arrayContaining(['members_site_id_email_unique', 'members_email_idx']),
    );
  });

  it('threads 有 (site_id, path) 唯一约束', async () => {
    expect(await indexNames('threads')).toContain('threads_site_id_path_unique');
  });

  it('labels 有 (site_id, name) 唯一约束，member_labels 是复合主键', async () => {
    expect(await indexNames('labels')).toContain('labels_site_id_name_unique');
    expect(await indexNames('member_labels')).toContain('member_labels_member_id_label_id_pk');
  });

  it('outbox 的 dedupe_key 唯一，并有 worker 轮询索引', async () => {
    const names = await indexNames('outbox');

    expect(names).toEqual(
      expect.arrayContaining(['outbox_dedupe_key_unique', 'outbox_status_scheduled_at_idx']),
    );
  });

  it('unsubscribes 的 token 唯一，并有 (site_id, email) 查询索引', async () => {
    const names = await indexNames('unsubscribes');

    expect(names).toEqual(
      expect.arrayContaining(['unsubscribes_token_unique', 'unsubscribes_site_id_email_idx']),
    );
  });

  it('admins.oidc_subject 唯一', async () => {
    expect(await indexNames('admins')).toContain('admins_oidc_subject_unique');
  });

  it('admins 刻意不含 role 列（权限由 IdP 驱动）', async () => {
    expect(await columnNames('admins')).not.toContain('role');
  });
});

describe('外键行为', () => {
  it('删除站点会级联清理业务数据，但审计日志保留且 site_id 置空', async () => {
    const [site] = await client.db
      .insert(sites)
      .values({ key: 'rc_cascade00000000000001', name: '级联测试' })
      .returning();
    if (!site) throw new Error('插入站点失败');

    const [thread] = await client.db
      .insert(threads)
      .values({ siteId: site.id, path: '/cascade' })
      .returning();
    const [member] = await client.db
      .insert(members)
      .values({ siteId: site.id, email: 'cascade@example.com' })
      .returning();
    if (!thread || !member) throw new Error('插入依赖数据失败');

    await client.db.insert(comments).values({
      siteId: site.id,
      threadId: thread.id,
      path: '/cascade',
      memberId: member.id,
      contentMd: 'hello',
      contentHtml: '<p>hello</p>',
      contentBytes: 5,
      status: 'approved',
    });
    await client.db.insert(auditLogs).values({
      siteId: site.id,
      action: 'site.create',
      targetType: 'site',
      targetId: site.id,
    });

    await client.db.delete(sites).where(eq(sites.id, site.id));

    const remainingComments = await client.db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM comments WHERE site_id = ${site.id}`,
    );
    const remainingMembers = await client.db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM members WHERE site_id = ${site.id}`,
    );
    const remainingThreads = await client.db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM threads WHERE site_id = ${site.id}`,
    );
    expect(remainingComments.rows[0]?.count).toBe('0');
    expect(remainingMembers.rows[0]?.count).toBe('0');
    expect(remainingThreads.rows[0]?.count).toBe('0');

    const audits = await client.db.select().from(auditLogs).where(eq(auditLogs.targetId, site.id));

    expect(audits).toHaveLength(1);
    expect(audits[0]?.siteId).toBeNull();
  });

  it('admins.oidc_subject 唯一约束会拒绝重复主体', async () => {
    await client.db.delete(admins).where(eq(admins.oidcSubject, 'iss#dup'));
    await client.db.insert(admins).values({ oidcSubject: 'iss#dup', kind: 'human' });

    const outcome = await client.db
      .insert(admins)
      .values({ oidcSubject: 'iss#dup', kind: 'machine' })
      .then(() => null)
      .catch((error: unknown) => error);

    // drizzle 会把驱动错误包一层（DrizzleQueryError），真正的原因在 cause 上
    expect(describeError(outcome)).toMatch(/duplicate key|unique/i);
  });
});
