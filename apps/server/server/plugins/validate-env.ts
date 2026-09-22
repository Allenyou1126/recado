/**
 * Nitro 运行时插件：进程启动即校验环境变量。
 *
 * 为什么需要它：框架没有启动生命周期钩子，而 `.specs/development-plan.md` T0.1 的
 * 验收要求是「缺失或格式错时**启动即失败**」。Nitro 插件在服务开始接收请求之前
 * 执行，正好是承担这件事的位置（见 https://nitro.build/docs/plugins）。
 *
 * ⚠️ 这里**不能**改用 `src/start.ts`：那会让框架的 CSRF 保护静默失效，
 * 并可能触发 issue #7460（见 AGENTS.md 硬性约束）。
 */

import { EnvValidationError, getEnv } from '../../src/config/env.server';

export default function validateEnvAtStartup(): void {
  try {
    getEnv();
  } catch (cause) {
    if (cause instanceof EnvValidationError) {
      // 日志模块本身依赖 env，此刻还不可用，直接写 stderr 保证一定可见
      process.stderr.write(`\n${cause.message}\n\n服务已停止。\n`);
      process.exit(1);
    }
    throw cause;
  }
}
