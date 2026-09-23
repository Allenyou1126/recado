/**
 * Recado 数据库迁移入口（Nix 包专用）。
 *
 * 为什么不直接用 `drizzle-kit migrate`：drizzle-kit 是 devDependency，且带平台相关的
 * 原生可执行文件。Nix 包只需要「把 drizzle/ 里的迁移按顺序应用」这一件事，
 * 用 drizzle-orm 自带的运行时迁移器（与 drizzle-kit 内部用的是同一套代码）
 * 打成单文件即可，运行时不必带上整个 node_modules。
 *
 * 等价性已验证：同一份 drizzle/ 目录分别用 `pnpm db:migrate`（drizzle-kit）
 * 与这个入口迁移两个空库，得到的 schema 完全一致，
 * `drizzle.__drizzle_migrations` 里的 hash 与 created_at 也逐行相同。
 *
 * 用法：
 *
 *   DATABASE_URL=postgres://... recado-migrate
 *   RECADO_MIGRATIONS_DIR=/path/to/drizzle recado-migrate   # 默认取同目录下的 drizzle/
 *
 * 退出码：0 成功、1 失败（失败信息写 stderr）。
 * 这是边界程序，允许 try/catch（见 .specs/development-standards.md §6.4）。
 *
 * ⚠️ 迁移是**独立部署步骤**，不要把它塞进应用启动流程（requirements.md §8.5）。
 */
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const connectionString = process.env['DATABASE_URL'];

if (!connectionString) {
  process.stderr.write('DATABASE_URL 未设置，无法执行迁移。\n');
  process.exit(1);
}

const migrationsFolder =
  process.env['RECADO_MIGRATIONS_DIR'] ?? fileURLToPath(new URL('./drizzle/', import.meta.url));

const pool = new Pool({ connectionString });

try {
  await migrate(drizzle(pool), { migrationsFolder });
  process.stdout.write(`迁移完成：${migrationsFolder}\n`);
} catch (error) {
  process.stderr.write(`迁移失败：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
