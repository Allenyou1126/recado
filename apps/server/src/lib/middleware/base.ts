/**
 * baseMiddleware —— 每个请求的第一环。
 *
 * 注入三样东西：`env`（启动时经 Zod 校验的配置）、`requestId`（贯穿日志与
 * 错误响应）、`logger`（已绑定 requestId）。
 *
 * 关于 `env` 的来源：框架的默认 Node 入口不会向中间件传任何初始 context
 * （`createNullProtoObject(undefined)`），所以配置必须在这里注入，
 * 而不是指望 `Register.server.requestContext` 会带来运行期的值。
 * 见 .specs/development-standards.md §13.2。
 */

import { createMiddleware } from '@tanstack/react-start';

import { getEnv } from '../../config/env.server';
import { createLogger } from '../logger.server';
import { resolveRequestId } from '../request-id.server';

export const baseMiddleware = createMiddleware({ type: 'request' }).server(
  async ({ next, request }) => {
    const env = getEnv();
    const requestId = resolveRequestId(request);

    // logger 已把 requestId 绑为 child binding，后续日志不要再重复传该字段
    // （否则序列化出的 JSON 会出现同名的两个键）
    return next({
      context: { env, requestId, logger: createLogger(env, { bindings: { requestId } }) },
    });
  },
);
