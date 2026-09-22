/**
 * @recado/core —— 领域逻辑。
 *
 * **本包禁止 import 任何框架 API**（`@tanstack/*`、HTTP 类型、Request/Response）。
 * 这条纪律保证领域逻辑能在不启动 HTTP 服务的前提下被单元测试，
 * 也是「框架可替换」这一风险对策的落地方式。
 * 见 .specs/development-standards.md §2.2。
 *
 * 目录约定（feature-based，每个功能自包含三层）：
 *
 *   src/features/<feature>/
 *     <feature>.schema.ts     Zod schema（输入、输出、类型推导）
 *     <feature>.data.ts       Repo 层：Drizzle 查询
 *     <feature>.service.ts    Service 层：业务逻辑、事务边界
 *     <feature>.errors.ts     该功能特有的错误 reason
 *     <feature>.test.ts       单元测试贴着源码放
 *
 * 功能模块划分见 .specs/requirements.md §6（M1–M10）：
 *   sites / threads / comments / members / labels / moderation /
 *   notifications / rendering / auth / audit
 */

export * from './features/rendering/emoji';
export * from './features/rendering/links';
export * from './features/rendering/mentions';
export * from './features/rendering/rendering.errors';
export * from './features/rendering/rendering.schema';
export * from './features/rendering/rendering.service';
export * from './features/audit/audit.service';
export * from './features/comments/comments.errors';
export * from './features/comments/comments.service';
export * from './features/members/members.service';
export * from './features/moderation/moderation.service';
export * from './features/sites/sites.errors';
export * from './features/sites/sites.schema';
export * from './features/sites/sites.service';
export * from './features/threads/threads.service';
