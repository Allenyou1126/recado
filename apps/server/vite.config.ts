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
          specifiers: ['pg', 'drizzle-orm', 'nodemailer', '@recado/db'],
          files: ['**/*.server.ts', '**/*.server.tsx'],
        },
      },
    }),

    viteReact(),

    /** Node 常驻服务部署产物：.output/server/index.mjs（见 requirements.md §8.5） */
    nitro(),
  ],
});
