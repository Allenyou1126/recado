import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-24">
      <h1 className="text-3xl font-semibold tracking-tight">Recado</h1>
      <p className="text-neutral-400">自托管、多站点、Headless 的评论系统。</p>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-200/90">
        <p className="font-medium">当前处于开发骨架阶段</p>
        <p className="mt-1 text-amber-200/70">
          公开 API、管理台与 OIDC 登录均未实现。规格见仓库 <code>.specs/</code> 目录。
        </p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-neutral-500">健康检查</dt>
        <dd>
          <a className="underline underline-offset-4" href="/api/v1/health">
            /api/v1/health
          </a>
        </dd>
        <dt className="text-neutral-500">需求与决策</dt>
        <dd className="text-neutral-400">.specs/requirements.md</dd>
        <dt className="text-neutral-500">开发规范</dt>
        <dd className="text-neutral-400">.specs/development-standards.md</dd>
      </dl>
    </main>
  );
}
