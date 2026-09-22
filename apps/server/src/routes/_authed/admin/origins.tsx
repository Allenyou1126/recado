import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { SitePicker } from '../../../components/admin/site-picker';
import { listOriginRejectionsFn } from '../../../lib/admin/admin.functions';

/**
 * 来源校验自检（T8.8）。
 *
 * 存在的理由很具体：域名白名单配错时，**访客**拿到 403，而站长在自己的
 * 后台里什么都看不到（错误只出现在访客的浏览器控制台）。这里把最近被拒绝的
 * 来源列出来，一眼就能看出「是漏配了 blog.example.com 还是配成了 www 版」。
 *
 * 记录保存在进程内存里（有界环形缓冲）：它是诊断信息，不是审计数据。
 */
const searchSchema = z.object({
  siteId: z.string().optional(),
});

export const Route = createFileRoute('/_authed/admin/origins')({
  validateSearch: searchSchema,
  component: OriginsPage,
});

const REASON_LABELS: Record<string, string> = {
  FORBIDDEN_ORIGIN_NOT_ALLOWED: '来源不在白名单内',
  FORBIDDEN_ORIGIN_MISSING: '请求没有来源头（站点为 strict）',
};

function OriginsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const { sites } = Route.useRouteContext();

  const siteId = search.siteId ?? sites[0]?.id ?? '';

  const { data, isPending, refetch } = useQuery({
    queryKey: ['admin', 'origins', siteId],
    queryFn: () => listOriginRejectionsFn({ data: { siteId } }),
    enabled: siteId.length > 0,
  });

  return (
    <main className="flex flex-col gap-5">
      <SitePicker
        sites={sites}
        value={siteId}
        onChange={(next) => {
          void navigate({ to: '/admin/origins', search: { siteId: next } });
        }}
      />

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
          onClick={() => {
            void refetch();
          }}
        >
          刷新
        </button>
        <p className="text-xs text-neutral-500">
          只保留最近 200 条，重启后清空 —— 它是诊断信息，不是审计数据。
        </p>
      </div>

      {isPending ? <p className="text-sm text-neutral-500">加载中…</p> : null}

      <ul className="flex flex-col gap-2 text-sm">
        {(data ?? []).map((entry) => (
          <li
            key={`${entry.at}-${entry.origin ?? 'none'}-${entry.path}`}
            className="rounded border border-neutral-200 bg-white p-3"
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-mono text-xs">{entry.origin ?? '（无来源头）'}</span>
              <span className="text-neutral-500">
                {REASON_LABELS[entry.reason] ?? entry.reason}
              </span>
              <span className="text-neutral-400">{entry.path}</span>
              <time className="ml-auto text-neutral-400" dateTime={entry.at}>
                {entry.at.slice(0, 19).replace('T', ' ')}
              </time>
            </div>
          </li>
        ))}
        {(data ?? []).length === 0 && !isPending ? (
          <li className="text-neutral-500">
            最近没有来源被拒绝。若访客报告 403，请确认请求确实打到了这个站点。
          </li>
        ) : null}
      </ul>
    </main>
  );
}
