/**
 * 结构化日志模块（pino）。
 *
 * 两条纪律：
 *
 * 1. **日志只由 Context 提供**（`ctx.logger`），业务代码不 import 本模块 ——
 *    这样测试可以注入静默 logger，也不需要启动真实进程。
 * 2. **输出前必须脱敏**：pino 的 `redact` 覆盖常见敏感键，其余场景用
 *    `lib/redact.server.ts` 的掩码函数，绝不把邮箱明文、完整 IP、Cookie
 *    或任何 token 写进日志（见 .specs/development-standards.md §8.6）。
 *
 * ⚠️ 本文件名为 `*.server.ts`，不会进入客户端 bundle。
 * 额外的兜底：pino 在客户端语境下并无意义，若真被打包进来说明分层已破。
 */

import { pino, stdSerializers, type DestinationStream, type Logger } from 'pino';

import type { Env } from '../config/env.server';

export type { Logger };

/**
 * 需要无条件抹掉的键。
 *
 * pino 的通配符 `*` 只匹配一层，因此常见的嵌套深度要逐层列出；
 * 宁可多列，也不要指望「调用方不会传敏感字段」。
 */
const REDACT_PATHS = [
  // 直接字段
  'email',
  'ip',
  'userAgent',
  'cookie',
  'authorization',
  'token',
  'accessToken',
  'refreshToken',
  'idToken',
  'password',
  'pass',
  'secret',
  'clientSecret',
  'siteKey',
  // 一层嵌套
  '*.email',
  '*.ip',
  '*.userAgent',
  '*.cookie',
  '*.authorization',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.idToken',
  '*.password',
  '*.pass',
  '*.secret',
  '*.clientSecret',
  '*.siteKey',
  // 两层嵌套（如 ctx.site.settings.smtp.pass）
  '*.*.email',
  '*.*.ip',
  '*.*.cookie',
  '*.*.authorization',
  '*.*.token',
  '*.*.password',
  '*.*.pass',
  '*.*.secret',
  '*.*.clientSecret',
  '*.*.siteKey',
  '*.*.*.pass',
  '*.*.*.password',
  '*.*.*.secret',
];

export const REDACTED = '[redacted]';

export type LoggerOptions = {
  /** 绑定的上下文字段，如 `{ requestId }`、`{ worker: 'outbox' }` */
  bindings?: Record<string, unknown>;
  /** 自定义输出流；仅测试需要（用于捕获日志断言脱敏结果） */
  destination?: DestinationStream;
};

/**
 * 创建 logger。
 *
 * @param env 经校验的配置（级别来自 `LOG_LEVEL`）
 */
export function createLogger(env: Env, options: LoggerOptions = {}): Logger {
  const config = {
    level: env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: REDACTED },
    // 未预期异常的堆栈只进日志，绝不进响应体
    serializers: { err: stdSerializers.err },
  } as const;

  const logger = options.destination ? pino(config, options.destination) : pino(config);
  const bindings = options.bindings ?? {};

  return Object.keys(bindings).length > 0 ? logger.child(bindings) : logger;
}
