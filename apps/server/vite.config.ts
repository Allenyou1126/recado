import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 3000 },

  plugins: [
    tailwindcss(),

    tanstackStart({
      /**
       * 构建期保护：阻止服务端专用模块泄漏进客户端 bundle。
       *
       * 这是 .specs/development-standards.md §3.3 的落地 —— 数据库代码、
       * SMTP 与连接串绝不能进入浏览器产物。
       * build 阶段硬报错，dev 阶段降级为 mock 以便继续开发。
       */
      importProtection: {
        behavior: { dev: 'mock', build: 'error' },
        client: {
          specifiers: [
            'pg',
            'drizzle-orm',
            'nodemailer',
            '@recado/db',
            // 渲染管线是服务端专用：客户端不得拥有独立的 Markdown 渲染器
            'unified',
            'remark-parse',
            'remark-gfm',
            'remark-rehype',
            'rehype-sanitize',
            'rehype-stringify',
            'rehype-mathjax',
            'shiki',
            '@shikijs/rehype',
          ],
          files: ['**/*.server.ts', '**/*.server.tsx'],
        },
      },
    }),

    viteReact(),

    /**
     * Node 常驻服务部署产物：.output/server/index.mjs（见 requirements.md §8.5）。
     *
     * Nitro v3 的 `serverDir` 默认为 `false`（不扫描 `server/` 目录），运行时插件
     * 必须显式登记。启动期要做的事（环境变量校验、邮件 worker）都放在 `server/plugins/`。
     */
    nitro({
      plugins: ['server/plugins/validate-env.ts', 'server/plugins/outbox-worker.ts'],

      /**
       * 关闭 wasm 导出条件。
       *
       * Nitro 默认给包解析加上 `wasm` / `unwasm` 条件，于是 `shiki/core` 会被解析到
       * `core-unwasm.mjs`，进而把 oniguruma 的 `onig.wasm` 拉进服务端构建并失败
       * （Rolldown 无法解析 emscripten 模块里的 `env` 导入）。
       * 我们的高亮用 JavaScript 正则引擎（见 packages/core/.../highlighter.ts），
       * 全程不需要任何 wasm，因此直接关掉这一条件。
       */
      wasm: false,
    }),
  ],
});
