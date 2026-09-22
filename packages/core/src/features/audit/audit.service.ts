/**
 * audit 功能的服务层。
 *
 * `recordAudit` 只做「写入一条留痕」，不校验权限 —— 权限由接口层的
 * actor/siteScope 中间件负责。它必须收 `DbExecutor` 而不是连接池：
 * 审计要跟着业务事务一起提交或回滚。
 */

import type { DbExecutor } from '@recado/db';

import { insertAuditLog, listAuditLogs, type AuditQuery } from './audit.data';

/** 审计动作名；稳定字符串，便于查询与统计 */
export const AuditActions = {
  commentStatusChanged: 'comment.status_changed',
  commentEdited: 'comment.edited',
  commentBatch: 'comment.batch',
  siteCreated: 'site.created',
  siteUpdated: 'site.updated',
  siteKeyRotated: 'site.key_rotated',
  memberUpdated: 'member.updated',
  labelAssigned: 'label.assigned',
  labelUnassigned: 'label.unassigned',
  outboxRetried: 'outbox.retried',
} as const;

export type AuditAction = (typeof AuditActions)[keyof typeof AuditActions];

export type AuditActor = {
  /** `admins.id`；机器主体同样在表里有一行（决策 Q-18） */
  id: string;
  kind: 'human' | 'machine';
};

export type RecordAuditParams = {
  /**
   * 动作名。用 `AuditAction | (string & {})` 而不是 `AuditAction | string`：
   * 后者会被 TS 收窄成 `string`，常量表就失去了提示作用；前者既保留字面量提示，
   * 又允许后续模块登记自己的动作名。
   */
  action: AuditAction | (string & {});
  actorId: string | null;
  siteId: string | null;
  targetType?: string | null;
  targetId?: string | null;
  /** 变更前后快照；**只放可安全留存的字段**，禁止写入邮箱明文、token 等 */
  diff?: Record<string, unknown> | null;
  ip?: string | null;
};

export async function recordAudit(db: DbExecutor, params: RecordAuditParams): Promise<void> {
  await insertAuditLog(db, {
    adminId: params.actorId,
    siteId: params.siteId,
    action: params.action,
    targetType: params.targetType ?? null,
    targetId: params.targetId ?? null,
    diff: params.diff ?? null,
    ip: params.ip ?? null,
  });
}

/** 查询审计日志（后台界面用） */
export async function queryAuditLogs(db: DbExecutor, query: AuditQuery) {
  return listAuditLogs(db, query);
}

/**
 * 审计日志查询的对外入口。
 *
 * 数据层函数只在本文件里用；接口层与 SSR 数据加载都从这里取，
 * 保证「审计怎么读」也只有一处实现。
 */
export { listAuditLogs } from './audit.data';
export type { AuditQuery } from './audit.data';
