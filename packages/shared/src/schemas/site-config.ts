/**
 * 公开站点配置（`GET /api/v1/config`）的响应契约。
 *
 * 这是**前端唯一需要知道的站点信息**：渲染评论列表与输入框所需的一切。
 * 刻意不包含 `auditMode`、`spamThreshold`、`minIntervalSeconds`、`notifyEmails`、
 * `smtp`、`originPolicy` 等内部配置 —— 公开响应必须是白名单式的显式构造
 * （见 .specs/development-standards.md §8.1）。
 */

import { z } from 'zod';

/** 站点公开身份：id 是唯一标识，name 仅作展示（决策 D17） */
export const PublicSiteIdentitySchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const PublicCommentConfigSchema = z.object({
  /** 嵌套深度上限，前端据此决定「回复」按钮出现在哪一层 */
  maxDepth: z.number().int(),

  /** 原文长度上限（字节） */
  maxContentBytes: z.number().int(),

  /** 昵称是否必填（站点可配） */
  requireNickname: z.boolean(),

  /**
   * 邮箱恒为必填且**站点不可关**（决策 D18）。
   * 这里固定为字面量 `true`，让前端类型上就知道没有分支要处理。
   */
  requireEmail: z.literal(true),

  /** 分页默认值与上限 */
  pageSize: z.number().int(),
  maxPageSize: z.number().int(),

  /** 每条顶层评论内联返回的回复条数 */
  repliesPreview: z.number().int(),

  /** 排序方式仅此两种（决策 Q-05） */
  sortOptions: z.array(z.enum(['latest', 'oldest'])),
});

export const PublicRenderConfigSchema = z.object({
  /** 服务端是否做代码高亮 / 公式渲染，前端据此决定要不要加载配套样式 */
  codeHighlight: z.boolean(),
  math: z.boolean(),
  linkNofollow: z.boolean(),
});

export const PublicSiteConfigSchema = z.object({
  site: PublicSiteIdentitySchema,
  comment: PublicCommentConfigSchema,
  rendering: PublicRenderConfigSchema,

  /** 表情短代码 → 图片 URL（内置包与站点自定义包合并后的结果） */
  emojis: z.record(z.string(), z.string()),

  /** Gravatar 之类的头像服务根地址；前端拼 `{base}/{邮箱哈希}` */
  avatarBaseUrl: z.string(),
});

export type PublicSiteConfig = z.infer<typeof PublicSiteConfigSchema>;
export type PublicSiteIdentity = z.infer<typeof PublicSiteIdentitySchema>;
