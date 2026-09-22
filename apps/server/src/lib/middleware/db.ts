/**
 * dbMiddleware —— 注入数据库客户端。
 *
 * 只做注入，不做连接管理：连接池是进程级单例（见 lib/db.server.ts），
 * 测试可以直接传入桩对象替换它。
 */

import { createMiddleware } from '@tanstack/react-start';

import { getDbClient } from '../db.server';
import { baseMiddleware } from './base';

export const dbMiddleware = createMiddleware({ type: 'request' })
  // 中间件的 context 是累积的：先声明依赖，才能拿到上游注入的 env
  .middleware([baseMiddleware])
  .server(async ({ next, context }) => {
    const { db } = getDbClient(context.env.DATABASE_URL);

    return next({ context: { db } });
  });
