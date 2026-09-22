import { createFileRoute } from '@tanstack/react-router';

import { methodNotAllowed } from '../../../lib/http/method-not-allowed';
import { jsonResponse } from '../../../lib/http/respond';

/**
 * 存活探针。
 *
 * 与 `/readyz` 的分工见 requirements.md §7.3：数据库不可用时 `/readyz` 返回 503，
 * 而 `/healthz` 仍返回 200 —— 否则编排系统会把「数据库暂时不可用」误判为
 * 「进程已死」并反复重启。
 */
export const Route = createFileRoute('/api/v1/health')({
  server: {
    handlers: {
      GET: async () => jsonResponse({ status: 'ok' }),

      // 未匹配的方法不会自动 405，必须显式兜住（AGENTS.md 硬性约束）
      ANY: async () => methodNotAllowed(['GET']),
    },
  },
});
