/**
 * 全局 Context 类型层次 —— 依赖注入的载体。
 *
 * Context 是**逐级升级**的：每个中间件只添加自己负责的依赖，
 * 函数签名里写它真正需要的**最低层级**（见 .specs/development-standards.md §4.1）。
 *
 * ```
 * baseMiddleware        → BaseContext      env / requestId / logger
 *     ↓
 * dbMiddleware          → DbContext        db
 *     ↓
 *     ├── 公开 API 分支
 *     │   siteMiddleware    → SiteContext       site
 *     │   originMiddleware  → SiteContext       origin
 *     │
 *     └── 管理 API 分支
 *         actorMiddleware      → ActorContext     actor + scope
 *         siteScopeMiddleware  → AdminSiteContext site
 * ```
 *
 * ⚠️ **不做 `Register.server.requestContext` 模块增强。**
 * 两条实测理由：
 *
 * 1. 框架消费的 `Register` 定义在 `@tanstack/router-core`（`createMiddleware.ts`
 *    显式 import 该类型），增强 `@tanstack/react-start` 只会新增一个同名接口，
 *    不会影响框架实际读取的那一个 —— 增强后 handler 的 context 依然缺 env。
 * 2. 框架默认的 Node 入口不会传入 request context（`createNullProtoObject(undefined)`），
 *    因此即便增强生效也只是**类型谎言**：`context.env` 在运行期是 undefined。
 *
 * 正确做法是让中间件链成为 context 类型的唯一真源：`baseMiddleware` 注入
 * env / requestId / logger 后，类型由框架的中间件推导自动带上。附带好处是
 * 「路由漏挂 baseMiddleware」会直接编译失败，而不是运行期才炸。
 */

import type { Database, Site } from '@recado/db';
import type { Logger } from 'pino';

import type { Env } from '../config/env.server';
import type { AccessScope, Actor } from './actor';

declare global {
  /** 第一级：每个请求都有的东西 */
  type BaseContext = {
    /** 启动时经 Zod 校验的配置 */
    env: Env;
    /** 贯穿日志与错误响应 */
    requestId: string;
    logger: Logger;
  };

  /** 第二级：注入数据库（Node 常驻下是共享连接池） */
  type DbContext = BaseContext & { db: Database };

  /** 第三级（公开 API）：已解析出站点与来源校验结果 */
  type SiteContext = DbContext & {
    site: Site;
    origin: { allowed: boolean; raw: string | null };
  };

  /** 第三级（管理端）：已认证主体 + 权限范围 */
  type ActorContext = DbContext & {
    actor: Actor;
    scope: AccessScope;
    /** 本次认证的来源：Cookie 认证需要 CSRF 双重提交，Bearer 不需要 */
    authVia: 'cookie' | 'bearer';
    /** 本次命中的角色名（供后台展示与诊断） */
    matchedRoles: string[];
  };

  /** 第四级：管理端 + 已校验该主体对本站点有权限 */
  type AdminSiteContext = ActorContext & { site: Site };
}
