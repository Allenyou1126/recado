import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { adminRequest, explainReason } from '../../../components/admin/admin-request';
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorBanner,
  Field,
  Input,
} from '../../../components/admin/ui';
import { listSitesFn } from '../../../lib/admin/sites.functions';

/**
 * 站点管理（T8.4）：创建、启停、白名单、配置、key 轮换。
 *
 * key 轮换是**破坏性操作**：旧 key 立即失效，前端不更新就会全线 404。
 * 因此必须二次确认并说明影响范围（T8.9），且轮换后立刻把新 key 显示出来。
 */
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

export const Route = createFileRoute('/_authed/admin/sites')({
  component: SitesPage,
});

function SitesPage() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [rotating, setRotating] = useState<{ id: string; key: string } | null>(null);
  const [newKey, setNewKey] = useState<{ id: string; key: string } | null>(null);

  const { data, isPending } = useQuery({
    queryKey: ['admin', 'sites'],
    queryFn: () => listSitesFn(),
  });

  const createSite = useMutation({
    mutationFn: async (form: FormData) =>
      adminRequest('', '/api/v1/admin/sites', {
        method: 'POST',
        body: {
          name: textField(form, 'name'),
          allowedOrigins: textField(form, 'origins')
            .split(/[\s,]+/)
            .map((value) => value.trim())
            .filter((value) => value.length > 0),
        },
      }),
    onSuccess: async (result) => {
      if (!result.ok) {
        setError(explainReason(result.reason, result.message));
        return;
      }

      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
  });

  const rotate = useMutation({
    mutationFn: async (siteId: string) =>
      adminRequest<{ key: string }>(siteId, `/api/v1/admin/sites/${siteId}/rotate-key`, {
        method: 'POST',
      }),
    onSuccess: async (result, siteId) => {
      setRotating(null);

      if (!result.ok) {
        setError(explainReason(result.reason, result.message));
        return;
      }

      setNewKey({ id: siteId, key: result.data.key });
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
  });

  const disable = useMutation({
    mutationFn: async (input: { id: string; status: 'active' | 'disabled' }) =>
      adminRequest(input.id, `/api/v1/admin/sites/${input.id}`, {
        method: 'PATCH',
        body: { status: input.status },
      }),
    onSuccess: async (result) => {
      if (!result.ok) {
        setError(explainReason(result.reason, result.message));
        return;
      }

      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
  });

  return (
    <main className="flex flex-col gap-6">
      <ErrorBanner message={error} />

      <section className="rounded-lg border border-neutral-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-neutral-800">新建站点</h2>
        <form
          className="mt-3 flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            createSite.mutate(new FormData(event.currentTarget));
          }}
        >
          <Field label="展示名（仅后台可见）">
            <Input name="name" required maxLength={100} />
          </Field>
          <Field label="来源白名单（逗号或空格分隔）">
            <Input name="origins" placeholder="https://blog.example.com, *.example.org" />
          </Field>
          <Button variant="primary" type="submit" disabled={createSite.isPending}>
            创建
          </Button>
        </form>
        <p className="mt-2 text-xs text-neutral-500">
          站点标识是创建后生成的 UUID；`name` 只用于展示，不参与任何授权判定（决策 D17）。
        </p>
      </section>

      {isPending ? <p className="text-sm text-neutral-500">加载中…</p> : null}

      {newKey !== null ? (
        <p className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">
          新 site key：<code className="font-mono">{newKey.key}</code>
          <br />
          旧 key 已立即失效，请把新 key 更新到站点前端。
        </p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {(data?.sites ?? []).map((site) => (
          <li key={site.id} className="rounded-lg border border-neutral-200 bg-white p-4">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium">{site.name}</span>
              <Badge tone={site.status === 'active' ? 'green' : 'neutral'}>
                {site.status === 'active' ? '启用' : '已停用'}
              </Badge>
              <code className="font-mono text-xs text-neutral-500">{site.id}</code>

              <span className="ml-auto flex gap-2">
                <Button
                  onClick={() => {
                    setRotating({ id: site.id, key: site.key });
                  }}
                >
                  轮换 key
                </Button>
                <Button
                  onClick={() => {
                    disable.mutate({
                      id: site.id,
                      status: site.status === 'active' ? 'disabled' : 'active',
                    });
                  }}
                >
                  {site.status === 'active' ? '停用' : '启用'}
                </Button>
              </span>
            </div>

            <dl className="mt-3 grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
              <dt className="text-neutral-500">site key</dt>
              <dd className="font-mono text-xs">{site.key}</dd>
              <dt className="text-neutral-500">来源白名单</dt>
              <dd>
                {site.allowedOrigins.length === 0
                  ? '（空，将拒绝所有浏览器请求）'
                  : site.allowedOrigins.join('、')}
              </dd>
            </dl>
          </li>
        ))}
      </ul>

      <ConfirmDialog
        open={rotating !== null}
        danger
        busy={rotate.isPending}
        title="确认轮换 site key"
        impact={`轮换后旧 key 会**立即失效**，所有还在用旧 key 的页面将收到 404。请准备好同步更新站点前端后再继续。`}
        confirmLabel="轮换"
        onCancel={() => {
          setRotating(null);
        }}
        onConfirm={() => {
          if (rotating !== null) rotate.mutate(rotating.id);
        }}
      />
    </main>
  );
}
