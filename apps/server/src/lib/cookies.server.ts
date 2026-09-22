/**
 * Cookie 读写与签名。
 *
 * 为什么自己签名：浏览器持有的状态（会话 token、OIDC 流程态）必须能防篡改。
 * 用 HMAC-SHA256 + `SESSION_SECRET`，格式为 `值.签名`（base64url）。
 *
 * 不引第三方 cookie 库：需求只有「签一个值、验一个值」这一点，
 * 而框架无关的 30 行实现比多一个依赖更容易审查。
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export type CookieOptions = {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  path?: string;
  maxAgeSeconds?: number;
};

/** 拼接 `Set-Cookie` 头；不提供序列化库，字段就这几个 */
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];

  parts.push(`Path=${options.path ?? '/'}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure === true) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);

  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${options.maxAgeSeconds}`);

  return parts.join('; ');
}

/** 从请求里读一个 cookie（同名只取第一个） */
export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (header === null) return null;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;

    const key = part.slice(0, separator).trim();
    if (key !== name) continue;

    const raw = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  return null;
}

/** 签名：`<base64url(值)>.<base64url(hmac)>` */
export function signValue(value: string, secret: string): string {
  const payload = Buffer.from(value, 'utf8').toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');

  return `${payload}.${signature}`;
}

/**
 * 验签并取值；签名不匹配返回 null。
 *
 * 用 `timingSafeEqual` 比较而不是 `===`：后者会在第一个不同的字节就返回，
 * 理论上可以被用来逐字节猜签名。
 */
export function verifySignedValue(signed: string, secret: string): string | null {
  const separator = signed.lastIndexOf('.');
  if (separator <= 0) return null;

  const payload = signed.slice(0, separator);
  const signature = signed.slice(separator + 1);
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');

  const provided = Buffer.from(signature, 'utf8');
  const wanted = Buffer.from(expected, 'utf8');

  if (provided.length !== wanted.length) return null;
  if (!timingSafeEqual(provided, wanted)) return null;

  try {
    return Buffer.from(payload, 'base64url').toString('utf8');
  } catch {
    return null;
  }
}

/** 会话 Cookie 名 */
export const SESSION_COOKIE = 'recado_session';

/** OIDC 流程态的 Cookie 名（state / nonce / PKCE verifier，登录回调后即清） */
export const OIDC_FLOW_COOKIE = 'recado_oidc_flow';
