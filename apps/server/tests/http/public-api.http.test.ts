/**
 * 生产构建下的 HTTP 行为测试。
 *
 * 覆盖三条**只能在生产产物上验证**的验收项：
 *
 * 1. CORS 预检返回正确的 `Access-Control-Allow-Origin`（dev 下框架会绕过处理器）
 * 2. 未匹配的 HTTP 方法返回 `405 + Allow`，而不是 `200 text/html`（SSR 应用外壳）
 * 3. 公开端点的统一错误信封（缺 / 错 site key、非白名单来源）
 *
 * 前置：测试库可用（compose 起 postgres 即可，helper 会自动建库并跑迁移）。
 */

import { createSite } from '@recado/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openTestDatabase } from '../helpers/test-db';
import { startBuiltServer, type RunningServer } from './server-harness';

const ALLOWED_ORIGIN = 'https://blog.example.com';

let server: RunningServer;
let siteKey: string;
let lenientSiteKey: string;
let db: ReturnType<typeof openTestDatabase>;

beforeAll(async () => {
  db = openTestDatabase();

  const strict = await createSite(db.db, {
    name: '生产 HTTP 测试站',
    allowedOrigins: [ALLOWED_ORIGIN, '*.example.org'],
    settings: { originPolicy: 'strict' },
  });
  const lenient = await createSite(db.db, {
    name: '宽松来源站点',
    allowedOrigins: [],
    settings: { originPolicy: 'lenient' },
  });

  if (!strict.data || !lenient.data) throw new Error('创建测试站点失败');
  siteKey = strict.data.key;
  lenientSiteKey = lenient.data.key;

  server = await startBuiltServer();
});

afterAll(async () => {
  await server?.stop();
  await db?.close();
});

function url(path: string): string {
  return `${server.baseUrl}${path}`;
}

describe('CORS 预检（生产构建）', () => {
  it('预检返回 204 + 回显来源 + 允许的方法与请求头', async () => {
    const response = await fetch(url('/api/v1/render'), {
      method: 'OPTIONS',
      headers: {
        'X-Recado-Site': siteKey,
        Origin: ALLOWED_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'X-Recado-Site, Content-Type',
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get('vary')).toBe('Origin');
    expect(response.headers.get('access-control-allow-methods')).toContain('POST');
    expect(response.headers.get('access-control-allow-headers')).toContain('X-Recado-Site');
    expect(response.headers.get('access-control-allow-headers')).toContain('Content-Type');
    expect(response.headers.get('access-control-allow-headers')).toContain('Idempotency-Key');
  });

  it('通配符白名单命中的子域同样被回显', async () => {
    const response = await fetch(url('/api/v1/render'), {
      method: 'OPTIONS',
      headers: { 'X-Recado-Site': siteKey, Origin: 'https://a.example.org' },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://a.example.org');
  });

  it('非白名单来源的预检被拒，但仍带上 CORS 头（否则前端读不到错误信封）', async () => {
    const response = await fetch(url('/api/v1/render'), {
      method: 'OPTIONS',
      headers: { 'X-Recado-Site': siteKey, Origin: 'https://evil.example.net' },
    });

    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://evil.example.net');

    const body = await response.json();
    expect(body.error.reason).toBe('FORBIDDEN_ORIGIN_NOT_ALLOWED');
  });

  it('不用 `*` 通配 —— 白名单是逐站点配置的', async () => {
    const response = await fetch(url('/api/v1/render'), {
      method: 'OPTIONS',
      headers: { 'X-Recado-Site': siteKey, Origin: ALLOWED_ORIGIN },
    });

    expect(response.headers.get('access-control-allow-origin')).not.toBe('*');
  });
});

describe('实际跨域请求（生产构建）', () => {
  it('白名单来源的 POST 成功，并带上 CORS 头', async () => {
    const response = await fetch(url('/api/v1/render'), {
      method: 'POST',
      headers: {
        'X-Recado-Site': siteKey,
        Origin: ALLOWED_ORIGIN,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ content: '跨域 **渲染**' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);

    const body = await response.json();
    expect(body.data.html).toContain('<strong>渲染</strong>');
  });

  it('非白名单来源被拒（403），响应体是统一错误信封', async () => {
    const response = await fetch(url('/api/v1/render'), {
      method: 'POST',
      headers: {
        'X-Recado-Site': siteKey,
        Origin: 'https://evil.example.net',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ content: 'hi' }),
    });

    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error.reason).toBe('FORBIDDEN_ORIGIN_NOT_ALLOWED');
  });

  it('无来源头时：strict 站点 403，lenient 站点放行', async () => {
    const strict = await fetch(url('/api/v1/render'), {
      method: 'POST',
      headers: { 'X-Recado-Site': siteKey, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'hi' }),
    });
    const lenient = await fetch(url('/api/v1/render'), {
      method: 'POST',
      headers: { 'X-Recado-Site': lenientSiteKey, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'hi' }),
    });

    expect(strict.status).toBe(403);
    expect((await strict.json()).error.reason).toBe('FORBIDDEN_ORIGIN_MISSING');
    expect(lenient.status).toBe(200);
  });
});

describe('错误方法与错误信封（生产构建）', () => {
  /**
   * 公开端点清单 × 未声明的方法。
   *
   * 「未匹配的方法返回 200 text/html（SSR 外壳）」这个框架行为很容易在新增路由时复发，
   * 因此用表格逐个端点断言，而不是只测一条。
   */
  const METHOD_MATRIX: ReadonlyArray<{
    path: string;
    method: string;
    allow: string;
  }> = [
    { path: '/api/v1/config', method: 'PUT', allow: 'GET, HEAD, OPTIONS' },
    { path: '/api/v1/config', method: 'DELETE', allow: 'GET, HEAD, OPTIONS' },
    { path: '/api/v1/config', method: 'POST', allow: 'GET, HEAD, OPTIONS' },
    { path: '/api/v1/render', method: 'GET', allow: 'POST, OPTIONS' },
    { path: '/api/v1/render', method: 'DELETE', allow: 'POST, OPTIONS' },
    { path: '/api/v1/health', method: 'POST', allow: 'GET, HEAD, OPTIONS' },
    { path: '/api/v1/health', method: 'PUT', allow: 'GET, HEAD, OPTIONS' },
  ];

  it.each(METHOD_MATRIX)(
    '$method $path 返回 405 + Allow（而不是 200 text/html）',
    async ({ path, method, allow }) => {
      const response = await fetch(url(path), {
        method,
        headers: { 'X-Recado-Site': siteKey, Origin: ALLOWED_ORIGIN },
      });

      expect(response.status).toBe(405);
      expect(response.headers.get('allow')).toBe(allow);
      expect(response.headers.get('content-type') ?? '').not.toContain('text/html');
    },
  );

  it('对只读端点发 PUT 返回 405 + Allow，而不是 200 text/html', async () => {
    const response = await fetch(url('/api/v1/config'), {
      method: 'PUT',
      headers: { 'X-Recado-Site': siteKey, Origin: ALLOWED_ORIGIN },
    });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
    // 405 无响应体，因此 content-type 可以为空；关键是**不能**是 SSR 外壳的 text/html
    expect(response.headers.get('content-type') ?? '').not.toContain('text/html');
  });

  it('对预览端点发 GET 返回 405 + Allow', async () => {
    const response = await fetch(url('/api/v1/render'), {
      method: 'GET',
      headers: { 'X-Recado-Site': siteKey, Origin: ALLOWED_ORIGIN },
    });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST, OPTIONS');
  });

  it('缺 site key 返回 400 + 统一错误信封', async () => {
    const response = await fetch(url('/api/v1/config'), { headers: { Origin: ALLOWED_ORIGIN } });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({
      error: { reason: 'VALIDATION_SITE_KEY_REQUIRED', message: 'Missing X-Recado-Site header' },
    });
  });

  it('未知 site key 返回 404 且不回显 key', async () => {
    const response = await fetch(url('/api/v1/config'), {
      headers: { 'X-Recado-Site': 'rc_nope', Origin: ALLOWED_ORIGIN },
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.reason).toBe('NOT_FOUND_SITE');
    expect(JSON.stringify(body)).not.toContain('rc_nope');
  });

  it('健康检查不受 site key 约束，且拒绝错误方法', async () => {
    const ok = await fetch(url('/api/v1/health'));
    const wrongMethod = await fetch(url('/api/v1/health'), { method: 'DELETE' });

    expect(ok.status).toBe(200);
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
  });
});

describe('GET /api/v1/config（生产构建）', () => {
  it('返回渲染评论区所需的公开配置', async () => {
    const response = await fetch(url('/api/v1/config'), {
      headers: { 'X-Recado-Site': siteKey, Origin: ALLOWED_ORIGIN },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.site.name).toBe('生产 HTTP 测试站');
    expect(body.data.site.id).toMatch(/^[0-9a-f-]{36}$/);

    expect(body.data.comment).toMatchObject({
      maxDepth: 2,
      maxContentBytes: 10_240,
      requireNickname: true,
      requireEmail: true,
      pageSize: 20,
      maxPageSize: 50,
      repliesPreview: 3,
      sortOptions: ['latest', 'oldest'],
    });

    expect(body.data.rendering).toMatchObject({
      codeHighlight: true,
      math: true,
      linkNofollow: true,
    });

    // 内置表情包已合并进来
    expect(Object.keys(body.data.emojis).length).toBeGreaterThan(10);
    expect(body.data.emojis.smile).toContain('twemoji');
    expect(body.data.avatarBaseUrl).toContain('gravatar');
  });

  it('不泄漏任何内部配置（notifyEmails / smtp / 审核与限流参数）', async () => {
    const response = await fetch(url('/api/v1/config'), {
      headers: { 'X-Recado-Site': siteKey, Origin: ALLOWED_ORIGIN },
    });
    const raw = await response.text();

    for (const leaked of [
      'notifyEmails',
      'smtp',
      'auditMode',
      'spamThreshold',
      'minIntervalSeconds',
      'originPolicy',
      'allowedOrigins',
      '"key"',
    ]) {
      expect(raw, `响应里出现了内部配置：${leaked}`).not.toContain(leaked);
    }
  });

  it('未知 site key 拿不到配置', async () => {
    const response = await fetch(url('/api/v1/config'), {
      headers: { 'X-Recado-Site': 'rc_unknown', Origin: ALLOWED_ORIGIN },
    });

    expect(response.status).toBe(404);
  });
});
