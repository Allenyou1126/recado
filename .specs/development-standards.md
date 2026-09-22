# Recado 开发规范

| 项目 | 内容 |
| --- | --- |
| 版本 | v1.0 |
| 适用 | 本仓库全部代码（`apps/server`、`packages/*`） |
| 配套 | `requirements.md`（需求）、`decision-log.md`（决策） |

> **参考来源**：本文的分层与依赖注入思路参考了 [我的博客项目架构 - TanStack Start 与依赖注入实战](https://blog.dukda.com/post/%E6%88%91%E7%9A%84%E5%8D%9A%E5%AE%A2%E9%A1%B9%E7%9B%AE%E6%9E%B6%E6%9E%84-tanstack-start%E4%B8%8E%E4%BE%9D%E8%B5%96%E6%B3%A8%E5%85%A5%E5%AE%9E%E6%88%98)、
> [上手 TanStack Start 框架](https://blog.dukda.com/post/%E4%B8%8A%E6%89%8Btanstack-start%E6%A1%86%E6%9E%B6%E8%88%92%E9%80%82%E7%9A%84%E5%BC%80%E5%8F%91%E4%BD%93%E9%AA%8C) 与
> [TypeScript 错误处理：用 Result 类型替代 try-catch](https://blog.dukda.com/post/typescript-%E9%94%99%E8%AF%AF%E5%A4%84%E7%90%86%E7%94%A8-result-%E7%B1%BB%E5%9E%8B%E6%9B%BF%E4%BB%A3-try-catch)。
> 各模式的采纳与改动理由见 §13，**不要直接照搬原文代码**——那些文章写于 TanStack Start 早期，部分 API 已经演进。

---

## 1. 总则

### 1.1 四条核心原则

| 原则 | 含义 | 反面 |
| --- | --- | --- |
| **高内聚** | 一个功能模块的接口、业务、数据访问放在一起，自包含 | 按技术类型平铺（所有 service 一个目录、所有 repo 一个目录） |
| **低耦合** | 层与层之间通过**显式参数**传递依赖，不依赖全局状态与具体实现 | 在函数内部 `import { db }` 直接用 |
| **显式优于隐式** | 依赖、错误、副作用都写在类型签名里 | 隐式抛异常、隐式全局单例、隐式类型断言 |
| **类型安全贯穿全链路** | Zod schema 是唯一真源，向前推导运行时校验与 OpenAPI，向后推导 TS 类型 | 手写 interface 与 schema 两套，靠人同步 |

### 1.2 依赖注入

依赖注入不是框架特性，是一条编码纪律：**函数运行所需的一切（数据库、配置、会话、日志）
都作为参数传入，而不是在函数内部创建或获取。**

```ts
// ✅ 依赖显式声明，可以脱离 HTTP 与真实数据库测试
export async function listComments(
  ctx: SiteContext,
  input: ListCommentsInput,
): Promise<Result<CommentPage, ListCommentsError>> { /* ... */ }

// ❌ 依赖藏在函数体里，测试必须启动数据库
export async function listComments(input: ListCommentsInput) {
  const db = getDb();  // 全局单例
  const site = await getSite(); // 又一次隐式获取
}
```

判断标准很简单：**如果这个函数不能在不启动数据库、不发真实请求的前提下被测试，它就不合格。**

---

## 2. 分层架构

### 2.1 三层职责

```
┌──────────────────────────────────────────────────────────┐
│ 接口层 (Interface)                                        │
│   Server Route  → 公开 REST API / 管理 API                │
│   Server Function → 管理台页面的 SSR 数据加载              │
│   职责：HTTP 语义、鉴权、参数校验、错误到状态码的映射        │
│   禁止：写业务规则、直接访问数据库                          │
├──────────────────────────────────────────────────────────┤
│ 服务层 (Service)                                          │
│   职责：业务规则、流程编排、事务边界、跨 Repo 组合            │
│   禁止：感知 HTTP（不出现 Request/Response/状态码）          │
├──────────────────────────────────────────────────────────┤
│ 数据层 (Repo)                                             │
│   职责：Drizzle 查询、持久化、行到领域对象的映射             │
│   禁止：写业务判断、抛业务错误                              │
└──────────────────────────────────────────────────────────┘
```

**依赖方向严格单向向下**：接口层 → 服务层 → 数据层。反向依赖一律禁止。

### 2.2 各层允许与禁止

| 层 | 允许 import | 禁止 import |
| --- | --- | --- |
| 接口层 | Service、`shared`（schema/错误码）、框架 API | 直接 import Repo、直接 import `db` 实例 |
| 服务层 | Repo、`shared`、`core` 内其他 service | 任何框架 API（`@tanstack/*`）、HTTP 类型 |
| 数据层 | Drizzle、`db` 类型、`shared` | Service、框架 API |

> 服务层**禁止** import `@tanstack/react-start`。这条纪律保证了 `packages/core`
> 可以在任意运行时下被测试和复用（也是主文档 §10 中「框架可替换」这一风险对策的落地方式）。

### 2.3 为什么业务逻辑不感知 HTTP

因为业务规则不该随路由风格变化。把「标记垃圾 → 邮箱声誉降级 → 重算计数」写进
Service 后，它同时服务于三条调用路径：管理台 UI、公开 REST API、CLI 命令，
且三者的行为一定一致。

---

## 3. 目录结构

### 3.1 仓库布局

```
recado/
├── apps/
│   └── server/                    # TanStack Start 应用
│       ├── src/
│       │   ├── routes/            # 页面路由 + API 路由
│       │   ├── db/                # Drizzle 实例与迁移（server-only）
│       │   ├── lib/               # 中间件、会话、OIDC 客户端
│       │   ├── types/             # 全局 Context 类型声明
│       │   ├── router.tsx
│       │   └── server.ts          # 可选：FastResponse 优化
│       └── ...
├── packages/
│   ├── core/                      # 领域逻辑（不依赖框架）
│   │   └── src/
│   │       ├── features/          # 按功能组织，见 3.2
│   │       └── lib/               # Result、错误类型、通用工具
│   ├── db/                        # Drizzle schema + 迁移
│   ├── shared/                    # Zod schema、错误码、API 契约类型
│   └── sdk/                       # @recado/client
├── .specs/                        # 需求、决策、开发规范、研究资料
├── AGENTS.md                      # 面向 AI 编码代理的约束与指引
└── README.md
```

### 3.2 Feature-based 组织

**每个功能模块自包含三层**，而不是按技术类型平铺：

```
packages/core/src/features/comments/
├── comments.schema.ts     # Zod schema（输入、输出、类型推导）
├── comments.data.ts       # Repo 层：Drizzle 查询
├── comments.service.ts    # Service 层：业务逻辑
├── comments.errors.ts     # 该功能特有的错误 reason 定义
└── comments.test.ts       # 单元测试贴着源码放
```

功能模块划分（与主文档 §6 的 M1–M10 对应）：
`sites` / `threads` / `comments` / `members` / `labels` / `moderation` /
`notifications` / `rendering` / `auth` / `audit`。

### 3.3 文件命名约定

| 后缀 | 含义 | 能否进入客户端 bundle |
| --- | --- | --- |
| `*.schema.ts` | Zod schema 与推导类型 | ✅ 可以 |
| `*.data.ts` | Repo 层，含 Drizzle 查询 | ❌ 服务端专用 |
| `*.service.ts` | Service 层 | ❌ 服务端专用 |
| `*.errors.ts` | 错误 reason 与类型 | ✅ 可以（SDK 需要） |
| `*.server.ts` | 含密钥/连接的模块 | ❌ 构建期硬报错 |
| `*.functions.ts` | Server Function 包装 | 仅函数本身可在客户端引用 |
| `*.tsx` | React 组件 | ✅ 可以 |

> `*.server.ts` 的拦截是**框架提供的构建期保护**（客户端构建时硬报错，
> 开发期降级为警告 + mock）。这是防止数据库代码泄漏进客户端的第一道闸门，
> 必须在 `tanstackStart({ importProtection })` 中补上 `pg`、`drizzle-orm`、`nodemailer`。

---

## 4. 依赖注入与 Context 规范

### 4.1 Context 类型层次

Context 是**逐级"升级"**的：每个中间件只添加自己负责的依赖。定义在
`apps/server/src/types/context.d.ts`：

```ts
declare global {
  // 第一级：每个请求都有的东西
  type BaseContext = {
    env: Env;            // 启动时经 Zod 校验的配置
    requestId: string;   // 贯穿日志与错误响应
    logger: Logger;
  };

  // 第二级：注入数据库（Node 常驻下是共享连接池）
  type DbContext = BaseContext & { db: Database };

  // 第三级：公开 API —— 已解析出站点与来源校验结果
  type SiteContext = DbContext & {
    site: Site;
    origin: { allowed: boolean; raw: string | null };
  };

  // 第三级（管理端）：已认证主体 + 权限范围
  type ActorContext = DbContext & {
    actor: Actor;         // { kind: 'human' | 'machine', subject, email }
    scope: AccessScope;   // { type: 'instance' } | { type: 'site', siteIds: string[] }
  };

  // 第四级：管理端 + 已校验该主体对本站点有权限
  type AdminSiteContext = ActorContext & { site: Site };
}

declare module '@tanstack/react-start' {
  interface Register {
    server: { requestContext: BaseContext };
  }
}
```

**规则**：函数签名里写它**真正需要的最低层级**。
只需要读数据库的 Repo 函数收 `db`，不需要整个 `SiteContext`；只有确实要判断权限的才收 `AdminSiteContext`。

### 4.2 中间件链

中间件是依赖注入的载体。每个中间件只做一件事，并向下游注入一项依赖。

```
baseMiddleware        → 注入 env / requestId / logger
    ↓
dbMiddleware          → 注入 db
    ↓
    ├── 公开 API 分支
    │   siteMiddleware    → 由 X-Recado-Site 解析站点，注入 site
    │   originMiddleware  → 按 originPolicy 校验来源，注入 origin
    │
    └── 管理 API 分支
        actorMiddleware      → 校验会话/Bearer，解析 OIDC 角色，注入 actor + scope
        siteScopeMiddleware  → 校验 actor 对目标站点有权限，注入 site
```

### 4.3 两种中间件写法（**不要混淆**）

Server Function 与 Server Route 的中间件挂载方式不同，这是最容易写错的地方：

```ts
// ✅ Server Function：用 createMiddleware 组合
import { createMiddleware } from '@tanstack/react-start';

export const dbMiddleware = createMiddleware({ type: 'function' }).server(
  async ({ next, context }) => {
    return next({ context: { db: getPool() } });
  },
);

export const listSitesFn = createServerFn({ method: 'GET' })
  .middleware([dbMiddleware, actorMiddleware])
  .handler(({ context }) => SiteService.list(context));
```

```ts
// ✅ Server Route：在路由选项的 server.middleware 中声明
export const Route = createFileRoute('/api/v1/comments')({
  server: {
    middleware: [dbMiddleware, siteMiddleware, originMiddleware],
    handlers: {
      GET: async ({ request, context }) => { /* context.site 已就绪 */ },
      ANY: async () => methodNotAllowed(['GET', 'OPTIONS']),
    },
  },
});
```

> 中间件的 `context` 是**累积**的：`siteMiddleware` 能拿到前面的 `db`，
> 因此它必须先声明对 `dbMiddleware` 的依赖（`createMiddleware().middleware([dbMiddleware])`）。

### 4.4 Server Function 与 Server Route 的选型规则（**硬性**）

| 场景 | 用什么 | 理由 |
| --- | --- | --- |
| 第三方站点调用的公开 API | **Server Route** | Server Function 有 4 重阻断，外部根本无法调用（主文档 §8.2 有实测证据） |
| 管理台页面的 SSR 数据加载 | Server Function | 享受 RPC 的端到端类型安全 |
| 管理台的表单提交与变更 | **Server Route** | 统一走 `/api/v1/admin/*`，便于集中做 CSRF 与会话校验 |
| 管理 API 的对外形态 | **Server Route** | 脚本/CI 也要能调 |

**判定口诀**：只要这个端点需要被「TanStack 客户端之外的东西」调用，就是 Server Route。

### 4.5 禁止事项

- ❌ 在 Service/Repo 里 `import { db } from '@/db'` —— 必须通过参数传入。
- ❌ 在模块顶层读取 `process.env` 并直接使用 —— 必须经 `Env` 校验后由 context 提供。
- ❌ 为图省事让所有函数都收 `AdminSiteContext` —— 依赖声明要精确。
- ❌ 在 Server Route 里直接写业务逻辑 —— 必须下沉到 Service。

---

## 5. 类型系统与校验

### 5.1 Zod 是唯一真源

一处定义，三处产物：**运行时校验 + TypeScript 类型 + OpenAPI 文档**。

```ts
// packages/shared/src/schemas/comment.ts
export const CreateCommentInput = z.object({
  path: z.string().min(1).max(2048),
  content: z.string().min(1),
  nickname: z.string().min(1).max(64),
  email: z.email(),                                  // 必填，不可配（D18）
  website: z.url().max(2048).optional(),
  parentId: z.uuid().optional(),
});

export type CreateCommentInput = z.infer<typeof CreateCommentInput>;  // 推导，不手写
```

**规则**：
- 永远用 `z.infer` 推导类型，**禁止**手写与 schema 重复的 `interface`。
- 输入 schema 命名 `XxxInput`，输出 schema 命名 `XxxOutput`。
- schema 放在 `packages/shared`（公开契约）或功能模块内（内部使用）。

### 5.2 校验关口

| 关口 | 校验内容 |
| --- | --- |
| 启动时 | 环境变量（缺失/格式错直接拒绝启动，给出可读错误） |
| 接口层 | 请求体、查询参数、路径参数 |
| 服务层 | 业务规则（如「回复深度不得超过 `maxDepth`」） |
| 数据层 | 依赖数据库约束作为最后一道防线（NOT NULL / UNIQUE / CHECK） |

**不要**把业务规则校验放在接口层——那样 CLI 或 worker 调用同一 Service 时会绕过它。

### 5.3 类型纪律

- `tsconfig` 开启 `strict`；**`verbatimModuleSyntax` 必须保持关闭**（官方文档说明开启它可能导致服务端产物泄漏进客户端 bundle）。
- **禁止 `any`**；确实需要时用 `unknown` + 类型收窄。
- **禁止非空断言 `!`** 与 `as` 强制断言；用类型守卫或 Zod 解析。
- 类型导入用 `import type`。

---

## 6. 错误处理规范

### 6.1 用 Result 类型，不用异常表达业务失败

TypeScript 的 `catch (e)` 里 `e` 是 `unknown`，而且**「谁抛了什么」不写在类型签名里**——
新增一种错误而忘记在调用处处理时，编译不会报错。业务失败必须用返回值表达。

```ts
// packages/core/src/lib/result.ts
export type Result<TData, TError extends { reason: string }> =
  | { data: TData; error: null }
  | { data: null; error: TError };

export function ok<TData>(data: TData): Result<TData, never> {
  return { data, error: null };
}

// const 类型参数：让 reason 推断为字面量类型而非宽泛的 string
export function err<const TReason extends string, TError extends { reason: TReason }>(
  error: TError,
): Result<never, TError> {
  return { data: null, error: error };
}
```

### 6.2 错误类型定义

```ts
// packages/shared/src/errors.ts
export type DomainError<Reason extends string = string> = {
  reason: Reason;        // 稳定错误码，SDK 据此分支
  message: string;       // 面向开发者的英文描述，不改动已有语义
  details?: unknown;     // 结构化补充信息
};
```

**错误码规范**：`大写下划线`，以分类前缀开头，保证 SDK 可稳定分支。
新增错误码是**向后兼容**的；修改或删除已有错误码是**破坏性变更**，需评估 SDK 影响。

| 前缀 | HTTP | 含义 |
| --- | --- | --- |
| `VALIDATION_*` | 400 | 输入不合法 |
| `AUTH_*` | 401 | 未认证 / 凭证失效 |
| `FORBIDDEN_*` | 403 | 已认证但无权限（含来源被拒） |
| `NOT_FOUND_*` | 404 | 资源不存在 |
| `CONFLICT_*` | 409 | 状态冲突（如重复提交） |
| `RATE_LIMITED_*` | 429 | 触发限流 |
| `INTERNAL_*` | 500 | 未预期错误 |

### 6.3 穷尽检查（关键收益）

调用方 `switch` 错误码时，用 `satisfies never` 让编译器兜底：

```ts
const result = await CommentService.create(ctx, input);

if (result.error) {
  switch (result.error.reason) {
    case 'VALIDATION_CONTENT_TOO_LONG':
      return badRequest(result.error);
    case 'FORBIDDEN_ORIGIN_NOT_ALLOWED':
      return forbidden(result.error);
    case 'RATE_LIMITED_TOO_FREQUENT':
      return tooManyRequests(result.error);
    default:
      // 所有错误都处理完时，reason 收窄为 never
      // 新增错误码却忘记处理 → 这里编译报错
      throw new UnhandledError(result.error.reason satisfies never);
  }
}

// 到这里 TS 知道 error 是 null，data 一定有值
return created(result.data);
```

这带来**双向保护**：新增错误忘记处理会编译失败；处理了已删除的错误，`case` 分支也会编译失败。

### 6.4 异常只用在边界

`try/catch` 不是禁用，而是**限定使用位置**——只用于捕获**未预期**的异常：

| 位置 | 处理方式 |
| --- | --- |
| Server Route / Server Function 最外层 | 捕获一切 → 记录 `requestId` 与堆栈 → 返回 `INTERNAL_*` 500。**绝不把堆栈返回给客户端** |
| outbox worker 循环 | 单条失败只标记该条 `failed`，**不得中断整个循环** |
| 外部 IO（SMTP、JWKS 拉取） | 网络失败是**预期**的，用 Result 包装后返回 |
| `request.json()` 解析 | 用户输入导致，用 Result 包装为 `VALIDATION_INVALID_JSON` |

```ts
// 接口层最外层的标准包装
export async function handle(fn: () => Promise<Result<unknown, DomainError>>) {
  try {
    const result = await fn();
    if (result.error) return errorToResponse(result.error);
    return Response.json({ data: result.data });
  } catch (cause) {
    logger.error({ err: cause, requestId }, 'unhandled');
    return Response.json(
      { error: { reason: 'INTERNAL_UNEXPECTED', message: 'Internal error' } },
      { status: 500 },
    );
  }
}
```

### 6.5 禁止事项

- ❌ 用 `throw` 表达可预期的业务失败（如「邮箱格式错误」「无权访问该站点」）。
- ❌ 吞掉错误（`catch {}` 空块）。至少记录日志。
- ❌ 把数据库原始错误直接暴露给客户端（可能泄漏表结构与数据）。
- ❌ 在 Service 层返回 HTTP 状态码或构造 `Response`。

---

## 7. 数据库访问规范

### 7.1 只出现在 Repo 层

Drizzle 查询**只能**写在 `*.data.ts`。Service 层不得出现 `.select()` / `.insert()`。

### 7.2 每个查询必须带站点隔离

多租户下这是最容易出安全漏洞的地方。**任何按业务维度查询的数据访问，`site_id` 条件不可省略**：

```ts
// ✅
export async function findThreadByPath(db: Database, siteId: string, path: string) {
  return db.query.threads.findFirst({
    where: and(eq(threads.siteId, siteId), eq(threads.path, path)),
  });
}

// ❌ 跨站点数据泄漏
export async function findThreadByPath(db: Database, path: string) { /* ... */ }
```

**约定**：Repo 函数的 `siteId` 参数位置固定（紧跟 `db`），便于评审时一眼看出是否遗漏。

### 7.3 事务

- **多行写入必须在事务内**。典型场景：发表评论（写 comment + upsert thread + 更新计数）、
  标记垃圾（改状态 + 声誉计数 + 重算计数 + 写审计日志）、批量操作。
- 事务边界在 **Service 层**（Repo 只提供单步操作，也接收可选的 `tx` 参数）。
- 禁止在事务内做网络 IO（发邮件、调 IdP）——必须放到事务提交之后。

```ts
// Service 层持有事务边界
export async function markAsSpam(ctx: AdminSiteContext, commentId: string) {
  return ctx.db.transaction(async (tx) => {
    const comment = await CommentRepo.updateStatus(tx, ctx.site.id, commentId, 'spam');
    if (comment.error) return comment;
    await MemberRepo.incrementSpamCount(tx, ctx.site.id, comment.data.memberId);
    await ThreadRepo.recount(tx, ctx.site.id, comment.data.threadId);
    await AuditRepo.write(tx, { actor: ctx.actor, action: 'comment.mark_spam', targetId: commentId });
    return ok(comment.data);
  });
  // 邮件投递在事务外，写 outbox 即可
}
```

### 7.4 查询规范

- **分页必须有上限**：`pageSize` 由服务端强制封顶（如 50），不信任客户端传值。
- **避免 N+1**：列表查询用 join 或 `inArray` 批量取，禁止在循环里查库。
- **列表查询只 select 需要的列**，尤其禁止把 `members.email`、`comments.ip` 带进公开查询。
- **计数走物化字段**（`threads.comment_count`），不要每次 `COUNT(*)`。

### 7.5 迁移

- 迁移文件纳入版本管理，由 Drizzle Kit 生成。
- **迁移作为独立部署步骤执行**（init container / 一次性任务），**不在应用启动时自动迁移**。
- 迁移必须可重复执行且向后兼容一个版本（先加列，再用，最后删旧列）。

---

## 8. 安全编码规范

### 8.1 数据暴露白名单

**公开 API 响应永远不包含**：`email`、`ip`、`user_agent`、`oidc_subject`、任何密钥。

实现方式：公开响应**显式构造**返回对象，而不是把数据库行直接透传。

```ts
// ✅ 显式白名单
function toPublicComment(row: CommentRow): PublicComment {
  return {
    id: row.id, path: row.path, content: row.contentHtml,
    nickname: row.authorNickname, website: row.authorWebsite,
    label: row.label, createdAt: row.createdAt,
  };
}

// ❌ 直接透传，新增敏感列时会静默泄漏
return Response.json(row);
```

### 8.2 站点隔离

见 §7.2。另外：**管理端也必须校验主体对目标站点的权限**，
不能因为「登录了」就允许访问任意站点（`siteScopeMiddleware` 的职责）。

### 8.3 内容与渲染

- 评论内容**只经服务端 Unified.js 管线渲染**，渲染后必须过 `rehype-sanitize`。
- 客户端**禁止**拥有独立的 Markdown 渲染器（Waline 的双管线分歧是明确的教训）。
- 外链统一加 `rel="nofollow ugc noopener noreferrer"`。
- 预览走 `POST /api/v1/render`，复用同一管线，保证预览与最终结果一致。

### 8.4 CSRF

- **Server Route 默认不受框架 CSRF 保护**（框架的 CSRF 中间件只过滤 Server Function）。
- 管理端写操作必须：校验 `Origin` + CSRF token 双重提交 + `SameSite=Lax` Cookie。
- 公开 API 不使用 Cookie 认证，因此不受 CSRF 影响。

### 8.5 CORS 与来源校验

- 按站点白名单**动态回显** `Access-Control-Allow-Origin`，禁止使用 `*`。
- 公开端点按站点 `originPolicy` 处理无来源头请求；管理端点不检查来源头（Q-12）。
- 参考实现统一放在 `originMiddleware`，不要在路由里各写一遍。

### 8.6 日志脱敏

日志**禁止**出现：邮箱明文、完整 IP、Cookie、OIDC token、SMTP 密码、site key。
需要关联时记录哈希或后四位。

---

## 9. 管理台前端规范

### 9.1 路由组织

```
apps/server/src/routes/
├── __root.tsx
├── _authed/                    # pathless layout：统一做登录态 UX 处理
│   ├── route.tsx               # beforeLoad 检查会话，未登录则跳转
│   ├── index.tsx               # 仪表盘
│   ├── comments.tsx
│   ├── sites/
│   │   ├── index.tsx
│   │   └── $siteId.tsx         # 站点标识一律 UUID（D17）
│   └── members.tsx
├── api/v1/                     # 公开 + 管理 REST API（Server Route）
└── auth/                       # OIDC 回调
```

> ⚠️ `beforeLoad` 里的重定向**只是 UX 优化，不是安全边界**。
> 真正的权限校验必须在服务端（`actorMiddleware` + `siteScopeMiddleware`）。

### 9.2 数据获取：TanStack Query + Server Function

统一模式：`queryOptions` 工厂 → loader 预取 → 组件消费。

```ts
// 1. 查询选项工厂（可复用、可预取）
const commentsQuery = (siteId: string, filters: CommentFilters) =>
  queryOptions({
    queryKey: ['comments', siteId, filters],
    queryFn: () => listCommentsFn({ data: { siteId, filters } }),
  });

// 2. loader 中预取（SSR 阶段执行）
export const Route = createFileRoute('/_authed/comments')({
  loader: ({ context, search }) =>
    context.queryClient.ensureQueryData(commentsQuery(context.siteId, search)),
  component: CommentsPage,
});

// 3. 组件中消费（命中缓存，无需 loading 态）
function CommentsPage() {
  const { data } = useSuspenseQuery(commentsQuery(siteId, filters));
}
```

**规则**：
- **loader 是同构的**（SSR 与客户端导航都会执行）——**绝不在 loader 里直接访问数据库或读密钥**，
  一律通过 Server Function。
- queryKey 必须包含 `siteId`，否则切换站点时会命中错误缓存。
- 变更操作后用 `queryClient.invalidateQueries` 精确失效，不要全局 `invalidate`。

### 9.3 SSR 注意事项

- 管理台整体开启 SSR；仅在组件确实依赖浏览器 API 时对单个路由设 `ssr: 'data-only'`。
- 时间、随机数、`window` 相关渲染用 `<ClientOnly>` 包裹，避免 hydration mismatch。
- 分页、筛选条件等状态优先放 **search params**（可分享、可刷新、可回退），
  用 `validateSearch` + Zod 校验。

### 9.4 UI 约定

- Tailwind CSS + shadcn/ui，界面中文（Q-13）。
- **破坏性操作必须二次确认并显示影响范围**（如「将删除 12 条评论」）。
- 批量操作的结果要展示**部分失败明细**，不能只显示「完成」。
- 表单错误提示定位到具体字段；服务端返回的 `reason` 映射为可读中文文案。
- 键盘可达、焦点可见、对比度达 WCAG AA。
- **禁止**用 `prompt()` / `confirm()` 做输入与确认（Waline 管理台的明确缺陷）。

---

## 10. 测试规范

### 10.1 分层策略

| 层 | 测试类型 | 依赖 |
| --- | --- | --- |
| Repo | 集成测试（真实 Postgres，用 testcontainers 或 compose） | 数据库 |
| Service | **单元测试为主**，用 mock 的 `ctx.db`；关键路径补集成测试 | 无（这正是 DI 的收益） |
| Server Route | 集成测试，直接构造 `Request` 调 handler | 数据库 + 测试上下文 |
| 公开 API | 契约测试，断言响应与 OpenAPI 一致 | 全栈 |
| 管理台 | Playwright E2E，覆盖登录、审核、批量操作 | 全栈 |

### 10.2 必测场景（回归防线）

1. **跨站点隔离**：用 A 站点的凭证读写 B 站点的数据必须失败。
2. **权限边界**：`PREFIX.ADMIN.<site>` 角色无法访问其他站点；无角色无法登录。
3. **敏感字段不泄漏**：公开 API 响应断言不含 `email` / `ip` / `user_agent`。
4. **XSS**：预置一批 payload，断言渲染结果已被消毒。
5. **错误方法**：对只读端点发 `PUT` 必须返回 **405 + `Allow`**，而非 `200 text/html`。
6. **CORS 预检**：**在生产构建下**验证（dev 下框架会绕过 OPTIONS 处理器）。
7. **状态机**：`spam → approved` 时声誉计数对称回滚。
8. **事务原子性**：标记垃圾过程中注入失败，断言无部分写入。

### 10.3 命名与组织

- 单元测试与被测文件同目录：`comments.service.test.ts`。
- 集成与 E2E 放 `tests/` 下分目录。
- 测试名描述**行为与预期**，不描述实现：
  `it('当评论被标记为垃圾后，该邮箱的下一条评论进入待审核')`。

---

## 11. 代码风格与工程配置

### 11.1 TypeScript

```jsonc
{
  "strict": true,
  "noUncheckedIndexedAccess": true,   // 数组/字典取值强制判空，数据密集场景收益明显
  "noImplicitOverride": true,
  "verbatimModuleSyntax": false       // ⚠️ 必须关闭，见 §5.3
}
```

> 不开启 `exactOptionalPropertyTypes`：它与 React、Drizzle、Zod 的类型定义存在较多摩擦，
> 收益不抵维护成本。这是有意识的取舍，不是遗漏。

### 11.2 命名约定

| 对象 | 约定 | 示例 |
| --- | --- | --- |
| 文件 | kebab-case | `comment-moderation.service.ts` |
| 类型 / 组件 | PascalCase | `CommentCard` |
| 函数 / 变量 | camelCase | `listComments` |
| 常量 | SCREAMING_SNAKE | `MAX_PAGE_SIZE` |
| Zod schema | PascalCase（无后缀） | `CreateCommentInput` |
| 错误码 | SCREAMING_SNAKE | `FORBIDDEN_ORIGIN_NOT_ALLOWED` |
| 数据库表 | snake_case 复数 | `comment_mentions` |
| 数据库列 | snake_case | `content_html` |

### 11.3 Import 顺序

1. Node 内置模块
2. 第三方依赖
3. `@recado/*` 工作区包
4. 本应用绝对路径（`@/`）
5. 相对路径

由 ESLint 的 `import/order` 规则强制，不靠人工。

### 11.4 注释

- 注释解释**为什么**，不解释**是什么**（代码本身说明是什么）。
- 涉及取舍的地方必须写清楚背景，例如：
  ```ts
  // 不级联删除子回复：Waline 的静默级联会连带删除他人发言（决策 Q-04）
  ```
- 禁止保留被注释掉的死代码。

---

## 12. Git 与协作规范

### 12.1 分支模型

- `master` 为主分支，始终可部署。功能分支 `feat/<topic>`、修复分支 `fix/<topic>`。
- 一个 PR 只做一件事；重构与功能变更**不要混在一个 PR**。

### 12.2 提交信息（由钩子强制校验）

> 规则实现于 `.githooks/commit-msg`，经 `core.hooksPath=.githooks` 启用。
> 新克隆仓库后若钩子未生效，执行 `git config core.hooksPath .githooks`。
> 不合规的提交会被**直接拒绝**，不是靠自觉。

**格式**：

```
<type>(<scope>): <描述>

正文（可选）

Assisted-By: <工具名> (<模型 ID>)
```

| 项 | 取值 |
| --- | --- |
| `type` | `feat` `fix` `refactor` `perf` `docs` `test` `build` `ci` `chore` `style` `revert` |
| `scope`（可省略） | `comments` `threads` `sites` `members` `labels` `moderation` `notifications` `rendering` `auth` `db` `api` `sdk` `admin` `docker` `ci` `deps` `docs` `specs` `hooks` `repo` |
| 标题长度 | ≤ 100 字符，细节移到正文 |
| 破坏性变更 | type 后加 `!`（如 `refactor!: ...`），正文用 `BREAKING CHANGE:` 说明 |

**Assisted-By 尾注是强制项。** 凡有 AI Agent 参与的提交（哪怕只参与一部分），
必须注明所用工具与模型，**两者缺一不可**：

```
Assisted-By: DeepSeek Harness (deepseek-flash)
```

- 多个 Agent 协作时写多行。
- 完全由人类完成、无任何 Agent 参与的提交写 `Assisted-By: none`。
- 尾注与正文之间**必须空一行**，否则 git 不将其识别为尾注块
  （钩子有行扫描兜底，但请按规范写）。

**完整示例**：

```
feat(moderation): 标记垃圾后自动降级该邮箱声誉

将评论标记为 spam 时，在同一事务内递增 members.spam_count，
达到站点阈值后置 review_required，使该邮箱后续评论进入待审核。
恢复为 approved 时对称回滚。

Assisted-By: DeepSeek Harness (deepseek-flash)
```

**提交粒度**：一个提交只做一件事；框架升级独立成提交（见 12.3）。

### 12.3 版本锁定（**重要**）

TanStack Start 尚未发布 1.0.0（npm 上为 `1.168.x`，官方文档仍标注 Release Candidate），
且底层依赖 `h3` 的 RC 版本。因此：

- **所有 TanStack 相关依赖锁定精确版本**（不用 `^` / `~`）。
- 框架升级必须**独立成一个 PR**，并跑完整回归（含生产构建下的 CORS 预检测试）。
- 禁止在功能 PR 里顺手升级框架。

### 12.4 PR 检查清单

- [ ] 分层没有被打破（接口层无业务逻辑，服务层无框架依赖，数据层无业务判断）
- [ ] 依赖通过 context / 参数显式传入，没有新增全局单例引用
- [ ] 所有新的数据访问都带 `site_id` 隔离
- [ ] 公开响应没有泄漏 `email` / `ip` / `user_agent`
- [ ] 业务失败用 `Result` 返回，`switch` 有 `satisfies never` 穷尽检查
- [ ] 多行写入在事务内，事务内没有网络 IO
- [ ] 新增的 API 路由声明了 `ANY → 405 + Allow`
- [ ] 新增的错误码登记在 `packages/shared/src/errors.ts`
- [ ] Zod schema 是新增类型的唯一真源，没有手写重复 interface
- [ ] 测试覆盖了跨站点隔离与权限边界（如涉及）
- [ ] 破坏性操作有二次确认与影响范围提示（如涉及管理台）

---

## 13. 对参考文章模式的取舍

不是照搬，逐条说明采纳与改动：

### 13.1 采纳

| 模式 | 采纳理由 |
| --- | --- |
| 三层架构（接口 / 服务 / 数据） | 职责清晰，业务逻辑可脱离 HTTP 测试 |
| Feature-based 目录 | 高内聚，一个功能的改动集中在同一目录 |
| 依赖注入 + Context 逐级升级 | 低耦合，可测试，依赖关系写在类型签名里 |
| 中间件作为注入载体 | 框架原生支持，组合性好，链式可叠加 |
| 全局 Context 类型声明 | 在 Server Function 内获得完整类型提示 |
| Zod schema 复用推导类型 | 端到端类型安全，避免两套定义漂移 |
| **Result 类型替代 try-catch** | 编译期穷尽检查，新增错误不处理会报错——这是本文最有价值的一条 |
| TanStack Query + loader 预取 | SSR 预取 + 客户端缓存 + 导航无 loading 态 |

### 13.2 改动（原文写法已过时或不适用的部分）

| 原文 | 问题 | 我们的做法 |
| --- | --- | --- |
| `import { createServerFn } from '@tanstack/start'` | 包名已变 | 用 `@tanstack/react-start`（研究阶段实测确认） |
| `.inputValidator(schema)` | 该 API 已标记 `@deprecated` | 用 **`.validator(schema)`**（Zod 可直接传入，无需适配器） |
| 在 `server-entry.ts` 注入 `env` | 那是 Cloudflare Workers 的形态 | 我们是 **Node 常驻**，配置在启动时经 Zod 校验后由 `baseMiddleware` 注入；同时避免创建 `src/start.ts`（会静默丢失 CSRF 保护，且可能触发 issue #7460） |
| `dbMiddleware` 里 `getDb(context.env)` 每次建连 | Workers 无长连接可用 | Node 常驻下用**模块级连接池单例**，中间件只负责**注入**它 |
| 只用 `createMiddleware({ type: 'function' })` | 只覆盖 Server Function | 本项目**公开 API 全部是 Server Route**，必须同时掌握 `server.middleware` 写法（§4.3） |
| `createServerFn()` 承载对外接口 | Server Function 无法被第三方调用（4 重实测阻断） | 对外一律 Server Route；Server Function 只用于管理台页面数据加载 |
| 全局 `declare global` 放所有 Context | 容易变成大杂烩 | 保留该手法，但明确**层级与最小依赖原则**（§4.1） |

### 13.3 不采纳

| 项 | 原因 |
| --- | --- |
| 在 loader 里直接调用数据库 | loader 是同构的，会在客户端执行，绝不能碰数据库 |
| 把所有 Server Function 写在一个文件 | 与 feature-based 组织冲突，改为 `features/<x>/x.functions.ts` |
| `window` / 浏览器 API 在 SSR 组件中直接使用 | 会导致 hydration mismatch，必须用 `<ClientOnly>` 包裹或改 `ssr: 'data-only'` |

---

## 14. 参考

- [我的博客项目架构 - TanStack Start 与依赖注入实战](https://blog.dukda.com/post/%E6%88%91%E7%9A%84%E5%8D%9A%E5%AE%A2%E9%A1%B9%E7%9B%AE%E6%9E%B6%E6%9E%84-tanstack-start%E4%B8%8E%E4%BE%9D%E8%B5%96%E6%B3%A8%E5%85%A5%E5%AE%9E%E6%88%98)
- [上手 TanStack Start 框架，舒适的开发体验](https://blog.dukda.com/post/%E4%B8%8A%E6%89%8Btanstack-start%E6%A1%86%E6%9E%B6%E8%88%92%E9%80%82%E7%9A%84%E5%BC%80%E5%8F%91%E4%BD%93%E9%AA%8C)
- [TypeScript 错误处理：用 Result 类型替代 try-catch](https://blog.dukda.com/post/typescript-%E9%94%99%E8%AF%AF%E5%A4%84%E7%90%86%E7%94%A8-result-%E7%B1%BB%E5%9E%8B%E6%9B%BF%E4%BB%A3-try-catch)
- [TypeScript 5.0 - const Type Parameters](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html#const-type-parameters)
- [TypeScript 4.9 - satisfies Operator](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html#the-satisfies-operator)
- 本项目其他文档：`requirements.md`、`decision-log.md`、`research/tanstack-start-report.md`
