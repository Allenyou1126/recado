/**
 * Result 类型 —— 用返回值表达可预期的业务失败，而不是抛异常。
 *
 * 为什么不用 try/catch：TypeScript 的 catch 块中 `e` 是 `unknown`，
 * 且「谁抛了什么」不写在类型签名里 —— 新增错误而忘记在调用处处理时，
 * 编译不会报错。Result 把错误编码进返回类型，配合 `satisfies never`
 * 即可获得编译期的穷尽检查。
 *
 * 见 .specs/development-standards.md §6.1。
 */

export type Result<TData, TError extends { reason: string }> =
  | { data: TData; error: null }
  | { data: null; error: TError };

export function ok<TData>(data: TData): Result<TData, never> {
  return { data, error: null };
}

/**
 * `const` 类型参数（TS 5.0+）让 TError 的属性推断为字面量类型
 * （如 `reason: "NOT_FOUND_SITE"` 而非宽泛的 `string`）。
 * 这是调用方能做穷尽检查的前提。
 */
export function err<const TError extends { reason: string }>(error: TError): Result<never, TError> {
  return { data: null, error };
}

/** 判断 Result 是否为失败分支（类型收窄用） */
export function isErr<TData, TError extends { reason: string }>(
  result: Result<TData, TError>,
): result is { data: null; error: TError } {
  return result.error !== null;
}
