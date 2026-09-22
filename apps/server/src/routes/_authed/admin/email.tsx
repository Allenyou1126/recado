import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';

import { adminRequest, explainReason } from '../../../components/admin/admin-request';
import { SitePicker } from '../../../components/admin/site-picker';
import { Badge, Button, ErrorBanner, Field, Input } from '../../../components/admin/ui';
import { listOutboxFn, listUnsubscribesFn } from '../../../lib/admin/admin.functions';

/**
 * 邮件管理（T8.6）：投递日志、手动重发、发信测试、退订列表。
 *
 * 投递日志是**必需**的：邮件是唯一会「悄悄失败」的副作用，
 * 没有日志时站长根本不知道回复通知有没有发出去（Waline 完全没有投递记录）。
 */
const searchSchema = z.object({
  siteId: z.string().optional(),
  status: z.enum(['queued', 'sending', 'sent', 'failed', 'skipped']).optional(),
});

/**
 * 从 FormData 取字符串字段。
 *
 * `String(form.get(...))` 在拿到 File 时会得到 `[object File]`，
 * 而类型检查也不允许对 `FormDataEntryValue` 直接做字符串化。
 */
function textField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

export const Route = createFileRoute('/_authed/admin/email')({
  validateSearch: searchSchema,
  component: EmailPage,
});

const STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  sending: '发送中',
  sent: '已发送',
  failed: '失败',
  skipped: '已跳过',
};

const STATUS_TONES: Record<string, string> = {
  queued: 'neutral',
  sending: 'amber',
  sent: 'green',
  failed: 'red',
  skipped: 'neutral',
};

function EmailPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { sites } = Route.useRouteContext();
  const queryClient = useQueryClient();

  const siteId = search.siteId ?? sites[0]?.id ?? '';
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const outbox = useQuery({
    queryKey: ['admin', 'outbox', siteId, search.status],
    queryFn: () => listOutboxFn({ data: { siteId, status: search.status, page: 1, pageSize: 50 } }),
    enabled: siteId.length > 0,
  });

  const unsubscribes = useQuery({
    queryKey: ['admin', 'unsubscribes', siteId],
    queryFn: () => listUnsubscribesFn({ data: { siteId, page: 1, pageSize: 50 } }),
    enabled: siteId.length > 0,
  });

  const retry = useMutation({
    mutationFn: async (id: string) =>
      adminRequest(siteId, `/api/v1/admin/outbox/${id}/retry`, { method: 'POST' }),
    onSuccess: async (result) => {
      if (!result.ok) {
        setError(explainReason(result.reason, result.message));
        return;
      }
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'outbox'] });
    },
  });

  const testEmail = useMutation({
    mutationFn: async (form: FormData) =>
      adminRequest(siteId, '/api/v1/admin/test-email', {
        method: 'POST',
        body: { to: textField(form, 'to') },
      }),
    onSuccess: (result) => {
      if (!result.ok) {
        // 发信测试的价值就在「即时反馈 SMTP 错误」，因此原样展示服务端信息
        setNotice(null);
        setError(explainReason(result.reason, result.message));
        return;
      }

      setError(null);
      setNotice('测试邮件已交给 SMTP 服务器，请检查收件箱（也看看垃圾箱）。');
    },
  });

  return (
    <main className="flex flex-col gap-5">
      <SitePicker
        sites={sites}
        value={siteId}
        onChange={(next) => {
          void navigate({ to: '/admin/email', search: { siteId: next } });
        }}
      />

      <ErrorBanner message={error} />
      {notice !== null ? (
        <p className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">
          {notice}
        </p>
      ) : null}

      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-800">发信测试</h2>
        <form
          className="mt-3 flex items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            testEmail.mutate(new FormData(event.currentTarget));
          }}
        >
          <Field label="收件人">
            <Input name="to" type="email" required placeholder="me@example.com" />
          </Field>
          <Button variant="primary" type="submit" disabled={testEmail.isPending}>
            发送测试邮件
          </Button>
        </form>
        <p className="mt-2 text-xs text-neutral-500">
          这是全系统唯一一处同步等待 SMTP 结果的操作 —— 它的全部价值就是立刻告诉你配置错在哪。
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-neutral-800">
          投递日志（共 {outbox.data?.total ?? 0} 条）
        </h2>

        <ul className="flex flex-col gap-2">
          {(outbox.data?.items ?? []).map((item) => (
            <li key={item.id} className="rounded border border-neutral-200 bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone={STATUS_TONES[item.status] ?? 'neutral'}>
                  {STATUS_LABELS[item.status] ?? item.status}
                </Badge>
                <span>{item.subject}</span>
                <span className="text-neutral-500">{item.toEmail}</span>
                <span className="text-neutral-400">尝试 {item.attempts} 次</span>

                {item.status === 'failed' ? (
                  <Button
                    className="ml-auto"
                    onClick={() => {
                      retry.mutate(item.id);
                    }}
                  >
                    重发
                  </Button>
                ) : null}
              </div>

              {item.lastError !== null ? (
                <p className="mt-2 font-mono text-xs text-red-700">{item.lastError}</p>
              ) : null}
            </li>
          ))}
          {(outbox.data?.items ?? []).length === 0 && !outbox.isPending ? (
            <li className="text-sm text-neutral-500">暂无投递记录。</li>
          ) : null}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-neutral-800">
          退订列表（共 {unsubscribes.data?.total ?? 0} 条）
        </h2>

        <ul className="flex flex-wrap gap-2 text-sm">
          {(unsubscribes.data?.items ?? []).map((item) => (
            <li key={item.id} className="rounded bg-neutral-100 px-2 py-1">
              {item.email}
            </li>
          ))}
          {(unsubscribes.data?.items ?? []).length === 0 ? (
            <li className="text-neutral-500">还没有人退订。</li>
          ) : null}
        </ul>
      </section>
    </main>
  );
}
