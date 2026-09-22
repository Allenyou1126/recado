/**
 * PostgreSQL 自定义列类型。
 *
 * drizzle-orm 0.45 没有内置 `citext` 与 `inet`，用 `customType` 声明。
 *
 * ⚠️ 本文件刻意**不被 `schema/index.ts` 再导出**：它只是列类型的实现细节，
 * 表定义各自 import 即可，避免把 `inet` 这类与 drizzle 同名的名字带上公共出口。
 */

import { customType } from 'drizzle-orm/pg-core';

/**
 * `citext` —— 大小写不敏感文本。
 *
 * 用于邮箱归并：`Alice@x.com` 与 `alice@x.com` 必须落到同一档案。
 * 迁移里需带 `CREATE EXTENSION IF NOT EXISTS citext;`。
 */
export const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});

/** `inet` —— PostgreSQL 原生 IP 类型，比 text 省空间且天然校验格式 */
export const inet = customType<{ data: string }>({
  dataType: () => 'inet',
});
