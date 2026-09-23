/**
 * OIDC 客户端（Authorization Code + PKCE，以及 client credentials）。
 *
 * 按**标准 OIDC** 实现：只依赖 discovery + JWKS + 标准 claims，
 * 不硬编码任何厂商特性（决策 D14，ZITADEL 是参考实现而非唯一实现）。
 *
 * 本文件是**外部 IO 边界**：网络失败是预期内的，因此这里允许 try/catch，
 * 并向上返回 `Result`（见 .specs/development-standards.md §6.4）。
 */

import type { AdminIdentity } from '@recado/core';
import { AuthErrors, type AuthError } from '@recado/core';
import { readRolesFromClaims } from '@recado/core';
import { err, ok, type Result } from '@recado/shared';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import * as client from 'openid-client';

import type { Env } from '../config/env.server';
import type { Logger } from './logger.server';

/** 请求的 scope；`offline_access` 由 IdP 支持时才返回 refresh token */
const OIDC_SCOPES = 'openid profile email';

export type AuthorizationRequest = {
  url: string;
  state: string;
  nonce: string;
  codeVerifier: string;
};

export type OidcIdentity = {
  identity: AdminIdentity;
  roles: string[];
  /** 登出时作为 `id_token_hint` 用；RP-Initiated Logout 属 P1 */
  idToken: string | null;
};

/**
 * discovery 结果按 issuer 缓存。
 *
 * 每次登录都拉一遍 `.well-known/openid-configuration` 既慢又会被 IdP 限流；
 * 元数据与 JWKS 在缓存里由 openid-client 自己维护刷新。
 */
let configurationCache: { issuer: string; value: Promise<client.Configuration> } | undefined;

export function getOidcConfiguration(env: Env): Promise<client.Configuration> {
  if (configurationCache?.issuer === env.OIDC_ISSUER_URL) {
    return configurationCache.value;
  }

  const value = client.discovery(
    new URL(env.OIDC_ISSUER_URL),
    env.OIDC_CLIENT_ID,
    undefined,
    client.ClientSecretPost(env.OIDC_CLIENT_SECRET),
  );

  configurationCache = { issuer: env.OIDC_ISSUER_URL, value };

  // 失败的 discovery 不能留在缓存里：一次网络抖动就会产生 rejected Promise，
  // 一旦缓存住，本进程后续每次登录都会立刻失败，只能靠重启恢复。
  void value.catch(() => {
    if (configurationCache?.value === value) configurationCache = undefined;
  });

  return value;
}

/** 仅供测试：清空 discovery 缓存 */
export function resetOidcConfigurationCache(): void {
  configurationCache = undefined;
}

/**
 * 送给 token 端点的 `redirect_uri`（回调地址）。
 *
 * openid-client 的 `authorizationCodeGrant` 用「传入 URL 去掉 query/hash」推导它，
 * 因此这里**不能用框架看到的请求 URL**：TLS 在反向代理上终止时，Nitro 交给应用的
 * 是内网的 `http://…`（srvx 的 `hops` 默认 0，不信任 `X-Forwarded-Proto`），
 * 推导出的值会变成 `http://<对外域名>/auth/callback`。
 *
 * Zitadel 换码时与授权请求登记的值**逐字符**比对，不一致即 `invalid_grant`
 * （`redirect_uri does not correspond`）—— 所以协议与主机一律取登记值
 * `OIDC_REDIRECT_URI`，只把回调带来的 query（`code` / `state` / `iss`）原样带上。
 */
export function resolveTokenRedirectUri(env: Env, callbackRequestUrl: string): URL {
  const registered = new URL(env.OIDC_REDIRECT_URI);
  registered.search = new URL(callbackRequestUrl).search;

  return registered;
}

/** 组装授权请求（state / nonce / PKCE 一个都不能少） */
export async function createAuthorizationRequest(env: Env): Promise<AuthorizationRequest> {
  const configuration = await getOidcConfiguration(env);

  const state = client.randomState();
  const nonce = client.randomNonce();
  const codeVerifier = client.randomPKCECodeVerifier();
  const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

  const url = client.buildAuthorizationUrl(configuration, {
    redirect_uri: env.OIDC_REDIRECT_URI,
    scope: OIDC_SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
    nonce,
  });

  return { url: url.href, state, nonce, codeVerifier };
}

/**
 * 用授权码换 token，并从中解析出主体身份与角色。
 *
 * @param callbackRequestUrl 回调请求的原样 URL，**只**用于取 `code` / `state` / `iss`
 * @param logger 请求级 logger：被吞掉的 IdP 错误细节只进这里，绝不进响应体
 */
export async function completeAuthorization(
  env: Env,
  callbackRequestUrl: string,
  checks: { state: string; nonce: string; codeVerifier: string },
  logger: Logger,
): Promise<Result<OidcIdentity, AuthError>> {
  try {
    const configuration = await getOidcConfiguration(env);
    const tokens = await client.authorizationCodeGrant(
      configuration,
      resolveTokenRedirectUri(env, callbackRequestUrl),
      {
        expectedState: checks.state,
        expectedNonce: checks.nonce,
        pkceCodeVerifier: checks.codeVerifier,
      },
    );

    const claims = tokens.claims();
    if (claims === undefined) return err(AuthErrors.oidcFailed('id_token'));

    return ok({
      identity: identityFromClaims(env, claims),
      roles: readRolesFromClaims(claims, env.OIDC_ROLE_CLAIM),
      idToken: tokens.id_token ?? null,
    });
  } catch (cause) {
    // 客户端仍只拿到统一错误码（细节可能含 IdP 内网地址与客户端标识），
    // 但服务端必须留下真实原因 —— 否则这个 catch 会把所有失败压成同一句话，
    // redirect_uri 不一致 / invalid_client / PKCE 失败在日志里长得一模一样。
    logger.warn({ err: cause }, 'oidc token exchange failed');

    return err(AuthErrors.oidcFailed('token_exchange'));
  }
}

/**
 * 校验 Bearer access token（client credentials 流程）。
 *
 * **每次都验签并现算角色**：脚本 / CI 的权限因此随 IdP 撤销立即生效，
 * 不像浏览器会话那样要等会话过期。
 */
export async function verifyBearerToken(
  env: Env,
  token: string,
): Promise<Result<OidcIdentity, AuthError>> {
  try {
    const configuration = await getOidcConfiguration(env);
    const jwksUri = configuration.serverMetadata().jwks_uri;

    if (jwksUri === undefined) return err(AuthErrors.oidcFailed('discovery'));

    const jwks = createRemoteJWKSet(new URL(jwksUri));

    const { payload } = await jwtVerify(token, jwks, {
      issuer: env.OIDC_ISSUER_URL,
      // 受众校验是 Q-07 明确要求的：否则别的客户端签发的 token 也能用
      audience: env.OIDC_AUDIENCE ?? env.OIDC_CLIENT_ID,
    });

    return ok({
      identity: identityFromClaims(env, payload),
      roles: readRolesFromClaims(payload, env.OIDC_ROLE_CLAIM),
      idToken: null,
    });
  } catch {
    return err(AuthErrors.oidcFailed('bearer_verification'));
  }
}

/** RP-Initiated Logout 的跳转地址（P1，先留好入口） */
export async function buildLogoutUrl(env: Env, idTokenHint: string): Promise<string | null> {
  try {
    const configuration = await getOidcConfiguration(env);
    const url = client.buildEndSessionUrl(configuration, { id_token_hint: idTokenHint });

    return url.href;
  } catch {
    return null;
  }
}

/**
 * 从 claims 生成主体身份。
 *
 * `oidc_subject` 存 `iss#sub` 组合：同一个 IdP 下 `sub` 唯一，但换 IdP 后
 * `sub` 可能撞车，加上 issuer 才能全局唯一。
 *
 * `kind` 的判定：有 `email` 视为人类主体，否则视为机器（client credentials
 * 的 token 通常不带 email）。**kind 不参与授权判定**（决策 Q-18），
 * 仅供展示与审计 —— 判定错了不会造成越权。
 */
function identityFromClaims(env: Env, claims: Record<string, unknown>): AdminIdentity {
  const subject = typeof claims['sub'] === 'string' ? claims['sub'] : '';
  const email = typeof claims['email'] === 'string' ? claims['email'] : null;
  const name =
    typeof claims['name'] === 'string'
      ? claims['name']
      : typeof claims['preferred_username'] === 'string'
        ? claims['preferred_username']
        : null;
  const picture = typeof claims['picture'] === 'string' ? claims['picture'] : null;

  return {
    oidcSubject: `${env.OIDC_ISSUER_URL}#${subject}`,
    kind: email === null ? 'machine' : 'human',
    email,
    displayName: name,
    avatarUrl: picture,
  };
}
