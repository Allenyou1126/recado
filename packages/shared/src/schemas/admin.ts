/**
 * 管理端 API 的契约。
 *
 * 与公开契约的关键差别：管理端**可以**看到 `email` / `ip` / `user_agent`
 * （§5.2 明确「仅管理员可见」），但**永远不返回** `oidc_subject` 这类内部标识
 * 与任何密钥。
 */

import { z } from 'zod';

import { CommentSortSchema, PublicCommentBaseSchema } from './comment';

/** 当前管理员（`GET /api/v1/admin/me`） */
export const AdminIdentitySchema = z.object({
  id: z.string(),
  kind: z.enum(['human', 'machine']),
  email: z.string().nullable(),
  displayName: z.string().nullable(),

  /**
   * 权限范围：`instance` 或站点列表。
   * ⚠️ 不回显 `oidc_subject`：它是内部标识，前端用不上。
   */
  scope: z.union([
    z.object({ type: z.literal('instance') }),
    z.object({ type: z.literal('site'), siteIds: z.array(z.string()) }),
  ]),

  /** 本次认证命中的角色名，供后台展示「我为什么能进来」 */
  matchedRoles: z.array(z.string()),
});

export type AdminIdentity = z.infer<typeof AdminIdentitySchema>;

/** 管理端评论对象：公开字段 + 仅管理员可见的字段 */
export const AdminCommentSchema = PublicCommentBaseSchema.extend({
  memberId: z.string(),
  email: z.string(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  /** 管理端能看到真实状态，包括 pending / spam */
  status: z.enum(['approved', 'pending', 'spam', 'deleted']),
  contentMd: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});

export type AdminComment = z.infer<typeof AdminCommentSchema>;

export const AdminCommentPageSchema = z.object({
  comments: z.array(AdminCommentSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});

export type AdminCommentPage = z.infer<typeof AdminCommentPageSchema>;

/** 后台评论列表查询 */
export const AdminListCommentsQuerySchema = z.object({
  path: z.string().max(2048).optional(),
  status: z.enum(['approved', 'pending', 'spam', 'deleted']).optional(),
  /** 关键词检索基于**原文**（一期 ILIKE，Q-15） */
  keyword: z.string().max(200).optional(),
  /** ISO 时间；`from`/`to` 闭区间 */
  from: z.string().optional(),
  to: z.string().optional(),
  sort: CommentSortSchema.default('latest'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).optional(),
});

export type AdminListCommentsQuery = z.infer<typeof AdminListCommentsQuerySchema>;

/** 单条更新：改状态、改原文，或两者同时 */
export const AdminUpdateCommentInputSchema = z
  .object({
    status: z.enum(['approved', 'pending', 'spam', 'deleted']).optional(),
    content: z.string().min(1).optional(),
  })
  .refine((value) => value.status !== undefined || value.content !== undefined, {
    message: 'status 与 content 至少要提供一个',
  });

export type AdminUpdateCommentInput = z.infer<typeof AdminUpdateCommentInputSchema>;

/** 批量操作入参 */
export const AdminBatchCommentsInputSchema = z.object({
  ids: z.array(z.string()).min(1).max(200),
  status: z.enum(['approved', 'pending', 'spam', 'deleted']),
});

export type AdminBatchCommentsInput = z.infer<typeof AdminBatchCommentsInputSchema>;

/** 批量操作结果：**必须**带上部分失败明细 */
export const AdminBatchResultSchema = z.object({
  requested: z.number().int(),
  applied: z.number().int(),
  failures: z.array(
    z.object({
      commentId: z.string(),
      reason: z.string(),
      details: z.unknown().optional(),
    }),
  ),
});

export type AdminBatchResult = z.infer<typeof AdminBatchResultSchema>;

/** 站点统计（仪表盘） */
export const AdminSiteStatsSchema = z.object({
  approved: z.number().int(),
  pending: z.number().int(),
  spam: z.number().int(),
  deleted: z.number().int(),
  /** 今日新增（已发布） */
  newToday: z.number().int(),
});

export type AdminSiteStats = z.infer<typeof AdminSiteStatsSchema>;

/** 创建站点（管理台与 CLI 共用同一套校验） */
export const AdminCreateSiteInputSchema = z.object({
  name: z.string().min(1).max(100),
  allowedOrigins: z.array(z.string()).max(50).default([]),
  settings: z.record(z.string(), z.unknown()).default({}),
});

export type AdminCreateSiteInput = z.infer<typeof AdminCreateSiteInputSchema>;

/** 更新站点：只提交要改的字段 */
export const AdminUpdateSiteInputSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    status: z.enum(['active', 'disabled']).optional(),
    allowedOrigins: z.array(z.string()).max(50).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '至少要提供一个字段' });

export type AdminUpdateSiteInput = z.infer<typeof AdminUpdateSiteInputSchema>;

/** 更新成员：审核声誉与待审状态 */
export const AdminUpdateMemberInputSchema = z
  .object({
    reviewRequired: z.boolean().optional(),
    spamCount: z.number().int().min(0).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: '至少要提供一个字段' });

export type AdminUpdateMemberInput = z.infer<typeof AdminUpdateMemberInputSchema>;

/** 指派 / 取消标签 */
export const AdminAssignLabelInputSchema = z.object({
  labelId: z.string().min(1),
  assigned: z.boolean(),
});

export type AdminAssignLabelInput = z.infer<typeof AdminAssignLabelInputSchema>;

/** 标签 CRUD */
export const AdminLabelInputSchema = z.object({
  name: z.string().min(1).max(50),
  color: z.string().max(32).nullable().default(null),
  sort: z.number().int().min(0).max(9999).default(0),
});

export type AdminLabelInput = z.infer<typeof AdminLabelInputSchema>;

/** 发信测试：即时反馈 SMTP 错误，因此必须同步等待结果 */
export const AdminTestEmailInputSchema = z.object({
  to: z.string().min(3).max(254),
});

export type AdminTestEmailInput = z.infer<typeof AdminTestEmailInputSchema>;
