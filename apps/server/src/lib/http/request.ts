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
  | DomainError<'VALIDATION_INVALID_BODY'>;

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
