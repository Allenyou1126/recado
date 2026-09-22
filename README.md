# Recado

> 自托管、多站点、Headless 的评论系统 —— 基于 Node.js 与 TanStack Start，参考 [Waline](https://waline.js.org) 的产品形态设计。

**当前状态：设计阶段，尚无实现代码。** 需求与规范已完成，技术设计与实现尚未开始。
详见 [`.specs/`](./.specs/)。

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

## 特性（规划中）

### 评论

- 匿名评论：昵称 + 邮箱 + 网址，无需注册
- Markdown 渲染，支持代码高亮（Shiki）与数学公式（MathJax），全部服务端渲染
- 表情面板与自定义表情包
- 多级回复，嵌套深度可按站点配置，**回复独立分页**（不受顶层分页限制）
- `@提及` 与邮件通知
- 按站点级的邮箱标签（如「站长」「作者」），作为展示徽章

### 审核

- 默认全量放行，不设验证码与第三方反垃圾服务
- 管理员可将评论标记为垃圾，**该邮箱在此站点的后续评论自动进入待审核**
- 按站点 / 路径 / 状态 / 关键词 / 时间范围筛选，支持批量操作与部分失败明细
- 完整的管理操作审计日志

### 通知

- 邮件通知：站长通知、回复通知、@提及通知
- **异步投递**（outbox 队列），发信失败不影响评论发布，支持重试与手动重发
- 每封邮件带退订链接
- SMTP 按站点独立配置

### 管理与运维

- 同源管理后台（TanStack Start SSR）
- OIDC 登录，支持 IdP 角色到实例级 / 站点级权限的映射
- 脚本与 CI 通过 OIDC client credentials 调用管理 API
- Docker + docker-compose 部署，版本化数据库迁移
- OpenAPI 3.1 文档与健康检查端点

---

## 技术栈

| 层 | 选型 |
| --- | --- |
| 运行时 | Node.js 22 LTS |
| 全栈框架 | TanStack Start (React) — **锁定精确版本** |
| 数据库 | PostgreSQL 16+ |
| ORM | Drizzle ORM |
| 校验 | Zod（API 契约的单一真源） |
| 渲染 | Unified.js + Shiki + MathJax，`rehype-sanitize` 消毒 |
| 邮件 | Nodemailer（SMTP） |
| 身份 | 标准 OIDC（参考实现：ZITADEL） |
| 管理台 UI | Tailwind CSS + shadcn/ui |
| 测试 | Vitest + Playwright |

---

## 项目结构

```
recado/
├── apps/
│   └── server/          # TanStack Start 应用：公开 API + 管理台 + OIDC 回调
├── packages/
│   ├── core/            # 领域逻辑：评论、审核、声誉、通知、渲染（无框架依赖）
│   ├── db/              # Drizzle schema + 迁移
│   ├── shared/          # Zod schema、类型、错误码（API 单一真源）
│   └── sdk/             # @recado/client
├── .specs/              # 需求、决策、开发规范、研究资料
├── docker/              # Dockerfile、compose
└── AGENTS.md
```

> 目录结构为规划结果，代码尚未落地。

---

## 文档

| 文档 | 内容 |
| --- | --- |
| [`.specs/requirements.md`](./.specs/requirements.md) | 需求分析与功能规划 |
| [`.specs/decision-log.md`](./.specs/decision-log.md) | 需求确认记录（18 项问答归档） |
| [`.specs/development-standards.md`](./.specs/development-standards.md) | 开发规范 |
| [`.specs/research/`](./.specs/research/) | Waline 功能盘点与 TanStack Start 实测报告 |
| [`AGENTS.md`](./AGENTS.md) | 面向 AI 编码代理的约束与指引 |

---

## 路线图

| 里程碑 | 内容 | 状态 |
| --- | --- | --- |
| 需求与规范 | 需求分析、18 项决策确认、开发规范 | ✅ 完成 |
| 里程碑 1 — 可用内核 | 站点管理、评论读写、渲染管线、审核与声誉、管理台、邮件通知、Docker 部署 | ⬜ 未开始 |
| 里程碑 2 — 体验完善 | @提及通知、Client SDK、线程视图、全文检索、投递日志 | ⬜ 未开始 |
| 里程碑 3 — 延后项 | Webhook 渠道、RSS 订阅、数据导出、i18n、从 Waline 迁移 | ⬜ 未开始 |

里程碑 1 的完整验收标准见 [`requirements.md` §11](./.specs/requirements.md)。

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
