/**
 * notifications 功能的数据访问层（Repo）。
 *
 * outbox 是**队列**，因此这里的查询形态和业务表不同：worker 要用
 * `FOR UPDATE SKIP LOCKED` 抢占任务，多实例并发时才不会重复投递。
 */

import {
  outbox,
  unsubscribes,
  type DbExecutor,
  type NewOutboxItem,
  type OutboxItem,
} from '@recado/db';
import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm';

/**
 * 入队（幂等）。
 *
 * `dedupe_key` 唯一 + `ON CONFLICT DO NOTHING`：同一事件重复入队只保留一条。
 * 这不是「防重复点击」的锦上添花 —— 评论服务可能被重试、worker 可能重启，
 * 没有幂等键就会重复发信。
 */
export async function enqueue(
  db: DbExecutor,
  item: NewOutboxItem,
): Promise<OutboxItem | undefined> {
  const [row] = await db.insert(outbox).values(item).onConflictDoNothing().returning();

  return row;
}

/**
 * 抢占一批待发送任务。
 *
 * `FOR UPDATE SKIP LOCKED` 是并发安全的关键：多个 worker 同时轮询时，
 * 每个只会拿到自己锁住的行，不会有两个实例投递同一封邮件。
 *
 * 返回后**必须在同一事务内**把状态推进到 `sending`，否则锁一释放
 * 别的 worker 会再抢一遍。
 */
export async function claimBatch(db: DbExecutor, limit: number): Promise<OutboxItem[]> {
  return db
    .select()
    .from(outbox)
    .where(and(inArray(outbox.status, ['queued', 'failed']), lte(outbox.scheduledAt, new Date())))
    .orderBy(asc(outbox.scheduledAt))
    .limit(limit)
    .for('update', { skipLocked: true });
}

export async function markSending(db: DbExecutor, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;

  await db
    .update(outbox)
    .set({ status: 'sending' })
    .where(inArray(outbox.id, [...ids]));
}

export async function markSent(db: DbExecutor, id: string): Promise<void> {
  await db
    .update(outbox)
    .set({ status: 'sent', sentAt: new Date(), lastError: null })
    .where(eq(outbox.id, id));
}

/** 失败：记录原因并安排下一次尝试（指数退避由调用方算好） */
export async function markFailed(
  db: DbExecutor,
  id: string,
  error: string,
  nextAttemptAt: Date | null,
): Promise<void> {
  // 用 SQL 自增而不是「读出来 +1」：并发重试时后者会丢更新
  await db
    .update(outbox)
    .set({
      status: nextAttemptAt === null ? 'failed' : 'queued',
      attempts: sql`${outbox.attempts} + 1`,
      lastError: error.slice(0, 500),
      scheduledAt: nextAttemptAt ?? new Date(),
    })
    .where(eq(outbox.id, id));
}

/** 标记为跳过（例如已退订），不再重试 */
export async function markSkipped(db: DbExecutor, id: string, reason: string): Promise<void> {
  await db
    .update(outbox)
    .set({ status: 'skipped', lastError: reason.slice(0, 500) })
    .where(eq(outbox.id, id));
}

export async function findOutboxItem(db: DbExecutor, id: string): Promise<OutboxItem | undefined> {
  return db.query.outbox.findFirst({ where: eq(outbox.id, id) });
}

export async function listOutbox(
  db: DbExecutor,
  siteId: string,
  query: { status?: OutboxItem['status'] | undefined; limit: number; offset: number },
): Promise<{ rows: OutboxItem[]; total: number }> {
  const scope = and(
    eq(outbox.siteId, siteId),
    query.status === undefined ? undefined : eq(outbox.status, query.status),
  );

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(outbox)
      .where(scope)
      .orderBy(asc(outbox.scheduledAt))
      .limit(query.limit)
      .offset(query.offset),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(outbox)
      .where(scope),
  ]);

  return { rows, total: totals[0]?.value ?? 0 };
}

/** 手动重发：把 failed 的任务放回队列并清零退避 */
export async function requeue(db: DbExecutor, siteId: string, id: string): Promise<boolean> {
  const rows = await db
    .update(outbox)
    .set({ status: 'queued', scheduledAt: new Date(), lastError: null })
    .where(and(eq(outbox.siteId, siteId), eq(outbox.id, id), eq(outbox.status, 'failed')))
    .returning({ id: outbox.id });

  return rows.length > 0;
}

/**
 * 该邮箱是否已在此站点退订。
 *
 * `email` 是 citext，因此大小写不敏感 —— 用户用 `Alice@x.com` 退订后，
 * 发给 `alice@x.com` 的邮件同样应当被拦下。
 */
export async function isUnsubscribed(
  db: DbExecutor,
  siteId: string,
  email: string,
): Promise<boolean> {
  const row = await db.query.unsubscribes.findFirst({
    where: and(eq(unsubscribes.siteId, siteId), eq(unsubscribes.email, email)),
  });

  return row !== undefined;
}

/** 批量查询退订状态：一次投递一批时避免逐条查库 */
export async function findUnsubscribedEmails(
  db: DbExecutor,
  siteId: string,
  emails: readonly string[],
): Promise<Set<string>> {
  if (emails.length === 0) return new Set();

  const rows = await db
    .select({ email: unsubscribes.email })
    .from(unsubscribes)
    .where(
      and(
        eq(unsubscribes.siteId, siteId),
        or(...emails.map((email) => eq(unsubscribes.email, email))),
      ),
    );

  return new Set(rows.map((row) => row.email.toLowerCase()));
}

export async function insertUnsubscribe(
  db: DbExecutor,
  values: {
    siteId: string;
    email: string;
    token: string;
    sourceCommentId: string | null;
  },
): Promise<void> {
  await db.insert(unsubscribes).values(values).onConflictDoNothing({ target: unsubscribes.token });
}

export async function findUnsubscribeByToken(db: DbExecutor, token: string) {
  return db.query.unsubscribes.findFirst({ where: eq(unsubscribes.token, token) });
}

export async function listUnsubscribes(
  db: DbExecutor,
  siteId: string,
  query: { limit: number; offset: number },
) {
  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(unsubscribes)
      .where(eq(unsubscribes.siteId, siteId))
      .orderBy(asc(unsubscribes.createdAt))
      .limit(query.limit)
      .offset(query.offset),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(unsubscribes)
      .where(eq(unsubscribes.siteId, siteId)),
  ]);

  return { rows, total: totals[0]?.value ?? 0 };
}
