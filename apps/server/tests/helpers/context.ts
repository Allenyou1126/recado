/**
 * 测试用 Context 工厂。
 *
 * 存在的意义就是让「依赖通过参数传入」这条纪律变得可验证：
 * 服务层函数只要收一个构造出来的 ctx 就能跑，不需要启动 HTTP 服务
 * （见 .specs/development-standards.md §1.2）。
 */

import type { Database } from '@recado/db';

import type { Env } from '../../src/config/env.server';
import { createLogger } from '../../src/lib/logger.server';

/**
 * 测试用配置。
 *
 * 全部字段显式写出（而不是从 process.env 读），这样单测不依赖运行环境；
 * `LOG_LEVEL=silent` 让日志不污染测试输出。
 */
export function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgres://recado:recado@localhost:55432/recado_test',
    PORT: 3000,
    LOG_LEVEL: 'silent',
    SESSION_SECRET: 'test-session-secret-test-session-',
    SECRETS_KEY: 'test-secrets-key-test-secrets-key',
    OIDC_ISSUER_URL: 'https://idp.test',
    OIDC_CLIENT_ID: 'recado-test',
    OIDC_CLIENT_SECRET: 'test-client-secret',
    OIDC_REDIRECT_URI: 'http://localhost:3000/auth/callback',
    OIDC_ROLE_PREFIX: 'recado',
    OIDC_ROLE_CLAIM: 'roles',
    SESSION_TTL_HOURS: 168,
    ...overrides,
  };
}

/** 第一级 Context：只有 env / requestId / logger */
export function makeBaseContext(overrides: Partial<BaseContext> = {}): BaseContext {
  const env = overrides.env ?? testEnv();

  return {
    env,
    requestId: 'test-request-id',
    logger: createLogger(env),
    ...overrides,
  };
}

/** 第二级 Context：再加上数据库 */
export function makeDbContext(db: Database, overrides: Partial<DbContext> = {}): DbContext {
  return { ...makeBaseContext(), db, ...overrides };
}
