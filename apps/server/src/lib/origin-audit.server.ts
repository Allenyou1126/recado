/**
 * 来源校验自检：记录最近被拒绝的 Origin（T8.8）。
 *
 * 为什么存在：多站点下误配域名白名单会让整站评论全部 403，
 * 而错误只出现在**访客**的浏览器控制台里 —— 站长看不到任何线索。
 * 这里保留最近若干条拒绝记录，后台一打开就知道「谁被挡了、为什么被挡」。
 *
 * 为什么放进程内内存而不是数据库：
 * - 这是**诊断信息**，不是审计数据，重启丢失完全可以接受
 * - 写库会给公开端点的热路径加一次写操作，而这条路径本来就该尽量轻
 * - 有界环形缓冲，不会无界增长
 */

export type OriginRejection = {
  siteId: string;
  origin: string | null;
  reason: string;
  path: string;
  at: string;
};

const MAX_ENTRIES = 200;

const rejections: OriginRejection[] = [];

export function recordOriginRejection(entry: {
  siteId: string;
  origin: string | null;
  reason: string;
  path: string;
}): void {
  rejections.unshift({ ...entry, at: new Date().toISOString() });

  if (rejections.length > MAX_ENTRIES) {
    rejections.length = MAX_ENTRIES;
  }
}

/** 取某站点最近的拒绝记录（新→旧） */
export function listOriginRejections(siteId: string, limit = 50): OriginRejection[] {
  return rejections.filter((entry) => entry.siteId === siteId).slice(0, limit);
}

/** 仅供测试：清空缓冲 */
export function resetOriginRejections(): void {
  rejections.length = 0;
}
