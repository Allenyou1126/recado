/**
 * 认证与会话的集成测试（阶段 7）。
 *
 * 覆盖验收项：
 * - 无匹配角色登录被拒，且**不产生会话**
 * - `ADMIN.<siteA>` 角色的账号访问 siteB 被拒（siteScope 的语义）
 * - 会话可吊销，吊销后立即失效
 * - 角色解析：OWNER / ADMIN.<uuid> / 无匹配
 *
 * 这里直接对会话与角色解析做集成测试，不需要真实 IdP：
 * OIDC 的握手部分（discovery / PKCE / JWKS）是标准的库调用，
 * 用一个假 IdP 只会把测试变成对 openid-client 的重测。
 */

import {
  authorizeBearer,
  createSessionToken,
  endSession,
  hashSessionToken,
  isSessionActive,
  readRolesFromClaims,
  resolveAccessScope,
  resolveSessionActor,
  revokeSessionsOfAdmin,
  scopeAllowsSite,
  startSession,
} from '@recado/core';
import { admins, sessions, sites, type DbClient } from '@recado/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ensureTestDatabase, openTestDatabase } from '../helpers/test-db';

let client: DbClient;
let siteAId: string;
let siteBId: string;

const PREFIX = 'recado';
const SITE_A = '11111111-1111-1111-1111-111111111111';
const SITE_B = '22222222-2222-2222-2222-222222222222';

beforeAll(async () => {
  await ensureTestDatabase();
  client = openTestDatabase();
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  await client.db.execute(sql`TRUNCATE TABLE sites CASCADE`);
  await client.db.execute(sql`TRUNCATE TABLE admins CASCADE`);

  const inserted = await client.db
    .insert(sites)
    .values([
      { id: SITE_A, key: 'rc_auth00000000000000001', name: 'A 站' },
      { id: SITE_B, key: 'rc_auth00000000000000002', name: 'B 站' },
    ])
    .returning();

  siteAId = inserted[0]?.id ?? '';
  siteBId = inserted[1]?.id ?? '';
});

function identity(subject: string, kind: 'human' | 'machine' = 'human') {
  return {
    oidcSubject: `https://idp.test#${subject}`,
    kind,
    email: kind === 'human' ? `${subject}@example.com` : null,
    displayName: subject,
    avatarUrl: null,
  };
}

describe('角色解析（T7.2）', () => {
  it('OWNER 得到实例级权限', () => {
    const match = resolveAccessScope([`${PREFIX}.OWNER`], PREFIX);

    expect(match.scope).toEqual({ type: 'instance' });
    expect(match.matchedRoles).toEqual([`${PREFIX}.OWNER`]);
  });

  it('ADMIN.<uuid> 得到站点级权限', () => {
    const match = resolveAccessScope([`${PREFIX}.ADMIN.${SITE_A}`], PREFIX);

    expect(match.scope).toEqual({ type: 'site', siteIds: [SITE_A] });
  });

  it('同时命中 OWNER 与 ADMIN 时取更高权限，但保留全部命中项', () => {
    const match = resolveAccessScope([`${PREFIX}.ADMIN.${SITE_A}`, `${PREFIX}.OWNER`], PREFIX);

    expect(match.scope).toEqual({ type: 'instance' });
    expect(match.matchedRoles).toHaveLength(2);
  });

  it('无匹配角色返回 null（Q-17：拒绝登录）', () => {
    expect(resolveAccessScope(['other.OWNER', 'recado.VIEWER'], PREFIX).scope).toBeNull();
    expect(resolveAccessScope([], PREFIX).scope).toBeNull();
  });

  it('站点段不是 UUID 的角色名被忽略（站点标识一律 UUID）', () => {
    expect(resolveAccessScope([`${PREFIX}.ADMIN.my-blog`], PREFIX).scope).toBeNull();
  });

  it('角色名前缀不匹配时不命中，避免多环境串号', () => {
    expect(resolveAccessScope(['staging.OWNER'], PREFIX).scope).toBeNull();
  });

  it('ADMIN 角色大小写不敏感地归一化站点 id', () => {
    const match = resolveAccessScope([`${PREFIX}.ADMIN.${SITE_A.toUpperCase()}`], PREFIX);

    expect(match.scope).toEqual({ type: 'site', siteIds: [SITE_A] });
  });

  it('从嵌套 claim 路径读取角色（兼容 Keycloak 的 realm_access.roles）', () => {
    const claims = { realm_access: { roles: ['recado.OWNER'] }, roles: ['ignored'] };

    expect(readRolesFromClaims(claims, 'realm_access.roles')).toEqual(['recado.OWNER']);
    expect(readRolesFromClaims(claims, 'roles')).toEqual(['ignored']);
  });

  it('claim 路径缺失或类型不对时返回空数组，而不是抛异常', () => {
    expect(readRolesFromClaims({}, 'roles')).toEqual([]);
    expect(readRolesFromClaims({ roles: 'not-an-array' }, 'roles')).toEqual([]);
    expect(readRolesFromClaims({ a: null }, 'a.b.c')).toEqual([]);
  });
});

describe('权限范围判定（T7.5）', () => {
  it('实例级覆盖任意站点，站点级只覆盖被授权的站点', () => {
    expect(scopeAllowsSite({ type: 'instance' }, siteAId)).toBe(true);
    expect(scopeAllowsSite({ type: 'site', siteIds: [SITE_A] }, SITE_A)).toBe(true);
    // 「已登录」不等于「可访问任意站点」
    expect(scopeAllowsSite({ type: 'site', siteIds: [SITE_A] }, SITE_B)).toBe(false);
  });
});

describe('会话（T7.3）', () => {
  it('登录成功后写入会话行，存的是 token 哈希而不是原文', async () => {
    const result = await startSession(client.db, {
      identity: identity('alice'),
      roles: [`${PREFIX}.OWNER`],
      rolePrefix: PREFIX,
      ip: '203.0.113.9',
      userAgent: 'vitest',
    });

    expect(result.error).toBeNull();
    const token = result.data?.token ?? '';
    expect(token).not.toHaveLength(0);

    const [row] = await client.db.select().from(sessions);
    expect(row?.id).toBe(hashSessionToken(token));
    expect(row?.id).not.toBe(token);
    expect(row?.roles).toEqual([`${PREFIX}.OWNER`]);
  });

  it('无匹配角色时拒绝登录且**不建任何行**', async () => {
    const result = await startSession(client.db, {
      identity: identity('nobody'),
      roles: ['some-other.OWNER'],
      rolePrefix: PREFIX,
      ip: null,
      userAgent: null,
    });

    expect(result.error?.reason).toBe('AUTH_NO_MATCHING_ROLE');
    expect(await client.db.select().from(sessions)).toHaveLength(0);
    // 连管理员档案都不该留下 —— 没登录成功就没有主体
    expect(await client.db.select().from(admins)).toHaveLength(0);
  });

  it('会话可解析出主体与权限范围', async () => {
    const started = await startSession(client.db, {
      identity: identity('bob'),
      roles: [`${PREFIX}.ADMIN.${SITE_A}`],
      rolePrefix: PREFIX,
      ip: null,
      userAgent: null,
    });
    const token = started.data?.token ?? '';

    const actor = await resolveSessionActor(client.db, token, PREFIX);

    expect(actor.error).toBeNull();
    expect(actor.data?.scope).toEqual({ type: 'site', siteIds: [SITE_A] });
    expect(actor.data?.actor.email).toBe('bob@example.com');
  });

  it('吊销后立即失效', async () => {
    const started = await startSession(client.db, {
      identity: identity('carol'),
      roles: [`${PREFIX}.OWNER`],
      rolePrefix: PREFIX,
      ip: null,
      userAgent: null,
    });
    const token = started.data?.token ?? '';

    expect(await isSessionActive(client.db, token)).toBe(true);

    await endSession(client.db, token);

    expect(await isSessionActive(client.db, token)).toBe(false);
    const actor = await resolveSessionActor(client.db, token, PREFIX);
    expect(actor.error?.reason).toBe('AUTH_SESSION_REVOKED');
  });

  it('强制下线会吊销该管理员的全部会话', async () => {
    const first = await startSession(client.db, {
      identity: identity('dave'),
      roles: [`${PREFIX}.OWNER`],
      rolePrefix: PREFIX,
      ip: null,
      userAgent: null,
    });
    const second = await startSession(client.db, {
      identity: identity('dave'),
      roles: [`${PREFIX}.OWNER`],
      rolePrefix: PREFIX,
      ip: null,
      userAgent: null,
    });

    const adminId = first.data?.actor.actor.id ?? '';
    const revoked = await revokeSessionsOfAdmin(client.db, adminId);

    expect(revoked).toBe(2);
    expect(await isSessionActive(client.db, first.data?.token ?? '')).toBe(false);
    expect(await isSessionActive(client.db, second.data?.token ?? '')).toBe(false);
  });

  it('过期的会话不再有效', async () => {
    const started = await startSession(client.db, {
      identity: identity('erin'),
      roles: [`${PREFIX}.OWNER`],
      rolePrefix: PREFIX,
      ip: null,
      userAgent: null,
      ttlSeconds: 1,
      now: new Date(Date.now() - 10_000),
    });

    const actor = await resolveSessionActor(client.db, started.data?.token ?? '', PREFIX);

    expect(actor.error?.reason).toBe('AUTH_SESSION_EXPIRED');
  });

  it('不存在的 token 解析为 AUTH_SESSION_INVALID', async () => {
    const actor = await resolveSessionActor(client.db, createSessionToken(), PREFIX);

    expect(actor.error?.reason).toBe('AUTH_SESSION_INVALID');
  });
});

describe('Bearer 认证（client credentials，T7.4）', () => {
  it('有权角色可换取主体，机器主体在 admins 表留一行', async () => {
    const result = await authorizeBearer(client.db, {
      identity: identity('ci-client', 'machine'),
      roles: [`${PREFIX}.OWNER`],
      rolePrefix: PREFIX,
    });

    expect(result.error).toBeNull();
    expect(result.data?.actor.kind).toBe('machine');

    const rows = await client.db.select().from(admins);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('machine');
  });

  it('无匹配角色的 token 拿不到主体', async () => {
    const result = await authorizeBearer(client.db, {
      identity: identity('ci-client', 'machine'),
      roles: ['nope'],
      rolePrefix: PREFIX,
    });

    expect(result.error?.reason).toBe('AUTH_NO_MATCHING_ROLE');
  });

  it('同一主体重复认证只保留一行档案', async () => {
    await authorizeBearer(client.db, {
      identity: identity('ci-client', 'machine'),
      roles: [`${PREFIX}.OWNER`],
      rolePrefix: PREFIX,
    });
    await authorizeBearer(client.db, {
      identity: identity('ci-client', 'machine'),
      roles: [`${PREFIX}.OWNER`],
      rolePrefix: PREFIX,
    });

    expect(await client.db.select().from(admins)).toHaveLength(1);
  });
});

describe('站点隔离（T7.5 的验收场景）', () => {
  it('ADMIN.<siteA> 的账号访问 siteB 被拒绝', async () => {
    const started = await startSession(client.db, {
      identity: identity('site-admin'),
      roles: [`${PREFIX}.ADMIN.${siteAId}`],
      rolePrefix: PREFIX,
      ip: null,
      userAgent: null,
    });
    const scope = started.data?.actor.scope;

    expect(scope).toBeDefined();
    if (scope === undefined) return;

    expect(scopeAllowsSite(scope, siteAId)).toBe(true);
    expect(scopeAllowsSite(scope, siteBId)).toBe(false);
  });

  it('OWNER 的账号可以访问任意站点', async () => {
    const started = await startSession(client.db, {
      identity: identity('owner'),
      roles: [`${PREFIX}.OWNER`],
      rolePrefix: PREFIX,
      ip: null,
      userAgent: null,
    });
    const scope = started.data?.actor.scope;
    if (scope === undefined) throw new Error('缺少权限范围');

    expect(scopeAllowsSite(scope, siteAId)).toBe(true);
    expect(scopeAllowsSite(scope, siteBId)).toBe(true);
  });
});
