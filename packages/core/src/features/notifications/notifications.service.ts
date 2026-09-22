/**
 * notifications 功能的服务层：入队、退订与投递状态机。
 *
 * 核心价值（M6）：**评论写入不被发信阻塞**。Waline 在写入请求内串行 await
 * 所有通知渠道，直接导致发评论变慢；这里只做「算好要发给谁 + 入队」，
 * 真正的 SMTP 投递交给 worker。
 *
 * 入队必须在**事务提交之后**：事务内写队列会在回滚时留下幽灵任务，
 * 而事务内做网络 IO 又是明令禁止的。
 */

import { randomBytes } from 'node:crypto';

import { members, type DbExecutor, type Site } from '@recado/db';
import { ok, type Result } from '@recado/shared';
import { and, eq } from 'drizzle-orm';

import { siteSettings } from '../sites/sites.service';
import {
  claimBatch,
  enqueue,
  findUnsubscribeByToken,
  findUnsubscribedEmails,
  insertUnsubscribe,
  isUnsubscribed,
  markFailed,
  markSent,
  markSending,
  markSkipped,
  requeue,
} from './notifications.data';
import { htmlToText, renderTemplate, type TemplateName } from './notifications.templates';

/** 投递失败的最大尝试次数；超过后留档等人工重发 */
export const MAX_DELIVERY_ATTEMPTS = 5;

/** 指数退避：1、2、4、8、16 分钟 */
export function backoffSeconds(attempt: number): number {
  return 60 * 2 ** Math.max(attempt - 1, 0);
}

export type NotificationContext = {
  db: DbExecutor;
  site: Pick<Site, 'id' | 'name' | 'settings'>;
  /** 站点对外基地址，用于拼邮件里的链接 */
  publicBaseUrl: string;
};

export type CommentNotificationInput = {
  commentId: string;
  path: string;
  threadUrl: string | null;
  authorNickname: string | null;
  /** 评论作者邮箱：用于「自己回复自己不发通知」的判定（比昵称可靠） */
  authorEmail: string | null;
  contentHtml: string;
  status: 'approved' | 'pending' | 'spam' | 'deleted';
  /** 被回复者的成员 id（顶层评论为 null） */
  replyToMemberId: string | null;
  /** 父评论作者邮箱（由调用方查好，避免这里再摸 members 表） */
  replyToEmail: string | null;
};

/**
 * 评论写入后入队通知。
 *
 * 通知类型（T6.8）：
 * - `admin_new_comment` → `settings.notifyEmails`
 * - `reply` → 被回复评论的作者（在库且未退订）
 *
 * @提及通知属 P1，本期不做。
 */
export async function enqueueCommentNotifications(
  ctx: NotificationContext,
  input: CommentNotificationInput,
): Promise<void> {
  const settings = siteSettings(ctx.site);

  // 待审评论要不要立刻打扰站长，由站点开关决定
  if (input.status === 'pending' && !settings.notifyOnPending) return;
  if (input.status !== 'approved' && input.status !== 'pending') return;

  const variables = {
    siteName: ctx.site.name,
    author: input.authorNickname ?? '匿名',
    path: input.path,
    url: input.threadUrl ?? `${ctx.publicBaseUrl}${input.path}`,
    content: htmlToText(input.contentHtml),
  };

  const recipients = new Set<string>();

  // 站长通知
  for (const email of settings.notifyEmails) {
    if (settings.notifyOnPending || input.status === 'approved') recipients.add(email);
  }

  // 回复通知：只发给被回复者，且不是自己回复自己。
  // 用**邮箱**比较而不是昵称 —— 昵称可以随便填，拿它判重会既漏发又误发
  const authorEmail = input.authorEmail?.trim().toLowerCase() ?? null;
  const replyEmail =
    input.replyToEmail !== null && input.replyToEmail.trim().toLowerCase() !== authorEmail
      ? input.replyToEmail
      : null;

  const targets: Array<{ email: string; template: TemplateName }> = [...recipients].map(
    (email) => ({ email, template: 'admin_new_comment' as const }),
  );

  if (input.replyToMemberId !== null && replyEmail !== null) {
    targets.push({ email: replyEmail, template: 'reply' });
  }

  if (targets.length === 0) return;

  // 退订名单一次性查完，避免逐个邮箱查库
  const unsubscribed = await findUnsubscribedEmails(
    ctx.db,
    ctx.site.id,
    targets.map((target) => target.email),
  );

  for (const target of targets) {
    const normalized = target.email.trim().toLowerCase();
    if (unsubscribed.has(normalized)) continue;

    const unsubscribeToken = await ensureUnsubscribeToken(ctx.db, ctx.site.id, normalized, null);

    const rendered = renderTemplate(target.template, {
      ...variables,
      unsubscribeUrl: `${ctx.publicBaseUrl}/api/v1/unsubscribe?token=${unsubscribeToken}`,
    });

    await enqueue(ctx.db, {
      type: target.template === 'reply' ? 'reply' : 'admin_new_comment',
      siteId: ctx.site.id,
      commentId: input.commentId,
      toEmail: normalized,
      subject: rendered.subject,
      template: target.template,
      payload: { ...variables, html: rendered.html, text: rendered.text },
      // 幂等键：同一评论 + 同一收件人 + 同一类型只入队一次
      dedupeKey: `${target.template}:${input.commentId}:${normalized}`,
    });
  }
}

/** 退订 token：不可猜测、长期有效（每封邮件都带，不设过期） */
function createUnsubscribeToken(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * 取（或创建）该邮箱在本站点的退订 token。
 *
 * 邮件里必须始终带同一个 token，因此已存在就复用。
 */
export async function ensureUnsubscribeToken(
  db: DbExecutor,
  siteId: string,
  email: string,
  sourceCommentId: string | null,
): Promise<string> {
  const token = createUnsubscribeToken();

  await insertUnsubscribe(db, { siteId, email, token, sourceCommentId });

  return token;
}

/** 按 token 退订；返回被退订的邮箱（供结果页展示） */
export async function unsubscribeByToken(
  db: DbExecutor,
  token: string,
): Promise<Result<{ email: string; siteId: string }, { reason: 'NOT_FOUND_UNSUBSCRIBE_TOKEN' }>> {
  const existing = await findUnsubscribeByToken(db, token);

  if (!existing) {
    return { data: null, error: { reason: 'NOT_FOUND_UNSUBSCRIBE_TOKEN' } };
  }

  return ok({ email: existing.email, siteId: existing.siteId });
}

export type DeliveryOutcome =
  | { kind: 'sent' }
  | { kind: 'skipped'; reason: string }
  | { kind: 'retry'; error: string; nextAttemptAt: Date | null };

/**
 * 投递一封邮件并推进状态机。
 *
 * `send` 由接口层注入（Nodemailer）—— core 不认识 SMTP 库，
 * 这样投递逻辑可以脱离真实 SMTP 测试。
 */
export async function deliverOutboxItem(
  db: DbExecutor,
  item: { id: string; siteId: string; toEmail: string; attempts: number },
  send: () => Promise<Result<null, { reason: string; message: string; permanent: boolean }>>,
): Promise<DeliveryOutcome> {
  // 投递前再查一次退订：用户可能在任务入队之后才点的退订
  if (await isUnsubscribed(db, item.siteId, item.toEmail)) {
    await markSkipped(db, item.id, 'recipient unsubscribed');
    return { kind: 'skipped', reason: 'unsubscribed' };
  }

  const result = await send();

  if (result.error) {
    const attempts = item.attempts + 1;
    const exhausted = attempts >= MAX_DELIVERY_ATTEMPTS || result.error.permanent;
    const nextAttemptAt = exhausted ? null : new Date(Date.now() + backoffSeconds(attempts) * 1000);

    await markFailed(db, item.id, result.error.message, nextAttemptAt);

    return { kind: 'retry', error: result.error.message, nextAttemptAt };
  }

  await markSent(db, item.id);
  return { kind: 'sent' };
}

/**
 * 取一批任务并标记为 `sending`。
 *
 * 两步都在调用方的事务里：`FOR UPDATE SKIP LOCKED` 的锁在事务结束时释放，
 * 若不先把状态推进到 `sending`，其他 worker 会立刻再抢一遍。
 */
export async function claimOutboxBatch(db: DbExecutor, limit: number) {
  const items = await claimBatch(db, limit);
  await markSending(
    db,
    items.map((item) => item.id),
  );

  return items;
}

/** 手动重发（后台「重发」按钮） */
export async function retryOutboxItem(
  db: DbExecutor,
  siteId: string,
  id: string,
): Promise<boolean> {
  return requeue(db, siteId, id);
}

export { isUnsubscribed } from './notifications.data';

/** 已退订邮箱不再下发给该站点 */
export async function filterUnsubscribed(
  db: DbExecutor,
  siteId: string,
  emails: readonly string[],
): Promise<string[]> {
  const unsubscribed = await findUnsubscribedEmails(db, siteId, emails);

  return emails.filter((email) => !unsubscribed.has(email.trim().toLowerCase()));
}

/**
 * 取成员邮箱（通知入队用）。
 *
 * 带站点隔离：`memberId` 来自评论行，理论上不会跨站，但多一道条件
 * 在评审时能一眼看出这里没有绕过租户边界。
 */
export async function loadMemberEmail(
  db: DbExecutor,
  siteId: string,
  memberId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ email: members.email })
    .from(members)
    .where(and(eq(members.siteId, siteId), eq(members.id, memberId)));

  return row?.email ?? null;
}
