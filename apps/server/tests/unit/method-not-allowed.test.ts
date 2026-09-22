import { describe, expect, it } from 'vitest';

import { methodNotAllowed } from '../../src/lib/http/method-not-allowed';

describe('methodNotAllowed', () => {
  it('返回 405 而不是让请求落到 SSR 外壳（AGENTS.md 硬性约束）', () => {
    const response = methodNotAllowed(['GET']);

    expect(response.status).toBe(405);
  });

  it('声明了 GET 就同时允许 HEAD（框架把 HEAD 回落到 GET）', () => {
    expect(methodNotAllowed(['GET']).headers.get('allow')).toBe('GET, HEAD, OPTIONS');
  });

  it('OPTIONS 始终并入 Allow', () => {
    expect(methodNotAllowed(['POST']).headers.get('allow')).toBe('POST, OPTIONS');
  });

  it('Allow 顺序稳定，便于人工核对', () => {
    expect(methodNotAllowed(['DELETE', 'GET', 'POST']).headers.get('allow')).toBe(
      'GET, HEAD, POST, DELETE, OPTIONS',
    );
  });
});
