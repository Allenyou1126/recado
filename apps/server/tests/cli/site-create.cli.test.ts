/**
 * CLI 的端到端测试。
 *
 * 直接拉起真实的 CLI 进程（`tsx scripts/cli.ts`），而不是把函数 import 进来 ——
 * 参数解析、退出码、stdout/stderr 这些正是 CLI 的对外契约，
 * 只有真跑一遍才算验证过。
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { resolveActiveSiteByKey } from '@recado/core';
import { beforeAll, describe, expect, it } from 'vitest';

import { ensureTestDatabase, openTestDatabase, TEST_DATABASE_URL } from '../helpers/test-db';

const SERVER_DIR = fileURLToPath(new URL('../../', import.meta.url));
const TSX = fileURLToPath(new URL('../../node_modules/.bin/tsx', import.meta.url));
const CLI = fileURLToPath(new URL('../../scripts/cli.ts', import.meta.url));

type CliResult = { status: number; stdout: string; stderr: string };

/** `execFileSync` 抛出的错误在 TS 里是 unknown，用类型守卫而不是断言收窄 */
function asCliFailure(cause: unknown): Partial<CliResult> {
  if (typeof cause !== 'object' || cause === null) return {};

  const status = Reflect.get(cause, 'status');
  const stdout = Reflect.get(cause, 'stdout');
  const stderr = Reflect.get(cause, 'stderr');

  return {
    ...(typeof status === 'number' ? { status } : {}),
    ...(typeof stdout === 'string' ? { stdout } : {}),
    ...(typeof stderr === 'string' ? { stderr } : {}),
  };
}

function runCli(args: string[]): CliResult {
  try {
    const stdout = execFileSync(TSX, [CLI, ...args], {
      cwd: SERVER_DIR,
      env: {
        ...process.env,
        // 覆盖掉本地 .env 兜底，强制打向测试库
        DATABASE_URL: TEST_DATABASE_URL,
        NODE_ENV: 'test',
        LOG_LEVEL: 'silent',
        SESSION_SECRET: 'test-session-secret-test-session-',
        SECRETS_KEY: 'test-secrets-key-test-secrets-key',
        OIDC_ISSUER_URL: 'https://idp.test',
        OIDC_CLIENT_ID: 'recado-test',
        OIDC_CLIENT_SECRET: 'test-client-secret',
        OIDC_REDIRECT_URI: 'http://localhost:3000/auth/callback',
        OIDC_ROLE_PREFIX: 'recado',
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    return { status: 0, stdout, stderr: '' };
  } catch (cause) {
    const failure = asCliFailure(cause);

    return {
      status: failure.status ?? 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

beforeAll(async () => {
  await ensureTestDatabase();
});

describe('CLI site:create', () => {
  it('--json 输出可被脚本消费，且站点真的落库了', async () => {
    const result = runCli(['site:create', '--name', 'CLI 站点', '--json']);

    expect(result.status).toBe(0);

    const payload: unknown = JSON.parse(result.stdout);
    if (typeof payload !== 'object' || payload === null) throw new Error('输出不是 JSON 对象');

    const { id, name, key } = payload as { id?: string; name?: string; key?: string };
    expect(name).toBe('CLI 站点');
    expect(key).toMatch(/^rc_[a-z0-9]{24}$/);

    const db = openTestDatabase();
    try {
      const resolved = await resolveActiveSiteByKey(db.db, key ?? '');
      expect(resolved.data?.id).toBe(id);
    } finally {
      await db.close();
    }
  });

  it('--origin 可重复，并会做归一化', async () => {
    const result = runCli([
      'site:create',
      '--name',
      'CLI 来源站点',
      '--origin',
      ' Example.com ',
      '--origin',
      '*.Example.org',
      '--json',
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      allowedOrigins: ['example.com', '*.example.org'],
    });
  });

  it('人类可读输出包含 site key', () => {
    const result = runCli(['site:create', '--name', 'CLI 可读站点']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('站点已创建');
    expect(result.stdout).toMatch(/rc_[a-z0-9]{24}/);
  });

  it('缺 --name 时退出码非零并给出提示', () => {
    const result = runCli(['site:create']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--name');
  });

  it('未知命令退出码非零', () => {
    const result = runCli(['nope']);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('未知命令');
  });

  it('--help 退出码为 0', () => {
    const result = runCli(['--help']);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('site:create');
  });
});
