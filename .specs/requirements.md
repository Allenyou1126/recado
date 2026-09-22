# Recado 评论系统 — 需求分析与功能规划

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v1.0（需求已确认） |
| 状态 | 已评审，待进入技术设计 |
| 项目代号 | Recado（已确认定名） |
| 参考产品 | [Waline](https://waline.js.org)（产品形态参考，**不做 API 兼容**） |
| 技术基线 | Node.js + TanStack Start + PostgreSQL |

> 本文档的 Waline 相关事实均经过源码级核查（见 `research/waline-feature-inventory.md`），
> 官方文档存在系统性滞后，凡冲突处一律以源码为准。
>
> **全部 18 项需求疑问已确认关闭**，逐条记录见 `decision-log.md`。本文中的 `Q-xx` 引用指向该文件。
>
> **落地时的编码约定见 `development-standards.md`**（分层架构、依赖注入、Result 错误处理、测试与评审清单）。

---

## 1. 项目定位

### 1.1 一句话定位

一个**自托管、多站点、Headless** 的评论系统：对外只提供 HTTP API 与类型安全的客户端 SDK，
站点前端 UI 完全由使用方自行实现；自带一个基于外部 OIDC 登录的管理后台。

### 1.2 与 Waline 的关系

我们参考 Waline 的**产品形态**（`serverURL` + `path` 标识文章 → 前端拉取评论），
但**不兼容其 REST 契约**，并在若干已知短板上明确改进。

| 维度 | Waline | Recado |
| --- | --- | --- |
| 实例与站点 | 一个部署 = 一个站点 | **一个部署 = 多站点**，site key 隔离 + 来源域名白名单 |
| API | `{errno, errmsg, data}` 信封，文档滞后于实现 | 全新 REST `/api/v1`，Zod 单一真源 → 运行时校验 + TS 类型 + OpenAPI 3.1 |
| 前端交付 | 内置 Vue 评论组件（CDN / npm） | **Headless**：HTTP API + TypeScript SDK，不含任何 UI |
| 数据库 | 8 种适配器自动探测，无常驻迁移体系 | **PostgreSQL 单栈** + Drizzle ORM + 版本化迁移 |
| 管理台身份 | 自建账号密码（phpass）+ 可选 TOTP，JWT 永不过期且不可吊销 | **外置 OIDC**，本系统不存管理员密码；服务端会话可过期可吊销 |
| 配置 | 全部靠部署期环境变量，**没有任何配置 UI** | 站点级配置存库，管理台即时修改 |
| 内容存储 | 只存渲染后的 HTML，`orig` 不落库（匿名评论的原文不可恢复） | **原文 `content_md` + 渲染结果 `content_html` 双存**，可重放 |
| 审核 | 验证码 / Akismet / 敏感词 / 频率限制全套 | **刻意不做图形反垃圾**，走「默认放行 + 人工标记 + 邮箱声誉降级」 |
| 线程 | 硬编码 2 层，单页回复一次性全量加载 | 嵌套深度**可配置**，回复**独立分页** |
| 通知 | 8 种渠道，在请求内串行 await，无退订 | 仅邮件，**outbox 队列异步投递**，带退订链接 |
| 计数器 | 点赞/反应/浏览量全部信任客户端，`localStorage` 去重 | 不提供点赞与浏览量；一切计数由服务端权威计算 |

### 1.3 目标用户与场景

- **主要**：拥有 1–N 个静态博客（Hexo / Hugo / Astro / VitePress 等）的个人站长，自己有 VPS 或 NAS，
  能跑 Docker，希望评论数据完全自主可控。
- **次要**：自研前端的技术团队，希望把评论能力当成一个后端服务接入自己的站点。
- **典型流程**：站长部署一个 Recado 实例 → 后台创建站点拿到 site key → 把 site key 配进博客前端 →
  前端用 SDK 拉取/提交评论 → 站长在后台审核。

---

## 2. 已确认的关键决策

| # | 决策项 | 结论 | 影响 |
| --- | --- | --- | --- |
| D1 | 系统定位 | 生产可用的自托管系统 | 功能可裁剪，但工程完成度（迁移、Docker、测试、日志、文档）不打折 |
| D2 | Waline API 兼容 | **不兼容**，全新类型安全 API | 无历史包袱，可自由设计错误模型与分页；生态需自建 |
| D3 | 租户模型 | 单实例多站点，site key + 来源域名白名单 | 所有业务表带 `site_id`；CORS 与鉴权按站点动态判定 |
| D4 | 部署目标 | Node.js 常驻服务（Docker / VPS） | 可用本地能力，无需为 Edge 运行时抽象存储 |
| D5 | 数据库 | PostgreSQL 单栈 | 可用 `jsonb`、`tsvector` 全文检索、`citext`、真事务、`LISTEN/NOTIFY` |
| D6 | 评论者身份 | **完全匿名**：昵称 + 邮箱 + 网址，无注册无登录 | 无评论者会话体系；身份以邮箱归并 |
| D7 | 邮箱标签 | **站点级隔离，仅用于前端展示** | 标签不参与审核判定 |
| D8 | 管理台身份 | **委托外部 OAuth 2.0 / OIDC** | 不实现注册、密码、找回、2FA；只维护本地会话 |
| D9 | 内容能力 | Markdown、表情/自定义表情包、代码高亮、数学公式、@提及 | 不含图片上传 |
| D10 | 审核策略 | 默认全量放行；标记垃圾 → 该邮箱后续进待审核 | 无验证码、无 Akismet、无敏感词库 |
| D11 | 通知渠道 | 仅邮件（SMTP），含站长通知、回复通知、退订链接 | 渠道抽象为接口，为后续扩展留位 |
| D12 | 交付形态 | HTTP API + TypeScript Client SDK（**无 UI**）+ 同源 `/admin` 管理台 | 评论列表与输入框由使用方自行实现 |
| D13 | 管理台形态 | 与 API 同一 TanStack Start 应用内的 `/admin` 路由 | 单产物、单进程、单容器 |
| D14 | OIDC 提供商 | **ZITADEL** 为参考实现，客户端按**标准 OIDC** 实现以兼容其他 Provider | 只依赖 discovery + JWKS + 标准 claims，不硬编码厂商特性 |
| D15 | 角色模型 | IdP 角色命名约定：`<前缀>.OWNER` = 全实例管理员；`<前缀>.ADMIN.<站点 UUID>` = 站点管理员 | 授权完全由 IdP 角色驱动，本系统**不存角色授予关系**，无自建 RBAC 表 |
| D16 | 机器调用 | 脚本 / CI 走 OIDC **client credentials** 流程，**复用同一角色约定**，不区分人类与机器 | 无需自建 Token 表与 Token 管理界面 |
| D17 | 站点标识 | **一律使用 UUID**，不提供 slug；`name` 仅作后台展示 | 站点改名不影响授权，避免 slug 改名导致 IdP 角色失配 |
| D18 | 评论者邮箱 | **必填且站点不可关** | 声誉与通知对每条评论都成立，审核语义无例外分支 |
| D19 | 渲染栈 | Unified.js（remark/rehype）+ Shiki + MathJax | 单一生态、插件丰富、AST 级处理 |

### 2.1 明确不做（Out of Scope）

以下能力**本期明确排除**，其中部分保留后续扩展位：

| 不做的事 | 理由 |
| --- | --- |
| 图片 / 附件上传 | 未选择；避免对象存储、体积限制、盗链与内容合规成本。Markdown 中的外链图片仍然可用 |
| 点赞 / 表情反应 / 星级评分 | 未选择；且 Waline 的客户端信任式计数是明确的完整性缺陷，不值得照搬 |
| 浏览量（pageview）统计 | 不属于评论系统核心；且无服务端去重手段时数据不可信 |
| 评论置顶 | 未选择 |
| 私密评论 / 悄悄话 | 未选择 |
| 评论编辑与撤回 | 未选择；评论者不能自助操作，只能由管理员删除（见 D6 追问） |
| 评论者自助删除 | 明确选择「只能由管理员删除」 |
| 实时推送（SSE / WebSocket） | 未选择 |
| 数据迁移导入（Waline / Twikoo / Disqus…） | 未选择 |
| 多语言 i18n | 未选择；中文优先，但文案集中管理以便后续国际化 |
| 第三方反垃圾（Akismet）、图形验证码 | 明确选择不做，**连预留字段都不设**（Q-11：被刷了再改造） |
| 站点 slug | 站点标识一律使用 UUID（D17 / Q-16），不提供 slug 配置 |
| 社交登录、邮箱魔法链接登录 | 评论者完全匿名；管理员走 OIDC |

> **与 D1 的张力说明**：D1 选择「对标 Waline 完整能力」，但后续选择裁剪了若干 Waline 功能。
> 本文档的处理方式是：**功能面按后续选择裁剪，工程完成度按生产系统标准执行**。
> 该取舍已在 **Q-01** 确认：接受裁剪，不追加任何被裁掉的功能。
> 详见 `decision-log.md`。

---

## 3. 角色与权限模型

### 3.1 主体

| 主体 | 说明 | 认证方式 |
| --- | --- | --- |
| 访客 / 评论者 | 完全匿名，凭昵称 + 邮箱 + 网址发言 | 无会话，仅 site key + 来源策略 |
| 成员（Member） | 系统内部概念：某站点内某个邮箱归一化后的档案 | 非登录主体，是数据聚合维度 |
| 人类管理员 | 管理台操作者 | 外部 OIDC（Authorization Code + PKCE）→ 本地服务端会话 |
| 机器管理员 | 脚本 / CI / bot | 外部 OIDC（client credentials）→ Bearer access token |
| 邮件 worker | outbox 消费 | 进程内，非外部主体 |

### 3.2 授权：完全由 IdP 角色驱动

本系统**不存储任何角色授予关系**，因此没有 `admin_site_grants` 之类的授权表。
每次认证时从 OIDC token 的 claims 中读取角色，按命名约定映射为权限：

| IdP 角色名 | 含义 | 权限 |
| --- | --- | --- |
| `<前缀>.OWNER` | 全实例管理员 | 所有站点的全部管理权限，含站点 CRUD |
| `<前缀>.ADMIN.<站点 UUID>` | 站点管理员 | 仅该站点的评论、成员、标签、站点配置 |
| （无匹配角色） | — | **拒绝登录，返回「无权限」提示**（Q-17） |

- **前缀可配置**（环境变量），用于在同一个 IdP 中区分多个部署或环境。
- **claim 路径可配置**，默认读 `roles`，兼容 `groups` 与 Keycloak 的嵌套结构（如 `realm_access.roles`）。
- 站点标识使用 **UUID**（D17），站点改名不影响授权。
- **撤销语义**：会话内缓存权限快照，但设置较短的重新校验周期；
  高权限操作（站点 CRUD、批量删除）强制回查 IdP 或按较短的会话绝对有效期判定。
  这样在 IdP 侧撤销角色后，权限能在可控时间内失效。

### 3.3 权限边界

- 公开 API 永远不返回邮箱、IP、User-Agent。
- 管理端 API 一律校验身份（会话或 Bearer token），且所有写操作落审计日志。
- 审计日志记录操作主体（OIDC `sub` / `email` 与客户端 ID），
  但**不为机器主体设置不同的角色等级**（Q-18：复用同一角色约定）。
- 无匹配角色的用户不产生任何会话。

---

## 4. 核心用例

| 编号 | 用例 | 角色 |
| --- | --- | --- |
| UC-01 | 部署实例并完成首次引导（创建 owner、创建第一个站点、拿到 site key） | 站长 |
| UC-02 | 在博客前端拉取某篇文章的评论列表并渲染 | 访客 |
| UC-03 | 匿名发表评论（含 Markdown、表情、代码、公式） | 访客 |
| UC-04 | 回复某条评论，并被 @提及他人 | 访客 |
| UC-05 | 收到「有人回复了你」的邮件并点击退订 | 访客 |
| UC-06 | 站长收到新评论邮件，登录后台审核 | 站长 |
| UC-07 | 站长把某条评论标记为垃圾，该邮箱后续评论自动进待审核 | 站长 |
| UC-08 | 站长给某邮箱打上「站长」标签，前端展示徽章 | 站长 |
| UC-09 | 站长在后台为第二个博客创建站点并配置域名白名单 | 站长 |
| UC-10 | 站长批量通过/删除一批待审评论 | 站长 |
| UC-11 | 前端用 SDK 批量获取多篇文章的评论数 | 站点前端 |

---

## 5. 领域模型

### 5.1 实体关系

```
sites ──┬── threads ──── comments ──┬── comment_mentions
        ├── members ───────────────┘
        ├── labels ── member_labels
        ├── thread? (见上)
        ├── outbox (邮件任务)
        ├── unsubscribes
        └── audit_logs
admins ───── sessions
（无授权表：角色完全由 IdP 驱动，见 §3.2）
```

### 5.2 表设计

#### `sites` — 站点（租户）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid PK | **站点的唯一标识**，同时是 OIDC 角色名中 `<站点 UUID>` 的取值（D17） |
| `key` | text unique | **公开** site key，形如 `rc_<24 随机字符>`，前端持有 |
| `name` | text | 展示名，**仅后台展示用**，不参与任何标识、URL 或授权 |
| `status` | enum | `active` / `disabled` |
| `allowed_origins` | jsonb | 来源域名白名单，支持精确域与 `*.example.com` 通配 |
| `settings` | jsonb | 站点级配置（见 5.3） |
| `created_at` / `updated_at` | timestamptz | |

#### `threads` — 文章评论线程

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid PK | |
| `site_id` | uuid FK | |
| `path` | text | 文章标识，来自前端（默认 `location.pathname`） |
| `url` / `title` | text | 可选，由前端上报，用于后台展示与邮件链接 |
| `comment_count` | int | 已发布评论数（事务内维护的物化计数） |
| `last_comment_at` | timestamptz | 最近评论时间 |

唯一约束：`(site_id, path)`。

> **相对 Waline 的改进**：Waline 用 `Comment.url` 字符串直接聚合，无独立文章表，导致评论数统计与
> 「最近评论」都要扫评论表。独立线程表让批量评论数与文章维度管理成为 O(1) 查询。

#### `members` — 站点内评论者档案

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid PK | |
| `site_id` | uuid FK | |
| `email` | citext | 身份归并键。**永不返回给公开 API** |
| `nickname` / `website` | text | 最近一次使用的值 |
| `avatar_url` | text null | 为空时按邮箱取 Gravatar |
| `label_id` | uuid null FK | 展示徽章，站点级，仅展示（D7） |
| `spam_count` | int default 0 | 该邮箱被标记垃圾的评论数（审核声誉，与标签分离） |
| `review_required` | bool default false | 为真时该邮箱的新评论一律进 `pending` |
| `first_seen_at` / `last_seen_at` | timestamptz | |
| `comment_count` | int | 已发布评论数 |

唯一约束：`(site_id, email)`；索引 `email`。

> **注意区分两个概念**：`label_id` 是**展示徽章**（D7，不参与审核）；
> `spam_count` / `review_required` 是**审核声誉**（D10，驱动自动待审）。
> Waline 把两者混在 `Users.label` 一个自由文本字段里，我们用两个独立字段避免语义打架。

#### `labels` — 展示徽章（站点级）

`id` / `site_id` / `name`（如「站长」「作者」「友链」）/ `color` / `sort` / `created_at`
唯一约束：`(site_id, name)`。

#### `comments` — 评论

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid PK（v7，时间有序） | |
| `site_id` / `thread_id` | uuid FK | |
| `path` | text | 冗余自 thread，避免列表查询回表 |
| `root_id` | uuid null FK self | 顶层祖先，用于按线程聚合 |
| `parent_id` | uuid null FK self | 直接父评论 |
| `reply_to_member_id` | uuid null FK | 被回复者，驱动回复通知与前端「回复 @xxx」 |
| `member_id` | uuid FK | 作者档案 |
| `author_nickname` / `author_website` | text | **发表时快照**（见下） |
| `content_md` | text | **权威原文** |
| `content_html` | text | 服务端渲染 + 消毒后的结果（缓存列） |
| `content_bytes` | int | 原文字节数，用于长度约束与后台展示 |
| `status` | enum | `approved` / `pending` / `spam` / `deleted` |
| `ip` | inet | 仅管理员可见 |
| `user_agent` | text | 仅管理员可见 |
| `search_vector` | tsvector | 由 `content_md` 生成，GIN 索引，供后台关键词检索。**P1 引入**，一期先用 `ILIKE`（Q-15） |
| `created_at` / `updated_at` / `deleted_at` | timestamptz | |

索引：`(site_id, path, status, created_at desc)`、`(site_id, status, created_at desc)`、
`(root_id, created_at)`、`(member_id)`、GIN(`search_vector`)。

> **为什么评论存作者快照**：评论是历史记录，署名不应随后续修改而变；同时让公开查询
> 完全不需要触碰 `members` 表（该表含邮箱等敏感列），降低误泄露风险。
> `members` 侧始终保留最新昵称/网址，后台可按需对比。

> **为什么原文与 HTML 双存**：这是 Waline 最昂贵的一个教训（研究报告 §6.3 #3/#4）——
> 只存 HTML 会导致解析器修复后无法重渲染、无法对原文做全文检索、无法让管理员以原文编辑。

#### `comment_mentions` — @提及记录

`comment_id` / `mentioned_member_id` / `notified_at` / `created_at`
用于追踪提及通知是否已发出，便于重发与审计。

#### `admins` — 管理台主体（人类与机器，均来自 OIDC）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid PK | |
| `oidc_subject` | text unique | `(iss, sub)` 组合，存 `iss#sub`；机器主体为 client ID |
| `kind` | enum | `human` / `machine`，**仅用于展示与审计，不参与授权**（Q-18） |
| `email` / `display_name` / `avatar_url` | text | 来自 ID Token claims（机器主体可为空） |
| `status` | enum | `active` / `disabled` |
| `first_login_at` / `last_login_at` | timestamptz | |

**刻意不存 `role` 字段**：权限完全由 IdP 角色在每次认证时计算（§3.2），
本表只记录「谁登录过」，用于审计关联与登录历史。

**不存密码、不存 TOTP 密钥、不存社交账号列**（Waline 把 8 个社交 provider 做成表列，加一个就要改表，明确避开）。

#### `sessions` — 管理台会话

`id`（存储哈希后的不透明 token）/ `admin_id` / `expires_at` / `revoked_at` / `ip` / `user_agent` / `created_at` / `last_seen_at`

> 会话是**服务端状态**，因此可过期、可吊销、可强制下线。OIDC 的 access/refresh token
> 只保留在服务端，不下发浏览器。

#### `outbox` — 邮件投递队列

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid PK | |
| `type` | enum | `admin_new_comment` / `reply` / `mention` / `pending_reminder` / `test` |
| `site_id` / `comment_id` | uuid | 关联上下文 |
| `to_email` / `subject` | text | |
| `template` / `payload` | text / jsonb | |
| `status` | enum | `queued` / `sending` / `sent` / `failed` / `skipped` |
| `attempts` / `last_error` | int / text | |
| `dedupe_key` | text unique | 幂等键，防止同一事件重复入队 |
| `scheduled_at` / `sent_at` | timestamptz | |

#### `unsubscribes` — 退订

`id` / `site_id` / `email` / `token` unique / `scope`（`site` 默认）/ `source_comment_id` / `created_at`

#### `audit_logs` — 管理操作留痕

`id` / `admin_id` / `site_id` / `action` / `target_type` / `target_id` / `diff` jsonb / `ip` / `created_at`

覆盖：标记垃圾、状态变更、删除、批量操作、内容编辑、配置修改、标签变更、站点创建与 key 轮换、管理员变更。

### 5.3 站点级配置（`sites.settings`）

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `maxDepth` | `2` | 嵌套深度上限，允许 1–5；超出时回复挂到允许的最深祖先 |
| `auditMode` | `none` | `none` 全放行 / `first_time` 首次评论待审 / `all` 全部待审 |
| `spamThreshold` | `1` | 累计被标记垃圾几次后，该邮箱进入 `review_required` |
| `pageSize` / `maxPageSize` | `20` / `50` | 列表分页 |
| `repliesPreview` | `3` | 每条顶层评论内联返回的回复条数 |
| `maxContentBytes` | `10240` | 单条评论原文上限 |
| `minIntervalSeconds` | `20` | 同 IP 同站点发评论最小间隔 |
| `requireNickname` | `true` | 昵称是否必填（**邮箱恒为必填，不可配**，见 D18） |
| `originPolicy` | `strict` | 无 `Origin` / `Referer` 头时的策略：`strict` 直接 403 / `lenient` 放行但限流更严（Q-12） |
| `notifyEmails` | `[]` | 站长通知接收邮箱 |
| `notifyOnPending` | `false` | 有待审评论时是否立即提醒站长 |
| `smtp` | 站点级 | **SMTP 配置是站点级的**（Q-10）：`host` / `port` / `secure` / `user` / `pass` / `fromName` / `fromEmail`。密码加密存储，读接口只回显「是否已配置」 |
| `emojis` | 内置包 | 表情包集合，支持自定义 URL 映射 |
| `markdown` | `{ gfm: true }` | Unified.js 渲染选项 |
| `codeHighlight` | `true` | 服务端 Shiki 高亮 |
| `math` | `true` | 服务端 MathJax 渲染 |
| `avatarBaseUrl` | `https://www.gravatar.com/avatar` | 头像服务 |
| `linkNofollow` | `true` | 外链加 `rel="nofollow ugc noopener noreferrer"` |

### 5.4 评论状态机

```
                  ┌──────────────┐
   新建 ────────► │   pending    │ ──┐
   （按审核策略）  └──────────────┘   │
                  ┌──────────────┐   │ 管理员操作
   新建 ────────► │   approved   │ ◄─┘
   （默认放行）    └──────────────┘
                          │  ▲
        标记垃圾 ▼        │  │ 恢复
                  ┌──────────────┐
                  │     spam     │
                  └──────────────┘
                          │
        删除 ▼            │ 恢复
                  ┌──────────────┐
                  │   deleted    │ （软删，行保留）
                  └──────────────┘
```

- **公开可见**：仅 `status = 'approved'`
- **计数口径**：`threads.comment_count` / `members.comment_count` 只统计 `approved`
- **删除语义**：软删。**默认不级联删除子回复**，子回复在列表中显示为「该评论已删除」占位。
  （Waline 会静默级联删除整棵子树，是本项目明确要避开的破坏性行为。见 Q-04）

### 5.5 标记垃圾的副作用（单事务内）

1. `comments.status = 'spam'`
2. `members.spam_count += 1`
3. 若 `spam_count >= settings.spamThreshold` → `members.review_required = true`
4. 重算 `threads.comment_count` / `members.comment_count`
5. 写 `audit_logs`

反向恢复（`spam → approved`）时对称回滚第 1–4 步。

**作用域**：`review_required` 是**站点级**的（Q-03 已确认，与整体数据隔离模型一致）。

---

## 6. 功能模块规划

优先级：**P0** = 首个可用版本必须交付；**P1** = 紧随其后的体验完善；**P2** = 明确延后。

### M1 站点与租户管理 · P0

| 功能点 | 说明 | 优先级 |
| --- | --- | --- |
| 站点 CRUD | 后台创建 / 编辑 / 停用站点 | P0 |
| site key 签发与轮换 | 生成 `rc_*` 随机 key；支持一键轮换（旧 key 立即失效） | P0 |
| 来源域名白名单 | 支持精确域与 `*.example.com`；变更即时生效 | P0 |
| 站点级配置 | 5.3 全部配置项可在后台修改，存库即时生效，**无需重新部署** | P0 |
| 站点概览 | 评论总数、待审数、垃圾数、今日新增、最近评论 | P0 |
| 多站点切换 | 后台全局站点选择器，所有列表按站点过滤 | P0 |
| 站点自助注册 | 不做；站点只能由管理员创建（D3 追问已确认） | — |

> **改进依据**：Waline 的评论管理台**没有任何站点/路径筛选**，也没有配置编辑界面
> （研究报告 §3.1/§3.6）。这两点是管理台可用性的关键，必须补齐。

### M2 评论读写核心 · P0

| 功能点 | 说明 | 优先级 |
| --- | --- | --- |
| 匿名发表评论 | 昵称 + 邮箱 + 网址；服务端全字段校验 | P0 |
| 回复评论 | `parentId` → 推导 `rootId`；`replyToMember` 由父评论作者推导 | P0 |
| 可配置嵌套深度 | `maxDepth` 默认 2（1–5 可配）；超出深度的回复挂到允许的最深祖先，并保留 `replyTo` 信息 | P0 |
| 评论列表查询 | 按 `path` 或 `threadId`；`sort=latest\|oldest`（Q-05 已确认仅此两种）；page 分页 | P0 |
| 回复分页 | 顶层评论按页返回，每条内联前 `repliesPreview` 条回复 + `hasMoreReplies`；完整回复走独立端点 | P0 |
| 批量评论数 | 一次请求查多个 path 的评论数 | P0 |
| 最新评论 | 跨 path 的最近评论，供侧边栏组件 | P1 |
| 线程元信息 | 单篇文章的评论数、最近评论时间 | P0 |
| 发表前置校验 | 长度、格式、URL 合法性、蜜罐字段 | P0 |
| 重复提交抑制 | 同邮箱 + 同内容 + 短时间窗口内拒绝 | P1 |
| 幂等键 | `Idempotency-Key` 头，防止客户端重试造成重复评论 | P1 |
| 管理员删除评论 | 软删；默认不级联 | P0 |
| 管理员编辑评论 | 改**原文**后重新渲染（因双存设计而可行） | P1 |
| 管理员身份回复 | 以管理员身份回复，异步发信不阻塞 | P0 |
| 列表返回形态 | 支持 `flat`（含 parentId，前端自行组装树）与 `tree`（服务端组装）两种 | P1 |

> **改进依据**：Waline 硬编码 2 层且「单页所有回复一次性无界加载」
> （研究报告 §1.4/§6.3 #6），热门文章的回复既无法分页也无法懒加载。

### M3 评论者身份与邮箱标签 · P0

| 功能点 | 说明 | 优先级 |
| --- | --- | --- |
| 邮箱归并 | 同站同邮箱 → 同一 `member`；昵称/网址取最近一次并回写档案 | P0 |
| 邮箱规范化 | trim + 小写 + `citext` 比较，避免大小写造成重复档案 | P0 |
| 展示标签 | 站点级标签 CRUD + 指派/取消；随评论响应返回 `{name, color}` | P0 |
| 头像 | 默认 Gravatar（邮箱哈希），站点可配 `avatarBaseUrl` | P0 |
| 隐私保护 | 公开 API 永不返回 `email` / `ip` / `user_agent` | P0 |
| 成员管理界面 | 按邮箱/昵称搜索，查看评论数、垃圾计数，指派标签、解除待审 | P0 |

### M4 内容渲染与安全 · P0

| 功能点 | 说明 | 优先级 |
| --- | --- | --- |
| 单一服务端渲染管线 | 服务端唯一权威渲染器：**Unified.js**（remark 解析 → 转换 → rehype 序列化）（D19） | P0 |
| Markdown 基础 | GFM（表格、删除线、任务列表）、换行、链接自动识别 | P0 |
| XSS 消毒 | 在 **rehype AST 层**用 `rehype-sanitize` 消毒，白名单策略，服务端强制。AST 级消毒比字符串级替换更可靠 | P0 |
| 代码高亮 | **Shiki** 服务端渲染，输出带样式的 HTML，前端零 JS；语言包按需加载 | P0 |
| 数学公式 | **MathJax** 服务端渲染（`rehype-mathjax`） | P0 |
| 表情 | `:name:` 短代码 → `<img class="emoji">`；站点级自定义表情包 | P0 |
| @提及解析 | 从原文解析 `@昵称`，匹配本站点成员 | P0 |
| 外链处理 | `rel="nofollow ugc noopener noreferrer"` | P0 |
| 预览渲染端点 | `POST /render` 不落库，复用同一渲染器，**保证预览与最终结果完全一致** | P1 |
| 内容重放 | 解析器升级后可批量重渲染历史评论（CLI 命令） | P1 |

> **改进依据**：Waline 有**两条不同的 Markdown 管线**——服务端 markdown-it、客户端预览 marked，
> 二者会分歧（研究报告 §6.3 #2）。我们只保留一条，并通过预览端点让前端复用。

### M5 审核与邮箱声誉 · P0

| 功能点 | 说明 | 优先级 |
| --- | --- | --- |
| 审核模式 | `none` / `first_time` / `all`，站点级 | P0 |
| 单条标记垃圾 | 触发 5.5 的邮箱声誉降级 | P0 |
| 恢复 | `spam → approved`，对称回滚声誉计数 | P0 |
| 待审核队列 | 按站点/路径/状态/关键词/时间范围筛选 | P0 |
| 关键词检索 | 基于 `tsvector` 搜索**原文**，而非渲染后的 HTML | P0 |
| 批量操作 | 服务端批量端点，**单事务 + 部分失败报告** | P0 |
| 邮箱声誉管理 | 查看/清零 `spam_count`，手动解除 `review_required` | P0 |
| 审计日志 | 记录所有管理操作 | P0 |
| 蜜罐字段 | 隐藏字段被填写即静默丢弃 | P1 |
| 基础频率限制 | 同 IP 同站点最小间隔、每 IP 每小时上限（**属于可用性保护，不是反垃圾**） | P0 |
| 验证码 / Akismet / 敏感词 | **明确不做**（D10） | — |

> **改进依据**：Waline 的批量操作是对单条接口 `Promise.all` 扇出，无批处理、无事务、
> 无部分失败处理（研究报告 §3.3/§6.3 #18）。

### M6 邮件通知 · P0

| 功能点 | 说明 | 优先级 |
| --- | --- | --- |
| SMTP 发信 | **站点级配置**（Q-10）：主机 / 端口 / TLS / 账号 / 密码 / 发件人，在后台按站点填写；密码加密存储 | P0 |
| 站长通知 | 新评论 → `settings.notifyEmails` | P0 |
| 回复通知 | 回复 → 被回复评论的作者（邮箱在库且未退订） | P0 |
| @提及通知 | 被 @ 的成员收到通知（仅本站点留过言者） | P1 |
| 待审提醒 | 出现待审评论时提醒站长（可开关） | P1 |
| 异步投递 | 写 `outbox` + worker 消费，**绝不阻塞评论写入请求** | P0 |
| 失败重试 | 指数退避，最多 N 次，超限标记 `failed` 并留在后台可见 | P0 |
| 退订 | 每封邮件带 token 链接，退订后该邮箱在该站点不再收信 | P0 |
| 模板系统 | 集中管理的内置模板 + 变量替换；后台可预览 | P0 |
| 发信测试 | 后台一键发送测试邮件，即时反馈 SMTP 错误 | P0 |
| 投递日志 | 后台查看 outbox 状态并手动重发 | P1 |
| 渠道抽象 | `Notifier` 接口，为 Webhook / Telegram 等留扩展位（**本期只实现 SMTP**） | P0（接口）/ P2（渠道） |

> **改进依据**：Waline 在评论写入请求内**串行 await 所有通知渠道**，社区反馈直接导致发评论变慢；
> 且完全没有退订机制，也没有投递记录（研究报告 §2.6）。

### M7 管理后台 · P0

| 模块 | 功能点 | 优先级 |
| --- | --- | --- |
| 认证 | OIDC Authorization Code + PKCE 登录；**ZITADEL 为参考实现**，按标准 OIDC 兼容其他 Provider（D14） | P0 |
| 认证 | 回调后按 IdP 角色计算权限（§3.2）；**无匹配角色直接拒绝登录**，不产生会话（Q-17） | P0 |
| 认证 | 机器调用：同一 IdP 的 client credentials 流程签发 Bearer token，复用同一角色约定（D16） | P0 |
| 认证 | 会话管理：服务端会话表，可过期、可吊销、可强制下线；权限快照定期回查 | P0 |
| 认证 | RP-Initiated Logout | P1 |
| 仪表盘 | 站点选择器 + 待审/垃圾计数 + 今日新增 + 最近评论 | P0 |
| 评论管理 | 按站点 / 路径 / 状态 / 关键词 / 时间范围筛选 + 排序 | P0 |
| 评论管理 | **线程视图**：展开某条顶层评论及其全部回复 | P1 |
| 评论管理 | 单条操作：通过 / 待审 / 垃圾 / 删除 / 编辑 / 管理员回复 | P0 |
| 评论管理 | 批量操作，含部分失败明细 | P0 |
| 站点管理 | 站点 CRUD、key 轮换、域名白名单、站点配置表单 | P0 |
| 成员管理 | 邮箱列表、搜索、评论数、垃圾计数、标签指派、解除待审 | P0 |
| 标签管理 | 标签 CRUD | P0 |
| 邮件管理 | 模板预览、发信测试、投递日志、退订列表 | P0/P1 |
| 审计日志 | 查询与筛选 | P1 |
| 技术形态 | 同一 TanStack Start 应用内的 `/admin` 路由，SSR | P0 |

> **改进依据**：Waline 管理台无路径/站点筛选、无配置界面、无仪表盘、
> 管理员回复后直接 `location.reload()`（研究报告 §3、§6.3 #17）。

### M8 对外 HTTP API · P0

| 功能点 | 说明 | 优先级 |
| --- | --- | --- |
| 版本化 | `/api/v1/*`，破坏性变更走新版本 | P0 |
| 错误模型 | HTTP 状态码 + `{ error: { code, message, details? } }` | P0 |
| 公开端点鉴权 | 请求头 `X-Recado-Site: <site key>`（site key 是**公开标识**，不是密钥） | P0 |
| 公开端点来源校验 | `Origin` / `Referer` 对照站点白名单；**无来源头时按站点级 `originPolicy` 决定 403 还是放行**（Q-12） | P0 |
| 管理端点鉴权 | 会话 Cookie（浏览器）或 `Authorization: Bearer <OIDC access token>`（脚本 / CI）；**管理端点不检查来源头**（Q-12） | P0 |
| CORS | 按站点白名单动态回显 `Access-Control-Allow-Origin`，含 OPTIONS 预检 | P0 |
| 输入校验 | Zod schema 单一真源 → 运行时校验 + TS 类型 + OpenAPI | P0 |
| OpenAPI 3.1 | 由 schema 自动生成，附带可交互文档页 | P0 |
| 限流 | 按 IP + 站点 + 端点维度 | P0 |
| 结构化错误码 | 稳定枚举，SDK 可据此分支 | P0 |
| 分页 | page/pageSize + `total`/`totalPages` | P0 |
| 服务端到服务端调用 | **支持**：脚本 / CI 通过 IdP 的 client credentials 取得 access token，复用同一角色约定（D16） | P0 |

**端点草案**

*公开（site key + 来源校验）*

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/config` | 站点公开配置（深度、表情包、字数限制、必填字段） |
| GET | `/api/v1/comments` | 评论列表（`path`/`threadId`、`sort`、`page`、`pageSize`、`order`） |
| GET | `/api/v1/comments/:id/replies` | 某顶层评论的回复分页 |
| GET | `/api/v1/comments/recent` | 最新评论 |
| GET | `/api/v1/comments/count` | 批量评论数（`paths=a,b,c`） |
| POST | `/api/v1/comments` | 发表评论 |
| POST | `/api/v1/render` | 预览渲染（不落库） |
| GET | `/api/v1/emojis` | 表情包清单 |
| GET | `/api/v1/threads/:path` | 线程元信息 |
| GET | `/api/v1/unsubscribe` | 退订（返回 HTML 结果页） |

*管理（会话 Cookie）*

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1/admin/me` | 当前管理员 |
| GET/POST | `/api/v1/admin/sites` | 站点列表 / 创建 |
| GET/PATCH/DELETE | `/api/v1/admin/sites/:id` | 站点详情 / 更新 / 删除 |
| POST | `/api/v1/admin/sites/:id/rotate-key` | 轮换 site key |
| GET | `/api/v1/admin/comments` | 后台评论列表（全维度筛选） |
| PATCH | `/api/v1/admin/comments/:id` | 改状态 / 改内容 |
| POST | `/api/v1/admin/comments/batch` | 批量操作（事务 + 部分失败报告） |
| POST | `/api/v1/admin/comments/:id/reply` | 管理员回复 |
| GET | `/api/v1/admin/members` | 成员列表 |
| PATCH | `/api/v1/admin/members/:id` | 标签 / 待审状态 / 垃圾计数 |
| GET/POST/PATCH/DELETE | `/api/v1/admin/labels` | 标签 CRUD |
| GET | `/api/v1/admin/outbox` | 邮件投递日志 |
| POST | `/api/v1/admin/outbox/:id/retry` | 重发 |
| POST | `/api/v1/admin/test-email` | 发信测试 |
| GET | `/api/v1/admin/unsubscribes` | 退订列表 |
| GET | `/api/v1/admin/audit-logs` | 审计日志 |
| GET | `/api/v1/admin/stats` | 站点统计 |

*认证与运维*

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/auth/login` | 302 到 IdP |
| GET | `/auth/callback` | OIDC 回调，建会话 |
| POST | `/auth/logout` | 本地登出 + RP-Initiated Logout |
| GET | `/healthz` / `/readyz` | 存活 / 就绪探针 |
| GET | `/openapi.json` | OpenAPI 文档 |

### M9 Client SDK · P1

| 功能点 | 说明 |
| --- | --- |
| 包名 | `@recado/client`（TypeScript，ESM + CJS） |
| 定位 | **纯 Headless**，不含任何 UI 组件（D12） |
| 能力 | 覆盖全部公开端点，返回类型化结果；错误类型化并携带稳定错误码 |
| 配置 | `siteKey`、`endpoint`、自定义 `fetch`（便于 SSR / Edge / 测试注入） |
| 健壮性 | `AbortSignal` 支持、超时、可配置重试 |
| 类型共享 | 复用 `packages/shared` 的 Zod 推导类型，与 API 强一致 |
| SSR 友好 | 无浏览器全局依赖，可在服务端渲染流程中直接调用 |

> M9 排在 P1 的原因：公开 API 是 P0 且已可直接使用，SDK 是开发者体验的增项。
> 但**类型定义（`packages/shared`）属于 P0**，因为它是 API 的单一真源。

### M10 运维与部署 · P0

| 功能点 | 说明 |
| --- | --- |
| 容器化 | 多阶段 `Dockerfile`（非 root 运行、体积精简） |
| 编排 | `docker-compose.yml`：应用 + PostgreSQL，含健康检查与数据卷 |
| 配置 | 全部走环境变量，启动时用 Zod 校验并给出可读错误 |
| 数据库迁移 | Drizzle 版本化迁移文件；作为**独立部署步骤 / init container** 执行，不在应用启动时自动迁移（见 8.5） |
| 首次引导 | 环境变量引导 owner；CLI 命令创建站点并输出 site key |
| CLI | `site:create` / `admin:grant` / `comment:rerender` / `outbox:retry` |
| 可观测性 | 结构化日志（pino）+ 请求 ID + 慢查询日志；不记录邮箱明文与完整 IP |
| 探针 | `/healthz`、`/readyz` |
| 生命周期 | 优雅停机（停止接收 → 等待在途请求 → 关闭连接池） |
| 备份 | `pg_dump` 指引；文档化的恢复流程 |
| 文档 | 部署指南、OIDC 接入指南、API 文档、SDK 文档 |

---

## 7. 非功能需求

### 7.1 安全

| 项 | 要求 |
| --- | --- |
| 传输 | 生产环境强制 HTTPS（可由反向代理终结） |
| 会话 | 不透明随机 token 存 `HttpOnly` + `Secure` + `SameSite=Lax` Cookie；服务端存哈希；可过期可吊销 |
| CSRF | 管理端写操作校验 `Origin`，并使用 CSRF token 双重提交。**框架的 CSRF 中间件只保护 Server Function，Server Route 需自行实现**（见 8.2） |
| CORS | 严格按站点白名单回显，不使用 `*` |
| 注入 | 全部经 ORM 参数化；无字符串拼接 SQL |
| XSS | 渲染管线末端强制白名单消毒；**存储即已消毒，读取时再消毒一次（双保险）** |
| 限流 | 公开写端点按 IP + 站点限流；认证端点单独限流 |
| 日志脱敏 | 日志不落邮箱明文、完整 IP、Cookie、OIDC token |
| 密钥管理 | OIDC client secret、SMTP 密码仅来自环境变量；不写入数据库、不出现在 API 响应 |
| 威胁模型说明 | site key 是**公开标识**而非密钥；来源校验挡不住服务端脚本。真正的防线是限流与人工审核。此限制在部署文档中明确写出，不制造虚假安全感 |

### 7.2 性能

按 Q-15 确认的规模（1–3 站点、单站 < 1000 条评论）设定，并留约 10 倍余量。

| 项 | 目标 |
| --- | --- |
| 评论列表 | 单篇文章 1000 条评论规模下 P95 < 150ms |
| 写评论 | P95 < 150ms（不含邮件投递，已异步化） |
| 评论数批量查询 | 100 个 path < 100ms（走 `threads` 物化计数） |
| 容量（设计目标） | 单实例 3 个站点、3 万条评论、300 篇文章、读写混合 20 QPS 无压力 |
| 渲染 | 单条 10KB Markdown 渲染 < 80ms（Shiki 高亮是其中最重的一环） |
| 冷启动 | 不适用（常驻服务） |

> 规模虽小，但 §5.2 的索引设计**不因此省略**——索引是设计正确性的一部分，不是规模优化。
> 唯一因规模而下调的是管理台关键词检索：一期用 `ILIKE` 即可，`tsvector` 移到 P1（Q-15）。

### 7.3 可靠性

- 多行写入一律在**数据库事务**内完成。
- 邮件投递失败不影响评论发布，且可重试、可人工重发。
- 数据库不可用时 `/readyz` 返回 503，`/healthz` 仍返回 200（避免编排系统误杀）。
- 应用无状态（除会话与 outbox，均在数据库），可水平扩容。

### 7.4 可维护性

- TypeScript `strict`，无 `any` 逃逸。
- Zod schema 是**唯一真源**：校验、TS 类型、OpenAPI 三处产物全部由它推导。
- 测试：核心领域逻辑单元测试、API 集成测试（真实 Postgres）、关键流程 E2E。
- 代码分层：`core`（领域逻辑，无框架依赖）→ `server`（TanStack Start 路由与 HTTP）→ `admin`（UI）。
  领域逻辑不感知 HTTP，便于测试与复用。

### 7.5 可访问性与体验

- 管理台支持键盘操作、焦点可见、对比度达 WCAG AA。
- 管理台表单有明确错误提示与危险操作二次确认（批量删除、key 轮换）。
- 所有破坏性操作展示影响范围（如「将删除 12 条评论」）。

---

## 8. 技术架构

### 8.1 技术选型

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 运行时 | Node.js 22 LTS | 常驻服务 |
| 全栈框架 | TanStack Start (React) `1.168.x` | 管理台 SSR + 公开 REST API 同进程。**必须锁定精确版本**，理由见 §10 风险表 |
| 路由 | TanStack Router | TanStack Start 内置 |
| 数据库 | PostgreSQL 16+ | 单栈 |
| ORM | Drizzle ORM | 类型安全、迁移文件可版本化、贴近 SQL |
| 校验 | Zod | API 与配置的单一真源 |
| Markdown | **Unified.js**（remark / rehype 生态） | 服务端权威渲染，AST 级处理（D19） |
| 消毒 | **`rehype-sanitize`** | 在 rehype AST 层做白名单消毒 |
| 代码高亮 | **Shiki** | 服务端渲染，VS Code 同款主题，语言包按需加载（Q-09） |
| 数学 | **MathJax**（`rehype-mathjax`） | 服务端渲染 |
| 邮件 | Nodemailer | SMTP，**站点级配置**（Q-10） |
| OIDC | `openid-client` | 标准 discovery + PKCE + JWKS + client credentials；**ZITADEL 为参考实现**，兼容其他 Provider |
| 日志 | pino | 结构化、低开销 |
| 管理台 UI | Tailwind CSS + shadcn/ui | 见 Q-13 |
| 测试 | Vitest + Playwright | 单元/集成 + E2E |
| Lint / 格式化 | **Oxc 工具链**（oxlint + oxfmt） | 统一 lint 与 format；含类型感知规则、import 排序与 Tailwind 类名排序。不引入 ESLint / Prettier，见开发规范 §11.5 |

### 8.2 关键技术点：公开 API 必须用 Server Route（已实测验证）

研究阶段实测确认：**TanStack Start 的 Server Function（`createServerFn`）无法被第三方站点调用**，
四重阻断全部在真实运行时复现：

| 调用尝试 | 实测结果 |
| --- | --- |
| `GET /_serverFn/<id>`，无来源头 | **403**（框架自动安装的 CSRF 中间件拦截） |
| `POST` 发送普通 JSON | **500** `Seroval Error` |
| 请求体正确但缺少 `x-tsr-serverFn` 头 | **500** `HTTPError` |
| 请求体与头都正确 | 200，但响应体是 seroval 交叉序列化信封 |

另有两处致命不兼容：**处理函数内的错误（含 Zod 校验失败）以 HTTP 200 返回**，错误藏在信封里；
函数 URL 是「文件路径 + 函数名」的哈希，重命名文件即改变 URL。
官方文档亦明确指出：「若需要能被 Start 应用之外调用的端点，请使用 server routes」。

**结论**：架构分工是硬性的，不是风格偏好。

- **公开 REST API**（`/api/v1/*`）→ **Server Route**。这是第三方站点唯一依赖的契约。
- **管理台页面的 SSR 数据加载** → 可用 Server Function（RPC），享受端到端类型安全。
- **管理端写操作** → 同样走 `/api/v1/admin/*` 的 Server Route，以统一会话与 CSRF 校验。

Server Route 写法（注意 `createServerFileRoute` 已在 RC → 稳定期被**移除**）：

```ts
// src/routes/api/v1/comments.ts  →  /api/v1/comments
export const Route = createFileRoute('/api/v1/comments')({
  server: {
    handlers: {
      GET: async ({ request }) => Response.json(payload, { status: 200, headers: corsHeaders }),
      POST: async ({ request }) => { const body = await request.json(); /* ... */ },
      OPTIONS: async () => new Response(null, { status: 204, headers: preflightHeaders }),
      ANY: async () => new Response(null, { status: 405, headers: { Allow: 'GET, POST, OPTIONS' } }),
    },
  },
})
```

**三个实测踩坑点，实现时必须处理：**

1. **未匹配的 HTTP 方法不返回 405**，而是落到路由层返回 `200 text/html`（SSR 应用外壳）。
   每个 API 路由都必须显式声明 `ANY` 处理器返回 405 + `Allow`，
   否则对只读端点发 `PUT` 会得到一份 HTML。
2. **框架没有任何内置 CORS 支持**（源码全局检索无匹配），响应头需全部自行设置。
3. **开发与生产的预检行为不一致**：`vite dev` 会拦截 `OPTIONS` 并绕过我们的处理器，
   返回一个**缺少 `Access-Control-Allow-Origin`** 的预检响应；生产构建下处理器才正常执行。
   → **CORS 预检必须在生产构建下验证**，只测 dev 会得到错误结论。

另外，**Server Route 默认不受 CSRF 保护**（框架的 CSRF 中间件只过滤 Server Function），
因此管理端写操作必须自行实现 CSRF 校验。

### 8.3 代码组织（pnpm monorepo）

```
recado/
├── apps/
│   └── server/          # TanStack Start 应用：公开 API + 管理台 + OIDC 回调
├── packages/
│   ├── core/            # 领域逻辑：评论、审核、声誉、通知、渲染（无框架依赖）
│   ├── db/              # Drizzle schema + 迁移
│   ├── shared/          # Zod schema、类型、错误码（API 单一真源）
│   └── sdk/             # @recado/client（P1）
├── .specs/              # 需求、决策、开发规范、研究资料
├── docker/              # Dockerfile、compose
├── AGENTS.md            # 面向 AI 编码代理的约束与指引
└── README.md
```

拆分为 monorepo 的理由：SDK 需要能被第三方独立安装；`core` 需要脱离 HTTP 独立测试。

### 8.4 请求生命周期（发表评论）

```
前端 SDK
  └─ POST /api/v1/comments   X-Recado-Site: rc_xxx   Origin: https://blog.example.com
       └─ Server Route
            ├─ 1. 解析 site key → 加载站点（缓存）
            ├─ 2. Origin 白名单校验
            ├─ 3. 限流检查（IP + 站点）
            ├─ 4. Zod 校验请求体
            ├─ 5. 蜜罐字段检查
            ├─ 6. 解析/创建 member（邮箱归并）
            ├─ 7. 判定初始状态（审核模式 + 邮箱声誉）
            ├─ 8. 渲染 Markdown → HTML → 消毒
            ├─ 9. 事务：写 comment + upsert thread + 更新计数
            ├─ 10. 事务后：解析 @提及 → 写 outbox（去重）
            └─ 11. 返回评论对象（不含邮箱/IP）
                  └─ Worker 异步消费 outbox → SMTP 投递
```

### 8.5 后台任务与数据库迁移

框架**不提供任何调度器、任务队列或 `waitUntil`**，后台能力完全依赖宿主环境。

- **邮件 worker**：常驻 Node 服务下用模块级 `setInterval` 轮询 `outbox`
  （以 `FOR UPDATE SKIP LOCKED` 保证多实例并发安全），
  同时暴露受保护的 `POST /internal/outbox/drain` 端点，便于外部 cron 或容器 sidecar 触发。
- `WORKER_MODE=inline|standalone`：小规模用 inline；需要隔离时拆成独立容器。
- **禁止**从请求处理器中 fire-and-forget 数据库写入。
- **数据库迁移作为独立部署步骤执行**（init container 或 `docker compose run` 一次性任务），
  **不在应用启动时自动迁移**——框架没有启动生命周期钩子，且迁移失败会污染启动流程。
- 选型理由：不引入 Redis / 消息队列，保持「一个容器 + 一个数据库」的部署承诺。

### 8.6 服务端代码隔离约定

框架提供构建期保护，用来防止数据库代码与密钥泄漏进客户端 bundle：

- 数据库与密钥相关代码放在 `*.server.ts`，客户端构建时会**硬报错**（开发期降级为警告 + mock）。
- 在 `tanstackStart({ importProtection })` 中额外声明 `pg`、`drizzle-orm`、`nodemailer` 等仅服务端依赖。
- `packages/core` 通过 `import '@tanstack/react-start/server-only'` 标记为服务端专用。
- 约定的文件划分：`x.ts`（客户端安全的类型与 schema）/ `x.server.ts`（数据库查询）/
  `x.functions.ts`（Server Function 包装）。
- **保持 `verbatimModuleSyntax` 关闭**——官方文档明确说明开启它可能导致服务端产物泄漏进客户端 bundle。

---

## 9. 分期路线图

### 里程碑 1 — 可用内核（P0）

目标：**一个真实博客可以把评论系统切过来并正常运转。**

1. 项目骨架、monorepo、Drizzle schema 与迁移、Docker 编排
2. 站点管理（CRUD、site key、域名白名单、站点配置）
3. 公开 API：配置、列表、发表、回复、计数、线程元信息
4. 渲染管线：Markdown + 消毒 + 代码高亮 + 数学 + 表情
5. 邮箱归并、成员与标签
6. 审核：状态机、邮箱声誉、批量操作、审计日志
7. 管理台：OIDC 登录与角色映射、仪表盘、评论管理、站点管理、成员与标签管理、SMTP 站点级配置
8. 邮件：outbox、worker、站长/回复通知、退订、模板、发信测试
9. OpenAPI 文档、部署指南、OIDC 接入指南

### 里程碑 2 — 体验完善（P1）

@提及通知、Client SDK 发布、预览渲染端点、线程视图、
全文检索升级为 `tsvector`（一期用 `ILIKE`）、
投递日志与手动重发、审计日志界面、管理员编辑评论、幂等键、内容重放 CLI。

### 里程碑 3 — 延后项（P2）

Webhook/Telegram 通知渠道、
RSS/Atom 评论订阅、数据导出（CSV/JSON）、多语言 i18n、
从 Waline 迁移工具、Prometheus 指标、评论审核自动化规则。

---

## 10. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| 无验证码 + 无第三方反垃圾 → 垃圾评论直接入库 | 中 | 已明确**连预留字段都不设**（Q-11）。靠邮箱声誉降级、批量操作、限流兜底；若真被刷需改造数据模型与站点配置 |
| **首次部署锁死风险**：若 IdP 侧角色未配置好，任何人都匹配不到角色，会被完全挡在门外（Q-17 的代价） | 中 | 部署文档把「先在 IdP 创建 `PREFIX.OWNER` 角色并授予自己」列为**第一步前置条件**；提供 CLI 诊断命令打印本次登录解析到的角色与可用站点 |
| 站点级 SMTP 密码需落库 | 中 | 用独立密钥加密存储；读接口只回显「是否已配置」；文档说明密钥丢失需重新填写 |
| 外置 OIDC 增加部署门槛 | 中 | 以 **ZITADEL** 为参考实现，给出 docker-compose 示例与接入文档；客户端按**标准 OIDC** 实现以兼容其他 Provider；保证 IdP 故障时已有会话仍可用 |
| site key 公开 → 无法阻止服务端伪造请求 | 中 | 部署文档明确威胁模型；限流 + 蜜罐 + 人工审核；不宣称来源校验是安全边界 |
| Headless 交付 → 使用方需自己写 UI | 中 | SDK 文档给出完整示例代码；后续可补官方 React 组件包（P2） |
| **TanStack Start 尚未发布 1.0.0**：npm 最新为 `1.168.x`，官方文档至今仍标注 Release Candidate，1.x 线已迭代 700+ 次发布，且底层强依赖 `h3@2.0.1-rc.20` 这一 RC 版本的 HTTP 库 | **高** | 锁定精确版本（含传递依赖）；领域逻辑全部放在框架无关的 `packages/core`，必要时可替换框架；升级走独立 PR 并跑完整回归 |
| 框架已知问题：CSRF 中间件可能把 `node:async_hooks` 泄漏进客户端 bundle（issue #7460，按官方文档写法触发）；Windows 下 Nitro dev 环境不可用（issue #7717，未经复现） | 中 | 引入 `src/start.ts` 做全局中间件时**优先验证 #7460**；团队统一在 Linux/macOS 开发、在 Docker 内构建 |
| CORS 预检在 dev 与生产行为不一致（dev 下框架绕过我们的 OPTIONS 处理器） | 中 | 预检必须纳入**生产构建**的自动化测试，不接受只在 dev 验证 |
| API 路由未声明 `ANY` 处理器时，未匹配方法返回 `200 text/html` 而非 405 | 中 | 路由脚手架统一生成 `ANY → 405 + Allow`；集成测试覆盖错误方法 |
| 单条评论无长度/内容上限时被塞入超大 Markdown | 低 | `maxContentBytes` 硬限制 + 渲染超时 |
| 邮件被标记为垃圾邮件 | 中 | 要求配置 SPF/DKIM/DMARC，文档给出指引；发信测试工具 |
| 多站点下误配域名白名单导致评论全部 403 | 低 | 后台提供「来源校验自检」工具，展示最近被拒绝的 Origin |

---

## 11. 验收标准（里程碑 1）

- [ ] 全新环境执行 `docker compose up` 后，应用与数据库正常启动，`/readyz` 返回 200
- [ ] 在 ZITADEL 中创建并授予 `PREFIX.OWNER` 角色后可登录管理台；**无角色用户被拒绝且不产生会话**
- [ ] 持有 `PREFIX.ADMIN.<站点 UUID>` 角色的账号只能看到被授权的站点，无法访问其他站点数据
- [ ] 脚本通过 client credentials 取得 access token 后可调用管理 API 写入数据
- [ ] 创建站点后拿到 site key（站点标识为 UUID，后台展示名为 `name`）
- [ ] 用一个真实的静态博客页面通过 SDK/HTTP 成功发表、拉取、回复评论
- [ ] Markdown、表情、Shiki 代码高亮、MathJax 公式在服务端正确渲染，且 XSS 载荷被 `rehype-sanitize` 消毒
- [ ] 后台可按站点 / 路径 / 状态 / 关键词筛选评论，并完成批量通过、标记垃圾、删除
- [ ] 将某条评论标记为垃圾后，该邮箱在本站点的下一条评论自动进入待审核
- [ ] 邮箱标签能在评论 API 响应中返回并正确展示
- [ ] 在后台按站点配置 SMTP 后，发表评论可触发站长与父评论作者的邮件；退订链接可用且生效
- [ ] SMTP 不可用时评论发布仍然成功，失败任务可在后台重发
- [ ] 跨域请求按站点域名白名单放行/拒绝；无来源头请求按站点 `originPolicy` 开关分别表现 403 与放行
- [ ] 对只读端点发送 `PUT` 返回 **405 + `Allow` 头**，而不是 `200 text/html`
- [ ] **在生产构建下**验证 CORS 预检返回正确的 `Access-Control-Allow-Origin`
- [ ] OpenAPI 文档与实际 API 完全一致
- [ ] 核心领域逻辑单元测试与 API 集成测试通过
- [ ] 部署指南、OIDC（ZITADEL）接入指南、API 文档齐备

---

## 12. 参考

- 开发规范（分层、依赖注入、错误处理、测试与评审清单）：`development-standards.md`
- 需求确认记录（18 项问答归档）：`decision-log.md`
- Waline 源码级功能盘点（711 行，含源码证据与 19 项设计缺陷）：`research/waline-feature-inventory.md`
- TanStack Start 能力实测报告（1708 行，含真实 dev + 生产构建验证）：`research/tanstack-start-report.md`
- Waline 源码：<https://github.com/walinejs/waline>
- Waline 文档：<https://waline.js.org>
- TanStack Start 文档：<https://tanstack.com/start/latest/docs/framework/react/overview>
  （追加 `.md` 可获取原始 markdown：`.../overview.md`）
