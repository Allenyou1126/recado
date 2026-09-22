/**
 * sites 功能的 Zod schema —— 站点级配置的**单一真源**。
 *
 * `sites.settings` 是 jsonb：库里的内容可能来自更早的版本，也可能被人工改坏。
 * 因此每个字段都带 `.catch(默认值)`，**单个字段写错只回退该字段**，
 * 而不是让整站配置解析失败、评论区直接打挂（见 .specs/requirements.md §5.3）。
 */

import { z } from 'zod';

/** 嵌套深度上限：1–5（§5.3） */
export const MAX_DEPTH_LIMIT = 5;

export const AuditModeSchema = z.enum(['none', 'first_time', 'all']);
export type AuditMode = z.infer<typeof AuditModeSchema>;

export const OriginPolicySchema = z.enum(['strict', 'lenient']);
export type OriginPolicy = z.infer<typeof OriginPolicySchema>;

/** 站点级 SMTP 配置（决策 Q-10：配置是站点级的） */
export const SmtpSettingsSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65_535),
  secure: z.boolean().default(true),
  user: z.string().optional(),
  /**
   * 密码**加密后**存储（阶段 6）。这里只声明字段形状，
   * 读取时必须由专门的「是否已配置」接口回显，绝不返回明文。
   */
  pass: z.string().optional(),
  fromName: z.string().optional(),
  fromEmail: z.string().min(1),
});

export type SmtpSettings = z.infer<typeof SmtpSettingsSchema>;

/** 站点级配置；字段与 .specs/requirements.md §5.3 逐项对应 */
export const SiteSettingsSchema = z.object({
  maxDepth: z.number().int().min(1).max(MAX_DEPTH_LIMIT).default(2).catch(2),

  /** `none` 全放行 / `first_time` 首次评论待审 / `all` 全部待审 */
  auditMode: AuditModeSchema.default('none').catch('none'),

  /** 累计被标记垃圾几次后，该邮箱进入 review_required */
  spamThreshold: z.number().int().min(1).default(1).catch(1),

  pageSize: z.number().int().min(1).max(100).default(20).catch(20),
  maxPageSize: z.number().int().min(1).max(200).default(50).catch(50),

  /** 每条顶层评论内联返回的回复条数 */
  repliesPreview: z.number().int().min(0).max(50).default(3).catch(3),

  /** 单条评论原文字节上限 */
  maxContentBytes: z.number().int().min(1).max(1_048_576).default(10_240).catch(10_240),

  /** 同 IP 同站点发评论最小间隔（可用性保护，不是反垃圾） */
  minIntervalSeconds: z.number().int().min(0).max(86_400).default(20).catch(20),

  /** 昵称是否必填。**邮箱恒为必填且不可配**（决策 D18） */
  requireNickname: z.boolean().default(true).catch(true),

  /** 无来源头时的策略（决策 Q-12） */
  originPolicy: OriginPolicySchema.default('strict').catch('strict'),

  /** 站长通知接收邮箱 */
  notifyEmails: z.array(z.string()).default([]).catch([]),

  /** 出现待审评论时是否立即提醒站长 */
  notifyOnPending: z.boolean().default(false).catch(false),

  smtp: SmtpSettingsSchema.nullable().default(null).catch(null),

  /** 站点自定义表情包：短代码 → 图片 URL（与内置包合并） */
  emojis: z.record(z.string().min(1), z.string().min(1)).default({}).catch({}),

  markdown: z
    .object({ gfm: z.boolean().default(true).catch(true) })
    .default({ gfm: true })
    .catch({
      gfm: true,
    }),

  codeHighlight: z.boolean().default(true).catch(true),
  math: z.boolean().default(true).catch(true),

  avatarBaseUrl: z
    .string()
    .min(1)
    .default('https://www.gravatar.com/avatar')
    .catch('https://www.gravatar.com/avatar'),

  linkNofollow: z.boolean().default(true).catch(true),
});

export type SiteSettings = z.infer<typeof SiteSettingsSchema>;

/** 解析站点配置；非对象或整体损坏时退回全默认值 */
export function parseSiteSettings(raw: unknown): SiteSettings {
  const parsed = SiteSettingsSchema.safeParse(raw);
  return parsed.success ? parsed.data : SiteSettingsSchema.parse({});
}

/** 裸域名 / 通配域名 / 带端口，如 `example.com`、`*.example.com`、`localhost:3000` */
const HOST_PATTERN =
  /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/i;

/** 带协议的完整来源，如 `https://example.com`、`http://localhost:3000` */
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * 来源白名单条目。
 *
 * 支持两种写法（大小写不敏感，落库前会归一化）：
 *
 * - **裸域**：`example.com`、`*.example.com`、`localhost:3000`
 * - **完整来源**：`https://example.com`、`http://localhost:3000`
 *
 * 明确拒绝带路径/查询/片段的写法（`https://example.com/blog`）：
 * 白名单匹配的是**来源**，路径从来不在比较范围内，允许它只会制造「配了却不生效」。
 * 通配符只能是最左侧一个标签。
 */
export const AllowedOriginSchema = z
  .string()
  .min(1)
  .max(253)
  .superRefine((value, ctx) => {
    const trimmed = value.trim();

    if (SCHEME_PATTERN.test(trimmed)) {
      let url: URL;
      try {
        url = new URL(trimmed);
      } catch {
        ctx.addIssue({ code: 'custom', message: '不是合法的来源（URL 解析失败）' });
        return;
      }

      if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
        ctx.addIssue({ code: 'custom', message: '来源白名单条目不能带路径、查询串或片段' });
        return;
      }

      if (!HOST_PATTERN.test(url.host)) {
        ctx.addIssue({ code: 'custom', message: '主机名格式不正确（通配符只能是最左侧一个标签）' });
      }
      return;
    }

    if (!HOST_PATTERN.test(trimmed)) {
      ctx.addIssue({ code: 'custom', message: '域名格式不正确，如 example.com 或 *.example.com' });
    }
  });

/** 创建站点入参 */
export const CreateSiteInputSchema = z.object({
  name: z.string().min(1).max(100),
  allowedOrigins: z.array(AllowedOriginSchema).max(50).default([]),
  settings: SiteSettingsSchema.partial().default({}),
});

export type CreateSiteInput = z.infer<typeof CreateSiteInputSchema>;
export type CreateSiteInputRaw = z.input<typeof CreateSiteInputSchema>;
