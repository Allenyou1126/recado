/**
 * 管理端写操作的统一请求封装。
 *
 * 三件事必须每处都做对，因此收敛到这里：
 * 1. 带上 `X-Recado-Site-Id`（管理端用站点 UUID，不是公开端的 site key）
 * 2. 带 CSRF 双重提交头 —— **Server Route 不受框架 CSRF 保护**（§8.4）
 * 3. 把错误信封解成可读信息，而不是把 Response 丢给调用方
 */

/** 读 CSRF Cookie（它由服务端在建立会话时下发，非 HttpOnly，前端要能读） */
function readCsrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)recado_csrf=([^;]*)/);
  return match?.[1] === undefined ? '' : decodeURIComponent(match[1]);
}

export type AdminRequestResult<TData> =
  | { ok: true; data: TData }
  | { ok: false; reason: string; message: string; details?: unknown };

export async function adminRequest<TData>(
  siteId: string,
  path: string,
  init: { method: 'POST' | 'PATCH' | 'DELETE'; body?: unknown },
): Promise<AdminRequestResult<TData>> {
  try {
    const response = await fetch(path, {
      method: init.method,
      headers: {
        'X-Recado-Site-Id': siteId,
        'X-Recado-CSRF-Token': readCsrfToken(),
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });

    const payload: unknown = await response.json().catch(() => undefined);

    if (!response.ok) {
      const error =
        typeof payload === 'object' && payload !== null ? Reflect.get(payload, 'error') : undefined;

      if (typeof error === 'object' && error !== null) {
        return {
          ok: false,
          reason: String(Reflect.get(error, 'reason')),
          message: String(Reflect.get(error, 'message')),
          details: Reflect.get(error, 'details'),
        };
      }

      return { ok: false, reason: 'INTERNAL_UNEXPECTED', message: `HTTP ${response.status}` };
    }

    const data =
      typeof payload === 'object' && payload !== null ? Reflect.get(payload, 'data') : null;

    return { ok: true, data: data as TData };
  } catch (cause) {
    return {
      ok: false,
      reason: 'CLIENT_NETWORK_FAILED',
      message: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/** 把错误码翻译成中文提示（表单错误定位到具体字段，T8.9） */
export function explainReason(reason: string, message: string): string {
  const table: Record<string, string> = {
    FORBIDDEN_CSRF_TOKEN_INVALID: 'CSRF 校验失败，请刷新页面后重试。',
    FORBIDDEN_SITE_SCOPE: '当前账号没有该站点的权限。',
    AUTH_SESSION_INVALID: '登录状态已失效，请重新登录。',
    CONFLICT_BATCH_PARTIAL_FAILURE: '批量操作未执行：存在不合法的条目，详见下方明细。',
    CONFLICT_INVALID_STATUS_TRANSITION: '该状态转移不被允许（例如已删除的评论无法恢复）。',
    VALIDATION_INVALID_BODY: '提交的内容不合校验，请检查后重试。',
    VALIDATION_INVALID_ORIGIN: '来源白名单条目格式不正确。',
    CONFLICT_SMTP_NOT_CONFIGURED: '该站点还没有配置 SMTP，请先在站点设置里填写。',
    FORBIDDEN_ROLE_REQUIRED: '当前账号权限不足。',
  };

  return table[reason] ?? `${message}（${reason}）`;
}
