import { fileURLToPath } from 'node:url';

import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit 配置。
 *
 * ⚠️ 迁移作为**独立部署步骤**执行（init container 或一次性任务），
 * 不在应用启动时自动迁移 —— 见 .specs/requirements.md §8.5。
 */

/**
 * 本地开发时从仓库根的 `.env` 取连接串；CI 与生产由编排注入环境变量。
 *
 * 只在未设置时加载，避免本地遗留的 `.env` 覆盖真实环境变量。
 */
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
  } catch {
    // 没有 .env 是正常情况（生产与 CI）
  }
}

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    'DATABASE_URL 未设置。本地开发请把 .env.example 复制为 .env 并填写连接串；' +
      '容器/CI 环境请由编排注入 DATABASE_URL。',
  );
}

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
