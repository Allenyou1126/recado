# Recado

> 自托管、多站点、Headless 的评论系统 —— 基于 Node.js 与 TanStack Start，参考 [Waline](https://waline.js.org) 的产品形态设计。

**当前状态：里程碑 1「可用内核」已完成**（阶段 0–9，验收标准逐条通过）。
部署方式见 [`docs/deployment.md`](./docs/deployment.md)，实现进度与偏差记录见
[`.specs/development-plan.md`](./.specs/development-plan.md) §4 与 §6。

---

## 这是什么

Recado 是一个可以自己部署的评论后端。你把它跑在自己的 VPS 或 NAS 上，
在管理后台创建站点、拿到一个 site key，然后让任意前端（静态博客、自研站点、脚本）
通过 HTTP API 读写评论。

它和 Waline 最大的不同有四点：

- **单实例多站点** —— 一次部署服务多个站点，数据按站点隔离，共用一套管理台
- **Headless** —— 只提供 HTTP API 与 TypeScript SDK，评论界面的 UI 完全由使用方决定
- **PostgreSQL 单栈** —— 不追求适配八种数据库，换取真事务、`jsonb` 与可版本化的迁移
- **管理台身份外置** —— 登录委托给标准 OIDC Provider，本系统不存任何管理员密码

---

## 快速开始

```bash
git clone <repo> recado && cd recado
pnpm install
cp .env.example .env          # 填 DATABASE_URL / SESSION_SECRET / SECRETS_KEY / OIDC_*

docker compose -f docker/compose.yaml up -d postgres
pnpm db:migrate               # 迁移是**独立步骤**，不在应用启动时自动执行

pnpm cli site:create --name "我的博客" --origin https://blog.example.com
pnpm dev                      # http://localhost:3000
```

⚠️ 部署前请先读 [`docs/deployment.md`](./docs/deployment.md) 的**第 0 步**：
本系统的管理台权限完全由 IdP 角色决定，**无匹配角色会被直接拒绝登录且不产生会话**。
所以要先在 IdP 里创建 `PREFIX.OWNER` 角色并授予自己，否则会把自己锁在门外。

用 Nix / NixOS 的话不需要上面的 Docker 步骤，见
[`docs/deployment.md` §11](./docs/deployment.md)：

```bash
nix build .#recado        # → result/bin/recado（服务端，自包含 .output）
nix build .#recado-cli    # → result/bin/recado-cli、result/bin/recado-migrate
```

前端接入：

```ts
import { createClient } from '@recado/client';

const client = createClient({
  endpoint: 'https://comments.example.com',
  siteKey: 'rc_xxxxxxxxxxxxxxxxxxxxxxxx',
});

const config = await client.getConfig();
const page = await client.listComments({ path: location.pathname });

const created = await client.createComment({
  path: location.pathname,
  content: '你好 **世界**',
  nickname: '访客',
  email: 'me@example.com',   // 邮箱必填且站点不可关（决策 D18）
});

if (created.error) {
  // 错误码是稳定枚举，可直接分支；SDK 的所有方法都返回 Result，不抛异常
  console.error(created.error.reason, created.error.message);
}
```

---

## 特性

### 评论

- 匿名评论：昵称 + 邮箱 + 网址，无需注册；同站同邮箱自动归并为一个成员档案
- 服务端 Markdown 渲染：GFM、Shiki 代码高亮、MathJax 公式、表情短代码、外链 `rel`
- 多级回复：嵌套深度按站点配置（1–5），超出深度时挂到允许的最深祖先并保留 `replyTo`
- **回复独立分页**，不受顶层分页限制（相对 Waline 的关键改进）
- 删除顶层评论**不级联**，子回复保留并显示「该评论已删除」占位
- 按站点级的邮箱标签（如「站长」「作者」），作为展示徽章随评论返回

### 审核

- 审核模式：全量放行 / 首次评论待审 / 全部待审（站点级）
- 管理员标记垃圾后，**该邮箱在此站点的后续评论自动进入待审核**；恢复时对称回滚
- 后台可按站点 / 路径 / 状态 / 关键词（查**原文**）/ 时间范围筛选
- 批量操作为服务端单事务 + **部分失败明细**，不做单条端点扇出
- 完整的管理操作审计日志

### 通知

- 邮件通知：站长通知、回复通知（@提及通知属里程碑 2）
- **异步投递**（outbox 队列 + worker），SMTP 不可用时评论发布依然成功
- 失败指数退避重试，超限留档可在后台重发；后台可查看投递日志
- 每封邮件带退订链接（不可猜测、长期有效，退订后该邮箱不再收信）
- SMTP 按站点独立配置，密码加密存储

### 管理与运维

- 同源管理后台（TanStack Start SSR）：概览、评论、成员与标签、站点、邮件、审计、来源自检
- OIDC 登录（Authorization Code + PKCE），IdP 角色到实例级 / 站点级权限的映射
- 脚本与 CI 通过 OIDC client credentials 调用管理 API
- 凭证形式：会话 Cookie（浏览器）或 `Authorization: Bearer`（脚本），后者每次验算角色
- Docker + docker-compose 部署，版本化数据库迁移，优雅停机
- `/healthz`（存活）与 `/readyz`（就绪）探针
- OpenAPI 3.1 文档（`/openapi.json`）与可交互文档页（`/docs`）

### 尚未实现（里程碑 2/3）

@提及通知、管理台线程视图与正文编辑入口、幂等键（`Idempotency-Key`）、
全文检索升级为 `tsvector`（当前用 `ILIKE`）、RP-Initiated Logout、
Webhook/Telegram 渠道、RSS 订阅、数据导出、i18n、从 Waline 迁移。

---

## 技术栈

| 层 | 选型 |
| --- | --- |
| 运行时 | Node.js 22+（开发环境实测于 24） |
| 全栈框架 | TanStack Start (React) — **锁定精确版本** |
| 数据库 | PostgreSQL 16+ |
| ORM | Drizzle ORM |
| 校验 | Zod（API 契约的单一真源 → 运行时校验 + TS 类型 + OpenAPI） |
| 渲染 | Unified.js + Shiki + MathJax，`rehype-sanitize` 消毒 |
| 邮件 | Nodemailer（SMTP，站点级配置） |
| 身份 | 标准 OIDC（参考实现：ZITADEL） |
| 管理台 UI | Tailwind CSS + 本地组件（按 shadcn 的做法把组件源码放进仓库） |
| 测试 | Vitest（单元 + 集成 + 生产构建 HTTP 测试）；Playwright E2E 未引入 |
| Lint / 格式化 | Oxc（oxlint + oxfmt） |

---

## 项目结构

```
recado/
├── apps/
│   └── server/
│       ├── src/
│       │   ├── routes/            # 公开 API / 管理 API / 管理台页面 / auth 回调
│       │   ├── components/admin/  # 管理台 UI 原语与请求封装
│       │   ├── lib/               # 中间件、OIDC、会话、渲染入口、worker
│       │   ├── config/            # 环境变量校验（唯一读取点）
│       │   └── types/             # 全局 Context 类型
│       ├── server/plugins/        # Nitro 运行时插件：环境校验 / 停机 / worker
│       ├── scripts/cli.ts         # 运维 CLI
│       └── tests/                 # 集成测试（真实 Postgres）与生产构建 HTTP 测试
├── packages/
│   ├── core/            # 领域逻辑：sites / threads / comments / members / labels /
│   │                    #   moderation / notifications / rendering / auth / audit
│   ├── db/              # Drizzle schema + 迁移
│   ├── shared/          # Zod schema、类型、错误码（API 单一真源）
│   └── sdk/             # @recado/client（Headless SDK）
├── docker/              # Dockerfile、compose.yaml
├── nix/                 # Nix 打包：packages.nix / module.nix / 迁移入口
├── flake.nix            # flake 输出：packages、nixosModules、overlays
├── docs/                # 部署指南
├── .specs/              # 需求、决策、开发规范、开发计划、研究资料
└── AGENTS.md            # 面向 AI 编码代理的约束与指引
```

---

## 常用命令

```bash
pnpm check                     # typecheck + lint + format:check，提交前跑这个
pnpm test                      # 单元 + 集成 + 生产构建 HTTP 测试（357 项）
pnpm dev                       # 开发服务器
pnpm build                     # 生产构建 → apps/server/.output

pnpm db:generate               # 生成 Drizzle 迁移
pnpm db:migrate                # 执行迁移（独立步骤）

pnpm cli site:create --name "..." --origin https://...   # 创建站点并签发 site key
pnpm cli admin:grant --owner                             # 打印实例管理员角色名
pnpm cli admin:grant --site <UUID>                       # 打印站点管理员角色名
pnpm cli auth:diagnose --token <token>                   # 诊断角色与可见站点
pnpm cli comment:rerender --site <UUID> --dry-run        # 重放历史评论的 HTML
pnpm cli outbox:retry --site <UUID>                      # 重发失败邮件

nix build .#recado                                       # 服务端产物（仅 Node.js 运行时）
nix build .#recado-cli                                   # 运维 CLI 与 recado-migrate
nix flake check                                          # 构建两个产物
nix fmt                                                  # nixfmt-rfc-style
```

---

## 文档

| 文档 | 内容 |
| --- | --- |
| [`docs/deployment.md`](./docs/deployment.md) | **部署指南**：环境变量、ZITADEL 接入、SPF/DKIM/DMARC、威胁模型、备份与故障排查、Nix/NixOS 部署（§11） |
| `/docs` 与 `/openapi.json` | 运行时可交互 API 文档（由 Zod schema 推导，启动后访问） |
| [`.specs/requirements.md`](./.specs/requirements.md) | 需求分析与功能规划（含 19 项决策 D1–D19） |
| [`.specs/decision-log.md`](./.specs/decision-log.md) | 需求确认记录（19 项问答归档，含每项的理由） |
| [`.specs/development-standards.md`](./.specs/development-standards.md) | 开发规范：分层、依赖注入、Result 错误处理、评审清单 |
| [`.specs/development-plan.md`](./.specs/development-plan.md) | 里程碑 1 的阶段划分、进度追踪与完成定义 |
| [`.specs/research/`](./.specs/research/) | Waline 功能盘点与 TanStack Start 实测报告 |
| [`AGENTS.md`](./AGENTS.md) | 面向 AI 编码代理的约束与指引 |

---

## 路线图

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| 需求与规范 | 需求分析、18 项决策确认、开发规范 | ✅ 完成 |
| 里程碑 1 — 可用内核 | 站点管理、评论读写、渲染管线、审核与声誉、管理台、邮件通知、Docker 部署 | ✅ 完成 |
| 里程碑 2 — 体验完善 | @提及通知、线程视图、幂等键、`tsvector` 检索、RP-Initiated Logout | ⬜ 未开始 |
| 里程碑 3 — 延后项 | Webhook 渠道、RSS 订阅、数据导出、i18n、从 Waline 迁移 | ⬜ 未开始 |

里程碑 1 的验收标准见 [`development-plan.md` §6](./.specs/development-plan.md)
与 [`requirements.md` §11](./.specs/requirements.md)。

---

## 不打算做的事

以下能力经评估后**明确排除**，以保持功能聚焦：

图片上传、点赞与表情反应、页面浏览量统计、评论置顶、私密评论、评论编辑与撤回、
评论者自助删除、实时推送、第三方反垃圾（Akismet）与人机验证、多语言界面、
数据迁移导入工具。

理由逐条记录在 [`decision-log.md`](./.specs/decision-log.md) 的 Q-01 与 Q-11。

---

## 许可

尚未确定。
