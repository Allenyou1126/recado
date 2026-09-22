import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { SitePicker } from '../../../components/admin/site-picker';
import { Badge } from '../../../components/admin/ui';
import { listAuditLogsFn } from '../../../lib/admin/admin.functions';

/**
 * 审计日志界面（T8.7）。
 *
 * 只读、倒序、按站点隔离。`diff` 由服务端序列化成字符串后展示 ——
 * 审计的价值在于「能查」，而不是「好看」，因此这里不做字段级渲染。
 */
const searchSchema = z.object({
  siteId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export const Route = createFileRoute('/_authed/admin/audit')({
  validateSearch: searchSchema,
  component: AuditPage,
});

const ACTION_LABELS: Record<string, string> = {
  'comment.status_changed': '评论状态变更',
  'comment.edited': '编辑评论',
  'comment.batch': '批量操作',
  'site.created': '创建站点',
  'site.updated': '更新站点',
  'site.key_rotated': '轮换 site key',
  'member.updated': '调整成员',
  'label.assigned': '指派标签',
  'label.unassigned': '取消/删除标签',
  'outbox.retried': '重发邮件',
};

function AuditPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { sites } = Route.useRouteContext();

  const siteId = search.siteId ?? sites[0]?.id ?? '';
  const pageSize = 50;

  const { data, isPending } = useQuery({
    queryKey: ['admin', 'audit', siteId, search.page],
    queryFn: () => listAuditLogsFn({ data: { siteId, page: search.page, pageSize } }),
    enabled: siteId.length > 0,
  });

  return (
    <main className="flex flex-col gap-5">
      <SitePicker
        sites={sites}
        value={siteId}
        onChange={(next) => {
          void navigate({ to: '/admin/audit', search: { siteId: next } });
        }}
      />

      {isPending ? <p className="text-sm text-neutral-500">加载中…</p> : null}

      <p className="text-sm text-neutral-500">共 {data?.total ?? 0} 条</p>

      <ul className="flex flex-col gap-2 text-sm">
        {(data?.items ?? []).map((entry) => (
          <li key={entry.id} className="rounded border border-neutral-200 bg-white p-3">
            <div className="flex flex-wrap items-center gap-3">
              <Badge>{ACTION_LABELS[entry.action] ?? entry.action}</Badge>
              <span className="text-neutral-500">
                {entry.targetType ?? '—'}
                {entry.targetId === null ? '' : ` ${entry.targetId.slice(0, 8)}…`}
              </span>
              <time className="ml-auto text-neutral-400" dateTime={entry.createdAt}>
                {entry.createdAt.slice(0, 19).replace('T', ' ')}
              </time>
            </div>

            {entry.diff !== null ? (
              <pre className="mt-2 overflow-x-auto rounded bg-neutral-50 p-2 font-mono text-xs text-neutral-600">
                {entry.diff}
              </pre>
            ) : null}
          </li>
        ))}
        {(data?.items ?? []).length === 0 && !isPending ? (
          <li className="text-neutral-500">暂无审计记录。</li>
        ) : null}
      </ul>
    </main>
  );
}
