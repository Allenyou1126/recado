import { describe, expect, it, vi } from 'vitest';

import { createClient } from './client';

/** 记录请求并返回预设响应的 fetch 桩 */
function stubFetch(payload: unknown, init: ResponseInit = {}) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];

  const fetchImpl = vi.fn<typeof globalThis.fetch>(
    async (input: RequestInfo | URL, requestInit?: RequestInit) => {
      // fetch 的第一个参数可能是 URL 或 Request，这里统一取字符串形式
      const url = input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
      calls.push({ url, init: requestInit });
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'content-type': 'application/json' },
        ...init,
      });
    },
  );

  return { fetchImpl, calls };
}

const client = (fetchImpl: typeof globalThis.fetch) =>
  createClient({
    endpoint: 'https://comments.example.com/',
    siteKey: 'rc_test',
    fetch: fetchImpl,
  });

describe('request 组装', () => {
  it('拼出正确的 URL、站点头与方法', async () => {
    const { fetchImpl, calls } = stubFetch({
      data: { path: '/p', url: null, title: null, commentCount: 0, lastCommentAt: null },
    });

    await client(fetchImpl).getThreadMeta('/posts/hello');

    expect(calls[0]?.url).toBe('https://comments.example.com/api/v1/threads/posts/hello');
    expect(calls[0]?.init?.method ?? 'GET').toBe('GET');

    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['X-Recado-Site']).toBe('rc_test');
  });

  it('查询参数只在有值时出现，不发送 undefined', async () => {
    const { fetchImpl, calls } = stubFetch({
      data: { comments: [], page: 1, pageSize: 20, total: 0, totalPages: 1 },
    });

    await client(fetchImpl).listComments({ path: '/posts/1', sort: 'latest' });

    const url = new URL(calls[0]?.url ?? '');
    expect(url.searchParams.get('path')).toBe('/posts/1');
    expect(url.searchParams.get('sort')).toBe('latest');
    expect(url.searchParams.has('page')).toBe(false);
    expect(url.searchParams.has('threadId')).toBe(false);
  });

  it('POST 带 JSON 体与 content-type', async () => {
    const { fetchImpl, calls } = stubFetch({
      data: {
        id: '1',
        path: '/p',
        rootId: null,
        parentId: null,
        replyTo: null,
        nickname: 'A',
        website: null,
        content: '<p>x</p>',
        status: 'approved',
        createdAt: new Date().toISOString(),
        labels: [],
      },
    });

    await client(fetchImpl).createComment({ path: '/p', content: 'x', email: 'a@example.com' });

    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(calls[0]?.init?.method).toBe('POST');
    expect(headers['content-type']).toBe('application/json');
    expect(calls[0]?.init?.body).toBe(
      JSON.stringify({ path: '/p', content: 'x', email: 'a@example.com' }),
    );
  });
});

describe('错误处理', () => {
  it('服务端错误信封原样映射成 Result 的 error 分支', async () => {
    const { fetchImpl } = stubFetch(
      {
        error: {
          reason: 'RATE_LIMITED_TOO_FREQUENT',
          message: 'too fast',
          details: { retryAfterSeconds: 5 },
        },
      },
      { status: 429 },
    );

    const result = await client(fetchImpl).createComment({
      path: '/p',
      content: 'x',
      email: 'a@example.com',
    });

    expect(result.data).toBeNull();
    expect(result.error?.reason).toBe('RATE_LIMITED_TOO_FREQUENT');
    expect(result.error?.details).toEqual({ retryAfterSeconds: 5 });
  });

  it('网络失败返回 CLIENT_NETWORK_FAILED 而不是抛异常', async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error('connect ECONNREFUSED');
    });

    const result = await client(fetchImpl).getConfig();

    expect(result.error?.reason).toBe('CLIENT_NETWORK_FAILED');
  });

  it('超时返回 CLIENT_TIMEOUT', async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'TimeoutError'));
          });
        }),
    );

    const slow = createClient({
      endpoint: 'https://comments.example.com',
      siteKey: 'rc_test',
      fetch: fetchImpl,
      timeoutMs: 10,
    });

    const result = await slow.getConfig();

    expect(result.error?.reason).toBe('CLIENT_TIMEOUT');
  });

  it('响应不符合契约时返回 CLIENT_INVALID_RESPONSE', async () => {
    const { fetchImpl } = stubFetch({ data: { unexpected: true } });

    const result = await client(fetchImpl).getConfig();

    expect(result.error?.reason).toBe('CLIENT_INVALID_RESPONSE');
  });

  it('非 JSON 的失败响应也能给出可读错误', async () => {
    const fetchImpl = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response('<html>502 Bad Gateway</html>', {
          status: 502,
          headers: { 'content-type': 'text/html' },
        }),
    );

    const result = await client(fetchImpl).getConfig();

    expect(result.error?.reason).toBe('INTERNAL_UNEXPECTED');
    expect(result.error?.message).toContain('502');
  });
});

describe('AbortSignal', () => {
  it('调用方的 signal 会中止请求', async () => {
    const controller = new AbortController();

    const fetchImpl = vi.fn<typeof globalThis.fetch>(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );

    const pending = client(fetchImpl).listComments({ path: '/p', signal: controller.signal });
    controller.abort();

    const result = await pending;

    expect(result.error?.reason).toBe('CLIENT_NETWORK_FAILED');
  });
});

describe('端点覆盖（M9 的四个核心操作）', () => {
  it('批量评论数把 paths 拼成逗号分隔', async () => {
    const { fetchImpl, calls } = stubFetch({ data: { counts: { '/a': 1 }, total: 1 } });

    const result = await client(fetchImpl).countComments(['/a', '/b']);

    expect(new URL(calls[0]?.url ?? '').searchParams.get('paths')).toBe('/a,/b');
    expect(result.data?.total).toBe(1);
  });

  it('回复分页端点带上 rootId', async () => {
    const { fetchImpl, calls } = stubFetch({
      data: { rootId: 'r1', replies: [], page: 1, pageSize: 20, total: 0, totalPages: 1 },
    });

    await client(fetchImpl).listReplies('r1', { pageSize: 10 });

    expect(calls[0]?.url).toContain('/api/v1/comments/r1/replies');
    expect(new URL(calls[0]?.url ?? '').searchParams.get('pageSize')).toBe('10');
  });

  it('预览渲染走 POST /render', async () => {
    const { fetchImpl, calls } = stubFetch({ data: { html: '<p>x</p>', mentions: ['alice'] } });

    const result = await client(fetchImpl).render('@alice');

    expect(calls[0]?.init?.method).toBe('POST');
    expect(result.data?.mentions).toEqual(['alice']);
  });
});
