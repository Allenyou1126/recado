# AGENTS.md

面向在此仓库工作的 AI 编码代理。**先读完本文件再动手。**

---

## 项目与当前阶段

**Recado** —— 自托管、多站点、Headless 的评论系统。Node.js + TanStack Start + PostgreSQL。

> ⚠️ **当前处于设计阶段，仓库内还没有任何实现代码。**
> 你的任务通常是从 `.specs/` 出发搭建骨架或实现某个模块，而**不是**去修改一个已有的代码库。
> 如果被要求「修 bug」，先确认代码是否真的存在。

---

## 动手前必读

按顺序读，不要跳：

| # | 文档 | 读什么 |
| --- | --- | --- |
| 1 | [`.specs/requirements.md`](./.specs/requirements.md) §1–§2 | 定位与 19 项已定决策（D1–D19） |
| 2 | [`.specs/decision-log.md`](./.specs/decision-log.md) | 18 项决策的**理由**与连带影响 |
| 3 | [`.specs/requirements.md`](./.specs/requirements.md) §5–§6 | 领域模型、站点配置、功能模块 M1–M10 |
| 4 | [`.specs/development-standards.md`](./.specs/development-standards.md) | 分层、依赖注入、错误处理、评审清单 |
| 5 | 研究资料（按需查） | `.specs/research/` 下的两份报告 |

**不要凭常识推断本项目的做法。** 多个关键决策与「主流做法」相反，
且都有明确的、经实测或源码核实的理由。有疑问先查决策记录，再问人。

---

## 硬性约束

以下每一条都对应一个**会返工或被安全审计打回**的坑。违反前请先确认你真的理解代价。

### 架构

| 约束 | 原因 |
| --- | --- |
| **公开 API 一律用 Server Route，不用 Server Function** | Server Function 有 4 重阻断（CSRF 403 / seroval 500 / 缺 `x-tsr-serverFn` 500 / 响应为 seroval 信封），**第三方站点根本无法调用**。详见 `requirements.md` §8.2 的实测表 |
| **每个 API 路由都要声明 `ANY` 处理器返回 405 + `Allow`** | 未匹配的方法不会返回 405，而是落到路由层返回 `200 text/html`（SSR 应用外壳） |
| **CORS 头必须自己写，框架没有任何内置支持** | 全局源码检索无匹配。且 **dev 与生产预检行为不一致**——`vite dev` 会绕过你的 `OPTIONS` 处理器，**预检必须在生产构建下验证** |
| **不要创建 `src/start.ts`，除非确有需要** | 创建它会**静默丢失框架的 CSRF 保护**，且可能触发 issue #7460（`node:async_hooks` 泄漏进客户端 bundle）。需要全局中间件时先验证这两点 |
| **TanStack 相关依赖锁定精确版本，升级独立成 PR** | 框架尚未发布 1.0.0，1.x 线已迭代 700+ 次发布，底层依赖 `h3` 的 RC 版本 |
| **`verbatimModuleSyntax` 必须保持关闭** | 官方文档明确说明开启它可能导致服务端产物泄漏进客户端 bundle |
| **`.inputValidator()` 已废弃，用 `.validator()`** | 该 API 已标记 `@deprecated`。Zod 可直接传入，无需适配器 |

### 分层与依赖

| 约束 | 原因 |
| --- | --- |
| **依赖方向严格单向向下**：接口层 → 服务层 → 数据层 | 反向依赖一律禁止 |
| **服务层禁止 import 任何框架 API**（`@tanstack/*`、HTTP 类型） | 这条纪律保证 `packages/core` 能脱离框架测试，也是「框架可替换」风险对策的落地方式 |
| **依赖通过 context / 参数显式传入，禁止在函数内取全局单例** | 判断标准：函数能否在不启动数据库、不发真实请求的前提下被测试 |
| **Drizzle 查询只能写在 `*.data.ts`** | 服务层不得出现 `.select()` / `.insert()` |
| **事务边界在服务层，事务内禁止网络 IO** | 发邮件、调 IdP 必须放到事务提交之后 |
| **loader 是同构的（SSR 与客户端都会执行）** | **绝不在 loader 里直接访问数据库或读密钥**，一律通过 Server Function |

### 多租户与安全

| 约束 | 原因 |
| --- | --- |
| **每个业务查询都必须带 `site_id` 隔离** | Repo 函数的 `siteId` 参数位置固定（紧跟 `db`），便于评审时一眼看出遗漏。跨站点数据泄漏是这类系统最典型的事故 |
| **公开 API 响应禁止包含 `email` / `ip` / `user_agent` / 任何密钥** | 响应对象必须**显式构造**，禁止把数据库行直接透传——否则新增敏感列时会静默泄漏 |
| **评论只经服务端 Unified.js 管线渲染，渲染后必须过 `rehype-sanitize`** | 客户端**禁止**拥有独立的 Markdown 渲染器（Waline 的双管线分歧是明确教训） |
| **Server Route 默认不受 CSRF 保护** | 框架的 CSRF 中间件只过滤 Server Function。管理端写操作必须自行实现 Origin 校验 + CSRF token |
| **站点标识一律使用 UUID** | 不提供 slug（决策 D17）。`sites.name` 仅作后台展示，不参与任何标识、URL 或授权 |
| **管理端也必须校验主体对目标站点的权限** | 「已登录」不等于「可访问任意站点」 |
| **日志禁止出现邮箱明文、完整 IP、Cookie、token、SMTP 密码** | 需要关联时记哈希或后四位 |

### 错误处理

| 约束 | 原因 |
| --- | --- |
| **业务失败用 `Result` 返回，不用 `throw`** | TS 的 `catch (e)` 中 `e` 是 `unknown`，且「谁抛了什么」不写在签名里——新增错误而忘记处理时编译不会报错 |
| **错误码 `switch` 必须有 `satisfies never` 穷尽检查** | 这是 `Result` 模式的核心收益：新增错误忘记处理会编译失败 |
| **`try/catch` 只用于边界**：路由最外层、worker 循环、外部 IO | 网络失败与 JSON 解析失败是**预期**的，用 `Result` 包装 |
| **绝不把堆栈或数据库原始错误返回给客户端** | 可能泄漏表结构与数据 |

---

## 提交规范（强制）

> ⚠️ **本节由 `.githooks/commit-msg` 钩子强制校验，不合规的提交会被直接拒绝。**
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

### 2. Assisted-By 尾注（强制）

**凡有 AI Agent 参与的提交——哪怕只参与了一部分——都必须注明所用工具与模型。**

格式为 `<工具名> (<模型 ID>)`，写在正文之后、**空一行**：

```
Assisted-By: DeepSeek Harness (deepseek-flash)
```

| 要求 | 说明 |
| --- | --- |
| **工具名与模型缺一不可** | `Assisted-By: DeepSeek Harness` 会被钩子拒绝 |
| **多个 Agent 写多行** | 主 Agent + 子 Agent 协作时逐行列出 |
| **纯人类提交写 `none`** | `Assisted-By: none`，明确表示无 Agent 参与 |
| **尾注前必须空一行** | 否则 git 不将其识别为尾注块（钩子有兜底，但请按规范写） |

提交时使用 `-m` 多次或 heredoc 保证空行，例如：

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
（见上文版本锁定约束）。提交前确保 `pnpm lint` 与 `pnpm typecheck` 通过。

---

## 常用命令

> 尚未 `scaffold`，以下为规划中的命令，**实现前不要当作可用**。

```bash
pnpm install            # 安装依赖
pnpm dev                # 启动开发服务器
pnpm build              # 生产构建
pnpm test               # 单元 + 集成测试
pnpm lint               # ESLint
pnpm typecheck          # tsc --noEmit
pnpm db:generate        # 生成 Drizzle 迁移
pnpm db:migrate         # 执行迁移（独立步骤，不在应用启动时跑）
```

**数据库迁移作为独立部署步骤执行**，不要在应用启动时自动迁移——
框架没有启动生命周期钩子，且迁移失败会污染启动流程。

---

## 约定速查

完整版见 [`.specs/development-standards.md`](./.specs/development-standards.md)。

| 对象 | 约定 |
| --- | --- |
| 文件 | kebab-case；`*.data.ts` / `*.service.ts` / `*.schema.ts` / `*.errors.ts` / `*.server.ts` |
| 类型、Zod schema、组件 | PascalCase |
| 函数、变量 | camelCase |
| 错误码、常量 | SCREAMING_SNAKE |
| 数据库表 / 列 | snake_case（表名复数） |
| 提交信息 | Conventional Commits + `Assisted-By` 尾注 —— 详见上文「提交规范（强制）」 |

---

## 不要做的事

- ❌ 不要引入新的功能，即使它「看起来很有用」——被排除的功能清单见 `README.md` 与决策 Q-01、Q-11。
- ❌ 不要为了省事让所有函数都收 `AdminSiteContext`——依赖声明要精确到最低层级。
- ❌ 不要手写与 Zod schema 重复的 `interface`——用 `z.infer` 推导。
- ❌ 不要使用 `any`、非空断言 `!`、`as` 强制断言。
- ❌ 不要用 `prompt()` / `confirm()` 做输入与确认（Waline 管理台的明确缺陷）。
- ❌ 不要在功能 PR 里顺手升级框架版本。
- ❌ 不要直接照搬 `.specs/research/` 里参考文章的代码——那些写法部分已过时，
  取舍说明见 `development-standards.md` §13。

---

## 文档维护

- 需求或决策变更时，**同步更新 `requirements.md` 与 `decision-log.md`**，不要只改一处。
- 新决策追加到 `decision-log.md`，编号顺延（当前到 `Q-18`）。
- 发现规范不合理时，**改规范而不是默默违反**——并在 PR 里说明理由。
