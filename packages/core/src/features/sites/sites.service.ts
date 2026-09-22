/**
 * sites 功能的服务层：站点解析与来源白名单判定。
 *
 * 这里只有业务规则，不感知 HTTP —— 传入的是请求头里的字符串，
 * 返回的是 `Result`，由接口层决定映射成什么状态码
 * （见 .specs/development-standards.md §2.3）。
 */

import { randomInt } from 'node:crypto';

import type { Database, Site } from '@recado/db';
import { err, ok, type Result } from '@recado/shared';

import { findSiteByKey, insertSite, updateSiteKey } from './sites.data';
import { SiteErrors, type SiteError } from './sites.errors';
import {
  AllowedOriginSchema,
  parseSiteSettings,
  type CreateSiteInput,
  type OriginPolicy,
  type SiteSettings,
} from './sites.schema';

/** 来源校验结果；`raw` 是命中的来源（也可能是 null，表示无来源头） */
export type OriginCheck = { allowed: boolean; raw: string | null };

/** 读取站点配置（已按 schema 归一化，字段缺失或写错都退回默认值） */
export function siteSettings(site: Pick<Site, 'settings'>): SiteSettings {
  return parseSiteSettings(site.settings);
}

/** 解析站点级 `originPolicy`；默认 `strict`（决策 Q-12） */
export function originPolicyOf(settings: Record<string, unknown>): OriginPolicy {
  return siteSettings({ settings }).originPolicy;
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

/**
 * 归一化来源白名单条目：去空白、转小写。
 *
 * 匹配本身已经大小写不敏感，归一化是为了让后台展示与审计日志里的一致，
 * 并顺手去掉重复项与空串。格式非法的条目直接丢弃 —— 让一条写错的配置
 * 静默失效，好过让它以「看起来像配了」的形态留在库里。
 */
export function normalizeAllowedOrigins(patterns: readonly string[]): string[] {
  const normalized = new Set<string>();

  for (const pattern of patterns) {
    const trimmed = pattern.trim().toLowerCase();

    if (trimmed.length === 0) continue;
    if (!AllowedOriginSchema.safeParse(trimmed).success) continue;

    normalized.add(trimmed);
  }

  return [...normalized];
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
  const { originPolicy } = siteSettings(site);
  const headerOrigin = headers.origin?.trim();
  // `Origin: null` 是 sandbox iframe / 不透明来源的序列化结果，等同于没有来源
  const raw =
    headerOrigin && headerOrigin !== 'null' ? headerOrigin : originFromReferer(headers.referer);

  if (!raw) {
    if (originPolicy === 'lenient') {
      return ok({ allowed: false, raw: null });
    }
    return err(SiteErrors.originMissing());
  }

  if (!matchesAllowedOrigin(site.allowedOrigins, raw)) {
    return err(SiteErrors.originNotAllowed(raw));
  }

  return ok({ allowed: true, raw });
}

/** site key 前缀 —— 让 key 在日志/配置里一眼可辨，也便于未来做格式校验 */
export const SITE_KEY_PREFIX = 'rc_';

/** site key 的随机部分长度（36 进制，24 位 ≈ 124 bit 熵） */
export const SITE_KEY_RANDOM_LENGTH = 24;

/** 用小写字母 + 数字：无需转义，粘贴进 URL、配置文件与 JS 字符串都不会出问题 */
const SITE_KEY_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * 生成 site key。
 *
 * `crypto.randomInt` 是**均匀**取值的加密随机源；用 `Math.random()` 或
 * 「取模范围」都会引入偏差，可枚举空间会被显著压缩。
 *
 * ⚠️ site key 是**公开标识，不是密钥**（见 requirements.md §7.1 威胁模型）：
 * 它挡不住有意的服务端伪造，真正的防线是来源白名单 + 限流 + 人工审核。
 */
export function generateSiteKey(): string {
  let suffix = '';

  for (let index = 0; index < SITE_KEY_RANDOM_LENGTH; index += 1) {
    suffix += SITE_KEY_ALPHABET[randomInt(SITE_KEY_ALPHABET.length)];
  }

  return `${SITE_KEY_PREFIX}${suffix}`;
}

/** 生成 site key 的重试次数：撞上唯一约束说明运气极差，换一个即可 */
const SITE_KEY_MAX_ATTEMPTS = 5;

/**
 * 创建站点并签发 site key。
 *
 * 重试而不是先查后插：并发下「先查再插」仍有竞态，唯一约束才是权威判定。
 */
export async function createSite(
  db: Database,
  input: CreateSiteInput,
): Promise<Result<Site, SiteError>> {
  const settings = { ...parseSiteSettings({}), ...input.settings };
  const allowedOrigins = normalizeAllowedOrigins(input.allowedOrigins);

  for (let attempt = 0; attempt < SITE_KEY_MAX_ATTEMPTS; attempt += 1) {
    const key = generateSiteKey();

    const existing = await findSiteByKey(db, key);
    if (existing) continue;

    const site = await insertSite(db, {
      key,
      name: input.name,
      allowedOrigins,
      settings,
    });

    return ok(site);
  }

  return err(SiteErrors.keyGenerationFailed());
}

/**
 * 轮换 site key：旧 key 立即失效（M1「一键轮换」）。
 *
 * 刻意不做「新旧并行有效期」——那会让「轮换」变成「再加一个 key」，
 * 站点失去明确的失效语义。
 */
export async function rotateSiteKey(
  db: Database,
  siteId: string,
): Promise<Result<Site, SiteError>> {
  for (let attempt = 0; attempt < SITE_KEY_MAX_ATTEMPTS; attempt += 1) {
    const updated = await updateSiteKey(db, siteId, generateSiteKey());

    if (updated) return ok(updated);
    // 更新未命中说明站点不存在，重试没有意义
    return err(SiteErrors.notFound(siteId));
  }

  return err(SiteErrors.keyGenerationFailed());
}
