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
 * ⚠️ `Register.server.requestContext` 的模块增强只描述**类型形状**：
 * 框架默认的 Node 入口不会传入任何值（`createNullProtoObject(undefined)`），
 * 真正的值由 `baseMiddleware` 注入。因此所有 API 路由都必须挂 baseMiddleware。
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
  };

  /** 第四级：管理端 + 已校验该主体对本站点有权限 */
  type AdminSiteContext = ActorContext & { site: Site };
}

declare module '@tanstack/react-start' {
  interface Register {
    server: { requestContext: BaseContext };
  }
}
