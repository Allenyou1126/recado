/**
 * 来源白名单与站点解析的单元测试。
 *
 * 全部是纯函数，不需要数据库与 HTTP —— 这正是把业务规则放在 `packages/core`
 * 的收益（见 .specs/development-standards.md §1.2）。
 */

import { describe, expect, it } from 'vitest';

import {
  evaluateOrigin,
  matchesAllowedOrigin,
  normalizeAllowedOrigins,
  originPolicyOf,
} from './sites.service';

const site = (allowedOrigins: string[], settings: Record<string, unknown> = {}) => ({
  allowedOrigins,
  settings,
});

describe('matchesAllowedOrigin', () => {
  it('精确域命中同一主机的任意协议', () => {
    expect(matchesAllowedOrigin(['example.com'], 'https://example.com')).toBe(true);
    expect(matchesAllowedOrigin(['example.com'], 'http://example.com')).toBe(true);
  });

  it('写了协议就只认该协议', () => {
    expect(matchesAllowedOrigin(['https://example.com'], 'https://example.com')).toBe(true);
    expect(matchesAllowedOrigin(['https://example.com'], 'http://example.com')).toBe(false);
  });

  it('通配符命中子域但不含裸域', () => {
    expect(matchesAllowedOrigin(['*.example.com'], 'https://blog.example.com')).toBe(true);
    expect(matchesAllowedOrigin(['*.example.com'], 'https://a.b.example.com')).toBe(true);
    expect(matchesAllowedOrigin(['*.example.com'], 'https://example.com')).toBe(false);
  });

  it('通配符不跨越标签边界', () => {
    expect(matchesAllowedOrigin(['*.example.com'], 'https://example.com.evil.net')).toBe(false);
  });

  it('端口要一致', () => {
    expect(matchesAllowedOrigin(['http://localhost:3000'], 'http://localhost:3000')).toBe(true);
    expect(matchesAllowedOrigin(['http://localhost:3000'], 'http://localhost:4000')).toBe(false);
    expect(matchesAllowedOrigin(['http://localhost:3000'], 'http://localhost')).toBe(false);
  });

  it('大小写不敏感', () => {
    expect(matchesAllowedOrigin(['Example.COM'], 'https://example.com')).toBe(true);
    expect(matchesAllowedOrigin(['example.com'], 'https://EXAMPLE.com')).toBe(true);
  });

  it('畸形输入一律不命中，而不是抛异常', () => {
    expect(matchesAllowedOrigin(['example.com'], 'not a url')).toBe(false);
    expect(matchesAllowedOrigin(['example.com'], '')).toBe(false);
    expect(matchesAllowedOrigin([':::'], 'https://example.com')).toBe(false);
  });

  it('白名单为空时拒绝一切（安全默认）', () => {
    expect(matchesAllowedOrigin([], 'https://example.com')).toBe(false);
  });
});

describe('originPolicyOf', () => {
  it('未配置时默认 strict', () => {
    expect(originPolicyOf({})).toBe('strict');
    expect(originPolicyOf({ originPolicy: 'nonsense' })).toBe('strict');
  });

  it('显式配置 lenient 时生效', () => {
    expect(originPolicyOf({ originPolicy: 'lenient' })).toBe('lenient');
  });
});

describe('evaluateOrigin', () => {
  it('strict：无来源头直接拒绝（决策 Q-12）', () => {
    const result = evaluateOrigin(site(['example.com'], { originPolicy: 'strict' }), {
      origin: null,
      referer: null,
    });

    expect(result.error?.reason).toBe('FORBIDDEN_ORIGIN_MISSING');
  });

  it('lenient：无来源头放行但标记 allowed=false，供限流加严', () => {
    const result = evaluateOrigin(site([], { originPolicy: 'lenient' }), {
      origin: null,
      referer: null,
    });

    expect(result.error).toBeNull();
    expect(result.data).toEqual({ allowed: false, raw: null });
  });

  it('没有 Origin 时回落到 Referer 的 origin', () => {
    const result = evaluateOrigin(site(['https://blog.example.com']), {
      origin: null,
      referer: 'https://blog.example.com/posts/1?x=1',
    });

    expect(result.data).toEqual({ allowed: true, raw: 'https://blog.example.com' });
  });

  it('Origin: null（不透明来源）等同于没有来源', () => {
    const result = evaluateOrigin(site(['example.com']), { origin: 'null', referer: null });

    expect(result.error?.reason).toBe('FORBIDDEN_ORIGIN_MISSING');
  });

  it('白名单之外的来源被拒，并在 details 里回显来源便于排查', () => {
    const result = evaluateOrigin(site(['https://blog.example.com']), {
      origin: 'https://evil.example.net',
      referer: null,
    });

    expect(result.error?.reason).toBe('FORBIDDEN_ORIGIN_NOT_ALLOWED');
    expect(result.error?.details).toEqual({ origin: 'https://evil.example.net' });
  });
});

describe('来源白名单匹配矩阵（T3.3）', () => {
  const cases: ReadonlyArray<[patterns: string[], origin: string, expected: boolean]> = [
    // 精确域
    [['example.com'], 'https://example.com', true],
    [['example.com'], 'http://example.com', true],
    [['example.com'], 'https://www.example.com', false],
    [['www.example.com'], 'https://www.example.com', true],
    // 协议限定
    [['https://example.com'], 'https://example.com', true],
    [['https://example.com'], 'http://example.com', false],
    [['http://example.com'], 'http://example.com', true],
    // 通配符
    [['*.example.com'], 'https://blog.example.com', true],
    [['*.example.com'], 'https://a.b.example.com', true],
    [['*.example.com'], 'https://example.com', false],
    [['*.example.com'], 'https://example.com.evil.net', false],
    [['*.example.com'], 'https://notexample.com', false],
    // 端口
    [['http://localhost:3000'], 'http://localhost:3000', true],
    [['http://localhost:3000'], 'http://localhost:3001', false],
    [['http://localhost:3000'], 'http://localhost', false],
    [['https://example.com:443'], 'https://example.com', true],
    // 大小写与空白
    [['  EXAMPLE.com '], 'https://example.com', true],
    [['example.com'], '  https://example.com  ', true],
    // 多条命中一条即可
    [['a.example.com', 'b.example.com'], 'https://b.example.com', true],
    // 畸形输入
    [['example.com'], 'null', false],
    [['example.com'], '', false],
    [['example.com'], 'https://', false],
  ];

  it.each(cases)('%j 对 %s => %s', (patterns, origin, expected) => {
    expect(matchesAllowedOrigin(patterns, origin)).toBe(expected);
  });

  it('协议相对地址（//host）按站外处理', () => {
    expect(matchesAllowedOrigin(['example.com'], '//example.com')).toBe(true);
  });
});

describe('normalizeAllowedOrigins', () => {
  it('去空白、转小写并去重', () => {
    expect(normalizeAllowedOrigins([' Example.com ', 'example.com', '*.Example.org'])).toEqual([
      'example.com',
      '*.example.org',
    ]);
  });

  it('丢弃空串与格式非法的条目', () => {
    expect(normalizeAllowedOrigins(['', '   ', 'https://a.example.com/path'])).toEqual([]);
  });

  it('保留带协议与端口的写法', () => {
    expect(normalizeAllowedOrigins(['http://localhost:3000'])).toEqual(['http://localhost:3000']);
  });
});
