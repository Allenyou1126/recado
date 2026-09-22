import { createFileRoute } from '@tanstack/react-router';

import { methodNotAllowed } from '../lib/http/method-not-allowed';
import { jsonResponse } from '../lib/http/respond';

/**
 * 存活探针：`GET /healthz`。
 *
 * 与 `/api/v1/health` 是同一个东西的两个路径：需求 §6 M8 的端点清单用的是
 * `/healthz`，而应用骨架最早把探针放在了 API 命名空间下。两个都保留 ——
 * 探针路径常被写进部署脚本与编排配置，改掉任何一个都会让既有部署静默失效。
 *
 * ⚠️ **不查数据库**（§7.3）：数据库不可用时它仍返回 200，避免编排系统把
 * 「数据库抖动」误判为「进程已死」并反复重启。要判断「能不能服务」用 `/readyz`。
 */
export const Route = createFileRoute('/healthz')({
  server: {
    handlers: {
      GET: async () => jsonResponse({ status: 'ok' }),

      ANY: async () => methodNotAllowed(['GET']),
    },
  },
});
