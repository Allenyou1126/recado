/**
 * `ANY → 405 + Allow` 处理器工厂。
 *
 * 为什么每个 API 路由都必须声明它：配错方法时框架**不会**返回 405，
 * 而是让请求落到路由层，返回 `200 text/html`（SSR 应用外壳）。
 * 对第三方调用方来说，「拿到了 200 和一段 HTML」比明确的 405 难排查得多。
 * 见 AGENTS.md 硬性约束与 requirements.md §8.2。
 */

/** 路由可以声明处理器的 HTTP 方法 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';

/**
 * 生成 405 响应。
 *
 * 自动补全两条容易漏掉的规则：
 * - 声明了 `GET` 就等于实现了 `HEAD`（框架的 HEAD 会回落到 GET 处理器）
 * - 所有 API 路由都应显式实现 `OPTIONS`，因此默认并入 `Allow`
 */
export function methodNotAllowed(methods: readonly HttpMethod[]): Response {
  const allow = new Set<string>(methods);

  if (allow.has('GET')) allow.add('HEAD');
  allow.add('OPTIONS');

  // 保持稳定顺序，便于测试与人工核对
  const order: HttpMethod[] = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
  const allowList = order.filter((method) => allow.has(method));

  return new Response(null, {
    status: 405,
    headers: {
      Allow: allowList.join(', '),
      'cache-control': 'no-store',
    },
  });
}
