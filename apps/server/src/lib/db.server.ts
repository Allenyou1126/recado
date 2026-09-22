/**
 * 数据库客户端的组合根（composition root）。
 *
 * Node 常驻服务下，模块级连接池单例是正确做法 —— 每次请求新建连接池会
 * 迅速耗尽 PostgreSQL 的连接数。但**业务代码不得 import 本模块**：
 * 它只被中间件使用，中间件负责把 `db` 注入 Context
 * （见 .specs/development-standards.md §13.2 与 §4.5）。
 */

import { createDbClient, type DbClient } from '@recado/db';

let client: DbClient | undefined;

/** 取得（或首次创建）进程级数据库客户端 */
export function getDbClient(connectionString: string): DbClient {
  client ??= createDbClient(connectionString);
  return client;
}

/** 优雅停机：关闭连接池（由 T9.6 的停机流程调用） */
export async function closeDbClient(): Promise<void> {
  const current = client;
  client = undefined;
  await current?.close();
}
