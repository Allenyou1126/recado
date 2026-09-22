import { describe, expect, it } from 'vitest';

import { REQUEST_ID_HEADER, resolveRequestId } from '../../src/lib/request-id.server';

const request = (headers: Record<string, string> = {}) =>
  new Request('https://recado.test/api/v1/site', { headers });

describe('resolveRequestId', () => {
  it('没有上游请求 ID 时自行生成 UUID', () => {
    const id = resolveRequestId(request());

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('接受上游传入的合法请求 ID，便于跨服务串联', () => {
    expect(resolveRequestId(request({ [REQUEST_ID_HEADER]: 'trace-abc.123' }))).toBe(
      'trace-abc.123',
    );
  });

  it('拒绝带空格与结构字符的请求 ID —— 否则就是日志注入入口', () => {
    // HTTP 头本身不允许换行，但仍可塞入空格、引号、花括号来伪造日志结构
    const forged = request({ [REQUEST_ID_HEADER]: 'ok {"level":50}' });

    expect(resolveRequestId(forged)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('拒绝超长请求 ID', () => {
    const long = 'a'.repeat(129);

    expect(resolveRequestId(request({ [REQUEST_ID_HEADER]: long }))).not.toBe(long);
  });

  it('空字符串按缺失处理', () => {
    expect(resolveRequestId(request({ [REQUEST_ID_HEADER]: '   ' }))).toMatch(/^[0-9a-f-]{36}$/);
  });
});
