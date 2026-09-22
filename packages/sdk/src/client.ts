/**
 * `@recado/client` —— Headless 客户端 SDK。
 *
 * 设计约束（决策 D12 / requirements.md §6 M9）：
 *
 * - **纯 HTTP API 封装，不含任何 UI**；评论列表与输入框由使用方实现
 * - 只调用 Server Route 形态的公开 API（`/api/v1/*`），不触碰 Server Function
 *   —— 后者对第三方站点有 4 重阻断，根本调不通
 * - **无浏览器全局依赖**，可在 SSR 流程里直接调用（只依赖 `fetch` 与 `AbortSignal`）
 * - 可注入 `fetch`（便于测试、Edge 运行时与 SSR 复用连接）
 * - 错误类型化并携带稳定错误码；所有方法返回 `Result`，不抛异常
 */

import {
  CommentCountsSchema,
  CommentPageSchema,
  PublicSiteConfigSchema,
  ReplyPageSchema,
  type CommentCounts,
  type CommentPage,
  type CommentSort,
  type CreateCommentInput,
  type PublicComment,
  type PublicSiteConfig,
  type ReplyPage,
  type Result,
} from '@recado/shared';
import { z } from 'zod';

import { ClientErrors, type ClientError } from './errors';

export type RecadoClientOptions = {
  /** API 根地址，如 `https://comments.example.com` */
  endpoint: string;
  /** 站点标识（公开的 site key，非密钥） */
  siteKey: string;
  /** 自定义 fetch：SSR / Edge / 测试注入 */
  fetch?: typeof globalThis.fetch;
  /** 单请求超时（毫秒），默认 10 秒 */
  timeoutMs?: number;
  /** 附带的额外请求头（如反向代理的认证头） */
  headers?: Record<string, string>;
};

export type ListCommentsOptions = {
  path?: string;
  threadId?: string;
  sort?: CommentSort;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
};

export type ListRepliesOptions = {
  sort?: CommentSort;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
};

export type PostCommentOptions = {
  signal?: AbortSignal;
};

/**
 * 线程元信息与预览结果的契约。
 *
 * 用 Zod 而不是手写 interface：SDK 拿到的是**外部输入**，
 * 必须运行时校验后才能当作类型使用（也避免用断言，那是仓库明令禁止的）。
 */
export const ThreadMetaSchema = z.object({
  path: z.string(),
  url: z.string().nullable(),
  title: z.string().nullable(),
  commentCount: z.number().int(),
  lastCommentAt: z.string().nullable(),
});

export type ThreadMeta = z.infer<typeof ThreadMetaSchema>;

export const RenderPreviewSchema = z.object({
  html: z.string(),
  mentions: z.array(z.string()),
});

export type RenderPreview = z.infer<typeof RenderPreviewSchema>;

export type RecadoClient = {
  readonly endpoint: string;
  readonly siteKey: string;

  /** 站点公开配置（渲染评论区所需的一切） */
  getConfig: (options?: { signal?: AbortSignal }) => Promise<Result<PublicSiteConfig, ClientError>>;

  /** 评论列表：顶层分页 + 每条内联前 N 条回复 */
  listComments: (options: ListCommentsOptions) => Promise<Result<CommentPage, ClientError>>;

  /** 某条顶层评论的回复分页（独立于顶层分页） */
  listReplies: (
    rootId: string,
    options?: ListRepliesOptions,
  ) => Promise<Result<ReplyPage, ClientError>>;

  /** 发表评论或回复 */
  createComment: (
    input: CreateCommentInput,
    options?: PostCommentOptions,
  ) => Promise<Result<PublicComment, ClientError>>;

  /** 批量评论数：一次查多个 path */
  countComments: (
    paths: string[],
    options?: { signal?: AbortSignal },
  ) => Promise<Result<CommentCounts, ClientError>>;

  /** 最近评论（跨 path） */
  listRecentComments: (options?: {
    limit?: number;
    signal?: AbortSignal;
  }) => Promise<Result<PublicComment[], ClientError>>;

  /** 线程元信息（评论数、最近评论时间） */
  getThreadMeta: (
    path: string,
    options?: { signal?: AbortSignal },
  ) => Promise<Result<ThreadMeta, ClientError>>;

  /** 预览渲染：与落库渲染复用同一条服务端管线 */
  render: (
    content: string,
    options?: { signal?: AbortSignal },
  ) => Promise<Result<RenderPreview, ClientError>>;
};

/** 服务端错误信封 */
type ErrorEnvelope = { error: { reason: string; message: string; details?: unknown } };

function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  if (typeof value !== 'object' || value === null) return false;

  const error = Reflect.get(value, 'error');
  return (
    typeof error === 'object' && error !== null && typeof Reflect.get(error, 'reason') === 'string'
  );
}

/** 成功信封 `{ data }` 的取值；不符合契约时返回 undefined */
function unwrap(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return Reflect.get(value, 'data');
}

export function createClient(options: RecadoClientOptions): RecadoClient {
  const doFetch = options.fetch ?? globalThis.fetch;
  const base = options.endpoint.replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 10_000;

  type RequestOptions = {
    method?: 'GET' | 'POST';
    path: string;
    query?: Record<string, string | undefined>;
    body?: unknown;
    signal?: AbortSignal | undefined;
  };

  /**
   * 统一请求：拼 URL、注入 site key、合并超时与调用方的 AbortSignal。
   *
   * 超时用 `AbortSignal.timeout` + `AbortSignal.any`：两者都是标准 API，
   * 不需要自己管理定时器，也不会漏掉清理。
   */
  async function request(requestOptions: RequestOptions): Promise<Result<unknown, ClientError>> {
    const url = new URL(`${base}${requestOptions.path}`);

    for (const [key, value] of Object.entries(requestOptions.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, value);
    }

    const signals = [AbortSignal.timeout(timeoutMs)];
    if (requestOptions.signal !== undefined) signals.push(requestOptions.signal);

    try {
      const response = await doFetch(url, {
        method: requestOptions.method ?? 'GET',
        headers: {
          // site key 是**公开标识**：它只用来选出「这次请求属于哪个站点」
          'X-Recado-Site': options.siteKey,
          ...(requestOptions.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...options.headers,
        },
        ...(requestOptions.body === undefined ? {} : { body: JSON.stringify(requestOptions.body) }),
        signal: AbortSignal.any(signals),
      });

      const payload: unknown = await response.json().catch(() => undefined);

      if (!response.ok) {
        if (isErrorEnvelope(payload)) {
          return { data: null, error: payload.error };
        }

        return {
          data: null,
          error: {
            reason: 'INTERNAL_UNEXPECTED',
            message: `Request failed with HTTP ${response.status}`,
          },
        };
      }

      return { data: unwrap(payload) ?? null, error: null };
    } catch (cause) {
      // 超时与网络失败要分开：前者可以适当重试，后者多半是配置问题
      if (cause instanceof DOMException && cause.name === 'TimeoutError') {
        return { data: null, error: ClientErrors.timeout(timeoutMs) };
      }

      return { data: null, error: ClientErrors.network(cause) };
    }
  }

  /**
   * 用 Zod 校验响应：服务端换了契约时立刻发现，而不是把坏数据一路传给 UI。
   *
   * 这也让「外部数据的类型」有运行时依据 —— 断言在这里是明令禁止的。
   */
  function validate<TData>(schema: z.ZodType<TData>, value: unknown): Result<TData, ClientError> {
    const parsed = schema.safeParse(value);

    if (!parsed.success) {
      return { data: null, error: ClientErrors.invalidResponse('schema mismatch') };
    }

    return { data: parsed.data, error: null };
  }

  return {
    endpoint: base,
    siteKey: options.siteKey,

    async getConfig(opts) {
      const result = await request({ path: '/api/v1/config', signal: opts?.signal });
      if (result.error) return result;

      return validate<PublicSiteConfig>(PublicSiteConfigSchema, result.data);
    },

    async listComments(listOptions) {
      const result = await request({
        path: '/api/v1/comments',
        query: {
          path: listOptions.path,
          threadId: listOptions.threadId,
          sort: listOptions.sort,
          page: listOptions.page === undefined ? undefined : String(listOptions.page),
          pageSize: listOptions.pageSize === undefined ? undefined : String(listOptions.pageSize),
        },
        signal: listOptions.signal,
      });
      if (result.error) return result;

      return validate<CommentPage>(CommentPageSchema, result.data);
    },

    async listReplies(rootId, replyOptions) {
      const result = await request({
        path: `/api/v1/comments/${encodeURIComponent(rootId)}/replies`,
        query: {
          sort: replyOptions?.sort,
          page: replyOptions?.page === undefined ? undefined : String(replyOptions.page),
          pageSize:
            replyOptions?.pageSize === undefined ? undefined : String(replyOptions.pageSize),
        },
        signal: replyOptions?.signal,
      });
      if (result.error) return result;

      return validate<ReplyPage>(ReplyPageSchema, result.data);
    },

    async createComment(input, postOptions) {
      const result = await request({
        method: 'POST',
        path: '/api/v1/comments',
        body: input,
        signal: postOptions?.signal,
      });
      if (result.error) return result;

      return validate<PublicComment>(CommentPageSchema.shape.comments.element, result.data);
    },

    async countComments(paths, opts) {
      const result = await request({
        path: '/api/v1/comments/count',
        query: { paths: paths.join(',') },
        signal: opts?.signal,
      });
      if (result.error) return result;

      return validate<CommentCounts>(CommentCountsSchema, result.data);
    },

    async listRecentComments(opts) {
      const result = await request({
        path: '/api/v1/comments/recent',
        query: { limit: opts?.limit === undefined ? undefined : String(opts.limit) },
        signal: opts?.signal,
      });
      if (result.error) return result;

      // 最近评论是数组：用一个只校验元素形状的宽松 schema
      const parsed = CommentPageSchema.shape.comments.safeParse(result.data);
      if (!parsed.success) {
        return { data: null, error: ClientErrors.invalidResponse('expected an array of comments') };
      }

      return { data: parsed.data, error: null };
    },

    async getThreadMeta(path, opts) {
      const result = await request({
        // splat 路由：文章标识本身含斜杠，因此整体拼在 /threads/ 之后
        path: `/api/v1/threads${path.startsWith('/') ? path : `/${path}`}`,
        signal: opts?.signal,
      });
      if (result.error) return result;

      const value = result.data;
      if (
        typeof value !== 'object' ||
        value === null ||
        typeof Reflect.get(value, 'path') !== 'string'
      ) {
        return { data: null, error: ClientErrors.invalidResponse('expected thread meta') };
      }

      return { data: value as ThreadMeta, error: null };
    },

    async render(content, opts) {
      const result = await request({
        method: 'POST',
        path: '/api/v1/render',
        body: { content },
        signal: opts?.signal,
      });
      if (result.error) return result;

      const value = result.data;
      if (
        typeof value !== 'object' ||
        value === null ||
        typeof Reflect.get(value, 'html') !== 'string'
      ) {
        return { data: null, error: ClientErrors.invalidResponse('expected render preview') };
      }

      return { data: value as RenderPreview, error: null };
    },
  };
}
