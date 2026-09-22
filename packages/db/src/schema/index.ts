/**
 * 数据库 schema 汇总。
 *
 * 新增领域表时在此导出。完整表设计见 .specs/requirements.md §5.2：
 * sites / threads / comments / members / labels / comment_mentions /
 * admins / sessions / outbox / unsubscribes / audit_logs
 */
export * from './admins';
export * from './audit-logs';
export * from './comment-mentions';
export * from './comments';
export * from './labels';
export * from './members';
export * from './outbox';
export * from './sites';
export * from './threads';
