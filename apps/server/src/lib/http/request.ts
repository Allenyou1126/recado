/**
 * 请求体读取与校验。
 *
 * `request.json()` 的失败是**用户输入导致**的预期失败，不是异常
 * （见 .specs/development-standards.md §6.4），因此在这里用 `Result` 包起来，
 * 调用方不必写 try/catch。
 *
 * 本模块不 import 任何框架 API，可直接单测。
 */

import { domainError, err, ok, type DomainError, type Result } from '@recado/shared';
import type { ZodType } from 'zod';

export type RequestBodyError =
  | DomainError<'VALIDATION_INVALID_JSON'>
  | DomainError<'VALIDATION_INVALID_BODY'>
  | DomainError<'VALIDATION_INVALID_QUERY'>;

/** 校验失败时最多回报多少条明细，避免超长错误体 */
const MAX_REPORTED_ISSUES = 10;

/**
 * 读取 JSON 请求体并按 schema 校验。
 *
 * @param request 原始请求
 * @param schema 单一真源（Zod）
 */
export async function readJsonBody<TOutput>(
  request: Request,
  schema: ZodType<TOutput>,
): Promise<Result<TOutput, RequestBodyError>> {
  let raw: unknown;

  try {
    raw = await request.json();
  } catch {
    return err(domainError('VALIDATION_INVALID_JSON', 'Request body is not valid JSON'));
  }

  const parsed = schema.safeParse(raw);

  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    }));

    return err(
      domainError('VALIDATION_INVALID_BODY', 'Request body failed validation', { issues }),
    );
  }

  return ok(parsed.data);
}

/**
 * 把查询串读成对象：重复出现的键收成数组（如 `?paths=a&paths=b`）。
 *
 * 直接把 `Object.fromEntries(searchParams)` 用在这里会**静默丢掉**重复键，
 * 对 `paths` 这类可重复参数是致命的。
 */
function searchParamsToObject(url: URL): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};

  for (const [key, value] of url.searchParams) {
    const existing = result[key];

    if (existing === undefined) {
      result[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      result[key] = [existing, value];
    }
  }

  return result;
}

/** 读取并校验查询串参数 */
export function readQuery<TOutput>(
  request: Request,
  schema: ZodType<TOutput>,
): Result<TOutput, RequestBodyError> {
  const parsed = schema.safeParse(searchParamsToObject(new URL(request.url)));

  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    }));

    return err(
      domainError('VALIDATION_INVALID_QUERY', 'Query parameters failed validation', { issues }),
    );
  }

  return ok(parsed.data);
}
