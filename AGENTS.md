# AGENTS.md

面向在此仓库工作的 AI 编码代理。**先读完本文件再动手。**

---

## 项目与当前阶段

**Recado** —— 自托管、多站点、Headless 的评论系统。Node.js + TanStack Start + PostgreSQL。

> ✅ **里程碑 1「可用内核」已完成**（`.specs/development-plan.md` 阶段 0–9，逐条验收通过）。
> 评论读写、渲染管线、审核与声誉、OIDC 登录、管理台、邮件通知、SDK、OpenAPI
> 都已落地并有测试覆盖（357 项）。**动手前先确认代码是否真的存在，不要假设某功能没写。**
>
> 下一步工作的入口仍然是 [`.specs/development-plan.md`](./.specs/development-plan.md)：
> §4 是进度追踪，§6 是完成定义与**已记录的规格偏差**（改代码前先看那几条，别把有意的
> 取舍当成 bug 修回去）。里程碑 2 的范围见 `requirements.md` §9。

**现状速览**

| 区域 | 位置 |
| --- | --- |
| 领域逻辑（无框架依赖） | `packages/core/src/features/<feature>/` |
| 数据库 schema 与迁移 | `packages/db/src/schema/`、`packages/db/drizzle/` |
| API 契约（Zod 单一真源） | `packages/shared/src/schemas/` |
| SDK | `packages/sdk/src/client.ts` |
| 公开 API / 管理 API / 管理台 | `apps/server/src/routes/` |
| 中间件、OIDC、会话、worker | `apps/server/src/lib/` |
| 启动期任务（环境校验 / 停机 / worker） | `apps/server/server/plugins/` |
| 运维 CLI | `apps/server/scripts/cli.ts` |
| 测试 | 单元测试贴着源码；集成与生产构建 HTTP 测试在 `apps/server/tests/` |

---

## 动手前必读

按顺序读，不要跳：

| # | 文档 | 读什么 |
| --- | --- | --- |
| 0 | [`.specs/development-plan.md`](./.specs/development-plan.md) | **执行入口**：阶段划分、进度、执行约定、红线、§6 的偏差记录 |
| 1 | [`.specs/requirements.md`](./.specs/requirements.md) §1–§2 | 定位与 19 项已定决策（D1–D19） |
| 2 | [`.specs/decision-log.md`](./.specs/decision-log.md) | 19 项决策的**理由**与连带影响 |
| 3 | [`.specs/requirements.md`](./.specs/requirements.md) §5–§6 | 领域模型、站点配置、功能模块 M1–M10 |
| 4 | [`.specs/development-standards.md`](./.specs/development-standards.md) | 分层、依赖注入、错误处理、评审清单 |
| 5 | [`docs/deployment.md`](./docs/deployment.md) | 部署形态、威胁模型与运维约束（改行为前先看它承诺了什么） |
| 6 | 研究资料（按需查） | `.specs/research/` 下的两份报告 |

**不要凭常识推断本项目的做法。** 多个关键决策与「主流做法」相反，
且都有明确的、经实测或源码核实的理由。有疑问先查决策记录，再问人。

---

## 硬性约束

以下每一条都对应一个**会返工或被安全审计打回**的坑。违反前请先确认你真的理解代价。

### 架构

| 约束 | 原因 |
| --- | --- |
| **公开 API 一律用 Server Route，不用 Server Function** | Server Function 有 4 重阻断（CSRF 403 / seroval 500 / 缺 `x-tsr-serverFn` 500 / 响应为 seroval 信封），**第三方站点根本无法调用**。详见 `requirements.md` §8.2 的实测表 |
| **每个 API 路由都要声明 `ANY` 处理器返回 405 + `Allow`** | 未匹配的方法不会返回 405，而是落到路由层返回 `200 text/html`（SSR 应用外壳）。用 `lib/http/method-not-allowed.ts`，并让 `tests/http` 的端点矩阵覆盖它 |
| **CORS 头必须自己写，框架没有任何内置支持** | 全局源码检索无匹配。且 **dev 与生产预检行为不一致**——`vite dev` 会绕过你的 `OPTIONS` 处理器，**预检必须在生产构建下验证**（`apps/server/tests/http` 跑的就是 `.output` 产物） |
| **不要创建 `src/start.ts`，除非确有需要** | 创建它会**静默丢失框架的 CSRF 保护**，且可能触发 issue #7460（`node:async_hooks` 泄漏进客户端 bundle）。启动期任务一律走 `apps/server/server/plugins/`（Nitro 运行时插件） |
| **TanStack 相关依赖锁定精确版本，升级独立成 PR** | 框架尚未发布 1.0.0，1.x 线已迭代 700+ 次发布，底层依赖 `h3` 的 RC 版本 |
| **`verbatimModuleSyntax` 必须保持关闭** | 官方文档明确说明开启它可能导致服务端产物泄漏进客户端 bundle |
| **`.inputValidator()` 已废弃，用 `.validator()`** | 该 API 已标记 `@deprecated`。Zod 可直接传入，无需适配器 |

### 分层与依赖

| 约束 | 原因 |
| --- | --- |
| **依赖方向严格单向向下**：接口层 → 服务层 → 数据层 | 反向依赖一律禁止 |
| **服务层禁止 import 任何框架 API**（`@tanstack/*`、HTTP 类型） | 这条纪律保证 `packages/core` 能脱离框架测试，也是「框架可替换」风险对策的落地方式 |
| **依赖通过 context / 参数显式传入，禁止在函数内取全局单例** | 判断标准：函数能否在不启动数据库、不发真实请求的前提下被测试。组合根只有三处：`lib/db.server.ts`、中间件、`scripts/cli.ts` |
| **Drizzle 查询只能写在 `*.data.ts`** | 服务层不得出现 `.select()` / `.insert()` |
| **Repo 函数收 `DbExecutor`（连接池或事务），不是 `Database`** | 同一个函数要能在事务内被服务层复用、也能单独调用，否则每个写操作都要写两份签名 |
| **事务边界在服务层，事务内禁止网络 IO** | 发邮件、调 IdP 必须放到事务提交之后（通知入队即遵循此规则） |
| **loader 是同构的（SSR 与客户端都会执行）** | **绝不在 loader 里直接访问数据库或读密钥**，一律通过 `lib/admin/*.functions.ts` 的 Server Function |

### 多租户与安全

| 约束 | 原因 |
| --- | --- |
| **每个业务查询都必须带 `site_id` 隔离** | Repo 函数的 `siteId` 参数位置固定（紧跟 `db`），便于评审时一眼看出遗漏。跨站点数据泄漏是这类系统最典型的事故 |
| **公开 API 响应禁止包含 `email` / `ip` / `user_agent` / 任何密钥** | 响应对象必须**显式构造**（`toPublicComment` / `toAdminComment` / `toPublicSiteConfig`），禁止把数据库行直接透传 |
| **评论只经服务端 Unified.js 管线渲染，渲染后必须过 `rehype-sanitize`** | 客户端**禁止**拥有独立的 Markdown 渲染器（Waline 的双管线分歧是明确教训） |
| **Server Route 默认不受 CSRF 保护** | 框架的 CSRF 中间件只过滤 Server Function。管理端写操作走 `csrfMiddleware`（Origin + 双重提交），且**只对 Cookie 认证生效**——Bearer 没有浏览器自动携带凭证的问题 |
| **站点标识一律使用 UUID** | 不提供 slug（决策 D17）。`sites.name` 仅作后台展示，不参与任何标识、URL 或授权 |
| **管理端也必须校验主体对目标站点的权限** | 「已登录」不等于「可访问任意站点」。`siteScopeMiddleware`（Server Route）与 `admin.functions.ts` 的 `assertSite`（Server Function）都要判 |
| **登录 / 回调 / 登出三条路由不得挂 actor / siteScope / CSRF 中间件** | 此刻还没有会话与 CSRF Cookie，挂上会导致永远无法登录 |
| **日志禁止出现邮箱明文、完整 IP、Cookie、token、SMTP 密码** | 需要关联时记哈希或后四位（`lib/redact.server.ts`） |

### 错误处理

| 约束 | 原因 |
| --- | --- |
| **业务失败用 `Result` 返回，不用 `throw`** | TS 的 `catch (e)` 中 `e` 是 `unknown`，且「谁抛了什么」不写在签名里——新增错误而忘记处理时编译不会报错 |
| **错误码 `switch` 必须有 `satisfies never` 穷尽检查** | 这是 `Result` 模式的核心收益：新增错误忘记处理会编译失败 |
| **`try/catch` 只用于边界**：路由最外层、worker 循环、外部 IO | 网络失败与 JSON 解析失败是**预期**的，用 `Result` 包装 |
| **绝不把堆栈或数据库原始错误返回给客户端** | 可能泄漏表结构与数据 |

---

## 实现期的实测结论（改这几处之前先读）

这些是踩过之后写进代码注释的坑，重犯代价很高：

| 位置 | 结论 |
| --- | --- |
| Context 类型 | **不做 `Register.server.requestContext` 模块增强**：框架读取的 `Register` 定义在 `@tanstack/router-core`，且 Node 入口不传 request context。Context 类型由**中间件链推导**，漏挂 `baseMiddleware` 会直接编译失败 |
| Server Function 中间件 | 它的 `server()` 形参里**没有 `request`**，要用 `getRequest()`（h3 事件）取；因此 `actorFunctionMiddleware` 是自包含的，与 `actorMiddleware` 共用 `resolveActorFromRequest` |
| 渲染顺序 | **MathJax 必须排在 Shiki 之前**：块级公式经 remark-rehype 会变成 `<pre><code class="language-math">`，与代码块同形，Shiki 先跑会把它吃掉 |
| Shiki | **不能用 Oniguruma WASM**（Nitro 的 wasm/unwasm 导出条件会让服务端构建失败，已在 `vite.config.ts` 关掉）；改用 JS 正则引擎，语言走白名单按需加载 |
| Shiki 别名 | 别名（`js`/`py`/`sh`…）必须自己改写成规范名，**不能交给 `langAlias`**——它会让 `getLoadedLanguages()` 提前把别名报成已加载，破坏懒加载分支 |
| 消毒位置 | `rehype-sanitize` 在「用户内容转换之后、可信插件之前」，白名单只需补两条固定字面量（`img.className=emoji`、`a.rel`） |
| clientIp | 只认反向代理头会让**没有代理头的部署静默不限流**；现在是「代理头 → 框架取的 socket 地址」两级兜底，且 IP 只用于限流与展示，绝不用于鉴权 |
| 邮箱归并 | 大小写由 `citext` + `normalizeEmail` 处理；**不要**做「去掉 Gmail 点号」这类归一 |
| 通知 | 入队必须在**事务提交之后**；「自己回复自己」用**邮箱**判定而不是昵称 |
| 测试产物 | `apps/server/tests/http` 会拉起 `.output` 产物，**产物过期会自动重建**——改了源码后不必手动 build，但也别指望它测的是 dev 行为 |
| Nix 打包 | 改了 `pnpm-lock.yaml` 或 pnpm 大版本后必须同步 `nix/pnpm-deps-hash.nix` 的依赖哈希（漏改会以 `hash mismatch` 明确报错，不会静默出错）。`nix/recado-migrate.mjs` 用的是 drizzle-orm 运行时迁移器，与 `drizzle-kit migrate` 是同一套代码，改迁移行为时两边都要照顾 |

---

## 提交规范（强制）

> ⚠️ **语义化格式、scope 白名单、标题长度由 `.githooks/commit-msg` 强制校验，不合规会被直接拒绝。**
> **Assisted-By 尾注缺失不拦截**，只在你填写时校验格式。
> 钩子通过 `core.hooksPath=.githooks` 启用。新克隆的仓库若钩子未生效，执行：
> `git config core.hooksPath .githooks`
>
> **不要用 `--no-verify` 绕过。** 确有特殊情况时，在 PR 描述里说明理由。

### 1. 语义化提交

所有提交一律写作 `<type>(<scope>): <描述>`。

**type** 必须是下列之一：

| type | 用于 | type | 用于 |
| --- | --- | --- | --- |
| `feat` | 新功能 | `build` | 构建系统与依赖 |
| `fix` | 缺陷修复 | `ci` | CI 配置 |
| `refactor` | 重构（外部行为不变） | `chore` | 杂项维护 |
| `perf` | 性能优化 | `style` | 格式调整 |
| `docs` | 文档 | `revert` | 回滚 |
| `test` | 测试 | | |

**scope** 可省略；若填写，必须取自这个白名单：

```
comments  threads   sites    members  labels   moderation  notifications
rendering auth      db       api      sdk      admin       docker
ci        deps      docs     specs    hooks    repo
```

需要新 scope 时，**同时**更新 `.githooks/commit-msg` 的白名单与本表。

**标题 ≤ 100 字符**，细节写正文。破坏性变更在 type 后加 `!`（如 `refactor!:`），
并在正文用 `BREAKING CHANGE:` 说明。

### 2. Assisted-By 尾注（Agent 必须添加，钩子不拦截缺失）

**凡有 AI Agent 参与的提交——哪怕只参与了一部分——都必须注明所用工具与模型。**

> ⚠️ 这是对 Agent 的**约定要求**，不是钩子的拦截项：
> **漏写不会被拒绝，写错格式会被拒绝。** 所以别指望钩子提醒你补上。

格式为 `<工具名> (<模型 ID>)`，写在正文之后、**空一行**：

```
Assisted-By: DeepSeek Harness (deepseek-flash)
```

| 要求 | 说明 |
| --- | --- |
| **工具名与模型缺一不可** | 只写 `Assisted-By: DeepSeek Harness` 会被钩子拒绝 |
| **多个 Agent 写多行** | 主 Agent + 子 Agent 协作时逐行列出 |
| **不需要时可以省略** | 纯人类提交可不写；也可显式写 `Assisted-By: none` |
| **尾注前必须空一行** | 否则 git 不将其识别为尾注块（钩子有行扫描兜底，但请按规范写） |

提交时用多个 `-m` 确保空行，例如：

```bash
git commit -m "feat(comments): 支持多级回复分页" \
           -m "回复数超过 repliesPreview 时返回 hasMoreReplies。" \
           -m "Assisted-By: DeepSeek Harness (deepseek-flash)"
```

### 3. 完整示例

```
feat(moderation): 标记垃圾后自动降级该邮箱声誉

将评论标记为 spam 时，在同一事务内递增 members.spam_count，
达到站点阈值后置 review_required，使该邮箱后续评论进入待审核。
恢复为 approved 时对称回滚。

Assisted-By: DeepSeek Harness (deepseek-flash)
```

### 4. 提交粒度

一个提交只做一件事；**重构与功能变更不要混在一起**；框架升级独立成提交
（见上文版本锁定约束）。提交前确保 `pnpm check` 全绿。

---

## 常用命令

```bash
pnpm install            # 安装依赖
pnpm dev                # 启动开发服务器
pnpm build              # 生产构建 → apps/server/.output
pnpm typecheck          # tsc --noEmit（全部工作区包）
pnpm lint               # oxlint（含类型感知规则）
pnpm lint:fix           # oxlint --fix
pnpm format             # oxfmt（含 import 排序与 Tailwind 类排序）
pnpm format:check       # 只检查不写入
pnpm check              # typecheck + lint + format:check，提交前跑这个
pnpm test               # 单元 + 集成 + 生产构建 HTTP 测试
                        # 集成测试连真实 Postgres，需先起库：
                        # docker compose -f docker/compose.yaml up -d postgres
pnpm db:generate        # 生成 Drizzle 迁移
pnpm db:migrate         # 执行迁移（独立步骤，不在应用启动时跑）

pnpm cli site:create --name "..." --origin https://...   # 创建站点并签发 site key
pnpm cli admin:grant --owner | --site <UUID>             # 打印 IdP 角色名（本系统不存授权）
pnpm cli auth:diagnose --token <token> | --roles a,b     # 诊断角色与可见站点
pnpm cli comment:rerender --site <UUID> [--dry-run]      # 用当前管线重放历史评论 HTML
pnpm cli outbox:retry --site <UUID> [--id <id>]          # 重发失败邮件
```

**Lint 与格式化统一用 Oxc 工具链**（`oxlint` + `oxfmt`），不引入 ESLint / Prettier。
`oxfmt` 已内置 import 排序与 Tailwind 类排序，**不要手工调整 import 顺序或类名顺序**，
运行 `pnpm format` 即可。

**数据库迁移作为独立部署步骤执行**，不要在应用启动时自动迁移——
框架没有启动生命周期钩子，且迁移失败会污染启动流程。

**启动期任务**（环境变量校验、outbox worker、优雅停机）挂在
`apps/server/server/plugins/`，并在 `vite.config.ts` 的 `nitro({ plugins })` 中显式登记
（Nitro v3 的 `serverDir` 默认关闭，不会自动扫描）。

---

## 约定速查

完整版见 [`.specs/development-standards.md`](./.specs/development-standards.md)。

| 对象 | 约定 |
| --- | --- |
| 文件 | kebab-case；`*.data.ts` / `*.service.ts` / `*.schema.ts` / `*.errors.ts` / `*.server.ts` / `*.functions.ts` |
| 类型、Zod schema、组件 | PascalCase |
| 函数、变量 | camelCase |
| 错误码、常量 | SCREAMING_SNAKE |
| 数据库表 / 列 | snake_case（表名复数） |
| 成功响应 | `{ data: T }`；失败 `{ error: { reason, message, details? } }` |
| 公开端点 | 请求头 `X-Recado-Site: <site key>` + 来源校验（`corsMiddleware` → `originMiddleware`） |
| 管理端点 | 会话 Cookie 或 `Authorization: Bearer` + `X-Recado-Site-Id: <站点 UUID>`；写操作另需 `X-Recado-CSRF-Token` |
| 提交信息 | Conventional Commits + `Assisted-By` 尾注 —— 详见上文「提交规范（强制）」 |

---

## 不要做的事

- ❌ 不要引入新的功能，即使它「看起来很有用」——被排除的功能清单见 `README.md` 与决策 Q-01、Q-11。
- ❌ 不要为了省事让所有函数都收 `AdminSiteContext`——依赖声明要精确到最低层级。
- ❌ 不要手写与 Zod schema 重复的 `interface`——用 `z.infer` 推导。
- ❌ 不要使用 `any`、非空断言 `!`、`as` 强制断言（**包括测试里的 `catch` 收窄与 fetch 桩**：用类型守卫或 Zod）。
- ❌ 不要用 `prompt()` / `confirm()` 做输入与确认（Waline 管理台的明确缺陷）。管理台的破坏性操作一律用 `ConfirmDialog` 并**明示影响范围**。
- ❌ 不要在功能 PR 里顺手升级框架版本。
- ❌ 不要直接照搬 `.specs/research/` 里参考文章的代码——那些写法部分已过时，
  取舍说明见 `development-standards.md` §13。
- ❌ 不要把 `.specs/development-plan.md` §6 记录的偏差当成 bug「修回去」——那几条都是实测驱动的有意取舍。

---

## 文档维护

- 需求或决策变更时，**同步更新 `requirements.md` 与 `decision-log.md`**，不要只改一处。
- 新决策追加到 `decision-log.md`，编号顺延（当前到 `Q-19`）。
- 完成一个阶段后，勾选 `.specs/development-plan.md` §4 的进度与对应验收项，
  并**单独提交**一次 `docs(specs): 更新开发计划进度`。
- 规格与实现出现不可调和的冲突时：**优先改规格并说明理由**，不要默默偏离；
  偏差要写进 `development-plan.md` §6 的偏差表。
- 发现规范不合理时，**改规范而不是默默违反**——并在 PR 里说明理由。
