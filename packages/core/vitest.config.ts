import { defineConfig } from 'vitest/config';

/** @recado/core 的测试配置：纯 Node 环境，单元测试贴着源码放。 */
export default defineConfig({
  test: {
    name: 'core',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
});
