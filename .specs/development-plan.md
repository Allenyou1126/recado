# Recado 开发计划

| 项目 | 内容 |
| --- | --- |
| 版本 | v1.0 |
| 范围 | 需求主文档 §9「里程碑 1 — 可用内核」的全部 P0 项 |
| 配套 | `requirements.md`（要做什么）、`decision-log.md`（为什么）、`development-standards.md`（怎么写） |
| 状态 | ⬜ 未开始 |

---

## 如何使用本文件

本文件是**给执行者（人或 AI Agent）的工作清单**。它把里程碑 1 拆成 10 个有依赖顺序的阶段，
每个阶段给出目标、任务、验收标准与已知坑。

**三种用法：**

| 场景 | 做法 |
| --- | --- |
| 执行全部 | 从阶段 0 顺序做到阶段 9，每个任务完成后更新 §4 的进度追踪 |
| 执行一部分 | 说出范围（如「只做阶段 0–2」），做完即停 |
| 只做某个阶段 | 先确认其「前置」已满足，不满足则先补前置 |

**本文件不重复规格内容。** 每个阶段都给出规格引用，动手前必须去读对应章节 —— 
凭常识推断本项目的做法会踩坑，多个决策与主流做法相反且有明确理由。

---

## 1. 当前状态

### 已完成

- ✅ 需求分析（18 项决策全部确认，见 `decision-log.md`）
- ✅ 开发规范 v1.0（分层、依赖注入、Result 错误处理、测试与评审清单）
- ✅ pnpm monorepo 骨架：`apps/server` + `packages/{core,db,shared,sdk}`
- ✅ Oxc 工具链（oxlint + oxfmt），`pnpm check` 全绿
- ✅ TanStack Start 应用壳 + `/api/v1/health`
- ✅ Drizzle 连接层工厂 + `sites` 表
- ✅ 提交校验钩子（语义化提交 + Assisted-By）
- ✅ 已验证：生产构建产出 `.output/server/index.mjs`、SSR 正常、
  只读端点的 `PUT` 返回 **405 + `Allow`**（框架默认返回 `200 text/html`，已用 `ANY` 处理器兜住）

### 未完成

里程碑 1 的全部业务功能。下面 10 个阶段即为此展开。

---

## 2. 执行约定

> 这些约定对**每一个任务**都生效，不再在各阶段重复。

### 2.1 动手前必读（按顺序）

1. `AGENTS.md` —— 硬性约束与提交规范
2. `requirements.md` §1–§2 —— 定位与 19 项已定决策
3. `decision-log.md` —— 决策理由与连带影响
4. `development-standards.md` —— 分层、依赖注入、错误处理
5. 当前阶段引用的规格章节

### 2.2 工作方式

| 约定 | 说明 |
| --- | --- |
| **一次一个任务** | 按任务编号顺序做，不要并行铺开多个未完成任务 |
| **小步提交** | 每个任务完成后立即提交，不要把多个任务塞进一个提交 |
| **提交前跑 `pnpm check`** | typecheck + lint + format:check 三者全绿才提交 |
| **语义化提交** | `<type>(<scope>): <描述>`，scope 取自 `AGENTS.md` 白名单；结尾加 `Assisted-By` 尾注 |
| **每个阶段结束更新 §4 进度表** | 并单独提交一次 `docs(specs): 更新开发计划进度` |
| **遇到规格空白先查决策记录** | 仍无答案就**停下来问**，不要自行发明设计 |

### 2.3 红线（违反会导致返工或安全审计打回）

完整清单见 `AGENTS.md`「硬性约束」。最容易被违反的几条：

- 公开 API 一律用 **Server Route**，不用 Server Function（后者第三方根本调不通）
- 每个 API 路由必须声明 `ANY → 405 + Allow`
- **CORS 头全部自己写**（框架零支持），且**预检必须在生产构建下验证**
- 不要创建 `src/start.ts`（会静默丢失 CSRF 保护，并可能触发 issue #7460）
- 每个业务查询必须带 `site_id` 隔离
- 公开响应**显式构造**，禁止透传数据库行（否则新增敏感列时静默泄漏）
- 业务失败用 `Result` 返回，不用 `throw`；错误码 `switch` 要有 `satisfies never` 穷尽检查
- 事务边界在服务层，**事务内禁止网络 IO**
- 服务层禁止 import 任何 `@tanstack/*`

### 2.4 不要做的事

`requirements.md` §2.1 列出的「明确不做」清单**不要实现**，即使看起来很有用：

图片上传、点赞/表情反应、页面浏览量、评论置顶、私密评论、评论编辑与撤回、
评论者自助删除、实时推送、第三方反垃圾与人机验证、多语言界面、数据迁移导入。

---

## 3. 阶段总览

```
阶段 0  工程地基 ────────┬── 阶段 1  数据模型 ──┬── 阶段 3  站点域 + 公开 API 骨架 ──┬── 阶段 4  评论读写核心 ──┬── 阶段 5  审核与声誉 ──┬── 阶段 8  管理台 ── 阶段 9  SDK 与文档
                        │                      │                                    │                        │                      │
                        └── 阶段 2  渲染管线 ──┘                                    │                        │                      │
                                                                                    │                        │                      │
                                                          阶段 6  邮件与 worker ─────┴────────────────────────┤                      │
                                                          阶段 7  OIDC 认证与会话 ──────────────────────────┴──────────────────────┘
```

| 阶段 | 名称 | 前置 | 预估任务数 |
| --- | --- | --- | --- |
| 0 | 工程地基 | — | 7 |
| 1 | 数据模型 | 0 | 11 |
| 2 | 内容渲染管线 | 0 | 9 |
| 3 | 站点域 + 公开 API 骨架 | 1、2 | 7 |
| 4 | 评论读写核心 | 2、3 | 11 |
| 5 | 审核、声誉与审计 | 4 | 10 |
| 6 | 邮件通知与 outbox worker | 4 | 9 |
| 7 | OIDC 认证与会话 | 0、1 | 7 |
| 8 | 管理台 | 5、6、7 | 9 |
| 9 | SDK、OpenAPI 与部署文档 | 4、8 | 6 |

**可并行的阶段**：2 与 1 可并行（渲染管线不依赖数据模型）；6 与 7 可并行。

---

## 4. 进度追踪

> 每完成一个阶段勾选一次，并提交 `docs(specs): 更新开发计划进度`。

- [ ] 阶段 0 · 工程地基
- [ ] 阶段 1 · 数据模型
- [ ] 阶段 2 · 内容渲染管线
- [ ] 阶段 3 · 站点域 + 公开 API 骨架
- [ ] 阶段 4 · 评论读写核心
- [ ] 阶段 5 · 审核、声誉与审计
- [ ] 阶段 6 · 邮件通知与 outbox worker
- [ ] 阶段 7 · OIDC 认证与会话
- [ ] 阶段 8 · 管理台
- [ ] 阶段 9 · SDK、OpenAPI 与部署文档

---

## 阶段 0 · 工程地基

**目标**：统一配置、上下文、错误与测试基座 —— 让后续所有功能站在同一块地板上。

**前置**：无
**规格**：`requirements.md` §7.1、§7.4、§8.4；`development-standards.md` §4、§6、§8.6

### 任务

| # | 任务 | 要点 |
| --- | --- | --- |
| T0.1 | 环境配置模块 | `apps/server/src/config/env.server.ts`。用 Zod 定义并校验全部环境变量（`DATABASE_URL`、`PORT`、`LOG_LEVEL`、`SESSION_SECRET`、`OIDC_*`、`OIDC_ROLE_PREFIX`、`OIDC_ROLE_CLAIM`、`SECRETS_KEY`）。**缺失或格式错时启动即失败**并打印可读错误。**在 handler 内读取，不在模块顶层读 `process.env`** |
| T0.2 | Context 类型层次 | `apps/server/src/types/context.d.ts`，按开发规范 §4.1 定义 `BaseContext` / `DbContext` / `SiteContext` / `ActorContext` / `AdminSiteContext`，并做 `Register.server.requestContext` 模块增强 |
| T0.3 | 中间件链 | `apps/server/src/lib/middleware/`：`base`（env / requestId / logger）→ `db`（注入启动时创建的 `DbClient`）→ `site`（由 `X-Recado-Site` 解析站点）→ `origin`（按白名单 + `originPolicy` 校验）。**Server Route 用 `server.middleware`，写法与 Server Function 的 `createMiddleware({type:'function'})` 不同** —— 见开发规范 §4.3 |
| T0.4 | 统一响应与错误映射 | `apps/server/src/lib/http/`：`respond.ts`（Result → Response，错误码 → 状态码，复用 `@recado/shared` 的 `statusForReason`）、`handler.ts`（最外层 try/catch，未预期异常 → 500 + 日志含 requestId，**绝不返回堆栈**）、`methodNotAllowed.ts`（生成 `ANY → 405 + Allow`） |
| T0.5 | 测试基础设施 | Vitest 配置（根 + 各包）、真实 Postgres 测试实例（testcontainers 或 compose）、测试用 Context 工厂 |
| T0.6 | Docker 编排 | `docker/compose.yaml`：Postgres 16 + 应用，含健康检查与数据卷 |
| T0.7 | 日志模块 | pino + 请求 ID；**脱敏**：不落邮箱明文、完整 IP、Cookie、token、SMTP 密码（需要关联时记哈希或后四位） |

### 验收

- [ ] `pnpm check` 全绿
- [ ] 缺 `DATABASE_URL` 启动时失败，报错信息能直接看懂缺了什么
- [ ] 存在一个示例受保护路由，可验证：无效 site key → 统一错误信封；非白名单 Origin → 403
- [ ] 集成测试能连真实 Postgres 跑通
- [ ] `docker compose up` 后 Postgres 健康检查通过

### 已知坑

- **不要创建 `src/start.ts`**。它会让框架的 CSRF 保护静默失效，并可能触发 issue #7460
  （`node:async_hooks` 泄漏进客户端 bundle）。Server Route 用路由级 `server.middleware` 就够。
- 框架**没有任何内置 CORS 支持**，响应头全部自己写。
- 中间件的 `context` 是**累积**的：`site` 中间件要能拿到 `db`，必须先声明依赖。

---

## 阶段 1 · 数据模型

**目标**：把 `requirements.md` §5.2 的全部表落成 Drizzle schema 与可执行迁移。

**前置**：阶段 0
**规格**：`requirements.md` §5.1–§5.5

### 任务

按依赖顺序建表（每张表一个任务，含字段、约束、索引）：

| # | 表 | 关键点 |
| --- | --- | --- |
| T1.1 | `threads` | 唯一约束 `(site_id, path)`；物化计数 `comment_count` |
| T1.2 | `members` | `email` 用 `citext`；唯一约束 `(site_id, email)`；索引 `email` |
| T1.3 | `labels` + `member_labels` | 多对多关联表 —— **不是** `members.label_id` 单外键 |
| T1.4 | `comments` | 原文 `content_md` + 渲染结果 `content_html` **双存**；`search_vector` 一期不建 |
| T1.5 | `comment_mentions` | 追踪 @提及通知是否已发出 |
| T1.6 | `admins` + `sessions` | `admins` **刻意不存 `role`**（角色由 IdP 驱动）；`sessions` 存 token 哈希 |
| T1.7 | `outbox` + `unsubscribes` | `outbox.dedupe_key` 唯一，用于幂等入队 |
| T1.8 | `audit_logs` | 记录 `actor`、`action`、`target`、`diff` |
| T1.9 | 索引与约束 | 按 §5.2 各表的索引清单补齐，**不因规模小而省略** |
| T1.10 | 生成迁移 | `pnpm db:generate`，迁移文件入库 |
| T1.11 | 迁移执行脚本 | `pnpm db:migrate` 可用；**作为独立步骤执行，不在应用启动时自动跑** |

### 验收

- [ ] 空库执行迁移成功，重复执行幂等
- [ ] 表结构、约束、索引与 `requirements.md` §5.2 逐项一致
- [ ] 迁移失败时不影响已启动的应用（因为它本来就不在启动流程里）

### 已知坑

- 评论**必须**同时存原文与渲染结果。只存 HTML 会导致解析器修复后无法重渲染、
  无法对原文做检索、管理员无法按原文编辑 —— 这是 Waline 最昂贵的教训。
- 站点标识一律 UUID，不提供 slug。

---

## 阶段 2 · 内容渲染管线

**目标**：把「Markdown → 安全 HTML」做成**纯函数模块**，可脱离 HTTP 与数据库独立测试。

**前置**：阶段 0
**规格**：`requirements.md` §6 M4；`development-standards.md` §8.3

### 任务

| # | 任务 | 要点 |
| --- | --- | --- |
| T2.1 | Unified 管线 | `remark-parse` → `remark-gfm` → `remark-rehype` → `rehype-sanitize` → `rehype-stringify` |
| T2.2 | 代码高亮 | `@shikijs/rehype`，**语言包按需加载**，未知语言降级为纯文本 |
| T2.3 | 数学公式 | `rehype-mathjax`，服务端渲染 |
| T2.4 | 表情 | `:name:` 短代码 → `<img class="emoji">`；支持站点级自定义表情包 |
| T2.5 | 外链处理 | 统一加 `rel="nofollow ugc noopener noreferrer"` |
| T2.6 | @提及解析 | **在 AST 层提取**，不要用正则扫原文 |
| T2.7 | 内容长度限制 | `maxContentBytes` 硬限制 + 渲染超时保护 |
| T2.8 | 预览端点 | `POST /api/v1/render`，复用同一管线，不落库 |
| T2.9 | 单元测试 | XSS payload 集、代码块、公式、表情、外链、超长与畸形输入 |

### 验收

- [ ] 预置的 XSS payload 全部被消毒，且合法 Markdown 不被误伤
- [ ] 预览端点的输出与「落库时生成的 HTML」**逐字节一致**
- [ ] 代码高亮、公式、表情均产出预期 HTML
- [ ] 渲染耗时满足 §7.2 目标（单条 10KB < 80ms）

### 已知坑

- **只允许一条渲染管线。** 客户端不得拥有独立的 Markdown 渲染器
  （Waline 的服务端 markdown-it 与客户端 marked 会分歧，是明确教训）。
- 消毒必须在 **rehype AST 层**用 `rehype-sanitize`，不要在字符串上做替换。
- @提及用正则实现会被代码块里的 `@` 骗到，必须走 AST。

---

## 阶段 3 · 站点域 + 公开 API 骨架

**目标**：打通「第三方站点跨域调用我们」这条链路。

**前置**：阶段 1、阶段 2
**规格**：`requirements.md` §6 M1、§6 M8；`decision-log.md` Q-12

### 任务

| # | 任务 | 要点 |
| --- | --- | --- |
| T3.1 | sites 三件套 | `sites.schema.ts` / `sites.data.ts` / `sites.service.ts`；**Repo 的 `siteId` 参数位置固定**（紧跟 `db`） |
| T3.2 | site key | 生成（`rc_` + 随机）与轮换 |
| T3.3 | 来源白名单匹配 | 精确域 + `*.example.com` 通配 |
| T3.4 | CORS | 动态回显 `Access-Control-Allow-Origin`；`OPTIONS` 预检；`Allow-Headers` 含 `X-Recado-Site` / `Content-Type` / `Idempotency-Key` |
| T3.5 | 公开 API 路由骨架 | 统一 `ANY → 405 + Allow`，统一错误信封 |
| T3.6 | CLI `site:create` | 管理台就绪前用于 bootstrap，输出 site key |
| T3.7 | `GET /api/v1/config` | 返回站点公开配置（深度、表情包、字数限制、必填字段） |

### 验收

- [ ] 一个**独立来源**的页面能跨域调用成功（用 curl 模拟第三方 Origin）
- [ ] 非白名单 Origin 被拒；无来源头时按站点 `originPolicy` 分别表现 403 / 放行
- [ ] `PUT` 只读端点返回 **405 + `Allow`**
- [ ] **在生产构建下**验证 CORS 预检返回正确的 `Access-Control-Allow-Origin`

### 已知坑

- **CORS 预检必须在生产构建下测。** `vite dev` 会拦截 `OPTIONS` 并绕过你的处理器，
  只测 dev 会得出错误结论。
- 未匹配的方法不会自动返回 405，而是落到路由层返回 `200 text/html`（SSR 外壳）。
- `site key` 是**公开标识，不是密钥**。来源校验挡不住有意的服务端伪造，
  真正的防线是限流 + 人工审核 —— 不要制造虚假安全感。

---

## 阶段 4 · 评论读写核心

**目标**：一个真实博客可以把评论系统切过来并正常运转。

**前置**：阶段 2、阶段 3
**规格**：`requirements.md` §6 M2、§6 M3、§5.4；`decision-log.md` Q-02～Q-05

### 任务

| # | 任务 | 要点 |
| --- | --- | --- |
| T4.1 | members 归并 | 邮箱规范化（trim + 小写 + citext），同站同邮箱 upsert 同一档案 |
| T4.2 | threads upsert | 评论写入时同步维护 `comment_count` / `last_comment_at` |
| T4.3 | 发表评论 | 全套校验 → 状态判定 → 渲染 → **单事务写入** |
| T4.4 | 回复 | `rootId` 推导、`maxDepth` 限制（超出挂到允许的最深祖先）、`replyToMember` |
| T4.5 | 列表查询 | `sort=latest\|oldest`、分页、每条顶层评论内联前 N 条回复 + `hasMoreReplies` |
| T4.6 | 回复分页端点 | 完整回复独立拉取，**不受顶层分页限制** |
| T4.7 | 批量评论数 | 一次查询多个 path |
| T4.8 | 最近评论 | 跨 path，供侧边栏组件 |
| T4.9 | 线程元信息 | 单篇文章的评论数与最近评论时间 |
| T4.10 | 限流 | 同 IP 同站点最小间隔（**属于可用性保护，不是反垃圾**） |
| T4.11 | 公开响应白名单 | 显式构造返回对象，**禁止透传数据库行** |

### 验收

- [ ] 端到端：发表 → 列表 → 回复 → 计数正确
- [ ] 公开响应断言**不含** `email` / `ip` / `user_agent`
- [ ] **跨站点隔离测试**：用 A 站 site key 读写 B 站数据必须失败
- [ ] 回复分页在热门评论下正常工作（顶层分页与回复分页互不干扰）
- [ ] 邮箱为必填，缺失返回校验错误而非降级处理

### 已知坑

- **回复不能一次性全量加载**（Waline 的实现缺陷：热门文章的回复既无法分页也无法懒加载）。
- 删除顶层评论**不级联**，子回复保留并显示「该评论已删除」占位（Q-04）。
- 邮箱**必填且站点不可关**（Q-02），不要加开关。

---

## 阶段 5 · 审核、声誉与审计

**目标**：站长能高效处理待审评论，且「标记垃圾」有可预期的连带效果。

**前置**：阶段 4
**规格**：`requirements.md` §5.4、§5.5、§6 M5；`decision-log.md` Q-03

### 任务

| # | 任务 | 要点 |
| --- | --- | --- |
| T5.1 | 评论状态机 | `approved` / `pending` / `spam` / `deleted`，含合法转移校验 |
| T5.2 | 审核模式 | 站点级 `none` / `first_time` / `all` |
| T5.3 | 标记垃圾的原子副作用 | §5.5 的五步在**单事务**内完成 |
| T5.4 | 邮箱声誉 | `spam_count` / `review_required`；恢复为 approved 时**对称回滚** |
| T5.5 | 管理端评论列表 | 按站点 / 路径 / 状态 / 关键词 / 时间范围筛选 |
| T5.6 | 批量操作端点 | 服务端批量端点，**单事务 + 部分失败明细** |
| T5.7 | 管理员编辑评论 | 改**原文**后重新渲染（双存设计使这成为可能） |
| T5.8 | 删除 | 默认不级联，子回复保留占位 |
| T5.9 | 审计日志 | 记录所有管理写操作 |
| T5.10 | 关键词检索 | 基于原文检索，一期用 `ILIKE`（`tsvector` 属 P1） |

### 验收

- [ ] 标记垃圾后，该邮箱在本站点的**下一条**评论自动进入 `pending`
- [ ] 恢复为 approved 后，声誉计数与线程计数**对称回滚**
- [ ] 批量操作部分失败时返回明细，且不留下部分写入
- [ ] 关键词检索匹配的是**原文**，不是渲染后的 HTML

### 已知坑

- 批量操作**不要**对单条端点做 `Promise.all` 扇出（Waline 的做法：无批处理、
  无事务、无部分失败处理）。
- 声誉是**站点级**的（Q-03），不要做成实例级。

---

## 阶段 6 · 邮件通知与 outbox worker

**目标**：评论写入不被发信阻塞，且通知可追溯、可重发、可退订。

**前置**：阶段 4
**规格**：`requirements.md` §6 M6；`decision-log.md` Q-10

### 任务

| # | 任务 | 要点 |
| --- | --- | --- |
| T6.1 | 站点级 SMTP 配置 | 每站独立配置；**密码加密存储**，读接口只回显「是否已配置」 |
| T6.2 | 模板系统 | 内置模板 + 变量替换；集中管理 |
| T6.3 | outbox 入队 | **事务提交后**写入；`dedupe_key` 保证幂等 |
| T6.4 | worker | 模块级 `setInterval` 轮询，`FOR UPDATE SKIP LOCKED` 保证并发安全；**单条失败不中断整个循环** |
| T6.5 | 外部触发端点 | 受保护的 `POST /internal/outbox/drain`，便于 cron / sidecar |
| T6.6 | SMTP 投递 | Nodemailer，按站点取配置 |
| T6.7 | 退订 | 每封邮件带 token 链接；退订后该邮箱在该站点不再收信 |
| T6.8 | 通知类型 | 站长新评论通知、回复通知（@提及通知属 P1） |
| T6.9 | 发信测试 | 后台一键发送测试邮件，即时反馈 SMTP 错误 |

### 验收

- [ ] **SMTP 不可用时评论发布仍然成功**（异步化生效）
- [ ] 失败任务记录错误并可按指数退避重试，超限后可在后台重发
- [ ] 退订链接生效，且退订后不再收到该站点的邮件
- [ ] 单条邮件投递失败不阻断同批次其他邮件

### 已知坑

- Waline 在评论写入请求内**串行 await 所有通知渠道**，直接导致发评论变慢。
  我们必须异步化 —— 这是 M6 的核心价值。
- 退订 token 要不可猜测且长期有效（每封邮件都带，不设过期）。

---

## 阶段 7 · OIDC 认证与会话

**目标**：管理台能登录，且权限完全由 IdP 角色驱动。

**前置**：阶段 0、阶段 1
**规格**：`requirements.md` §3；`decision-log.md` Q-06、Q-07、Q-08、Q-16、Q-17、Q-18

### 任务

| # | 任务 | 要点 |
| --- | --- | --- |
| T7.1 | OIDC 客户端 | `openid-client`；discovery + Authorization Code + PKCE + state/nonce + JWKS 校验 |
| T7.2 | 角色解析 | `<前缀>.OWNER` = 实例管理员；`<前缀>.ADMIN.<站点UUID>` = 站点管理员。claim 路径可配（默认 `roles`，兼容 `groups` 与 Keycloak 嵌套）。**无匹配角色 → 拒绝登录且不建会话** |
| T7.3 | 会话 | 不透明 token 存 DB 哈希；`HttpOnly` + `Secure` + `SameSite=Lax`；可过期、可吊销 |
| T7.4 | `actor` 中间件 | 会话 Cookie（浏览器）或 OIDC Bearer（client credentials，供脚本 / CI）。**管理端点不检查来源头** |
| T7.5 | `siteScope` 中间件 | 校验主体对目标站点有权限 —— 「已登录」不等于「可访问任意站点」 |
| T7.6 | CSRF | 管理端写操作校验 `Origin` + CSRF token 双重提交。**Server Route 不受框架 CSRF 保护** |
| T7.7 | 诊断 CLI | 打印本次登录解析到的角色与可见站点，用于排查「首次部署锁死」 |

### 验收

- [ ] 无匹配角色的用户登录被拒，且**不产生会话**
- [ ] `ADMIN.<siteA>` 角色的账号无法访问 siteB 的数据
- [ ] 脚本通过 client credentials 取得 token 后可调用管理 API
- [ ] 会话可被吊销，吊销后立即失效
- [ ] **不回显 `oidc_subject` 等内部标识给非管理员**

### 已知坑

- **首次部署锁死风险**：若 IdP 侧角色没配好，任何人都进不来，且没有环境变量兜底（Q-17）。
  部署文档必须把「先在 IdP 创建 `PREFIX.OWNER` 角色并授予自己」列为第一步前置条件，
  T7.7 的诊断 CLI 就是为此准备的安全网。
- 站点标识用 **UUID**（Q-16），角色名里写 UUID 不是 slug。
- Waline 的 JWT 永不过期且不可吊销 —— 我们用服务端会话，不要重蹈覆辙。

---

## 阶段 8 · 管理台

**目标**：站长日常审核、站点配置、标签管理都能在浏览器里完成。

**前置**：阶段 5、6、7
**规格**：`requirements.md` §6 M7；`development-standards.md` §9

### 任务

| # | 任务 | 要点 |
| --- | --- | --- |
| T8.1 | `_authed` 布局路由 | `beforeLoad` 处理登录态 UX。**它不是安全边界**，真正的校验在服务端中间件 |
| T8.2 | 仪表盘 | 站点选择器 + 待审 / 垃圾计数 + 今日新增 + 最近评论 |
| T8.3 | 评论管理 | 筛选、排序、**线程视图**、单条操作、批量操作（含部分失败明细） |
| T8.4 | 站点管理 | CRUD、key 轮换、域名白名单、站点配置表单、SMTP 配置 |
| T8.5 | 成员与标签管理 | 邮箱列表、搜索、标签指派、解除待审 |
| T8.6 | 邮件管理 | 模板预览、发信测试、投递日志、退订列表 |
| T8.7 | 审计日志界面 | 查询与筛选 |
| T8.8 | 来源校验自检工具 | 展示最近被拒绝的 Origin，用于排查白名单误配 |
| T8.9 | 交互规范 | 破坏性操作二次确认 + 明示影响范围；**禁止 `prompt()` / `confirm()`** |

### 验收

- [ ] 全流程可**仅用键盘**完成一次评论审核
- [ ] 批量删除前显示「将删除 N 条评论」
- [ ] 站点切换后所有列表数据正确刷新（queryKey 含 `siteId`）
- [ ] 无 hydration mismatch（时间等不确定内容用 `<ClientOnly>` 包裹）

### 已知坑

- **loader 是同构的**（SSR 与客户端导航都会执行），**绝不在 loader 里直接访问数据库或读密钥**，
  一律通过 Server Function。
- Waline 管理台的明确缺陷：无路径/站点筛选、无配置界面、管理员回复后 `location.reload()`。
  这些都要避开。

---

## 阶段 9 · SDK、OpenAPI 与部署文档

**目标**：第三方能自助接入，运维能自助部署。

**前置**：阶段 4、阶段 8
**规格**：`requirements.md` §6 M9、§6 M10、§9 里程碑 1 第 9 项

### 任务

| # | 任务 | 要点 |
| --- | --- | --- |
| T9.1 | OpenAPI 3.1 | 由 Zod schema 自动生成 + 可交互文档页；**与实际 API 保持一致** |
| T9.2 | `@recado/client` | 实现全部公开端点；类型化错误；可注入 `fetch`；支持 `AbortSignal` |
| T9.3 | Dockerfile | 多阶段构建，非 root 运行，体积精简 |
| T9.4 | 部署指南 | 含 ZITADEL 接入、SPF/DKIM/DMARC 指引、**威胁模型说明**（site key 不是密钥） |
| T9.5 | CLI 收尾 | `admin:grant` / `comment:rerender` / `outbox:retry` |
| T9.6 | 优雅停机 | 停止接收 → 等待在途请求 → 关闭连接池 |

### 验收

- [ ] `docker compose up` 全新环境可跑通（含迁移）
- [ ] SDK 能完成发表、列表、回复、计数四个核心操作
- [ ] OpenAPI 文档与实际 API 逐项一致
- [ ] 部署文档能让人从零完成一次部署，包括 IdP 侧配置

---

## 5. 全局风险

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| **TanStack Start 尚未发布 1.0.0**（`1.168.x`，文档仍标 RC，底层依赖 `h3` 的 RC 版本） | 高 | 锁定精确版本；升级独立成 PR 并跑完整回归；领域逻辑全部在 `packages/core`，必要时可换框架 |
| 框架 issue #7460：CSRF 中间件可能把 `node:async_hooks` 泄漏进客户端 bundle | 中 | **不创建 `src/start.ts`** 即可规避；确需全局中间件时先验证该 issue |
| CORS 预检在 dev 与生产行为不一致 | 中 | 预检纳入**生产构建**的自动化测试 |
| 无验证码无第三方反垃圾，垃圾评论直接入库 | 中 | Q-11 已确认不预留。靠邮箱声誉、批量操作、限流兜底；被刷需改造数据模型 |
| 首次部署因 IdP 角色未配好而完全锁死 | 中 | 部署文档把配置角色列为第一步前置；提供 T7.7 诊断 CLI |
| `oxfmt` 仍是 0.x（Beta） | 低 | 升级独立成 PR；它已通过 Prettier 全部 JS/TS 一致性测试 |
| 邮件进垃圾箱 | 中 | 部署文档给 SPF/DKIM/DMARC 指引；提供发信测试工具 |

---

## 6. 完成定义（Definition of Done）

阶段 0–9 全部勾选后，`requirements.md` §11 的验收标准应全部满足。逐条复核：

- [ ] 全新环境 `docker compose up` 后应用与数据库正常启动，`/readyz` 返回 200
- [ ] 在 ZITADEL 中创建并授予 `PREFIX.OWNER` 角色后可登录管理台；无角色用户被拒绝且不产生会话
- [ ] 持有 `PREFIX.ADMIN.<站点 UUID>` 角色的账号只能看到被授权的站点
- [ ] 脚本通过 client credentials 取得 access token 后可调用管理 API
- [ ] 创建站点后拿到 site key（站点标识为 UUID，后台展示名为 `name`）
- [ ] 用一个真实的静态博客页面通过 SDK/HTTP 成功发表、拉取、回复评论
- [ ] Markdown、表情、Shiki 代码高亮、MathJax 公式在服务端正确渲染，XSS 载荷被 `rehype-sanitize` 消毒
- [ ] 后台可按站点 / 路径 / 状态 / 关键词筛选评论，并完成批量通过、标记垃圾、删除
- [ ] 将某条评论标记为垃圾后，该邮箱在本站点的下一条评论自动进入待审核
- [ ] 邮箱标签能在评论 API 响应中返回并正确展示
- [ ] 在后台按站点配置 SMTP 后，发表评论可触发站长与父评论作者的邮件；退订链接可用且生效
- [ ] SMTP 不可用时评论发布仍然成功，失败任务可在后台重发
- [ ] 跨域请求按站点域名白名单放行/拒绝；无来源头请求按 `originPolicy` 分别表现 403 与放行
- [ ] 对只读端点发送 `PUT` 返回 **405 + `Allow` 头**，而不是 `200 text/html`
- [ ] **在生产构建下**验证 CORS 预检返回正确的 `Access-Control-Allow-Origin`
- [ ] OpenAPI 文档与实际 API 完全一致
- [ ] 核心领域逻辑单元测试与 API 集成测试通过
- [ ] 部署指南、OIDC（ZITADEL）接入指南、API 文档齐备
