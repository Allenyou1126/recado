/**
 * SMTP 投递（Nodemailer）。
 *
 * 配置是**站点级**的（决策 Q-10）：每个站点在后台填自己的主机 / 账号 / 发件人，
 * 因此这里按站点取配置，而不是全局一个 transport。
 *
 * 外部 IO 边界：网络失败是**预期**的，一律用 `Result` 返回（§6.4），
 * 并把「永久失败」（认证失败、地址非法）与「临时失败」（连接超时）分开 ——
 * 前者重试多少次都没用，应当直接留档等人工处理。
 */

import { decryptSecret, type SmtpSettings } from '@recado/core';
import { domainError, err, ok, type Result } from '@recado/shared';
import nodemailer, { type Transporter } from 'nodemailer';

import type { Env } from '../config/env.server';

export type MailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** 退订链接要作为 List-Unsubscribe 头带上，邮件客户端才能显示原生退订按钮 */
  unsubscribeUrl?: string | undefined;
};

export type SendError = {
  reason: 'SMTP_SEND_FAILED' | 'SMTP_NOT_CONFIGURED';
  message: string;
  /** 永久失败不重试 */
  permanent: boolean;
};

/** transport 按站点 + 配置指纹缓存：每封邮件新建连接池会拖慢投递 */
const transportCache = new Map<string, Transporter>();

function cacheKey(siteId: string, settings: SmtpSettings): string {
  return [
    siteId,
    settings.host,
    String(settings.port),
    String(settings.secure),
    settings.user ?? '',
    settings.pass ?? '',
    settings.fromEmail,
  ].join('|');
}

/** 仅供测试：清空 transport 缓存 */
export function resetTransportCache(): void {
  for (const transport of transportCache.values()) transport.close();
  transportCache.clear();
}

export function buildTransport(env: Env, smtp: SmtpSettings): Transporter {
  const password = smtp.pass === undefined ? undefined : decryptSecret(smtp.pass, env.SECRETS_KEY);

  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    ...(smtp.user === undefined || password === null
      ? {}
      : { auth: { user: smtp.user, pass: password ?? '' } }),
    // 单实例小规模部署：并发 3 足够，且不至于被收件方当成批量发信
    pool: true,
    maxConnections: 3,
  });

  return transport;
}

function getTransport(env: Env, siteId: string, smtp: SmtpSettings): Transporter {
  const key = cacheKey(siteId, smtp);
  const cached = transportCache.get(key);

  if (cached !== undefined) return cached;

  const transport = buildTransport(env, smtp);
  transportCache.set(key, transport);

  return transport;
}

/**
 * 发送一封邮件。
 *
 * @param smtp 站点级 SMTP 配置；未配置时返回 `SMTP_NOT_CONFIGURED`
 */
export async function sendMail(
  env: Env,
  siteId: string,
  smtp: SmtpSettings | null,
  message: MailMessage,
): Promise<Result<null, SendError>> {
  if (smtp === null) {
    return err({
      reason: 'SMTP_NOT_CONFIGURED',
      message: 'This site has no SMTP configuration',
      permanent: true,
    });
  }

  try {
    const transport = getTransport(env, siteId, smtp);

    await transport.sendMail({
      from: smtp.fromName === undefined ? smtp.fromEmail : `"${smtp.fromName}" <${smtp.fromEmail}>`,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(message.unsubscribeUrl === undefined
        ? {}
        : { list: { unsubscribe: `<${message.unsubscribeUrl}>` } }),
    });

    return ok(null);
  } catch (cause) {
    const code =
      typeof cause === 'object' && cause !== null ? Reflect.get(cause, 'code') : undefined;
    const message = cause instanceof Error ? cause.message : String(cause);

    // 认证失败、地址被拒这类问题重试无用，直接标永久失败
    const permanent =
      typeof code === 'string' && ['EAUTH', 'EENVELOPE', 'EMESSAGE', 'EACCES'].includes(code);

    return err({
      reason: 'SMTP_SEND_FAILED',
      // 只保留状态码与简要信息：SMTP 的错误里可能带账号信息
      message: typeof code === 'string' ? `${code}: ${message}` : message,
      permanent,
    });
  }
}

/** 站点未配置 SMTP 时给接口层用的统一错误 */
export const smtpNotConfigured = domainError(
  'CONFLICT_SMTP_NOT_CONFIGURED',
  'Site SMTP is not configured',
);
