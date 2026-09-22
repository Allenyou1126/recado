import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { z } from 'zod';

import { adminRequest, explainReason } from '../../../components/admin/admin-request';
import { SitePicker } from '../../../components/admin/site-picker';
import {
  Badge,
  Button,
  ConfirmDialog,
  ErrorBanner,
  Field,
  Input,
  Select,
} from '../../../components/admin/ui';
import { listCommentsFn } from '../../../lib/admin/admin.functions';

/**
 * 评论管理（T8.3）。
 *
 * 与 Waline 管理台的差别（研究报告 §3、§6.3 #17）：
 * - **有路径 / 状态 / 关键词筛选**（Waline 完全没有）
 * - 操作后就地刷新，不 `location.reload()`
 * - 批量操作展示**部分失败明细**，而不是只说一句「完成」
 *
 * 状态与筛选放在 search params 里：可分享、可刷新（§9.3）。
 * queryKey 含 siteId 与全部筛选条件，切换站点必然重新拉取（T8 验收）。
 */

const searchSchema = z.object({
  siteId: z.string().optional(),
  status: z.enum(['approved', 'pending', 'spam', 'deleted']).optional(),
  path: z.string().optional(),
  keyword: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
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

export const Route = createFileRoute('/_authed/admin/comments')({
  validateSearch: searchSchema,
  component: CommentsPage,
});

/** 表单里的状态值只有在白名单内才当作筛选条件，避免把任意字符串传给服务端 */
function statusFrom(
  value: FormDataEntryValue | null,
): 'approved' | 'pending' | 'spam' | 'deleted' | undefined {
  return value === 'approved' || value === 'pending' || value === 'spam' || value === 'deleted'
    ? value
    : undefined;
}

const STATUS_LABELS: Record<string, string> = {
  approved: '已发布',
  pending: '待审核',
  spam: '垃圾',
  deleted: '已删除',
};

const STATUS_TONES: Record<string, string> = {
  approved: 'green',
  pending: 'amber',
  spam: 'red',
  deleted: 'neutral',
};

function CommentsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { sites } = Route.useRouteContext();
  const queryClient = useQueryClient();

  const siteId = search.siteId ?? sites[0]?.id ?? '';
  const pageSize = 20;

  const [selected, setSelected] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<{
    ids: string[];
    status: 'approved' | 'spam' | 'deleted';
  } | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const { data, isPending, error } = useQuery({
    queryKey: [
      'admin',
      'comments',
      siteId,
      search.status,
      search.path,
      search.keyword,
      search.page,
    ],
    queryFn: () =>
      listCommentsFn({
        data: {
          siteId,
          status: search.status,
          path: search.path,
          keyword: search.keyword,
          page: search.page,
          pageSize,
        },
      }),
    enabled: siteId.length > 0,
  });

  const refresh = async () => {
    setSelected([]);
    await queryClient.invalidateQueries({ queryKey: ['admin', 'comments'] });
  };

  const mutate = useMutation({
    mutationFn: async (input: {
      ids: string[];
      status: 'approved' | 'pending' | 'spam' | 'deleted';
    }) => {
      if (input.ids.length === 1) {
        const id = input.ids[0] ?? '';
        return adminRequest(siteId, `/api/v1/admin/comments/${id}`, {
          method: 'PATCH',
          body: { status: input.status },
        });
      }

      return adminRequest(siteId, '/api/v1/admin/comments/batch', {
        method: 'POST',
        body: { ids: input.ids, status: input.status },
      });
    },
    onSuccess: async (result) => {
      setConfirm(null);

      if (!result.ok) {
        // 批量部分失败：把明细原样展示出来，不能只说一句「失败」
        const details = result.details;
        const failures =
          typeof details === 'object' && details !== null
            ? Reflect.get(details, 'failures')
            : undefined;

        if (Array.isArray(failures) && failures.length > 0) {
          setFailure(
            failures
              .map((item: unknown) =>
                typeof item === 'object' && item !== null
                  ? `${String(Reflect.get(item, 'commentId'))}：${String(Reflect.get(item, 'reason'))}`
                  : String(item),
              )
              .join('；'),
          );
        } else {
          setFailure(explainReason(result.reason, result.message));
        }

        return;
      }

      setFailure(null);
      await refresh();
    },
  });

  const runAction = (ids: string[], status: 'approved' | 'spam' | 'deleted') => {
    if (status === 'deleted' || status === 'spam') {
      // 破坏性操作一律二次确认，并**明示影响范围**（T8.9）
      setConfirm({ ids, status });
      return;
    }

    mutate.mutate({ ids, status });
  };

  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  return (
    <main className="flex flex-col gap-5">
      <SitePicker
        sites={sites}
        value={siteId}
        onChange={(next) => {
          void navigate({ to: '/admin/comments', search: { siteId: next } });
        }}
      />

      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void navigate({
            to: '/admin/comments',
            search: {
              siteId,
              status: statusFrom(form.get('status')),
              path: textField(form, 'path') || undefined,
              keyword: textField(form, 'keyword') || undefined,
              page: 1,
            },
          });
        }}
      >
        <Field label="状态">
          <Select name="status" defaultValue={search.status ?? ''}>
            <option value="">全部</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="路径">
          <Input name="path" defaultValue={search.path ?? ''} placeholder="/posts/hello" />
        </Field>

        <Field label="关键词（查原文）">
          <Input name="keyword" defaultValue={search.keyword ?? ''} placeholder="评论原文里的词" />
        </Field>

        <Button variant="primary" type="submit">
          筛选
        </Button>
        <Button
          onClick={() => {
            void navigate({ to: '/admin/comments', search: { siteId } });
          }}
        >
          重置
        </Button>
      </form>

      <ErrorBanner message={failure} />

      {selected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm">
          <span>已选 {selected.length} 条</span>
          <Button onClick={() => runAction(selected, 'approved')}>通过</Button>
          <Button onClick={() => runAction(selected, 'spam')}>标记垃圾</Button>
          <Button variant="danger" onClick={() => runAction(selected, 'deleted')}>
            删除
          </Button>
          <Button variant="ghost" onClick={() => setSelected([])}>
            取消选择
          </Button>
        </div>
      ) : null}

      {isPending ? <p className="text-sm text-neutral-500">加载中…</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          加载失败：{error.message}
        </p>
      ) : null}

      {data ? (
        <>
          <p className="text-sm text-neutral-500">
            共 {total} 条{totalPages > 1 ? ` · 第 ${search.page}/${totalPages} 页` : ''}
          </p>

          <ul className="flex flex-col gap-3">
            {data.comments.map((comment) => (
              <li key={comment.id} className="rounded-lg border border-neutral-200 bg-white p-4">
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    aria-label={`选择评论 ${comment.id}`}
                    checked={selected.includes(comment.id)}
                    onChange={(event) => {
                      setSelected((current) =>
                        event.target.checked
                          ? [...current, comment.id]
                          : current.filter((id) => id !== comment.id),
                      );
                    }}
                  />

                  <Badge tone={STATUS_TONES[comment.status] ?? 'neutral'}>
                    {STATUS_LABELS[comment.status] ?? comment.status}
                  </Badge>

                  <span className="font-medium">{comment.nickname ?? '匿名'}</span>
                  <span className="text-neutral-500">{comment.email}</span>
                  <span className="text-neutral-400">{comment.path}</span>
                  <time className="text-neutral-400" dateTime={comment.createdAt}>
                    {comment.createdAt.slice(0, 19).replace('T', ' ')}
                  </time>

                  <span className="ml-auto flex gap-2">
                    <Button
                      onClick={() => {
                        runAction([comment.id], 'approved');
                      }}
                    >
                      通过
                    </Button>
                    <Button
                      onClick={() => {
                        runAction([comment.id], 'spam');
                      }}
                    >
                      垃圾
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => {
                        runAction([comment.id], 'deleted');
                      }}
                    >
                      删除
                    </Button>
                  </span>
                </div>

                {/* 渲染结果已经过服务端消毒，这里直接插入 */}
                <div
                  className="prose prose-sm mt-3 max-w-none text-neutral-800"
                  dangerouslySetInnerHTML={{ __html: comment.content }}
                />

                {comment.ip !== null ? (
                  <p className="mt-2 font-mono text-xs text-neutral-400">
                    IP {comment.ip} · {comment.userAgent?.slice(0, 60) ?? '未知 UA'}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>

          {totalPages > 1 ? (
            <nav className="flex items-center gap-3 text-sm" aria-label="分页">
              <Button
                disabled={search.page <= 1}
                onClick={() => {
                  void navigate({
                    to: '/admin/comments',
                    search: { ...search, siteId, page: search.page - 1 },
                  });
                }}
              >
                上一页
              </Button>
              <span>
                {search.page} / {totalPages}
              </span>
              <Button
                disabled={search.page >= totalPages}
                onClick={() => {
                  void navigate({
                    to: '/admin/comments',
                    search: { ...search, siteId, page: search.page + 1 },
                  });
                }}
              >
                下一页
              </Button>
            </nav>
          ) : null}
        </>
      ) : null}

      <ConfirmDialog
        open={confirm !== null}
        danger={confirm?.status === 'deleted'}
        busy={mutate.isPending}
        title={confirm?.status === 'deleted' ? '确认删除' : '确认标记垃圾'}
        impact={
          confirm === null
            ? ''
            : confirm.status === 'deleted'
              ? `将删除 ${confirm.ids.length} 条评论。子回复会保留并显示「该评论已删除」占位；已发布计数会同步减少。`
              : `将标记 ${confirm.ids.length} 条评论为垃圾。若达到站点阈值，这些邮箱的后续评论会自动进入待审核。`
        }
        confirmLabel={confirm?.status === 'deleted' ? '删除' : '标记垃圾'}
        onCancel={() => {
          setConfirm(null);
        }}
        onConfirm={() => {
          if (confirm !== null) mutate.mutate(confirm);
        }}
      />
    </main>
  );
}
