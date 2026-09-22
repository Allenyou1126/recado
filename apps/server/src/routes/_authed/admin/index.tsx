import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from 'zod';

import { SitePicker } from '../../../components/admin/site-picker';
import { getDashboardFn } from '../../../lib/admin/admin.functions';

/**
 * 管理台概览（T8.2）。
 *
 * 站点选择放在 **search params** 里（§9.3）：可分享、可刷新、可回退，
 * 而且天然避免了「刷新后站点跳回第一个」这类问题。
 */

const searchSchema = z.object({
  siteId: z.string().optional(),
});

export const Route = createFileRoute('/_authed/admin/')({
  validateSearch: searchSchema,
  component: DashboardPage,
});

function DashboardPage() {
  const { siteId } = Route.useSearch();
  const navigate = useNavigate();
  const { sites } = Route.useRouteContext();

  const activeSiteId = siteId ?? sites[0]?.id ?? '';

  const { data, isPending, error } = useQuery({
    // queryKey 必须含 siteId：否则切换站点会命中上一个站点的缓存（T8 验收）
    queryKey: ['admin', 'dashboard', activeSiteId],
    queryFn: () => getDashboardFn({ data: { siteId: activeSiteId } }),
    enabled: activeSiteId.length > 0,
  });

  return (
    <main className="flex flex-col gap-6">
      <SitePicker
        sites={sites}
        value={activeSiteId}
        onChange={(next) => {
          void navigate({ to: '/admin', search: { siteId: next } });
        }}
      />

      {isPending ? <p className="text-sm text-neutral-500">加载中…</p> : null}
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          加载失败：{error.message}
        </p>
      ) : null}

      {data ? (
        <>
          <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="待审核" value={data.counts.pending} tone="amber" />
            <Stat label="已发布" value={data.counts.approved} tone="green" />
            <Stat label="垃圾" value={data.counts.spam} tone="red" />
            <Stat label="已删除" value={data.counts.deleted} />
          </section>

          <section className="rounded-lg border border-neutral-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-neutral-800">站点信息</h2>
            <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
              <dt className="text-neutral-500">站点 UUID</dt>
              <dd className="font-mono text-xs">{data.site.id}</dd>

              <dt className="text-neutral-500">site key</dt>
              <dd className="font-mono text-xs">{data.key}</dd>

              <dt className="text-neutral-500">状态</dt>
              <dd>{data.site.status === 'active' ? '启用' : '已停用'}</dd>

              <dt className="text-neutral-500">来源白名单</dt>
              <dd>
                {data.allowedOrigins.length === 0
                  ? '（空，将拒绝所有浏览器请求）'
                  : data.allowedOrigins.join('、')}
              </dd>

              <dt className="text-neutral-500">嵌套深度</dt>
              <dd>{data.settings.maxDepth}</dd>

              <dt className="text-neutral-500">审核模式</dt>
              <dd>{AUDIT_MODE_LABELS[data.settings.auditMode] ?? data.settings.auditMode}</dd>

              <dt className="text-neutral-500">SMTP</dt>
              <dd>{data.settings.smtp === null ? '未配置' : '已配置'}</dd>
            </dl>
          </section>
        </>
      ) : null}
    </main>
  );
}

const AUDIT_MODE_LABELS: Record<string, string> = {
  none: '全量放行',
  first_time: '首次评论待审',
  all: '全部待审',
};

function Stat({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: string }) {
  const tones: Record<string, string> = {
    neutral: 'text-neutral-900',
    amber: 'text-amber-700',
    green: 'text-green-700',
    red: 'text-red-700',
  };

  return (
    <div className="rounded-lg border border-neutral-200 bg-white p-4">
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${tones[tone] ?? tones.neutral}`}>{value}</p>
    </div>
  );
}
