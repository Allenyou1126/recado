/**
 * OpenAPI 3.1 文档：由 Zod schema **推导**，不手写。
 *
 * 这正是「Zod 是唯一真源」的第三处产物（另外两处是运行时校验与 TS 类型）。
 * 手写文档必然会漂移 —— 而漂移的 API 文档比没有文档更糟。
 *
 * 3.1 的 schema 方言就是 JSON Schema 2020-12，与 `z.toJSONSchema()` 的输出一致，
 * 因此不需要任何转换层。
 */

import {
  AdminBatchCommentsInputSchema,
  AdminBatchResultSchema,
  AdminCreateSiteInputSchema,
  AdminIdentitySchema,
  AdminLabelInputSchema,
  AdminListCommentsQuerySchema,
  AdminTestEmailInputSchema,
  AdminUpdateCommentInputSchema,
  AdminUpdateMemberInputSchema,
  AdminUpdateSiteInputSchema,
  CommentCountsSchema,
  CommentPageSchema,
  CreateCommentInputSchema,
  ListCommentsQuerySchema,
  ListRepliesQuerySchema,
  PublicCommentSchema,
  PublicSiteConfigSchema,
  RecentCommentsQuerySchema,
  RenderRequestSchema,
  ReplyPageSchema,
} from '@recado/shared';
import { z } from 'zod';

type JsonSchema = Record<string, unknown>;

/** 把 Zod schema 转成 OpenAPI 组件（输入型：允许省略带默认值的字段） */
function input(name: string, schema: z.ZodType): [string, JsonSchema] {
  return [name, { ...(z.toJSONSchema(schema, { io: 'input' }) as JsonSchema), title: name }];
}

function output(name: string, schema: z.ZodType): [string, JsonSchema] {
  return [name, { ...(z.toJSONSchema(schema, { io: 'output' }) as JsonSchema), title: name }];
}

/** 统一错误信封 */
const ERROR_SCHEMA: JsonSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['reason', 'message'],
      properties: {
        reason: { type: 'string', description: '稳定错误码，SDK 据此分支' },
        message: { type: 'string' },
        details: {},
      },
    },
  },
};

function errorResponse(description: string): JsonSchema {
  return {
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
  };
}

function jsonBody(ref: string, description: string): JsonSchema {
  return {
    description,
    required: true,
    content: { 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } },
  };
}

function okResponse(ref: string): JsonSchema {
  return {
    description: '成功',
    content: { 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } },
  };
}

/** 公开端点共用的鉴权/来源/错误响应 */
const PUBLIC_ERRORS: JsonSchema = {
  400: errorResponse('参数校验失败'),
  403: errorResponse('来源不在白名单内，或站点已停用'),
  404: errorResponse('站点或资源不存在'),
  429: errorResponse('触发限流（同 IP 同站点最小发表间隔）'),
  500: errorResponse('服务器内部错误'),
};

const ADMIN_ERRORS: JsonSchema = {
  401: errorResponse('未认证或会话已失效'),
  403: errorResponse('无权限（含站点范围不足、CSRF 校验失败）'),
  404: errorResponse('资源不存在'),
  409: errorResponse('状态冲突（如批量操作存在非法项）'),
  500: errorResponse('服务器内部错误'),
};

const COMMENT_REF = 'PublicComment';

/**
 * 生成 OpenAPI 文档。
 *
 * `servers` 留空表示「同源」—— 部署文档会让使用者把 endpoint 指到自己的域名。
 */
export function buildOpenApiDocument(): JsonSchema {
  const schemas: Record<string, JsonSchema> = Object.fromEntries([
    input('CreateCommentInput', CreateCommentInputSchema),
    input('ListCommentsQuery', ListCommentsQuerySchema),
    input('ListRepliesQuery', ListRepliesQuerySchema),
    input('RecentCommentsQuery', RecentCommentsQuerySchema),
    input('RenderRequest', RenderRequestSchema),
    output(COMMENT_REF, PublicCommentSchema),
    output('CommentPage', CommentPageSchema),
    output('ReplyPage', ReplyPageSchema),
    output('CommentCounts', CommentCountsSchema),
    output('PublicSiteConfig', PublicSiteConfigSchema),
    output('AdminIdentity', AdminIdentitySchema),
    output('AdminCommentPage', CommentPageSchema),
    input('AdminListCommentsQuery', AdminListCommentsQuerySchema),
    input('AdminUpdateCommentInput', AdminUpdateCommentInputSchema),
    input('AdminBatchCommentsInput', AdminBatchCommentsInputSchema),
    output('AdminBatchResult', AdminBatchResultSchema),
    input('AdminCreateSiteInput', AdminCreateSiteInputSchema),
    input('AdminUpdateSiteInput', AdminUpdateSiteInputSchema),
    input('AdminLabelInput', AdminLabelInputSchema),
    input('AdminUpdateMemberInput', AdminUpdateMemberInputSchema),
    input('AdminTestEmailInput', AdminTestEmailInputSchema),
    ['Error', ERROR_SCHEMA],
  ]);

  return {
    openapi: '3.1.0',
    info: {
      title: 'Recado API',
      version: '1.0.0',
      description: [
        '自托管、多站点、Headless 的评论系统 API。',
        '',
        '**公开端点**需要 `X-Recado-Site: <site key>` 与合法来源；',
        '**管理端点**需要会话 Cookie 或 `Authorization: Bearer <OIDC access token>`，',
        '以及 `X-Recado-Site-Id: <站点 UUID>`。',
        '',
        '⚠️ site key 是**公开标识**而非密钥：它挡不住有意的服务端伪造，',
        '真正的防线是限流与人工审核。',
      ].join('\n'),
    },
    servers: [{ url: '/', description: '当前部署' }],
    components: {
      schemas,
      ...OPENAPI_COMPONENTS_EXTRA,
    },
    paths: {
      '/api/v1/health': {
        get: {
          summary: '存活探针',
          description: '不查数据库：数据库不可用时仍返回 200，避免编排系统误杀进程。',
          tags: ['运维'],
          responses: { 200: { description: '进程存活' } },
        },
      },
      '/readyz': {
        get: {
          summary: '就绪探针',
          description: '数据库不可用时返回 503，负载均衡据此摘流量。',
          tags: ['运维'],
          responses: { 200: { description: '就绪' }, 503: { description: '数据库不可用' } },
        },
      },
      '/api/v1/config': {
        get: {
          summary: '站点公开配置',
          description: '前端渲染评论区所需的全部信息（深度、分页、表情包、必填字段）。',
          tags: ['公开'],
          parameters: [{ $ref: '#/components/parameters/SiteKey' }],
          responses: { 200: okResponse('PublicSiteConfig'), ...PUBLIC_ERRORS },
        },
      },
      '/api/v1/comments': {
        get: {
          summary: '评论列表',
          description:
            '顶层评论分页，每条内联前 `repliesPreview` 条回复与 `hasMoreReplies`。只返回已发布评论（以及已删除但有回复的占位）。',
          tags: ['公开'],
          parameters: [
            { $ref: '#/components/parameters/SiteKey' },
            { name: 'path', in: 'query', schema: { type: 'string' } },
            { name: 'threadId', in: 'query', schema: { type: 'string' } },
            {
              name: 'sort',
              in: 'query',
              schema: { type: 'string', enum: ['latest', 'oldest'], default: 'latest' },
            },
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1 } },
            { $ref: '#/components/parameters/Origin' },
          ],
          responses: { 200: okResponse('CommentPage'), ...PUBLIC_ERRORS },
        },
        post: {
          summary: '发表评论或回复',
          description:
            '邮箱**必填且站点不可关**；`parentId` 省略即顶层评论。超出 `maxDepth` 时会挂到允许的最深祖先，但保留 `replyTo`。',
          tags: ['公开'],
          parameters: [{ $ref: '#/components/parameters/SiteKey' }],
          requestBody: jsonBody('CreateCommentInput', '评论内容'),
          responses: { 201: okResponse(COMMENT_REF), ...PUBLIC_ERRORS },
        },
      },
      '/api/v1/comments/{id}/replies': {
        get: {
          summary: '回复分页',
          description: '回复独立分页，**不受顶层分页限制**（相对 Waline 的关键改进）。',
          tags: ['公开'],
          parameters: [
            { $ref: '#/components/parameters/SiteKey' },
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            {
              name: 'sort',
              in: 'query',
              schema: { type: 'string', enum: ['latest', 'oldest'], default: 'oldest' },
            },
            { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
            { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1 } },
          ],
          responses: { 200: okResponse('ReplyPage'), ...PUBLIC_ERRORS },
        },
      },
      '/api/v1/comments/count': {
        get: {
          summary: '批量评论数',
          description: '一次查询多个 path，走线程表的物化计数。未评论过的 path 返回 0。',
          tags: ['公开'],
          parameters: [
            { $ref: '#/components/parameters/SiteKey' },
            {
              name: 'paths',
              in: 'query',
              required: true,
              schema: { type: 'string' },
              description: '逗号分隔，1–100 个',
            },
          ],
          responses: { 200: okResponse('CommentCounts'), ...PUBLIC_ERRORS },
        },
      },
      '/api/v1/comments/recent': {
        get: {
          summary: '最近评论',
          description: '跨 path，供侧边栏组件使用。',
          tags: ['公开'],
          parameters: [
            { $ref: '#/components/parameters/SiteKey' },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50 } },
          ],
          responses: { 200: okResponse(COMMENT_REF), ...PUBLIC_ERRORS },
        },
      },
      '/api/v1/threads/{path}': {
        get: {
          summary: '线程元信息',
          description: '单篇文章的评论数与最近评论时间。没有评论过的文章返回零值而不是 404。',
          tags: ['公开'],
          parameters: [
            { $ref: '#/components/parameters/SiteKey' },
            {
              name: 'path',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: '文章标识（含前导斜杠）',
            },
          ],
          responses: { 200: { description: '线程元信息' }, ...PUBLIC_ERRORS },
        },
      },
      '/api/v1/render': {
        post: {
          summary: '预览渲染',
          description: '复用与落库完全相同的渲染管线，因此「预览所见 = 最终所得」。不落库。',
          tags: ['公开'],
          parameters: [{ $ref: '#/components/parameters/SiteKey' }],
          requestBody: jsonBody('RenderRequest', '待渲染的原文'),
          responses: {
            200: { description: '渲染结果（已消毒的 HTML 与提及列表）' },
            ...PUBLIC_ERRORS,
          },
        },
      },
      '/api/v1/unsubscribe': {
        get: {
          summary: '退订',
          description:
            '邮件里的退订链接。**刻意不校验 site key 与来源头** —— 它是在邮件客户端里点开的，凭据是 token 本身。返回 HTML 结果页。',
          tags: ['公开'],
          parameters: [{ name: 'token', in: 'query', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: '退订结果页（HTML）' }, 404: errorResponse('凭据无效') },
        },
      },
      '/api/v1/admin/me': {
        get: {
          summary: '当前管理员',
          description: '返回身份与权限范围；**不回显 `oidc_subject` 等内部标识**。',
          tags: ['管理'],
          security: [{ session: [] }, { bearer: [] }],
          responses: { 200: okResponse('AdminIdentity'), ...ADMIN_ERRORS },
        },
      },
      '/api/v1/admin/comments': {
        get: {
          summary: '后台评论列表',
          description:
            '全维度筛选（路径 / 状态 / 关键词 / 时间范围）。关键词查的是**原文**而非渲染后的 HTML。',
          tags: ['管理'],
          security: [{ session: [] }, { bearer: [] }],
          parameters: [
            { $ref: '#/components/parameters/SiteId' },
            { $ref: '#/components/parameters/CsrfToken' },
          ],
          responses: { 200: okResponse('AdminCommentPage'), ...ADMIN_ERRORS },
        },
      },
      '/api/v1/admin/comments/{id}': {
        patch: {
          summary: '改状态 / 改原文',
          description:
            '改原文会重新渲染（双存设计的回报）。删除同样是改状态（`deleted`），**不级联**子回复。',
          tags: ['管理'],
          security: [{ session: [] }, { bearer: [] }],
          parameters: [
            { $ref: '#/components/parameters/SiteId' },
            { $ref: '#/components/parameters/CsrfToken' },
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: jsonBody('AdminUpdateCommentInput', '要改的字段'),
          responses: { 200: okResponse(COMMENT_REF), ...ADMIN_ERRORS },
        },
      },
      '/api/v1/admin/comments/batch': {
        post: {
          summary: '批量改状态',
          description: '**单事务 + 部分失败明细**：存在非法项时整批不执行，返回逐条原因（409）。',
          tags: ['管理'],
          security: [{ session: [] }, { bearer: [] }],
          parameters: [
            { $ref: '#/components/parameters/SiteId' },
            { $ref: '#/components/parameters/CsrfToken' },
          ],
          requestBody: jsonBody('AdminBatchCommentsInput', '批量操作入参'),
          responses: { 200: okResponse('AdminBatchResult'), ...ADMIN_ERRORS },
        },
      },
      '/api/v1/admin/sites': {
        get: {
          summary: '站点列表',
          description: '只返回当前主体**可见**的站点。',
          tags: ['管理'],
          security: [{ session: [] }, { bearer: [] }],
          responses: { 200: { description: '站点列表' }, ...ADMIN_ERRORS },
        },
        post: {
          summary: '创建站点',
          description: '需要**实例级**权限。创建时即签发 site key。',
          tags: ['管理'],
          security: [{ session: [] }, { bearer: [] }],
          parameters: [{ $ref: '#/components/parameters/CsrfToken' }],
          requestBody: jsonBody('AdminCreateSiteInput', '站点信息'),
          responses: { 201: { description: '创建成功' }, ...ADMIN_ERRORS },
        },
      },
      '/api/v1/admin/sites/{id}': {
        patch: {
          summary: '更新站点',
          description: '名称 / 状态 / 来源白名单 / 站点配置。',
          tags: ['管理'],
          security: [{ session: [] }, { bearer: [] }],
          parameters: [
            { $ref: '#/components/parameters/SiteId' },
            { $ref: '#/components/parameters/CsrfToken' },
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: jsonBody('AdminUpdateSiteInput', '要改的字段'),
          responses: { 200: { description: '更新成功' }, ...ADMIN_ERRORS },
        },
      },
      '/api/v1/admin/sites/{id}/rotate-key': {
        post: {
          summary: '轮换 site key',
          description: '**旧 key 立即失效**，没有并行有效期。',
          tags: ['管理'],
          security: [{ session: [] }, { bearer: [] }],
          parameters: [
            { $ref: '#/components/parameters/SiteId' },
            { $ref: '#/components/parameters/CsrfToken' },
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { 200: { description: '新的 site key' }, ...ADMIN_ERRORS },
        },
      },
      '/api/v1/admin/members/{id}': {
        patch: {
          summary: '调整成员审核声誉',
          description: '手动解除待审、清零或修正垃圾计数。',
          tags: ['管理'],
          security: [{ session: [] }, { bearer: [] }],
          parameters: [
            { $ref: '#/components/parameters/SiteId' },
            { $ref: '#/components/parameters/CsrfToken' },
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          ],
          requestBody: jsonBody('AdminUpdateMemberInput', '要改的字段'),
          responses: { 200: { description: '更新成功' }, ...ADMIN_ERRORS },
        },
      },
      '/api/v1/admin/labels': {
        get: {
          summary: '标签列表',
          tags: ['管理'],
          responses: { 200: { description: '标签列表' } },
        },
        post: {
          summary: '创建标签',
          tags: ['管理'],
          security: [{ session: [] }, { bearer: [] }],
          parameters: [{ $ref: '#/components/parameters/CsrfToken' }],
          requestBody: jsonBody('AdminLabelInput', '标签信息'),
          responses: { 201: { description: '创建成功' }, ...ADMIN_ERRORS },
        },
      },
      '/api/v1/admin/test-email': {
        post: {
          summary: '发信测试',
          description: '**同步等待 SMTP 结果**并原样回报错误 —— 这是全系统唯一一处故意阻塞的发信。',
          tags: ['管理'],
          security: [{ session: [] }, { bearer: [] }],
          parameters: [{ $ref: '#/components/parameters/CsrfToken' }],
          requestBody: jsonBody('AdminTestEmailInput', '收件人'),
          responses: { 200: { description: '已投递' }, ...ADMIN_ERRORS },
        },
      },
      '/internal/outbox/drain': {
        post: {
          summary: '触发一轮邮件投递',
          description: '给外部 cron / sidecar 用；共享密钥走 `X-Recado-Internal-Token`。',
          tags: ['运维'],
          responses: { 200: { description: '本轮统计' }, ...ADMIN_ERRORS },
        },
      },
    },
  };
}

/** 文档里被 `$ref` 引用的公共参数与安全方案 */
const OPENAPI_COMPONENTS_EXTRA = {
  parameters: {
    SiteKey: {
      name: 'X-Recado-Site',
      in: 'header',
      required: true,
      schema: { type: 'string' },
      description: '公开的 site key（不是密钥）',
    },
    SiteId: {
      name: 'X-Recado-Site-Id',
      in: 'header',
      required: true,
      schema: { type: 'string', format: 'uuid' },
      description: '目标站点 UUID（管理端不复用公开的 site key）',
    },
    Origin: {
      name: 'Origin',
      in: 'header',
      required: false,
      schema: { type: 'string' },
      description: '必须命中站点白名单；无来源头时按站点 originPolicy 决定放行或 403',
    },
    CsrfToken: {
      name: 'X-Recado-CSRF-Token',
      in: 'header',
      required: false,
      schema: { type: 'string' },
      description: 'Cookie 认证的写操作必须带上，且与 recado_csrf Cookie 一致',
    },
  },
  securitySchemes: {
    session: { type: 'apiKey', in: 'cookie', name: 'recado_session' },
    bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
  },
} as const;
