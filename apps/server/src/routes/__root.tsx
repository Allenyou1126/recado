import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import appCss from '../styles.css?url';

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Recado' },
      { name: 'description', content: '自托管、多站点、Headless 的评论系统' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  component: RootComponent,
});

function RootComponent() {
  // ⚠️ 只把 queryClient 放进 **router context** 是不够的：`useQuery` 读的是
  // React Query 自己的 React context，必须由 `QueryClientProvider` 提供。
  // 少了它，管理台每个用到 useQuery 的页面都会在渲染期抛
  // 「No QueryClient set, use QueryClientProvider to set one」：
  // 生产 SSR 下表现为空白页（HTTP 200，内容被截断），客户端则整页崩掉。
  // queryClient 实例来自 router context（每请求一个，见 ../router.tsx）。
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <RootDocument>
        <Outlet />
      </RootDocument>
    </QueryClientProvider>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <head>
        <HeadContent />
      </head>
      <body className="min-h-dvh bg-neutral-950 text-neutral-100 antialiased">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
