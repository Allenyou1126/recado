/**
 * 请求 ID 的产生与校验。
 *
 * 单独成模块（不 import 任何框架 API）是为了能直接单测 —— 它是日志关联的
 * 唯一线索，判定逻辑必须精确。
 */

/** 允许上游（反向代理、SDK）传入的请求 ID 头 */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * 允许的字符集与长度。
 *
 * 上游传来的值会被写进日志，因此必须限制字符集 —— 否则就是一个日志注入
 * （伪造日志行、塞入控制字符）的入口。长度上限避免超长值撑爆日志。
 */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** 采用上游请求 ID，不可用时自行生成 */
export function resolveRequestId(request: Request): string {
  const inbound = request.headers.get(REQUEST_ID_HEADER)?.trim();

  if (inbound && REQUEST_ID_PATTERN.test(inbound)) {
    return inbound;
  }

  return crypto.randomUUID();
}
