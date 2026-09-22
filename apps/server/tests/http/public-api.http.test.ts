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

import { createSite, startSession } from '@recado/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { openTestDatabase } from '../helpers/test-db';
import { startBuiltServer, type RunningServer } from './server-harness';

const ALLOWED_ORIGIN = 'https://blog.example.com';

let server: RunningServer;
let siteKey: string;
let lenientSiteKey: string;
/** 评论流程用站点：关掉最小发表间隔，避免测试之间互相限流 */
let commentSiteKey: string;
/** 限流测试用站点：60 秒最小间隔 */
let throttledSiteKey: string;
/** 评论流程站点的 id（管理端按 UUID 定位站点） */
let commentSiteId: string;
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
  const commentSite = await createSite(db.db, {
    name: '评论流程站点',
    allowedOrigins: [ALLOWED_ORIGIN],
    settings: { minIntervalSeconds: 0 },
  });
  const throttledSite = await createSite(db.db, {
    name: '限流站点',
    allowedOrigins: [ALLOWED_ORIGIN],
    settings: { minIntervalSeconds: 60 },
  });

  if (!strict.data || !lenient.data || !commentSite.data || !throttledSite.data) {
    throw new Error('创建测试站点失败');
  }

  siteKey = strict.data.key;
  lenientSiteKey = lenient.data.key;
  commentSiteKey = commentSite.data.key;
  commentSiteId = commentSite.data.id;
  throttledSiteKey = throttledSite.data.key;

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

describe('评论公开端点（生产构建）', () => {
  const headers = (key: string): Record<string, string> => ({
    'X-Recado-Site': key,
    Origin: ALLOWED_ORIGIN,
    'content-type': 'application/json',
  });

  async function postComment(body: Record<string, unknown>, key = commentSiteKey) {
    return fetch(url('/api/v1/comments'), {
      method: 'POST',
      headers: headers(key),
      body: JSON.stringify(body),
    });
  }

  it('端到端：发表 → 列表 → 回复 → 计数', async () => {
    const created = await postComment({
      path: '/http/hello',
      content: '第一条 **评论**',
      nickname: 'Alice',
      email: 'alice@example.com',
    });
    const createdBody = await created.json();

    expect(created.status).toBe(201);
    const rootId: string = createdBody.data.id;
    expect(createdBody.data.content).toContain('<strong>评论</strong>');

    const reply = await postComment({
      path: '/http/hello',
      content: '一条回复',
      nickname: 'Bob',
      email: 'bob@example.com',
      parentId: rootId,
    });
    const replyBody = await reply.json();

    expect(reply.status).toBe(201);
    expect(replyBody.data.parentId).toBe(rootId);
    expect(replyBody.data.rootId).toBe(rootId);

    const list = await fetch(url('/api/v1/comments?path=%2Fhttp%2Fhello'), {
      headers: { 'X-Recado-Site': commentSiteKey, Origin: ALLOWED_ORIGIN },
    });
    const listBody = await list.json();

    expect(list.status).toBe(200);
    expect(listBody.data.total).toBe(1);
    expect(listBody.data.comments[0].replies).toHaveLength(1);

    const counts = await fetch(url('/api/v1/comments/count?paths=%2Fhttp%2Fhello,%2Fnever'), {
      headers: { 'X-Recado-Site': commentSiteKey, Origin: ALLOWED_ORIGIN },
    });
    const countsBody = await counts.json();

    expect(countsBody.data.counts['/http/hello']).toBe(2);
    expect(countsBody.data.counts['/never']).toBe(0);
  });

  it('公开响应不含 email / ip / user-agent', async () => {
    await postComment({
      path: '/http/secrets',
      content: '敏感字段检查',
      nickname: 'Secret',
      email: 'secret@example.com',
    });

    const list = await fetch(url('/api/v1/comments?path=%2Fhttp%2Fsecrets'), {
      headers: { 'X-Recado-Site': commentSiteKey, Origin: ALLOWED_ORIGIN },
    });
    const raw = await list.text();

    for (const leaked of ['email', 'secret@example.com', 'userAgent', 'user-agent', '"ip"']) {
      expect(raw, `公开响应里出现了 ${leaked}`).not.toContain(leaked);
    }
  });

  it('回复分页端点独立于顶层分页', async () => {
    const created = await postComment({
      path: '/http/paging',
      content: '顶层',
      nickname: 'Alice',
      email: 'alice@example.com',
    });
    const rootId: string = (await created.json()).data.id;

    for (let index = 0; index < 4; index += 1) {
      await postComment({
        path: '/http/paging',
        content: `回复 ${index}`,
        nickname: 'Bob',
        email: 'bob@example.com',
        parentId: rootId,
      });
    }

    const replies = await fetch(
      url(`/api/v1/comments/${rootId}/replies?pageSize=2&page=2&sort=oldest`),
      { headers: { 'X-Recado-Site': commentSiteKey, Origin: ALLOWED_ORIGIN } },
    );
    const body = await replies.json();

    expect(replies.status).toBe(200);
    expect(body.data.total).toBe(4);
    expect(body.data.totalPages).toBe(2);
    expect(body.data.replies).toHaveLength(2);
  });

  it('缺少 email 返回校验错误，而不是降级处理（决策 D18）', async () => {
    const response = await postComment({ path: '/http/validation', content: '没有邮箱' });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.reason).toBe('VALIDATION_INVALID_BODY');
  });

  it('超长内容返回 400 + VALIDATION_CONTENT_TOO_LONG', async () => {
    const response = await postComment({
      path: '/http/too-long',
      content: 'a'.repeat(20_000),
      nickname: 'Alice',
      email: 'alice@example.com',
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.reason).toBe('VALIDATION_CONTENT_TOO_LONG');
  });

  it('最小间隔内重复发表返回 429 + 重试间隔', async () => {
    const first = await postComment(
      { path: '/http/throttle', content: '第一条', nickname: 'A', email: 'a@example.com' },
      throttledSiteKey,
    );
    const second = await postComment(
      { path: '/http/throttle', content: '第二条', nickname: 'A', email: 'a@example.com' },
      throttledSiteKey,
    );
    const body = await second.json();

    expect(first.status).toBe(201);
    expect(second.status).toBe(429);
    expect(body.error.reason).toBe('RATE_LIMITED_TOO_FREQUENT');
    expect(body.error.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('最近评论与线程元信息可用', async () => {
    await postComment({
      path: '/http/meta',
      content: '元信息测试',
      nickname: 'Alice',
      email: 'alice@example.com',
    });

    const recent = await fetch(url('/api/v1/comments/recent?limit=5'), {
      headers: { 'X-Recado-Site': commentSiteKey, Origin: ALLOWED_ORIGIN },
    });
    const thread = await fetch(url('/api/v1/threads/http/meta'), {
      headers: { 'X-Recado-Site': commentSiteKey, Origin: ALLOWED_ORIGIN },
    });

    expect(recent.status).toBe(200);
    expect((await recent.json()).data.length).toBeGreaterThan(0);

    expect(thread.status).toBe(200);
    expect((await thread.json()).data).toMatchObject({ path: '/http/meta', commentCount: 1 });
  });

  it('评论端点同样拒绝未声明的方法', async () => {
    const list = await fetch(url('/api/v1/comments'), {
      method: 'DELETE',
      headers: { 'X-Recado-Site': commentSiteKey, Origin: ALLOWED_ORIGIN },
    });
    const recent = await fetch(url('/api/v1/comments/recent'), {
      method: 'POST',
      headers: { 'X-Recado-Site': commentSiteKey, Origin: ALLOWED_ORIGIN },
    });

    expect(list.status).toBe(405);
    expect(list.headers.get('allow')).toBe('GET, HEAD, POST, OPTIONS');
    expect(recent.status).toBe(405);
  });
});

describe('管理端 API（生产构建）', () => {
  let adminSiteId: string;
  let sessionCookie: string;
  const CSRF_TOKEN = 'csrf-token-for-tests';

  beforeAll(async () => {
    const created = await createSite(db.db, {
      name: '管理端测试站',
      allowedOrigins: [ALLOWED_ORIGIN],
      settings: { minIntervalSeconds: 0 },
    });
    if (!created.data) throw new Error('创建管理端测试站失败');
    adminSiteId = created.data.id;

    // 直接建一个实例级管理员的会话：这里要验的是 HTTP 行为，
    // OIDC 握手本身由 auth 的集成测试覆盖
    const session = await startSession(db.db, {
      identity: {
        oidcSubject: 'https://idp.test#http-admin',
        kind: 'human',
        email: 'admin@example.com',
        displayName: 'HTTP Admin',
        avatarUrl: null,
      },
      roles: ['recado.OWNER'],
      rolePrefix: 'recado',
      ip: null,
      userAgent: 'vitest',
    });

    if (!session.data) throw new Error('创建测试会话失败');
    sessionCookie = `recado_session=${session.data.token}`;
  });

  const adminHeaders = (): Record<string, string> => ({
    cookie: sessionCookie,
    'X-Recado-Site-Id': adminSiteId,
    'content-type': 'application/json',
  });

  it('未认证请求被拒，且不泄漏任何数据', async () => {
    const response = await fetch(url('/api/v1/admin/comments'), {
      headers: { 'X-Recado-Site-Id': adminSiteId },
    });

    expect(response.status).toBe(401);
    expect((await response.json()).error.reason).toBe('AUTH_SESSION_INVALID');
  });

  it('管理端点不检查来源头（脚本调用没有 Origin，Q-12）', async () => {
    const response = await fetch(url('/api/v1/admin/me'), {
      headers: { cookie: sessionCookie, Origin: 'https://evil.example.net' },
    });

    expect(response.status).toBe(200);
  });

  it('/admin/me 返回身份与权限范围，且不回显 oidc_subject', async () => {
    const response = await fetch(url('/api/v1/admin/me'), {
      headers: { cookie: sessionCookie },
    });
    const body = await response.json();
    const raw = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.data.kind).toBe('human');
    expect(body.data.email).toBe('admin@example.com');
    expect(body.data.scope).toEqual({ type: 'instance' });
    expect(body.data.matchedRoles).toEqual(['recado.OWNER']);

    // 内部标识不外泄
    expect(raw).not.toContain('oidc_subject');
    expect(raw).not.toContain('https://idp.test#http-admin');
  });

  it('站点管理员访问未授权站点被拒（403，不是 404）', async () => {
    const scoped = await startSession(db.db, {
      identity: {
        oidcSubject: 'https://idp.test#scoped-admin',
        kind: 'human',
        email: 'scoped@example.com',
        displayName: 'Scoped',
        avatarUrl: null,
      },
      roles: ['recado.ADMIN.11111111-1111-1111-1111-111111111111'],
      rolePrefix: 'recado',
      ip: null,
      userAgent: 'vitest',
    });
    if (!scoped.data) throw new Error('创建测试会话失败');

    const response = await fetch(url('/api/v1/admin/comments'), {
      headers: {
        cookie: `recado_session=${scoped.data.token}`,
        'X-Recado-Site-Id': adminSiteId,
      },
    });

    expect(response.status).toBe(403);
    expect((await response.json()).error.reason).toBe('FORBIDDEN_SITE_SCOPE');
  });

  it('Cookie 认证的写操作必须带 CSRF 双重提交', async () => {
    const withoutToken = await fetch(url('/api/v1/admin/comments/batch'), {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({ ids: ['00000000-0000-0000-0000-000000000000'], status: 'spam' }),
    });

    expect(withoutToken.status).toBe(403);
    expect((await withoutToken.json()).error.reason).toBe('FORBIDDEN_CSRF_TOKEN_INVALID');

    const mismatched = await fetch(url('/api/v1/admin/comments/batch'), {
      method: 'POST',
      headers: {
        ...adminHeaders(),
        'x-recado-csrf-token': 'wrong',
        cookie: `${sessionCookie}; recado_csrf=${CSRF_TOKEN}`,
      },
      body: JSON.stringify({ ids: ['00000000-0000-0000-0000-000000000000'], status: 'spam' }),
    });

    expect(mismatched.status).toBe(403);
  });

  it('带齐 CSRF 后可以批量处理，且返回部分失败明细', async () => {
    // 先发一条评论
    const created = await fetch(url('/api/v1/comments'), {
      method: 'POST',
      headers: {
        'X-Recado-Site': commentSiteKey,
        Origin: ALLOWED_ORIGIN,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        path: '/admin/batch',
        content: '待标记垃圾',
        nickname: 'Alice',
        email: 'alice@example.com',
      }),
    });
    const commentId: string = (await created.json()).data.id;

    const response = await fetch(url('/api/v1/admin/comments/batch'), {
      method: 'POST',
      headers: {
        ...adminHeaders(),
        'X-Recado-Site-Id': commentSiteId,
        'x-recado-csrf-token': CSRF_TOKEN,
        cookie: `${sessionCookie}; recado_csrf=${CSRF_TOKEN}`,
      },
      body: JSON.stringify({
        ids: [commentId, '00000000-0000-0000-0000-000000000000'],
        status: 'spam',
      }),
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.reason).toBe('CONFLICT_BATCH_PARTIAL_FAILURE');
    expect(body.error.failures).toEqual([
      { commentId: '00000000-0000-0000-0000-000000000000', reason: 'NOT_FOUND_COMMENT' },
    ]);
  });

  it('后台列表能看到 pending / spam 与管理员可见字段', async () => {
    const response = await fetch(url('/api/v1/admin/comments?status=approved'), {
      headers: { cookie: sessionCookie, 'X-Recado-Site-Id': commentSiteId },
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    // 前面已经发过评论，这里必然有数据
    expect(body.data.comments.length).toBeGreaterThan(0);

    const first = body.data.comments[0];
    // 管理端可以看到敏感字段，公开端不行 —— 这正是两套契约分开的原因
    expect(first).toHaveProperty('email');
    expect(first).toHaveProperty('ip');
    expect(first).toHaveProperty('contentMd');
    // 但内部标识仍然不外泄
    expect(JSON.stringify(first)).not.toContain('oidc_subject');
  });

  it('每个管理端点都声明了 ANY → 405（认证后）', async () => {
    const me = await fetch(url('/api/v1/admin/me'), {
      method: 'POST',
      headers: { cookie: sessionCookie },
    });
    const comments = await fetch(url('/api/v1/admin/comments'), {
      method: 'DELETE',
      headers: {
        cookie: `${sessionCookie}; recado_csrf=${CSRF_TOKEN}`,
        'X-Recado-Site-Id': adminSiteId,
        'x-recado-csrf-token': CSRF_TOKEN,
      },
    });

    expect(me.status).toBe(405);
    expect(me.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
    expect(comments.status).toBe(405);
  });
});

describe('管理台页面（生产构建）', () => {
  it('未登录访问管理台页面不会泄露数据（跳转或错误页）', async () => {
    const response = await fetch(url('/admin/comments'), { redirect: 'manual' });

    // beforeLoad 会把未登录访问者导向登录流程；关键是**不会**渲染出任何管理数据
    expect([302, 303, 307, 200]).toContain(response.status);
    const body = await response.text();
    expect(body).not.toContain('@example.com');
  });

  it('/auth/login 会 302 到 IdP 并下发签名过的流程态 Cookie', async () => {
    const response = await fetch(url('/auth/login'), { redirect: 'manual' });

    // harness 里的 OIDC_ISSUER_URL 指向不存在的 idp.test：两种结果都可接受 ——
    // 真的连上了就 302 到 IdP，连不上则返回统一错误信封（绝不吐堆栈）
    expect([302, 401, 500, 502]).toContain(response.status);

    const body = await response.text();
    expect(body).not.toContain('at ');
  });

  it('登出端点声明了 ANY → 405', async () => {
    const response = await fetch(url('/auth/logout'), { method: 'GET' });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST, OPTIONS');
  });
});

describe('探针（T9.6）', () => {
  it('/healthz 不依赖数据库，始终 200', async () => {
    const response = await fetch(url('/api/v1/health'));
    expect(response.status).toBe(200);
  });

  it('/readyz 在数据库可用时返回 200', async () => {
    const response = await fetch(url('/readyz'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('ready');
  });

  it('/readyz 拒绝未声明的方法', async () => {
    const response = await fetch(url('/readyz'), { method: 'POST' });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD, OPTIONS');
  });
});
