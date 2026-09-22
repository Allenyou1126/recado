import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit 配置。
 *
 * ⚠️ 迁移作为**独立部署步骤**执行（init container 或一次性任务），
 * 不在应用启动时自动迁移 —— 见 .specs/requirements.md §8.5。
 */
export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  strict: true,
  verbose: true,
});
