/**
 * sites 功能的服务层：站点解析与来源白名单判定。
 *
 * 这里只有业务规则，不感知 HTTP —— 传入的是请求头里的字符串，
 * 返回的是 `Result`，由接口层决定映射成什么状态码
 * （见 .specs/development-standards.md §2.3）。
 */

import type { Database, Site } from '@recado/db';
import { err, ok, type Result } from '@recado/shared';

import { findSiteByKey } from './sites.data';
import { SiteErrors, type SiteError } from './sites.errors';

/** 无来源头请求的策略（决策 Q-12） */
export type OriginPolicy = 'strict' | 'lenient';

/** 来源校验结果；`raw` 是命中的来源（也可能是 null，表示无来源头） */
export type OriginCheck = { allowed: boolean; raw: string | null };

/**
 * 解析站点级 `originPolicy`。
 *
 * 默认 `strict`：未显式配置时一律拒绝无来源头请求。
 * ⚠️ 站点配置的完整 schema 在 T3.1 落地，届时这里改为读取校验后的配置。
 */
export function originPolicyOf(settings: Record<string, unknown>): OriginPolicy {
  return settings.originPolicy === 'lenient' ? 'lenient' : 'strict';
}

/**
 * 按 site key 解析出可用的站点。
 *
 * 三类失败分开返回：缺 key / 查不到 / 站点已停用 —— 调用方与调用者
 * 都能立刻区分是「配置没传」「key 写错」还是「站点被站长停用了」。
 */
export async function resolveActiveSiteByKey(
  db: Database,
  rawKey: string | null,
): Promise<Result<Site, SiteError>> {
  const key = rawKey?.trim();
  if (!key) {
    return err(SiteErrors.keyRequired());
  }

  const site = await findSiteByKey(db, key);
  if (!site) {
    return err(SiteErrors.notFoundByKey());
  }

  if (site.status === 'disabled') {
    return err(SiteErrors.disabled(site.id));
  }

  return ok(site);
}

type ParsedOrigin = {
  /** 小写协议名；未书写协议时为 null（表示「任意协议」） */
  scheme: string | null;
  host: string;
  /** 显式端口；未书写时为 null（URL 会归一化掉默认端口） */
  port: string | null;
};

const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

function parseOrigin(value: string): ParsedOrigin | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const hasScheme = SCHEME_PATTERN.test(trimmed);

  let url: URL;
  try {
    url = new URL(hasScheme ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  if (!url.hostname) return null;

  return {
    scheme: hasScheme ? url.protocol.slice(0, -1).toLowerCase() : null,
    host: url.hostname.toLowerCase(),
    port: url.port === '' ? null : url.port,
  };
}

/**
 * 来源是否命中白名单。
 *
 * 白名单条目支持四种写法（协议与端口可选，大小写不敏感）：
 *
 * | 写法 | 命中 |
 * | --- | --- |
 * | `example.com` | `https://example.com`、`http://example.com`（任意协议，无显式端口） |
 * | `https://example.com` | 仅 https |
 * | `*.example.com` | `https://blog.example.com`，**不**含 `example.com` 本身 |
 * | `http://localhost:3000` | 带端口的本地开发地址 |
 *
 * 通配符只允许出现在最左侧一个标签，且 `*` 不跨越 `.`。
 */
export function matchesAllowedOrigin(patterns: readonly string[], origin: string): boolean {
  const target = parseOrigin(origin);
  if (!target) return false;

  return patterns.some((pattern) => {
    const rule = parseOrigin(pattern);
    if (!rule) return false;

    if (rule.scheme !== null && rule.scheme !== target.scheme) return false;
    if (rule.port !== target.port) return false;

    if (rule.host.startsWith('*.')) {
      const suffix = rule.host.slice(1);
      return target.host.endsWith(suffix) && target.host.length > suffix.length;
    }

    return rule.host === target.host;
  });
}

/** 从 `Referer` 里取出来源；格式非法时按「无来源」处理 */
function originFromReferer(referer: string | null): string | null {
  if (!referer) return null;

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

/**
 * 判定请求来源（决策 Q-12）。
 *
 * - `Origin` 优先；没有则回落到 `Referer` 的 origin
 * - 两者都没有（或为 `null` 这一不透明来源字面量）时：
 *   `strict` → 403；`lenient` → 放行，但标记 `allowed: false` 供限流加严
 * - 有来源但不在白名单 → 403
 */
export function evaluateOrigin(
  site: Pick<Site, 'allowedOrigins' | 'settings'>,
  headers: { origin: string | null; referer: string | null },
): Result<OriginCheck, SiteError> {
  const headerOrigin = headers.origin?.trim();
  // `Origin: null` 是 sandbox iframe / 不透明来源的序列化结果，等同于没有来源
  const raw =
    headerOrigin && headerOrigin !== 'null' ? headerOrigin : originFromReferer(headers.referer);

  if (!raw) {
    if (originPolicyOf(site.settings) === 'lenient') {
      return ok({ allowed: false, raw: null });
    }
    return err(SiteErrors.originMissing());
  }

  if (!matchesAllowedOrigin(site.allowedOrigins, raw)) {
    return err(SiteErrors.originNotAllowed(raw));
  }

  return ok({ allowed: true, raw });
}
