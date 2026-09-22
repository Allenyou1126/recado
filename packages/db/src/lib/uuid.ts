/**
 * UUID v7（时间有序）生成。
 *
 * 为什么不用 v4：评论列表与分页高度依赖时间序。v4 完全随机，插入会打散 B-tree
 * 索引、也失去了「按 id 排序即按时间排序」这个便利。v7 把 48 位毫秒时间戳放在
 * 高位，既保持随机性又天然有序（.specs/requirements.md §5.2 指定 comments.id 用 v7）。
 *
 * PostgreSQL 16 没有内置 `uuidv7()`（PG 18 才有），因此在应用侧生成，
 * 由 Drizzle 的 `$defaultFn` 在插入时求值。
 */

/** 16 字节 → 8-4-4-4-12 的标准 UUID 字符串 */
function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * 生成一个 UUID v7。
 *
 * 布局（RFC 9562）：48 位毫秒时间戳 | 4 位版本(=7) | 12 位随机 |
 * 2 位变体(=0b10) | 62 位随机。
 *
 * @param now 毫秒时间戳，默认当前时间；显式传入便于测试
 */
export function uuidv7(now: number = Date.now()): string {
  const timestamp = BigInt(now);

  const random = new Uint8Array(10);
  crypto.getRandomValues(random);

  const bytes = new Uint8Array(16);

  // 0..5：48 位大端时间戳
  for (let index = 0; index < 6; index += 1) {
    bytes[index] = Number((timestamp >> BigInt(8 * (5 - index))) & 0xffn);
  }

  // 6..7：版本 7 + 12 位随机
  bytes[6] = 0x70 | ((random[0] ?? 0) & 0x0f);
  bytes[7] = random[1] ?? 0;

  // 8：变体 0b10 + 6 位随机
  bytes[8] = 0x80 | ((random[2] ?? 0) & 0x3f);

  // 9..15：剩余 56 位随机
  bytes.set(random.subarray(3, 10), 9);

  return formatUuid(bytes);
}
