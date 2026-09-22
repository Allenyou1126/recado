/**
 * 评论相关的公开 API 契约。
 *
 * 这一层是**对外承诺**：字段增删等同 API 变更，SDK 与 OpenAPI 都从这里取类型。
 * 注意公开评论对象**不含** `email` / `ip` / `user_agent`（见 §8.1 数据暴露白名单）。
 */

import { z } from 'zod';

/** 排序仅此两种（决策 Q-05：不提供热度排序） */
export const CommentSortSchema = z.enum(['latest', 'oldest']);
export type CommentSort = z.infer<typeof CommentSortSchema>;

/** 站点级展示徽章（决策 D7：仅用于展示，不参与审核判定） */
export const CommentLabelSchema = z.object({
  name: z.string(),
  color: z.string().nullable(),
});

export type CommentLabel = z.infer<typeof CommentLabelSchema>;

/**
 * 公开评论对象的**骨架字段**。
 *
 * 除 `deleted` 占位外，公开列表里只会出现 `approved`（见 §5.4 状态机）。
 * `deleted` 的评论只有骨架字段有意义，前端应渲染「该评论已删除」占位 ——
 * 这是决策 Q-04 的语义：删除不级联，子回复仍要能显示。
 */
const PublicCommentBaseSchema = z.object({
  id: z.string(),
  path: z.string(),

  /** 顶层祖先；顶层评论自身为 null */
  rootId: z.string().nullable(),
  /** 直接父评论 */
  parentId: z.string().nullable(),

  /** 被回复者（仅昵称），驱动前端「回复 @xxx」 */
  replyTo: z.object({ nickname: z.string().nullable() }).nullable(),

  nickname: z.string().nullable(),
  website: z.string().nullable(),

  /** **已消毒的 HTML**（服务端唯一管线产出） */
  content: z.string(),

  status: z.enum(['approved', 'deleted']),

  createdAt: z.string(),

  labels: z.array(CommentLabelSchema),
});

/**
 * 公开评论对象。
 *
 * `replies` 内联的是**同一形状的叶子节点**（不再嵌套），前端按 `parentId`
 * 自行组装树 —— 需求 M2 的 `flat` 形态（`tree` 形态属 P1）。
 * 这样定义同时也避开了自引用 schema 带来的类型推导问题。
 */
export const PublicCommentSchema = PublicCommentBaseSchema.extend({
  /** 仅顶层评论内联返回：前 N 条回复 */
  replies: z.array(PublicCommentBaseSchema).optional(),

  /** 仅顶层评论内联返回：回复数超过内联条数 */
  hasMoreReplies: z.boolean().optional(),
});

export type PublicComment = z.infer<typeof PublicCommentSchema>;

/** 发表评论入参 */
export const CreateCommentInputSchema = z.object({
  /**
   * 文章标识，默认 `location.pathname`。
   *
   * 注意路径是**逐段解码**的：`/posts/中文` 与 `/posts/%E4%B8%AD%E6%96%87`
   * 会被视为两篇文章，这是前端上报值决定的事实，不做归一。
   */
  path: z.string().min(1).max(2048),

  /** 原文（权威数据，服务端渲染后落库） */
  content: z.string().min(1),

  nickname: z.string().max(64).optional(),
  /** 邮箱**必填且站点不可关**（决策 D18） */
  email: z.string().min(3).max(254),
  website: z.string().max(2048).optional(),

  /** 回复目标；省略表示顶层评论 */
  parentId: z.string().optional(),

  /** 可选的文章元信息，用于后台展示与邮件链接 */
  url: z.string().max(2048).optional(),
  title: z.string().max(512).optional(),
});

export type CreateCommentInput = z.infer<typeof CreateCommentInputSchema>;

/** 评论列表查询参数（查询串里全是字符串，因此用 coerce） */
export const ListCommentsQuerySchema = z
  .object({
    path: z.string().min(1).max(2048).optional(),
    threadId: z.string().optional(),
    sort: CommentSortSchema.default('latest'),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).optional(),
  })
  .refine((value) => value.path !== undefined || value.threadId !== undefined, {
    message: 'path 与 threadId 至少要提供一个',
  });

export type ListCommentsQuery = z.infer<typeof ListCommentsQuerySchema>;

/** 回复分页查询参数 */
export const ListRepliesQuerySchema = z.object({
  sort: CommentSortSchema.default('oldest'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).optional(),
});

export type ListRepliesQuery = z.infer<typeof ListRepliesQuerySchema>;

/** 分页信封：`total` / `totalPages` 由服务端权威计算 */
export const CommentPageSchema = z.object({
  comments: z.array(PublicCommentSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});

export type CommentPage = z.infer<typeof CommentPageSchema>;

export const ReplyPageSchema = z.object({
  rootId: z.string(),
  replies: z.array(PublicCommentSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});

export type ReplyPage = z.infer<typeof ReplyPageSchema>;

/** 批量评论数：`paths=a,b,c`（逗号分隔），也接受重复的 `paths` 参数 */
export const CountCommentsQuerySchema = z.object({
  paths: z
    .union([z.string(), z.array(z.string())])
    .transform((value) =>
      (Array.isArray(value) ? value : value.split(','))
        .map((path) => path.trim())
        .filter((path) => path.length > 0),
    )
    .refine((paths) => paths.length > 0 && paths.length <= 100, {
      message: 'paths 需要 1–100 个非空 path',
    }),
});

export const RecentCommentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

/** 批量评论数响应 */
export const CommentCountsSchema = z.object({
  counts: z.record(z.string(), z.number().int()),
  total: z.number().int(),
});

export type CommentCounts = z.infer<typeof CommentCountsSchema>;
