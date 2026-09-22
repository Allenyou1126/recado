/**
 * PostgreSQL 连接池与 Drizzle 客户端。
 *
 * ⚠️ **仅服务端可用**。文件名遵循 `*.server.ts` 约定，会被 TanStack Start
 * 的构建期保护拦截，防止数据库代码泄漏进客户端 bundle
 * （见 .specs/development-standards.md §3.3）。
 *
 * 关于连接池：Node 常驻服务下，模块级单例连接池是正确做法；但为了满足
 * 依赖注入纪律（§4.5「禁止在函数内取全局单例」），这里**导出工厂函数**
 * 而非单例 —— 由应用启动时创建一次，并把结果注入 Context。
 * 这样业务代码无需 import 本模块，测试也能替换成真实/桩连接。
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema/index';

export type Database = ReturnType<typeof buildDrizzle>;

export type DbClient = {
  db: Database;
  /** 优雅停机时调用 */
  close: () => Promise<void>;
};

function buildDrizzle(pool: Pool) {
  return drizzle(pool, { schema });
}

/**
 * 创建数据库客户端。
 *
 * @param connectionString PostgreSQL 连接串（来自经校验的配置，不要在此读 process.env）
 */
export function createDbClient(connectionString: string): DbClient {
  const pool = new Pool({
    connectionString,
    // 单实例小规模部署（1–3 站点，见 Q-15），连接数无需很大
    max: 10,
  });

  return {
    db: buildDrizzle(pool),
    close: () => pool.end(),
  };
}
