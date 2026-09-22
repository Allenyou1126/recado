import { defineConfig } from 'vitest/config';

/**
 * @recado/server 的测试配置。
 *
 * 刻意**不挂** TanStack Start / Nitro 插件：这里跑的是领域逻辑与路由适配层，
 * 需要整站行为的验证（CORS 预检、405、错误信封）走阶段 3 的生产构建测试。
 */
export default defineConfig({
  test: {
    name: 'server',
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    passWithNoTests: true,
    // 集成测试要连真实 Postgres，默认 5s 偏紧
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
