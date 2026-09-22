import { domainError } from '@recado/shared';
import { describe, expect, it } from 'vitest';

import {
  errorResponse,
  jsonResponse,
  okResponse,
  resultToResponse,
} from '../../src/lib/http/respond';

describe('jsonResponse', () => {
  it('默认不缓存，避免已删除的评论被缓存放出', async () => {
    const response = jsonResponse({ data: 'x' });

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  });

  it('传入的响应头覆盖默认值（如 CORS）', () => {
    const response = jsonResponse({}, { headers: { 'cache-control': 'public' } });

    expect(response.headers.get('cache-control')).toBe('public');
  });
});

describe('okResponse', () => {
  it('包成 { data } 信封', async () => {
    const response = okResponse({ id: 'abc' });

    await expect(response.json()).resolves.toEqual({ data: { id: 'abc' } });
  });
});

describe('errorResponse', () => {
  it('按错误码前缀推导状态码', async () => {
    const cases = [
      ['VALIDATION_X', 400],
      ['AUTH_X', 401],
      ['FORBIDDEN_X', 403],
      ['NOT_FOUND_X', 404],
      ['CONFLICT_X', 409],
      ['RATE_LIMITED_X', 429],
      ['INTERNAL_X', 500],
    ] as const;

    for (const [reason, status] of cases) {
      expect(errorResponse(domainError(reason, 'boom')).status).toBe(status);
    }
  });

  it('未知前缀按 500 处理，不静默降级成看似合理的状态码', () => {
    expect(errorResponse(domainError('SOMETHING_ELSE', 'boom')).status).toBe(500);
  });

  it('只输出 reason/message/details，不带堆栈', async () => {
    const response = errorResponse(domainError('VALIDATION_X', 'bad input', { field: 'email' }));

    await expect(response.json()).resolves.toEqual({
      error: { reason: 'VALIDATION_X', message: 'bad input', details: { field: 'email' } },
    });
  });
});

describe('resultToResponse', () => {
  it('成功走 200 + { data }', async () => {
    const response = resultToResponse({ data: 1, error: null });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: 1 });
  });

  it('失败走错误信封', async () => {
    const response = resultToResponse({ data: null, error: domainError('NOT_FOUND_X', 'nope') });

    expect(response.status).toBe(404);
  });
});
