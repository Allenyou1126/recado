import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';

import { adminRequest, explainReason } from '../../../components/admin/admin-request';
import { SitePicker } from '../../../components/admin/site-picker';
import { Badge, Button, ErrorBanner, Field, Input } from '../../../components/admin/ui';
import { listLabelsFn, listMembersFn } from '../../../lib/admin/admin.functions';

/**
 * 成员与标签管理（T8.5）。
 *
 * 成员的身份归并键是**邮箱**（决策 D6），因此邮箱在这里必须可见 ——
 * 站长要凭它判断「这是同一个人吗」。公开 API 永远不返回邮箱（§8.1）。
 *
 * 标签是展示徽章（D7），与审核声誉是两套独立结构：这里既能指派徽章，
 * 也能手动解除待审、清零垃圾计数。
 */
const searchSchema = z.object({
  siteId: z.string().optional(),
  search: z.string().optional(),
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

export const Route = createFileRoute('/_authed/admin/members')({
  validateSearch: searchSchema,
  component: MembersPage,
});

function MembersPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { sites } = Route.useRouteContext();
  const queryClient = useQueryClient();

  const siteId = search.siteId ?? sites[0]?.id ?? '';
  const [error, setError] = useState<string | null>(null);

  const members = useQuery({
    queryKey: ['admin', 'members', siteId, search.search],
    queryFn: () =>
      listMembersFn({ data: { siteId, search: search.search, page: 1, pageSize: 50 } }),
    enabled: siteId.length > 0,
  });

  const labels = useQuery({
    queryKey: ['admin', 'labels', siteId],
    queryFn: () => listLabelsFn({ data: { siteId } }),
    enabled: siteId.length > 0,
  });

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['admin', 'members'] });
  };

  const updateMember = useMutation({
    mutationFn: async (input: { memberId: string; reviewRequired?: boolean; spamCount?: number }) =>
      adminRequest(siteId, `/api/v1/admin/members/${input.memberId}`, {
        method: 'PATCH',
        body: {
          ...(input.reviewRequired === undefined ? {} : { reviewRequired: input.reviewRequired }),
          ...(input.spamCount === undefined ? {} : { spamCount: input.spamCount }),
        },
      }),
    onSuccess: async (result) => {
      if (!result.ok) {
        setError(explainReason(result.reason, result.message));
        return;
      }
      setError(null);
      await refresh();
    },
  });

  const assignLabel = useMutation({
    mutationFn: async (input: { memberId: string; labelId: string; assigned: boolean }) =>
      adminRequest(siteId, `/api/v1/admin/members/${input.memberId}/labels`, {
        method: 'POST',
        body: { labelId: input.labelId, assigned: input.assigned },
      }),
    onSuccess: async (result) => {
      if (!result.ok) {
        setError(explainReason(result.reason, result.message));
        return;
      }
      setError(null);
      await refresh();
    },
  });

  return (
    <main className="flex flex-col gap-5">
      <SitePicker
        sites={sites}
        value={siteId}
        onChange={(next) => {
          void navigate({ to: '/admin/members', search: { siteId: next } });
        }}
      />

      <form
        className="flex items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void navigate({
            to: '/admin/members',
            search: { siteId, search: textField(form, 'search') || undefined },
          });
        }}
      >
        <Field label="按邮箱或昵称搜索">
          <Input name="search" defaultValue={search.search ?? ''} />
        </Field>
        <Button variant="primary" type="submit">
          搜索
        </Button>
      </form>

      <ErrorBanner message={error} />

      {members.isPending ? <p className="text-sm text-neutral-500">加载中…</p> : null}

      <ul className="flex flex-col gap-3">
        {(members.data?.members ?? []).map((member) => (
          <li key={member.id} className="rounded-lg border border-neutral-200 bg-white p-4 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium">{member.nickname ?? '（无昵称）'}</span>
              <span className="text-neutral-500">{member.email}</span>
              <span className="text-neutral-400">评论 {member.commentCount}</span>
              <span className="text-neutral-400">垃圾 {member.spamCount}</span>
              {member.reviewRequired ? <Badge tone="amber">待审中</Badge> : null}

              <span className="ml-auto flex gap-2">
                <Button
                  onClick={() => {
                    updateMember.mutate({
                      memberId: member.id,
                      reviewRequired: !member.reviewRequired,
                    });
                  }}
                >
                  {member.reviewRequired ? '解除待审' : '设为待审'}
                </Button>
                <Button
                  disabled={member.spamCount === 0}
                  onClick={() => {
                    updateMember.mutate({ memberId: member.id, spamCount: 0 });
                  }}
                >
                  清零垃圾计数
                </Button>
              </span>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-neutral-500">展示标签：</span>
              {(labels.data ?? []).map((label) => {
                const assigned = member.labels.some((item) => item.id === label.id);

                return (
                  <label key={label.id} className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={assigned}
                      onChange={(event) => {
                        assignLabel.mutate({
                          memberId: member.id,
                          labelId: label.id,
                          assigned: event.target.checked,
                        });
                      }}
                    />
                    {label.name}
                  </label>
                );
              })}
              {(labels.data ?? []).length === 0 ? (
                <span className="text-xs text-neutral-400">（还没有标签，可在下方创建）</span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <LabelManager siteId={siteId} onChanged={refresh} />
    </main>
  );
}

/** 标签 CRUD（T8.5）：与成员列表同页，避免站长在两个页面之间来回跳 */
function LabelManager({ siteId, onChanged }: { siteId: string; onChanged: () => Promise<void> }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const labels = useQuery({
    queryKey: ['admin', 'labels', siteId],
    queryFn: () => listLabelsFn({ data: { siteId } }),
    enabled: siteId.length > 0,
  });

  const create = useMutation({
    mutationFn: async (form: FormData) =>
      adminRequest(siteId, '/api/v1/admin/labels', {
        method: 'POST',
        body: { name: textField(form, 'name'), color: null, sort: 0 },
      }),
    onSuccess: async (result) => {
      if (!result.ok) {
        setError(explainReason(result.reason, result.message));
        return;
      }
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'labels'] });
      await onChanged();
    },
  });

  const remove = useMutation({
    mutationFn: async (labelId: string) =>
      adminRequest(siteId, `/api/v1/admin/labels/${labelId}`, { method: 'DELETE' }),
    onSuccess: async (result) => {
      if (!result.ok) {
        setError(explainReason(result.reason, result.message));
        return;
      }
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'labels'] });
      await onChanged();
    },
  });

  return (
    <section className="rounded-lg border border-neutral-200 bg-white p-4">
      <h2 className="text-sm font-semibold text-neutral-800">展示标签</h2>
      <ErrorBanner message={error} />

      <ul className="mt-3 flex flex-wrap gap-2 text-sm">
        {(labels.data ?? []).map((label) => (
          <li key={label.id} className="flex items-center gap-2 rounded bg-neutral-100 px-2 py-1">
            <span>{label.name}</span>
            <Button
              variant="ghost"
              className="px-1 py-0 text-xs"
              onClick={() => {
                remove.mutate(label.id);
              }}
            >
              删除
            </Button>
          </li>
        ))}
      </ul>

      <form
        className="mt-3 flex items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate(new FormData(event.currentTarget));
        }}
      >
        <Field label="新标签名">
          <Input name="name" required maxLength={50} placeholder="站长 / 作者 / 友链" />
        </Field>
        <Button variant="primary" type="submit" disabled={create.isPending}>
          创建
        </Button>
      </form>
    </section>
  );
}
