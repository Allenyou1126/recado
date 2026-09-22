/**
 * 根 Vitest 配置 —— 只是把各包的 project 串起来。
 *
 * 各包自带 `vitest.config.ts`（单元测试贴着源码放，见开发规范 §10.3），
 * 根配置负责「一条命令跑全部」：
 *
 *   pnpm test              # 各包分别跑（pnpm -r）
 *   pnpm exec vitest run   # 根配置跑全部 project
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
});
