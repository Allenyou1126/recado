/**
 * 环境配置模块 —— 全部环境变量的**唯一**读取点。
 *
 * 设计约束（见 .specs/development-standards.md §4.5、§5.2）：
 *
 * - **不在模块顶层读 `process.env`**：模块顶层求值会发生在构建期，
 *   而构建期与运行期的环境并不相同（构建机上通常没有数据库连接串）。
 *   因此这里只导出「函数」，由 `baseMiddleware` 在请求处理时调用。
 * - **校验失败即拒绝启动**，并打印出「哪个变量、错在哪」——
 *   启动期的一次性失败远好于运行到某条语句才抛 `undefined is not a string`。
 * - 校验后的配置通过 Context 注入，业务代码不直接读 `process.env`。
 *
 * ⚠️ 本文件名为 `*.server.ts`，会被框架的 importProtection 拦截，
 * 绝不会进入客户端 bundle。
 */

import { z } from 'zod';

/** 日志级别，与 pino 的级别集合一致 */
const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/**
 * 校验后的密钥/连接串最小长度。
 *
 * 会话 token 与 SMTP 密码的加密都以这些密钥为根，长度不足等于没有防护。
 * 这里只做「长度与形态」校验，具体派生方式由使用方决定。
 */
const SECRET_MIN_LENGTH = 32;

/** PostgreSQL 连接串允许的协议前缀 */
const DATABASE_PROTOCOLS = ['postgres:', 'postgresql:'];

const DATABASE_URL = z
  .string()
  .min(1, '数据库连接串不能为空')
  .refine(
    (value) => {
      try {
        return DATABASE_PROTOCOLS.includes(new URL(value).protocol);
      } catch {
        return false;
      }
    },
    { message: `必须是合法的连接串，形如 postgres://user:pass@host:5432/recado` },
  );

/** 环境变量 schema —— 新增变量时同时更新 `.env.example` */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** PostgreSQL 连接串（迁移作为独立步骤执行，但应用自身也要连库） */
  DATABASE_URL,

  /** HTTP 监听端口 */
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  /** 日志级别；`silent` 用于测试 */
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),

  /** 管理台会话 token 的签名密钥 */
  SESSION_SECRET: z.string().min(SECRET_MIN_LENGTH),

  /** 站点级 SMTP 密码等落库密钥的加密根密钥 */
  SECRETS_KEY: z.string().min(SECRET_MIN_LENGTH),

  /** OIDC Issuer，用于 discovery（ZITADEL 为参考实现，见决策 D14） */
  OIDC_ISSUER_URL: z.url(),

  OIDC_CLIENT_ID: z.string().min(1),

  OIDC_CLIENT_SECRET: z.string().min(1),

  /** 回调地址，必须与 IdP 侧登记的一致 */
  OIDC_REDIRECT_URI: z.url(),

  /** 角色名前缀，用于在同一 IdP 中区分多个部署（见决策 D15） */
  OIDC_ROLE_PREFIX: z.string().min(1),

  /**
   * 角色所在的 claim 路径，默认 `roles`；
   * 兼容 `groups` 与 Keycloak 的嵌套结构（如 `realm_access.roles`）。
   */
  OIDC_ROLE_CLAIM: z.string().min(1).default('roles'),

  /**
   * Bearer token 的受众（`aud`）校验值，默认取 `OIDC_CLIENT_ID`。
   * Q-07 明确要求做受众校验 —— 否则同一 IdP 下**别的客户端**签发的 token 也能调我们的管理 API。
   */
  OIDC_AUDIENCE: z.string().min(1).optional(),

  /**
   * 管理台会话有效期（小时），默认 7 天。
   *
   * 权限快照存在会话里，因此这个值同时决定「IdP 侧撤销角色后最晚多久生效」；
   * 对安全要求高的部署可以调小（代价是更频繁地重新登录）。
   */
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(168),

  /**
   * 站点对外基地址，用于拼邮件里的链接（评论链接、退订链接）。
   * 省略时退回 `OIDC_REDIRECT_URI` 的 origin —— 那通常就是部署地址。
   */
  PUBLIC_BASE_URL: z.url().optional(),

  /**
   * 外部 cron / sidecar 触发 `POST /internal/outbox/drain` 的共享密钥。
   * 不设置时该端点不可用（一直返回未认证）。
   */
  INTERNAL_DRAIN_TOKEN: z.string().min(16).optional(),
});

export type Env = z.infer<typeof EnvSchema>;

/** 单个变量的校验失败明细 */
export type EnvIssue = { variable: string; message: string };

/**
 * 环境变量校验失败。
 *
 * 单独定义一个错误类型，是为了让「启动失败」与「请求处理失败」在日志里
 * 一眼可辨 —— 前者必须让进程退出，后者只是 500。
 */
export class EnvValidationError extends Error {
  readonly issues: readonly EnvIssue[];

  constructor(issues: readonly EnvIssue[]) {
    super(formatEnvIssues(issues));
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/** 把校验明细渲染成可直接阅读的多行文本 */
export function formatEnvIssues(issues: readonly EnvIssue[]): string {
  const lines = issues.map((issue) => `  ✗ ${issue.variable}: ${issue.message}`);
  return [
    `环境变量校验失败，共 ${issues.length} 项问题：`,
    '',
    ...lines,
    '',
    '请对照 .env.example 补齐或修正后重启。',
  ].join('\n');
}

/**
 * 读取并校验环境变量。
 *
 * @param source 环境变量来源，默认 `process.env`；测试可注入固定对象。
 * @throws {EnvValidationError} 缺失或格式错误时
 */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = EnvSchema.safeParse(source);

  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => {
      const variable = issue.path.map(String).join('.') || '(root)';
      // Zod 对「undefined」的默认文案是 Invalid input: expected string, received undefined，
      // 对着它排查缺哪个变量并不直观，这里换成一眼能懂的说明。
      const missing = source[variable] === undefined;
      return { variable, message: missing ? '未设置（必填）' : issue.message };
    });
    throw new EnvValidationError(issues);
  }

  return parsed.data;
}

/**
 * 本地开发兜底：从仓库根的 `.env` 读取环境变量。
 *
 * **只在 `DATABASE_URL` 未设置时加载** —— 否则本地遗留的 `.env` 会覆盖编排
 * 注入的真实配置，这种事故很难排查。服务进程本身不需要它（Docker / CI 直接注入
 * 环境变量），这是给 CLI 与本地脚本准备的。
 */
export function loadLocalEnvFile(): void {
  if (process.env['DATABASE_URL']) return;

  try {
    process.loadEnvFile(new URL('../../../../.env', import.meta.url));
  } catch {
    // 没有 .env 是正常情况
  }
}

let cachedEnv: Env | undefined;

/**
 * 取得当前进程的配置（首次调用时校验并缓存）。
 *
 * 这是**组合根**（composition root）的一部分：只有中间件与启动校验会调用它，
 * 领域逻辑一律通过参数接收配置。见 .specs/development-standards.md §4.5。
 *
 * @throws {EnvValidationError} 首次调用时校验失败
 */
export function getEnv(): Env {
  cachedEnv ??= loadEnv();
  return cachedEnv;
}

/** 仅供测试：清空 `getEnv` 的缓存 */
export function resetEnvCache(): void {
  cachedEnv = undefined;
}
