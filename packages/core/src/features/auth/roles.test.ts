import { describe, expect, it } from 'vitest';

import { readRolesFromClaims } from './roles';

/**
 * 角色 claim 的读取规则（回归测试）。
 *
 * 线上踩过的坑：部署在 ZITADEL 上、`OIDC_ROLE_CLAIM` 取默认值 `roles`，
 * 而 Zitadel 把项目角色断言在 `urn:zitadel:iam:org:project:roles` 里，
 * 且形状是**以角色名为键的对象**。两处都对不上时读出来永远是空数组，
 * 表现为登录停在 `AUTH_NO_MATCHING_ROLE`（`details.roles` 为 `[]`），
 * 而错误码本身不含任何线索。
 */
describe('readRolesFromClaims', () => {
  it('扁平数组（默认 roles / 通用 groups）', () => {
    expect(readRolesFromClaims({ roles: ['recado.OWNER'] }, 'roles')).toEqual(['recado.OWNER']);
  });

  it('点分路径下钻（Keycloak 的 realm_access.roles）', () => {
    const claims = { realm_access: { roles: ['recado.OWNER', 'other.VIEWER'] } };

    expect(readRolesFromClaims(claims, 'realm_access.roles')).toEqual([
      'recado.OWNER',
      'other.VIEWER',
    ]);
  });

  it('claim 名整名匹配 —— 名字自带 . 或 : 时不能按点拆分', () => {
    const claims = {
      'https://example.com/roles': ['recado.OWNER'],
      urn_zitadel: { 'iam:org:project:roles': ['不该被取到'] },
    };

    expect(readRolesFromClaims(claims, 'https://example.com/roles')).toEqual(['recado.OWNER']);
  });

  it('整名匹配优先于点分路径', () => {
    const claims = { 'a.b': ['整名'], a: { b: ['下钻'] } };

    expect(readRolesFromClaims(claims, 'a.b')).toEqual(['整名']);
  });

  it('对象形状取键：Zitadel 的 urn:zitadel:iam:org:project:roles', () => {
    const claims = {
      'urn:zitadel:iam:org:project:roles': {
        'recado.OWNER': { '392035304413937458': 'allenyou.top' },
        'recado.ADMIN.11111111-1111-1111-1111-111111111111': {
          '392035304413937458': 'allenyou.top',
        },
      },
    };

    expect(readRolesFromClaims(claims, 'urn:zitadel:iam:org:project:roles')).toEqual([
      'recado.OWNER',
      'recado.ADMIN.11111111-1111-1111-1111-111111111111',
    ]);
  });

  it('数组里的非字符串元素被丢掉', () => {
    const claims = { roles: ['recado.OWNER', 42, null, { role: 'x' }] };

    expect(readRolesFromClaims(claims, 'roles')).toEqual(['recado.OWNER']);
  });

  it('路径不存在、类型不对或中途断链时返回空数组，而不是抛异常', () => {
    expect(readRolesFromClaims({}, 'roles')).toEqual([]);
    expect(readRolesFromClaims({ roles: 'recado.OWNER' }, 'roles')).toEqual([]);
    expect(readRolesFromClaims({ roles: null }, 'roles')).toEqual([]);
    expect(readRolesFromClaims({ a: null }, 'a.b.c')).toEqual([]);
    expect(readRolesFromClaims({ realm_access: 'not-an-object' }, 'realm_access.roles')).toEqual(
      [],
    );
  });

  it('角色为空对象时返回空数组（授权由 resolveAccessScope 判定为拒绝登录）', () => {
    expect(
      readRolesFromClaims(
        { 'urn:zitadel:iam:org:project:roles': {} },
        'urn:zitadel:iam:org:project:roles',
      ),
    ).toEqual([]);
  });
});
