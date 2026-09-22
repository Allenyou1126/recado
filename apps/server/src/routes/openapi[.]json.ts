import { createFileRoute } from '@tanstack/react-router';

import { methodNotAllowed } from '../lib/http/method-not-allowed';
import { jsonResponse } from '../lib/http/respond';
import { buildOpenApiDocument } from '../lib/openapi.server';

/**
 * `GET /openapi.json` —— OpenAPI 3.1 文档。
 *
 * 文档由 Zod schema **推导**，与实际路由共用同一批契约类型；
 * `tests/http` 里有一条测试逐项比对「文档里的路径集合 == 实际路由集合」，
 * 避免文档悄悄落后于实现。
 */
export const Route = createFileRoute('/openapi.json')({
  server: {
    handlers: {
      GET: async () => jsonResponse(buildOpenApiDocument()),

      ANY: async () => methodNotAllowed(['GET']),
    },
  },
});
