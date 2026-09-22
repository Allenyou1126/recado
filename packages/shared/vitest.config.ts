import { defineConfig } from 'vitest/config';

/** @recado/shared 的测试配置：纯 Node 环境，单元测试贴着源码放。 */
export default defineConfig({
  test: {
    name: 'shared',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
});
