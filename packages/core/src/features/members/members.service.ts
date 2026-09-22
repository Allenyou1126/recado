/**
 * members 功能的服务层：邮箱归并与档案维护。
 *
 * 身份模型（决策 D6）：评论者**完全匿名**，没有注册与登录，身份以邮箱归并。
 * 因此「同一个邮箱 = 同一个人」这条规则必须稳定，邮箱规范化放在这里统一做。
 */

import type { DbExecutor, Member } from '@recado/db';

import { upsertMember, type MemberProfile } from './members.data';

/**
 * 邮箱规范化：去空白 + 转小写。
 *
 * 数据库侧 `members.email` 是 **citext**，比较本身已经大小写不敏感；
 * 这里再规范化一次是为了**存储值一致** —— 否则库里会同时存在
 * `Alice@x.com` 与 `alice@x.com` 两种写法，后台按邮箱搜索与导出都会很难看。
 *
 * 刻意不做「去掉 Gmail 的点号」这类归一：那会把两个真实存在的不同地址合并，
 * 属于替用户做决定。
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * 解析（必要时创建）成员档案。
 *
 * 并发安全：底层是单条 `INSERT ... ON CONFLICT DO UPDATE`，
 * 不做「先查再插」——那在并发下会撞唯一约束。
 */
export async function resolveMember(
  db: DbExecutor,
  siteId: string,
  profile: { email: string; nickname?: string | null; website?: string | null },
): Promise<Member> {
  const normalized: MemberProfile = {
    email: normalizeEmail(profile.email),
    nickname: profile.nickname?.trim() || null,
    website: profile.website?.trim() || null,
    avatarUrl: null,
  };

  return upsertMember(db, siteId, normalized);
}
