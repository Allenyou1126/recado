/**
 * 日志脱敏工具。
 *
 * 硬性约束（.specs/development-standards.md §8.6、AGENTS.md）：
 * 日志**禁止**出现邮箱明文、完整 IP、Cookie、OIDC token、SMTP 密码、site key。
 *
 * 需要把两次日志关联起来时，用哈希或后缀而不是原文 —— 既能定位问题，
 * 又不构成新的个人数据泄漏面。
 */

import { createHash } from 'node:crypto';

/** 邮箱：保留首字符与域名，形如 `a***@example.com` */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '***';

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, 1);

  return `${head}***@${domain}`;
}

/** IPv4 抹掉后两段，IPv6 只保留前两组 */
export function maskIp(ip: string): string {
  if (ip.includes(':')) {
    const groups = ip.split(':').filter(Boolean);
    return `${groups.slice(0, 2).join(':')}::…`;
  }

  const octets = ip.split('.');
  if (octets.length !== 4) return '***';
  return `${octets[0]}.${octets[1]}.x.x`;
}

/** 只保留末尾若干位，用于「同一个值吗」这类关联判断 */
export function keepTail(value: string, length = 4): string {
  if (value.length <= length) return '***';
  return `***${value.slice(-length)}`;
}

/**
 * 稳定哈希，用于跨日志关联同一主体（如同一 IP 的多次请求）。
 *
 * @param secret 加盐，避免对低熵输入（IP、邮箱）做彩虹表反查
 */
export function hashForLog(value: string, secret: string): string {
  return createHash('sha256').update(`${secret}:${value}`).digest('hex').slice(0, 12);
}
