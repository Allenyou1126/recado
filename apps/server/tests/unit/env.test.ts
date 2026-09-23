import { describe, expect, it } from 'vitest';

import { resolveExternalOrigin } from '../../src/config/env.server';
import { testEnv } from '../helpers/context';

/**
 * `resolveExternalOrigin` 是 CSRF 同源判定的基准。
 *
 * 不能用 `request.url`：反向代理终止 TLS 后，框架拿到的是内网 `http://…`，
 * 与浏览器发来的 `Origin: https://…` 永远不相等，会让所有写操作静默 403。
 */
describe('resolveExternalOrigin', () => {
  it('优先取 PUBLIC_BASE_URL', () => {
    expect(resolveExternalOrigin(testEnv({ PUBLIC_BASE_URL: 'https://comments.test' }))).toBe(
      'https://comments.test',
    );
  });

  it('PUBLIC_BASE_URL 省略时退回 OIDC_REDIRECT_URI 的 origin', () => {
    expect(
      resolveExternalOrigin(testEnv({ OIDC_REDIRECT_URI: 'https://comments.test/auth/callback' })),
    ).toBe('https://comments.test');
  });

  it('丢掉路径，只保留协议 + 主机 + 端口', () => {
    expect(
      resolveExternalOrigin(testEnv({ PUBLIC_BASE_URL: 'https://comments.test:8443/admin/' })),
    ).toBe('https://comments.test:8443');
  });
});
