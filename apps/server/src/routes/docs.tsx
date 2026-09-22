import { createFileRoute } from '@tanstack/react-router';

/**
 * `GET /docs` —— 可交互的 API 文档页。
 *
 * 用 Scalar 的 CDN 脚本渲染 `/openapi.json`：文档页本身不参与 API 契约，
 * 因此不把文档渲染器打进产物（它会让服务端 bundle 膨胀几百 KB）。
 * 若部署环境完全离线，删掉这条路由即可 —— API 本身不受影响。
 */
export const Route = createFileRoute('/docs')({
  component: DocsPage,
});

function DocsPage() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-xl font-semibold">Recado API 文档</h1>
      <p className="mt-2 text-sm text-neutral-500">
        由 Zod schema 生成的 OpenAPI 3.1 文档：{' '}
        <a className="underline underline-offset-4" href="/openapi.json">
          /openapi.json
        </a>
      </p>

      <div id="scalar-mount" className="mt-6" />

      {/*
        用原生 script 而不是引入依赖：文档页是纯静态壳，
        真正的契约在 /openapi.json 里，SDK 与测试都从那里取。
      */}
      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function () {
              var script = document.createElement('script');
              script.src = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference';
              script.onload = function () {
                window.Scalar.createApiReference('#scalar-mount', { url: '/openapi.json' });
              };
              document.head.appendChild(script);
            })();
          `,
        }}
      />
    </main>
  );
}
