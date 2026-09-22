/**
 * 集成测试用的真实 PostgreSQL。
 *
 * 测试**不连开发库**：单元与集成测试跑在一个独立数据库 `recado_test` 上，
 * 避免把本地开发数据洗掉。
 *
 * 启动数据库（compose 只起 postgres 服务）：
 *
 *   docker compose -f docker/compose.yaml up -d postgres
 *
 * 连接串可用 `TEST_DATABASE_URL` 覆盖，默认对齐 compose 里的端口映射。
 */

import { execFileSync } from 'node:child_process';

import { createDbClient, type DbClient, type Database } from '@recado/db';
import { Pool } from 'pg';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://recado:recado@localhost:55432/recado_test';

/**
 * 数据库扩展。
 *
 * `members.email` 是 citext，`CREATE TABLE` 前必须已有扩展 ——
 * drizzle-kit 不会自动生成 `CREATE EXTENSION`，迁移文件里也要手写这一句。
 */
async function ensureExtensions(databaseUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    await pool.query('CREATE EXTENSION IF NOT EXISTS citext');
  } finally {
    await pool.end();
  }
}

/** 构造测试库所需的 DDL 前的准备：库本身可能还不存在 */
async function ensureDatabaseExists(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));

  if (!database) {
    throw new Error(`TEST_DATABASE_URL 缺少数据库名：${TEST_DATABASE_URL}`);
  }

  // 连到维护库，避免「要连的库不存在」这个先有鸡还是先有蛋的问题
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';

  const pool = new Pool({ connectionString: adminUrl.toString(), max: 1 });
  try {
    const existing = await pool.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (existing.rowCount === 0) {
      // 数据库名来自配置而非请求，但仍然加引号，避免大小写/特殊字符踩坑
      await pool.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
    }
  } finally {
    await pool.end();
  }
}

/**
 * 把 schema 同步到测试库。
 *
 * ⚠️ 阶段 0 还没有迁移文件（T1.10 生成），因此先用 `drizzle-kit push` 同步结构；
 * T1.11 之后这里应改为执行迁移，让测试库与生产迁移路径完全一致。
 */
function pushSchema(): void {
  execFileSync('pnpm', ['--filter', '@recado/db', 'exec', 'drizzle-kit', 'push', '--force'], {
    cwd: new URL('../../../../', import.meta.url).pathname,
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}

let ready: Promise<void> | undefined;

/** 幂等：同一进程内只准备一次 */
export function ensureTestDatabase(): Promise<void> {
  ready ??= (async () => {
    await ensureDatabaseExists();
    await ensureExtensions(TEST_DATABASE_URL);
    pushSchema();
  })();

  return ready;
}

/** 打开一个测试用数据库连接；用完必须 `close()` */
export function openTestDatabase(): DbClient {
  return createDbClient(TEST_DATABASE_URL);
}

/**
 * 清空业务表。
 *
 * 用 `TRUNCATE ... CASCADE` 而不是 DELETE：更快，且顺带重置自增序列。
 * 新增业务表时记得加进来 —— 漏掉会让测试互相污染。
 */
export async function resetSites(db: Database): Promise<void> {
  await db.execute('TRUNCATE TABLE sites CASCADE');
}
