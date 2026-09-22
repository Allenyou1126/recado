/**
 * rendering 功能的输入输出契约。
 *
 * Zod 是唯一真源：运行时校验、TS 类型、OpenAPI 三处产物都由它推导
 * （见 .specs/development-standards.md §5.1）。**不要**手写重复的 interface。
 */

import { z } from 'zod';

/**
 * 表情短代码 → 图片 URL。
 *
 * 站点可在 `sites.settings.emojis` 里覆盖或扩展内置表情包；
 * 未知短代码会被原样丢弃，不会用来拼接 URL。
 */
export const EmojiMapSchema = z.record(z.string().min(1), z.string().min(1));
export type EmojiMap = z.infer<typeof EmojiMapSchema>;

export const RenderOptionsSchema = z.object({
  /** GFM（表格、删除线、任务列表、自动链接） */
  gfm: z.boolean().default(true),

  /** 服务端 Shiki 高亮；关闭时代码块原样输出 */
  codeHighlight: z.boolean().default(true),

  /** 服务端 MathJax 渲染 */
  math: z.boolean().default(true),

  /** 外链加 `rel="nofollow ugc noopener noreferrer"` */
  linkNofollow: z.boolean().default(true),

  /** 站点自定义表情包（与内置包合并，同名覆盖） */
  emojis: EmojiMapSchema.default({}),

  /** 单条评论原文字节上限（见 requirements.md §5.3） */
  maxContentBytes: z.number().int().positive().default(10_240),

  /** 渲染墙钟超时；超时返回 INTERNAL_RENDER_TIMEOUT */
  renderTimeoutMs: z.number().int().positive().max(60_000).default(5_000),
});

export type RenderOptions = z.infer<typeof RenderOptionsSchema>;
/** 入参类型：带默认值的字段可以省略 */
export type RenderOptionsInput = z.input<typeof RenderOptionsSchema>;

/** 渲染结果 */
export const RenderedContentSchema = z.object({
  /** 已消毒的 HTML（可安全拼进页面） */
  html: z.string(),

  /** 从 AST 层提取到的 @提及昵称（去重、保持出现顺序） */
  mentions: z.array(z.string()),

  /** 原文字节数，写入 `comments.content_bytes` */
  bytes: z.number().int().nonnegative(),
});

export type RenderedContent = z.infer<typeof RenderedContentSchema>;
