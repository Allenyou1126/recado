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

/**
 * 把整个错误链摊平。
 *
 * drizzle 只把「失败的 SQL」写进 message，**真正的原因在 `cause` 上**：
 * 例如 `CREATE SCHEMA` 失败时，只有 cause 才带着 pg 的
 * `permission denied for database ...`（SQLSTATE 42501）。
 * 只打 message 等于让运维对着一句 SQL 盲猜 —— 这条日志就是为排查而生的。
 */
function describeError(error) {
  const lines = [];
  const seen = new Set();
  let current = error;

  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    lines.push(current.message);

    // pg 的错误码与详情是定位问题的关键（42501 = 权限不足）
    for (const key of ['code', 'detail', 'hint']) {
      const value = Reflect.get(current, key);
      if (typeof value === 'string' && value.length > 0) lines.push(`  ${key}: ${value}`);
    }

    current = current.cause;
  }

  return lines.length > 0 ? lines.join('\n') : String(error);
}

const pool = new Pool({ connectionString });

try {
  // 先说清楚「以谁的身份连到了哪个库」：迁移失败最常见的原因就是连错了库或权限不对，
  // 这一行能让排查少绕一圈。库名与角色名不是敏感信息（密码绝不出现在这里）。
  const identity = await pool.query(
    'select current_database() as database, current_user as "user"',
  );
  const who = identity.rows[0];
  if (who) process.stdout.write(`连接：${who.database}（角色 ${who.user}）\n`);

  await migrate(drizzle(pool), { migrationsFolder });
  process.stdout.write(`迁移完成：${migrationsFolder}\n`);
} catch (error) {
  process.stderr.write(`迁移失败：\n${describeError(error)}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
