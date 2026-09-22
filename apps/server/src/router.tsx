import { QueryClient } from '@tanstack/react-query';
import { createRouter as createTanStackRouter } from '@tanstack/react-router';

import { routeTree } from './routeTree.gen';

/**
 * 路由工厂。
 *
 * 每个请求都要新建一个实例（而不是模块级单例），
 * 否则 SSR 期间不同请求会共享同一个 QueryClient 与路由状态。
 */
export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // 管理台数据变动频繁，默认不缓存过久；具体查询自行覆盖
        staleTime: 30_000,
        retry: 1,
      },
    },
  });

  return createTanStackRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    scrollRestoration: true,
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
