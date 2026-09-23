import { describe, expect, it } from 'vitest';

import { resolveTokenRedirectUri } from '../../src/lib/oidc.server';
import { testEnv } from '../helpers/context';

/**
 * 回归测试：反向代理下 token 请求的 `redirect_uri` 必须取登记值。
 *
 * 线上踩过的坑：TLS 在 nginx 上终止时，框架看到的请求 URL 是内网的
 * `http://127.0.0.1:28993/…`（Nitro 默认不信任 `X-Forwarded-Proto`，srvx 的
 * `hops` 为 0），而 openid-client 的 `authorizationCodeGrant` 会用「传入 URL
 * 去掉 query」推导 `redirect_uri`。于是 token 请求发出的是
 * `http://<对外域名>/auth/callback`，与授权请求登记的 `https://…` 不一致，
 * Zitadel 直接 `invalid_grant`（`redirect_uri does not correspond`），
 * 表现为登录永远停在 `OIDC token_exchange step failed`。
 */
describe('resolveTokenRedirectUri', () => {
  const env = testEnv({ OIDC_REDIRECT_URI: 'https://comments.test/auth/callback' });

  it('协议与主机取登记值，不取内网请求 URL', () => {
    const resolved = resolveTokenRedirectUri(
      env,
      'http://127.0.0.1:28993/auth/callback?code=abc&state=xyz',
    );

    expect(resolved.href).toBe('https://comments.test/auth/callback?code=abc&state=xyz');
  });

  it('原样保留回调带来的 query —— openid-client 要从里面取 code/state/iss', () => {
    const resolved = resolveTokenRedirectUri(
      env,
      'http://127.0.0.1:28993/auth/callback?code=abc&state=xyz&iss=https%3A%2F%2Fcomments.test',
    );

    expect(resolved.searchParams.get('code')).toBe('abc');
    expect(resolved.searchParams.get('state')).toBe('xyz');
    expect(resolved.searchParams.get('iss')).toBe('https://comments.test');
  });

  it('没有 query 时就是登记地址本身', () => {
    expect(resolveTokenRedirectUri(env, 'http://127.0.0.1:28993/auth/callback').href).toBe(
      'https://comments.test/auth/callback',
    );
  });
});
