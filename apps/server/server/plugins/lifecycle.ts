/**
 * Nitro 运行时插件：优雅停机与数据库连接池回收（T9.6）。
 *
 * 停机的顺序（需求 M10「生命周期」）：
 * 1. **停止接收**新请求 —— 由宿主（Docker / systemd）发 SIGTERM 后，
 *    Node 不再接受新连接；这里不再主动 close server，避免与框架入口抢控制权
 * 2. **等待在途请求**（下面给一个宽限期）
 * 3. **关闭连接池** —— 否则进程会带着半开的连接退出，数据库侧要等超时才知道
 *
 * 为什么要注册 `SIGTERM` 而不是依赖框架：框架没有任何启动/停机生命周期钩子
 * （requirements.md §8.5），Nitro 插件是唯一可用的位置。
 */

import { getEnv } from '../../src/config/env.server';
import { closeDbClient } from '../../src/lib/db.server';
import { createLogger } from '../../src/lib/logger.server';

/** 在途请求的宽限期：超过就强退，避免「优雅停机」变成「永不退出」 */
const DRAIN_GRACE_MS = 5_000;

export default function registerGracefulShutdown(): void {
  const env = getEnv();

  if (env.NODE_ENV === 'test') return;

  const logger = createLogger(env, { bindings: { lifecycle: 'shutdown' } });
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info({ signal }, 'graceful shutdown started');

    // 给在途请求一点时间跑完，再收连接池
    await new Promise((resolve) => setTimeout(resolve, DRAIN_GRACE_MS));

    try {
      await closeDbClient();
      logger.info('database pool closed');
    } catch (cause) {
      logger.error({ err: cause }, 'failed to close database pool');
    }

    process.exit(0);
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      void shutdown(signal);
    });
  }
}
