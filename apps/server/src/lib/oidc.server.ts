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

  return value;
}

/** 仅供测试：清空 discovery 缓存 */
export function resetOidcConfigurationCache(): void {
  configurationCache = undefined;
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

/** 用授权码换 token，并从中解析出主体身份与角色 */
export async function completeAuthorization(
  env: Env,
  currentUrl: string,
  checks: { state: string; nonce: string; codeVerifier: string },
): Promise<Result<OidcIdentity, AuthError>> {
  try {
    const configuration = await getOidcConfiguration(env);
    const tokens = await client.authorizationCodeGrant(configuration, new URL(currentUrl), {
      expectedState: checks.state,
      expectedNonce: checks.nonce,
      pkceCodeVerifier: checks.codeVerifier,
    });

    const claims = tokens.claims();
    if (claims === undefined) return err(AuthErrors.oidcFailed('id_token'));

    return ok({
      identity: identityFromClaims(env, claims),
      roles: readRolesFromClaims(claims, env.OIDC_ROLE_CLAIM),
      idToken: tokens.id_token ?? null,
    });
  } catch {
    // 不把 IdP 的错误细节回给客户端：可能包含内部地址与客户端标识
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
