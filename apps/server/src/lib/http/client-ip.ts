/**
 * 真实客户端 IP 的提取。
 *
 * 两级来源，按部署形态自动适配：
 *
 * 1. **反向代理头**（`X-Forwarded-For` 的第一段 / `X-Real-IP`）——
 *    生产部署在 Nginx、Caddy、CDN 后面时走这条
 * 2. **socket 地址**（框架从底层 h3 事件取）—— 直连或没有代理头时兜底
 *
 * ⚠️ 代理头是**可以伪造的**，因此 IP 在这里只用于：
 * - 后台展示（仅管理员可见）
 * - 同 IP 同站点的最小发表间隔（可用性保护，不是反垃圾）
 *
 * 绝不能用它做鉴权或封禁决策 —— 那会给伪造者一个绕过或栽赃的手段。
 * 部署文档需要说明：若前面有代理，必须由代理重写而不是透传该头。
 */

import { getRequestIP } from '@tanstack/react-start/server';

/** 取第一段：`X-Forwarded-For` 是逗号分隔的调用链，最左边是原始客户端 */
function firstForwardedFor(value: string | null): string | null {
  if (value === null) return null;

  const first = value.split(',')[0]?.trim();
  return first !== undefined && first.length > 0 ? first : null;
}

export function clientIp(request: Request): string | null {
  const forwarded = firstForwardedFor(request.headers.get('x-forwarded-for'));
  if (forwarded !== null) return forwarded;

  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp !== undefined && realIp.length > 0) return realIp;

  try {
    // 框架从 h3 事件取 socket 地址；不在请求上下文里会抛，按「拿不到」处理
    return getRequestIP() ?? null;
  } catch {
    return null;
  }
}
