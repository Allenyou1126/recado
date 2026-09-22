/**
 * outbox worker —— 异步投递邮件。
 *
 * 这是 M6 的核心：评论写入只入队，投递在这里慢慢做。Waline 在写入请求内
 * 串行 await 所有通知渠道，发评论因此变慢；我们把它彻底挪出请求路径。
 *
 * 可靠性要点：
 * - `FOR UPDATE SKIP LOCKED` + 事务内推进状态 → 多实例并发不会重复投递
 * - **单条失败不中断整个循环**（§6.4）：失败只标记该条并安排退避
 * - 指数退避，超过上限后留档等人工重发
 * - 循环本身不允许抛出：任何异常都记账后继续下一轮
 */

import { claimOutboxBatch, deliverOutboxItem, getSiteById, siteSettings } from '@recado/core';
import { err, type Result } from '@recado/shared';

import type { Env } from '../config/env.server';
import { getDbClient } from './db.server';
import { createLogger } from './logger.server';
import { sendMail, type SendError } from './mailer.server';

/** 每轮最多领多少条：太小则吞吐低，太大则单轮占用连接过久 */
export const DRAIN_BATCH_SIZE = 20;

/** 轮询间隔（毫秒）。小规模部署（Q-15）下 30 秒足够 */
export const POLL_INTERVAL_MS = 30_000;

export type DrainSummary = {
  claimed: number;
  sent: number;
  failed: number;
  skipped: number;
};

/**
 * 跑一轮投递。可被外部 cron 复用（见 `/internal/outbox/drain`）。
 *
 * @param limit 本轮最多处理多少条
 */
export async function drainOutbox(env: Env, limit = DRAIN_BATCH_SIZE): Promise<DrainSummary> {
  const logger = createLogger(env, { bindings: { worker: 'outbox' } });
  const client = getDbClient(env.DATABASE_URL);

  const summary: DrainSummary = { claimed: 0, sent: 0, failed: 0, skipped: 0 };

  // 抢占必须在事务里：锁在事务结束时释放，状态要同时推进到 sending
  const batch = await client.db.transaction(async (tx) => claimOutboxBatch(tx, limit));

  summary.claimed = batch.length;

  for (const item of batch) {
    try {
      const site = await getSiteById(client.db, item.siteId);

      if (!site) {
        // 站点被删了，任务没有意义
        await deliverOutboxItem(client.db, item, async () =>
          err({
            reason: 'SMTP_SEND_FAILED',
            message: 'Site no longer exists',
            permanent: true,
          }),
        );
        summary.failed += 1;
        continue;
      }

      const settings = siteSettings(site);
      const payload = item.payload;

      const result = await deliverOutboxItem(
        client.db,
        item,
        () =>
          sendMail(env, site.id, settings.smtp, {
            to: item.toEmail,
            subject: item.subject,
            html: typeof payload['html'] === 'string' ? payload['html'] : '',
            text: typeof payload['text'] === 'string' ? payload['text'] : '',
            unsubscribeUrl:
              typeof payload['unsubscribeUrl'] === 'string' ? payload['unsubscribeUrl'] : undefined,
          }) as Promise<Result<null, SendError>>,
      );

      switch (result.kind) {
        case 'sent':
          summary.sent += 1;
          break;
        case 'skipped':
          summary.skipped += 1;
          break;
        case 'retry':
          summary.failed += 1;
          // 失败原因只记在 outbox 行里，日志不打收件人邮箱
          logger.warn(
            { outboxId: item.id, reason: result.error },
            'outbox delivery failed, scheduled for retry',
          );
          break;
      }
    } catch (cause) {
      // 单条任务的异常绝不中断整批 —— 否则一条坏数据会卡死整个队列
      summary.failed += 1;
      logger.error({ err: cause, outboxId: item.id }, 'unexpected error while delivering');
    }
  }

  return summary;
}

/**
 * 启动 worker（模块级 setInterval）。
 *
 * 框架没有任何调度器（requirements.md §8.5），常驻 Node 服务下模块级定时器
 * 就是正确的宿主能力。用一个 `running` 标志防止上一轮没跑完就叠加下一轮。
 */
export function startOutboxWorker(env: Env): () => void {
  const logger = createLogger(env, { bindings: { worker: 'outbox' } });
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;

    try {
      const summary = await drainOutbox(env);
      if (summary.claimed > 0) {
        logger.info(summary, 'outbox drained');
      }
    } catch (cause) {
      // 数据库不可用等情况：记账后继续，不要让定时器挂掉
      logger.error({ err: cause }, 'outbox drain failed');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, POLL_INTERVAL_MS);

  // 不阻止进程退出：停机流程由 T9.6 的优雅停机负责
  timer.unref();

  logger.info({ intervalMs: POLL_INTERVAL_MS }, 'outbox worker started');

  return () => {
    clearInterval(timer);
    logger.info('outbox worker stopped');
  };
}
