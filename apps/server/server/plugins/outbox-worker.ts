/**
 * Nitro 运行时插件：随服务启动 outbox worker。
 *
 * 框架没有启动生命周期钩子，Nitro 插件是唯一合适的位置（见 requirements.md §8.5）。
 *
 * `WORKER_MODE` 之类的开关暂不引入：需求要求「小规模用 inline」，
 * 而单容器部署就是 inline 的形态；需要隔离时把 `pnpm cli outbox:drain`
 * 挂到外部 cron 即可（T6.5 的端点就是为此准备的）。
 */

import { getEnv } from '../../src/config/env.server';
import { startOutboxWorker } from '../../src/lib/outbox-worker.server';

export default function startWorkerAtBoot(): void {
  const env = getEnv();

  // 测试环境不启动轮询：它会干扰断言，也让测试进程难以退出
  if (env.NODE_ENV === 'test') return;

  startOutboxWorker(env);
}
