# Recado 部署指南

面向**从零部署一个 Recado 实例**的运维者。按顺序做，不要跳步 —— 尤其是第 0 步。

> 下面按 Docker Compose 讲。**用 Nix / NixOS 的话直接看第 11 节**，
> 第 0 步（IdP 角色）与第 3、4、6 节（反代、建站点、邮件）同样适用。

---

## 0. 前置条件（**先做这一步，否则会把自己锁在门外**）

| 项            | 要求                                                              |
| ------------- | ----------------------------------------------------------------- |
| 主机          | 能跑 Docker 的 Linux / NAS，1 vCPU / 1 GB 内存即可（规模见 Q-15） |
| 数据库        | PostgreSQL 16+（compose 里已包含）                                |
| 反向代理      | Nginx / Caddy / Traefik 之一，负责 HTTPS 终结                     |
| OIDC Provider | 标准 OIDC 实现，参考实现是 **ZITADEL**                            |

> ⚠️ **本系统不存任何角色授予关系**（决策 D15）。管理台权限**完全**由 IdP 角色决定，
> 且**无匹配角色的用户会被直接拒绝登录、不产生会话**（Q-17）。
> 因此：**先在 IdP 里创建 `PREFIX.OWNER` 角色并授予自己**，再部署。
> 否则你会看到「登录成功但没有权限」，且没有任何环境变量可以兜底。

角色命名约定：

| 角色名                     | 权限                                   |
| -------------------------- | -------------------------------------- |
| `<前缀>.OWNER`             | 全实例管理员，可管理所有站点、创建站点 |
| `<前缀>.ADMIN.<站点 UUID>` | 仅该站点的评论、成员、标签与配置       |

`<前缀>` 由环境变量 `OIDC_ROLE_PREFIX` 配置（同一个 IdP 里跑多套环境时用它区分）。

**站点标识一律是 UUID**（决策 D17）：站点改名不影响授权，角色名里写的也是 UUID。

---

## 1. 准备配置

```bash
git clone <repo> recado && cd recado
cp .env.example .env
```

必填项（缺失或格式错误时**进程会拒绝启动并逐项列出问题**）：

| 变量                                    | 说明                                   |
| --------------------------------------- | -------------------------------------- |
| `DATABASE_URL`                          | PostgreSQL 连接串                      |
| `SESSION_SECRET`                        | ≥32 字符；管理台会话 Cookie 的签名密钥 |
| `SECRETS_KEY`                           | ≥32 字符；站点级 SMTP 密码的加密根密钥 |
| `OIDC_ISSUER_URL`                       | IdP 的 issuer（discovery 地址）        |
| `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | 在 IdP 里创建的应用                    |
| `OIDC_REDIRECT_URI`                     | 必须与 IdP 侧登记的回调地址完全一致    |
| `OIDC_ROLE_PREFIX`                      | 角色前缀，见第 0 步                    |

建议设置：

| 变量                   | 说明                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `PUBLIC_BASE_URL`      | 对外地址，用于拼邮件里的评论链接与退订链接；省略时取 `OIDC_REDIRECT_URI` 的 origin |
| `OIDC_ROLE_CLAIM`      | 角色所在的 claim 路径，默认 `roles`；Keycloak 常见写法是 `realm_access.roles`      |
| `OIDC_AUDIENCE`        | Bearer token 的受众校验值，默认取 `OIDC_CLIENT_ID`                                 |
| `SESSION_TTL_HOURS`    | 管理台会话有效期，默认 168（7 天）                                                 |
| `INTERNAL_DRAIN_TOKEN` | 外部 cron / sidecar 触发 `POST /internal/outbox/drain` 的共享密钥                  |

> 🔑 **`SECRETS_KEY` 丢失意味着所有站点的 SMTP 密码都要重填**（它们用它加密存储）。
> 请与数据库备份一起妥善保存。

---

## 2. 启动

```bash
# 1. 起数据库
docker compose -f docker/compose.yaml up -d postgres

# 2. 执行迁移（**独立步骤，不会在应用启动时自动执行**）
docker compose -f docker/compose.yaml run --rm migrate

# 3. 启动应用
docker compose -f docker/compose.yaml up -d --build app
```

迁移刻意不放进应用启动流程（requirements.md §8.5）：框架没有启动生命周期钩子，
且迁移失败会污染启动流程。升级时先跑迁移，再滚动重启应用。

验证：

```bash
curl -fsS http://127.0.0.1:3000/healthz   # 进程存活
curl -fsS http://127.0.0.1:3000/readyz    # 就绪（数据库可用才 200）
```

两个探针的分工：`/healthz` **不查数据库**（数据库暂时不可用时也返回 200，
否则编排系统会把「数据库抖动」误判为「进程已死」并反复重启）；
`/readyz` 在数据库不可用时返回 **503**，负载均衡据此摘流量。

---

## 3. 反向代理

必须由代理负责 HTTPS，并**重写**（而不是透传）来源相关头：

```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header Host              $host;
  proxy_set_header X-Real-IP         $remote_addr;
  proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

- `X-Forwarded-For` 用于「同 IP 同站点最小发表间隔」。
  ⚠️ 这个头**可以伪造**，因此它只用于可用性保护与后台展示，**绝不用于鉴权或封禁**。
  若代理能直接连到公网，请确保它覆盖而不是追加客户端传来的同名头。
- 没有代理头时系统会退回 socket 地址，但生产环境请配置代理头，否则所有请求
  会被算作同一个来源。

---

## 4. 创建第一个站点

```bash
pnpm cli site:create --name "我的博客" --origin https://blog.example.com
```

输出里的 **site key**（`rc_...`）填进博客前端即可。

> 🔒 **site key 是公开标识，不是密钥。** 它只用来选出「这次请求属于哪个站点」。
> 来源白名单挡得住浏览器，但**挡不住有意的服务端伪造**（curl 就能伪造 Origin）。
> 真正的防线是限流 + 人工审核。请不要把 site key 当成访问控制手段。

前端接入示例（TypeScript SDK）：

```ts
import { createClient } from '@recado/client';

const client = createClient({
  endpoint: 'https://comments.example.com',
  siteKey: 'rc_xxxxxxxxxxxxxxxxxxxxxxxx',
});

const config = await client.getConfig(); // 站点公开配置
const page = await client.listComments({ path: location.pathname });
const created = await client.createComment({
  path: location.pathname,
  content: '你好 **世界**',
  nickname: '访客',
  email: 'me@example.com', // 邮箱必填且站点不可关（D18）
});
```

---

## 5. ZITADEL 接入（参考实现，其他 Provider 同理）

1. **创建项目**，在项目下创建两个角色：`OWNER`、`ADMIN`（前缀由 `OIDC_ROLE_PREFIX` 决定，
   若前缀是 `recado`，则 IdP 里的角色名应为 `recado.OWNER`）。
2. **创建 Web 应用**（类型：Web / Code）：
   - 回调地址：`https://comments.example.com/auth/callback`
   - 勾选 **PKCE**（Recado 强制使用 Authorization Code + PKCE）
   - 把 client id / secret 填进 `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET`
   - `OIDC_ISSUER_URL` 填 ZITADEL 实例的 issuer
3. **授予自己角色**：在 ZITADEL 里把 `recado.OWNER` 授予你的账号。
   ⚠️ 这一步没做的话，登录会返回 `AUTH_NO_MATCHING_ROLE` 且**不产生会话**。
4. **站点管理员**：为每个站点创建一个角色 `recado.ADMIN.<站点 UUID>` 并授予相应账号。
   站点 UUID 在管理台「站点」页可见，也可以用 `pnpm cli admin:grant --site <UUID>` 打印。
5. **脚本 / CI（client credentials）**：在 ZITADEL 创建机器用户与服务账号，
   授予同样的角色。调用时带 `Authorization: Bearer <access token>` 即可 ——
   Bearer 路径**每次都验签并现算角色**，因此 IdP 侧撤销会立即生效。

### 排查「首次部署锁死」

```bash
# 只核对前缀与角色名映射（不需要 token）
pnpm cli auth:diagnose --roles "recado.OWNER,recado.ADMIN.<站点 UUID>"

# 走完整验签（最接近真实调用）
pnpm cli auth:diagnose --token "<access token>"
```

它会打印「拿到了哪些角色、命中了哪些、能看见哪些站点」，以及排查顺序建议。

---

## 6. 邮件（SPF / DKIM / DMARC）

SMTP 是**站点级**配置（Q-10）：在管理台「站点 → 站点设置」里填写主机、端口、账号、
发件人。密码加密存储，读接口只回显「是否已配置」。

要让邮件不进垃圾箱，请在发件域上配置：

| 记录      | 作用                             | 示例                                                       |
| --------- | -------------------------------- | ---------------------------------------------------------- |
| **SPF**   | 声明哪些主机可以代你发信         | `v=spf1 include:_spf.yourprovider.com -all`                |
| **DKIM**  | 用私钥签名，收件方可验证未被篡改 | 由邮件服务商提供选择器与公钥，填 `selector._domainkey` TXT |
| **DMARC** | 告诉收件方 SPF/DKIM 失败时怎么办 | `v=DMARC1; p=quarantine; rua=mailto:dmarc@example.com`     |

建议先用**独立子域**（如 `comments.example.com`）发信，避免影响主域声誉。
配好后在管理台点「发送测试邮件」验证 —— 那是全系统唯一同步等待 SMTP 结果的操作，
会直接把错误原因显示出来。

投递是**异步**的：评论写入只入队，worker 按 `FOR UPDATE SKIP LOCKED` 取任务投递，
单条失败只标记该条并指数退避（1/2/4/8/16 分钟），超过 5 次留档等人工重发。
**SMTP 不可用时评论发布依然成功**。

需要把 worker 拆成独立容器时，用外部 cron 触发：

```bash
curl -fsS -X POST https://comments.example.com/internal/outbox/drain \
  -H "X-Recado-Internal-Token: $INTERNAL_DRAIN_TOKEN"
```

---

## 7. 备份与恢复

```bash
# 备份
docker compose -f docker/compose.yaml exec postgres \
  pg_dump -U recado -Fc recado > recado-$(date +%F).dump

# 恢复
docker compose -f docker/compose.yaml exec -T postgres \
  pg_restore -U recado -d recado --clean --if-exists < recado-2026-01-01.dump
```

请把 `SECRETS_KEY` 与备份一起保存：没有它，恢复出来的站点 SMTP 密码无法解密。

---

## 8. 升级

```bash
git pull
docker compose -f docker/compose.yaml build app
docker compose -f docker/compose.yaml run --rm migrate   # 先迁移
docker compose -f docker/compose.yaml up -d app          # 再重启
```

迁移是向后兼容一个版本的（先加列、再用、最后删旧列），因此可以滚动升级。

---

## 9. 常见故障

| 现象                                                                            | 原因与处理                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 启动即退出，stderr 列出环境变量                                                 | 配置缺失或格式错。对照 `.env.example` 补齐                                                                                                                                                                                                                                          |
| 登录后提示无权限                                                                | IdP 侧角色没配好。跑 `pnpm cli auth:diagnose --token <token>`                                                                                                                                                                                                                       |
| 访客拿到 403，站长不知为何                                                      | 来源白名单没配。管理台「来源自检」页会列出最近被拒绝的 Origin 与原因                                                                                                                                                                                                                |
| 所有公开请求 403                                                                | 白名单为空时**拒绝一切**（安全默认）。在站点设置里加上域名                                                                                                                                                                                                                          |
| 邮件一直失败                                                                    | 看管理台「邮件」页的投递日志；`EAUTH` 这类错误是永久失败，不会无限重试                                                                                                                                                                                                              |
| 评论发不出去                                                                    | 检查 `minIntervalSeconds`（同 IP 同站点最小间隔）与 `maxContentBytes`                                                                                                                                                                                                               |
| 换过 `SECRETS_KEY` 后邮件发不出                                                 | SMTP 密码解不开，需要重新填写                                                                                                                                                                                                                                                       |
| 改了 `OIDC_ROLE_PREFIX` 后所有人都进不来                                        | 角色名必须跟着改；前缀变更等于换了一套授权命名空间                                                                                                                                                                                                                                  |
| 迁移失败，stderr 只有一句 `Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"` | 真因在其后打印的错误链里（`code`/`detail`）。若是 `42501 permission denied for database`，说明**应用角色不是该库的属主**：本机库由 `recado-postgres-ownership.service` 自动处理，外部库请执行 `ALTER DATABASE <库> OWNER TO <角色>`（或 `GRANT CREATE ON DATABASE <库> TO <角色>`） |

---

## 10. 运维命令速查

```bash
pnpm cli site:create --name "..." --origin https://...   # 创建站点并签发 site key
pnpm cli admin:grant --owner                             # 打印实例管理员角色名
pnpm cli admin:grant --site <UUID>                       # 打印站点管理员角色名
pnpm cli auth:diagnose --token <token>                   # 诊断角色与可见站点
pnpm cli comment:rerender --site <UUID> --dry-run        # 重放历史评论的 HTML
pnpm cli outbox:retry --site <UUID>                      # 重发失败邮件
pnpm db:migrate                                          # 执行迁移（独立步骤）
```

管理 API（脚本 / CI）：所有 `/api/v1/admin/*` 端点既接受会话 Cookie，也接受
`Authorization: Bearer <OIDC access token>`，并需要 `X-Recado-Site-Id: <站点 UUID>`。

---

## 11. Nix / NixOS 部署

仓库自带 `flake.nix`，产物与 Docker 镜像**同源**：都是 `pnpm build` 产出的
`apps/server/.output`，区别只在依赖来自 `fetchPnpmDeps` 冻结的 pnpm 存储，
因此**构建期不联网**、也不需要在构建机上装 pnpm。

### 11.1 产物

| 产物                           | 内容                                                                     |
| ------------------------------ | ------------------------------------------------------------------------ |
| `packages.<system>.recado`     | 服务端：自包含的 `.output` + `bin/recado` 包装脚本，运行时只需要 Node.js |
| `packages.<system>.recado-cli` | `bin/recado-cli`（运维 CLI）与 `bin/recado-migrate`（数据库迁移）        |

迁移仍然按 §8.5 的约定**独立执行**：它是单独的命令、单独的一次性服务，
**不会**在应用启动时自动跑。

### 11.2 任意 Linux（不用 NixOS）

```bash
nix build .#recado        # → result/bin/recado
nix build .#recado-cli    # → result/bin/recado-cli、result/bin/recado-migrate

# 运行（环境变量与 Docker 部署完全一致）
DATABASE_URL=postgres://... SESSION_SECRET=... SECRETS_KEY=... ./result/bin/recado

# 迁移（独立步骤）
DATABASE_URL=postgres://... ./result/bin/recado-migrate

# 创建第一个站点
DATABASE_URL=... ./result/bin/recado-cli site:create \
  --name "我的博客" --origin https://blog.example.com
```

> 两条 `nix build` 都会写 `./result`；需要同时保留两个产物时用 `-o` 换个链接名
> （例如 `nix build .#recado-cli -o result-cli`）。

`recado` 不读任何内置配置，环境变量清单与第 1 节完全相同（可以写成 `.env`
再用 systemd 的 `EnvironmentFile=` 注入）。默认监听 `PORT`（3000），
HTTPS 与 `X-Forwarded-*` 依旧由反向代理负责（第 3 节）。

### 11.3 NixOS 模块

```nix
{
  inputs.recado.url = "git+https://your.git.host/recado";

  # nixosSystem / flake 的 modules 里：
  imports = [ recado.nixosModules.default ];

  services.recado = {
    enable = true;
    settings = {
      LOG_LEVEL = "info";
      OIDC_ISSUER_URL = "https://id.example.com";
      OIDC_CLIENT_ID = "recado";
      OIDC_REDIRECT_URI = "https://comments.example.com/auth/callback";
      OIDC_ROLE_PREFIX = "recado";
      PUBLIC_BASE_URL = "https://comments.example.com";
    };
    # 🔑 密钥不进 Nix store（store 全局可读）：用 sops-nix / agenix 生成这个文件
    environmentFile = "/run/secrets/recado.env";
    # 可选：在本机跑 PostgreSQL（socket + peer 认证，不需要密码）
    database.createLocally = true;
  };
}
```

`environmentFile` 至少要有 `DATABASE_URL`、`SESSION_SECRET`（≥32 字符）、
`SECRETS_KEY`（≥32 字符）、`OIDC_CLIENT_SECRET`。**不含密码的 `DATABASE_URL`
也可以写在 `settings` 里**（`database.createLocally = true` 就是自动这么做的）。

模块提供两个 unit（外加一个本机数据库的辅助 unit）：

| unit                                | 触发方式                                  | 说明                                                          |
| ----------------------------------- | ----------------------------------------- | ------------------------------------------------------------- |
| `recado.service`                    | 开机自启                                  | 应用本体：非 root 系统用户 + 一组 systemd 加固                |
| `recado-migrate.service`            | **手动** `systemctl start recado-migrate` | 一次性迁移，刻意不挂 `wantedBy`（见 §8.5 与第 2 节）          |
| `recado-postgres-ownership.service` | 仅在 `database.createLocally` 时存在      | 把 `database.name` 的属主改成服务角色；迁移与启动都排在它之后 |

> `database.createLocally` **不**使用 nixpkgs 的 `ensureDBOwnership`：它只把**与角色同名**
> 的库交给该角色，库名一旦不同就会留下「库主是 postgres」，迁移必然在 `CREATE SCHEMA`
> 上以 `permission denied` 失败。属主由上面那个 unit 显式修正（幂等，postgres 每次启动后重跑）。
> 外部数据库没有这个 unit，需要你自己保证库主是服务角色（见 §9 的最后一行）。

只想用 `nix/module.nix` 而不引入 flake 的话，需要自己提供包：
`nixpkgs.overlays = [ recado.overlays.default ]`，或显式设置
`services.recado.package` / `services.recado.cliPackage`。

### 11.4 升级

```bash
nix flake update recado               # 或先把仓库切到目标提交
sudo nixos-rebuild switch
sudo systemctl start recado-migrate   # 先迁移
sudo systemctl restart recado         # 再重启
```

迁移向后兼容一个版本，所以「先迁库、再换代码」这个顺序是安全的（与第 8 节一致）。

### 11.5 打包侧的维护点

- **`nix/pnpm-deps-hash.nix`**：改了 `pnpm-lock.yaml`、或换了 pnpm 大版本之后必须
  重新生成依赖哈希，文件里写了办法。忘了改也不会静默出错 —— 构建会以
  `hash mismatch` 报出正确值。
- 只依赖 nixpkgs 一个 flake 输入；pnpm 用 nixpkgs 的 `pnpm_12`（12.3.x），
  与 `package.json` 里锁的 12.4.1 同大版本，lockfile 格式（9.0）不变。
- 目前只验证了 `x86_64-linux`；在 `aarch64-linux` 上首次构建会报出该平台的依赖
  哈希，填进 `nix/pnpm-deps-hash.nix` 即可。
- `nix flake check` 会构建上面两个产物；`nix fmt` 用 `nixfmt-rfc-style`。
