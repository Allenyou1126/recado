/**
 * 生产构建的 HTTP 测试基座。
 *
 * 为什么必须跑生产产物：**CORS 预检在 dev 与生产行为不一致** ——
 * `vite dev` 会拦截 `OPTIONS` 并绕过路由处理器（见 requirements.md §8.2、
 * 风险表「预检必须纳入生产构建的自动化测试」）。只测 dev 会得出错误结论。
 *
 * 需要 `.output/server/index.mjs`：缺失时自动执行一次 `pnpm build`
 * （冷启动约十几秒，之后复用）。
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureTestDatabase, TEST_DATABASE_URL } from '../helpers/test-db';

const SERVER_DIR = fileURLToPath(new URL('../../', import.meta.url));
const REPO_DIR = fileURLToPath(new URL('../../../../', import.meta.url));
const SERVER_ENTRY = fileURLToPath(new URL('../../.output/server/index.mjs', import.meta.url));

/** 参与构建的源码目录；任一文件比产物新就说明产物过期 */
const SOURCE_DIRS = [
  join(SERVER_DIR, 'src'),
  join(SERVER_DIR, 'server'),
  join(REPO_DIR, 'packages/core/src'),
  join(REPO_DIR, 'packages/db/src'),
  join(REPO_DIR, 'packages/shared/src'),
];

/**
 * 产物是否过期。
 *
 * 不做这一步的话，改了源码却忘了 `pnpm build` 时会拿着旧产物跑测试，
 * 得到一堆「代码明明改了却失败」的假象 —— 这种坑排查起来很费时间。
 */
function isBuildStale(): boolean {
  if (!existsSync(SERVER_ENTRY)) return true;

  const builtAt = statSync(SERVER_ENTRY).mtimeMs;

  for (const dir of SOURCE_DIRS) {
    if (!existsSync(dir)) continue;

    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;

      const file = join(entry.parentPath, entry.name);
      if (statSync(file).mtimeMs > builtAt) return true;
    }
  }

  return false;
}

/** 与 tests/helpers/context.ts 的 testEnv 保持一致 */
const BASE_ENV: Record<string, string> = {
  NODE_ENV: 'production',
  LOG_LEVEL: 'warn',
  SESSION_SECRET: 'test-session-secret-test-session-',
  SECRETS_KEY: 'test-secrets-key-test-secrets-key',
  OIDC_ISSUER_URL: 'https://idp.test',
  OIDC_CLIENT_ID: 'recado-test',
  OIDC_CLIENT_SECRET: 'test-client-secret',
  OIDC_REDIRECT_URI: 'http://localhost:3000/auth/callback',
  OIDC_ROLE_PREFIX: 'recado',
  OIDC_ROLE_CLAIM: 'roles',
};

export type RunningServer = {
  baseUrl: string;
  stop: () => Promise<void>;
};

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: SERVER_DIR, stdio: 'inherit' });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} 退出码 ${String(code)}`));
    });
  });
}

/** 让操作系统分配一个空闲端口，避免与开发者本机的服务撞车 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();

    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close();
        reject(new Error('无法确定空闲端口'));
        return;
      }

      const { port } = address;
      probe.close(() => {
        resolve(port);
      });
    });
  });
}

async function waitForReady(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/health`);
      if (response.ok) return;
    } catch {
      // 还没起来，继续等
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(`服务在 ${timeoutMs}ms 内没有就绪`);
}

/**
 * 启动生产构建的服务。
 *
 * 调用方负责 `stop()`；测试通常放在 `beforeAll` / `afterAll`。
 */
export async function startBuiltServer(): Promise<RunningServer> {
  await ensureTestDatabase();

  if (isBuildStale()) {
    await run('pnpm', ['build']);
  }

  const port = await freePort();
  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      ...BASE_ENV,
      PORT: String(port),
      DATABASE_URL: TEST_DATABASE_URL,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    output += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await waitForReady(baseUrl, 30_000);
  } catch (cause) {
    child.kill('SIGKILL');
    throw new Error(`生产构建的服务启动失败：${String(cause)}\n--- 服务输出 ---\n${output}`);
  }

  return {
    baseUrl,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) {
          resolve();
          return;
        }
        child.once('exit', () => resolve());
        child.kill('SIGTERM');
      }),
  };
}
