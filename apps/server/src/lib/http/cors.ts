/**
 * 公开端点的 CORS 支持。
 *
 * ⚠️ 框架**没有任何内置 CORS 支持**（全源码检索无匹配），响应头必须自己写。
 *
 * 两条硬性要求：
 *
 * 1. **动态回显具体来源，禁止 `*`**。站点白名单是逐站点配置的，用 `*` 等于
 *    把白名单作废。
 * 2. **必须带 `Vary: Origin`**。回显来源却不让缓存按来源分桶，会把 A 站的响应
 *    交给 B 站 —— 这是比「忘了加 CORS 头」更隐蔽的事故。
 *
 * 被拒绝的来源同样回显，便于前端看到我们的错误信封；否则浏览器只会给出
 * 一个不可读的 CORS 报错，排查成本极高。回显不代表放行 —— 请求本身已被拒。
 */

/** 允许浏览器携带的请求头（含 SDK 会用到的幂等键） */
export const CORS_ALLOWED_HEADERS = ['X-Recado-Site', 'Content-Type', 'Idempotency-Key'];

/**
 * 公开端点只使用 GET / POST，因此预检统一声明这两个方法。
 * 若将来新增公开的 PATCH / DELETE 端点，必须同步更新这里。
 */
export const CORS_ALLOWED_METHODS = ['GET', 'POST', 'OPTIONS'];

/** 预检结果缓存时长（秒） */
export const CORS_MAX_AGE_SECONDS = 86_400;

/** 来源为空（同源请求或非浏览器客户端）时不加任何 CORS 头 */
export function corsHeaders(origin: string | null | undefined): Record<string, string> {
  const value = origin?.trim();

  if (!value) return {};

  return {
    'Access-Control-Allow-Origin': value,
    Vary: 'Origin',
  };
}

/** 预检响应：`204` + 允许的方法与请求头 */
export function preflightResponse(origin: string | null | undefined): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...corsHeaders(origin),
      'Access-Control-Allow-Methods': CORS_ALLOWED_METHODS.join(', '),
      'Access-Control-Allow-Headers': CORS_ALLOWED_HEADERS.join(', '),
      'Access-Control-Max-Age': String(CORS_MAX_AGE_SECONDS),
      'cache-control': 'no-store',
    },
  });
}

/**
 * 给响应补上 CORS 头。
 *
 * 重建 Response 而不是原地改 header：下游响应可能来自框架内部或驱动层，
 * 其 headers 未必可变。这里不涉及流式响应，重建是安全的。
 */
export function withCorsHeaders(response: Response, origin: string | null | undefined): Response {
  const headers = new Headers(response.headers);

  for (const [name, value] of Object.entries(corsHeaders(origin))) {
    headers.set(name, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
