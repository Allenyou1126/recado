import { createFileRoute } from '@tanstack/react-router';
import { sql } from 'drizzle-orm';

import { methodNotAllowed } from '../lib/http/method-not-allowed';
import { jsonResponse } from '../lib/http/respond';
import { dbMiddleware } from '../lib/middleware/db';

/**
 * 就绪探针：`GET /readyz`。
 *
 * 与 `/healthz` 的分工（requirements.md §7.3）：
 * - `/healthz` 只回答「进程还活着」——数据库挂了也返回 200，
 *   否则编排系统会把「数据库暂时不可用」误判为「进程已死」并反复重启
 * - `/readyz` 回答「现在能不能服务」——数据库不可用时返回 **503**，
 *   负载均衡据此把流量摘掉
 */
export const Route = createFileRoute('/readyz')({
  server: {
    middleware: [dbMiddleware],
    handlers: {
      GET: async ({ context }) => {
        try {
          await context.db.execute(sql`select 1`);

          return jsonResponse({ status: 'ready' });
        } catch (cause) {
          context.logger.error({ err: cause }, 'readiness check failed');

          // 只回报「不可用」，不带数据库错误原文（可能含连接串与表结构）
          return jsonResponse({ status: 'unavailable' }, { status: 503 });
        }
      },

      ANY: async () => methodNotAllowed(['GET']),
    },
  },
});
