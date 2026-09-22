/**
 * 领域错误与错误码规范。
 *
 * 错误码是**对外 API 契约的一部分**：新增错误码是向后兼容的；
 * 修改或删除已有错误码是破坏性变更，需评估 SDK 影响。
 *
 * 见 .specs/development-standards.md §6.2。
 */

export type DomainError<Reason extends string = string> = {
  /** 稳定错误码，SDK 据此分支 */
  reason: Reason;
  /** 面向开发者的英文描述 */
  message: string;
  /** 结构化补充信息（可选） */
  details?: unknown;
};

/**
 * 错误码分类 → HTTP 状态码。
 *
 * 约定：错误码一律 `大写下划线`，形如 `<分类>_<细节>`（如 `NOT_FOUND_SITE`）。
 * 分类名不带下划线，匹配时补上分隔符 —— 下划线是分隔符，不是名字的一部分。
 */
export const ERROR_STATUS = {
  VALIDATION: 400,
  AUTH: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
} as const;

export type ErrorCategory = keyof typeof ERROR_STATUS;

/**
 * 由错误码推导 HTTP 状态码。
 *
 * 未匹配任何已知分类时按 500 处理 —— 错误码拼错会被立刻发现，
 * 而不是静默降级成某个看起来合理的状态码。
 */
export function statusForReason(reason: string): number {
  for (const [category, status] of Object.entries(ERROR_STATUS)) {
    if (reason.startsWith(`${category}_`)) {
      return status;
    }
  }
  return ERROR_STATUS.INTERNAL;
}

/** 构造领域错误的便捷函数 */
export function domainError<const Reason extends string>(
  reason: Reason,
  message: string,
  details?: unknown,
): DomainError<Reason> {
  return details === undefined ? { reason, message } : { reason, message, details };
}
