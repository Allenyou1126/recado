/**
 * 主体解析的**唯一实现**。
 *
 * 请求中间件（Server Route）与函数中间件（Server Function）都调用它 ——
 * 两套认证路径（会话 Cookie / OIDC Bearer）的判定只能有一份代码，
 * 否则迟早会漂移成「管理 API 严、SSR 松」这种最难发现的安全缺口。
 */

import { authorizeBearer, resolveSessionActor, type SessionActor } from '@recado/core';
import type { Database } from '@recado/db';
import { isErr, type Result } from '@recado/shared';

import type { Env } from '../../config/env.server';
import { readCookie, SESSION_COOKIE } from '../cookies.server';
import { verifyBearerToken } from '../oidc.server';

export type ResolvedActor = SessionActor & { via: 'cookie' | 'bearer' };

/** 从 `Authorization: Bearer <token>` 里取 token */
export function readBearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (header === null) return null;

  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== 'bearer') return null;

  const token = rest.join('').trim();
  return token.length > 0 ? token : null;
}

/**
 * 解析请求主体。
 *
 * @returns 认证失败或没有凭证时返回 `null`；调用方负责映射成 401
 */
export async function resolveActorFromRequest(params: {
  env: Env;
  db: Database;
  request: Request;
}): Promise<ResolvedActor | null> {
  const bearer = readBearerToken(params.request);

  if (bearer !== null) {
    const verified = await verifyBearerToken(params.env, bearer);
    if (isErr(verified)) return null;

    const authorized = await authorizeBearer(params.db, {
      identity: verified.data.identity,
      roles: verified.data.roles,
      rolePrefix: params.env.OIDC_ROLE_PREFIX,
    });

    if (isErr(authorized)) return null;

    return { ...authorized.data, via: 'bearer' };
  }

  const cookie = readCookie(params.request, SESSION_COOKIE);
  if (cookie === null) return null;

  const resolved: Result<SessionActor, { reason: string }> = await resolveSessionActor(
    params.db,
    cookie,
    params.env.OIDC_ROLE_PREFIX,
  );

  if (isErr(resolved)) return null;

  return { ...resolved.data, via: 'cookie' };
}
