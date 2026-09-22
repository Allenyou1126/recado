import { err, ok } from '@recado/shared';
import { createFileRoute } from '@tanstack/react-router';

import { createHandler } from '../../lib/http/handler';
import { methodNotAllowed } from '../../lib/http/method-not-allowed';
import { dbMiddleware } from '../../lib/middleware/db';
import { drainOutbox } from '../../lib/outbox-worker.server';

/**
 * `POST /internal/outbox/drain` —— 外部触发一轮投递。
 *
 * 存在的意义（requirements.md §8.5）：框架没有调度器，需要隔离 worker 时
 * 可以把这条端点挂到外部 cron 或容器 sidecar，而不必改代码。
 *
 * 用共享密钥认证（`X-Recado-Internal-Token` = `INTERNAL_DRAIN_TOKEN`）：
 * cron / sidecar 通常拿不到 OIDC 凭证，而这条端点的作用域是**整个实例**
 * （会处理所有站点的待发邮件），因此不能只靠站点级权限。
 *
 * 常量时间比较：`===` 会在第一个不同的字节返回，理论上可被逐字节猜测。
 */

const INTERNAL_TOKEN_HEADER = 'x-recado-internal-token';

function tokenMatches(provided: string | null, expected: string | undefined): boolean {
  if (provided === null || expected === undefined) return false;
  if (provided.length !== expected.length) return false;

  let mismatch = 0;
  for (let index = 0; index < provided.length; index += 1) {
    mismatch |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }

  return mismatch === 0;
}

type DrainResult = { claimed: number; sent: number; failed: number; skipped: number };

const drain = createHandler<DbContext, DrainResult, { reason: string; message: string }>(
  async (context, request) => {
    if (
      !tokenMatches(request.headers.get(INTERNAL_TOKEN_HEADER), context.env.INTERNAL_DRAIN_TOKEN)
    ) {
      return err({
        reason: 'AUTH_SESSION_INVALID',
        message: 'Missing or invalid internal drain token',
      });
    }

    return ok(await drainOutbox(context.env));
  },
  { operation: 'internal.outbox.drain' },
);

export const Route = createFileRoute('/internal/outbox-drain')({
  server: {
    middleware: [dbMiddleware],
    handlers: {
      POST: drain,
      ANY: async () => methodNotAllowed(['POST']),
    },
  },
});
