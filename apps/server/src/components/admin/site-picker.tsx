import { Select } from './ui';

/**
 * 站点选择器（M1「多站点切换」）。
 *
 * 站点标识一律用 **UUID**（决策 D17），展示名仅供参考 —— 所以这里
 * 把 UUID 也一并显示出来：站长在 IdP 里配角色时需要它。
 */
export function SitePicker({
  sites,
  value,
  onChange,
}: {
  sites: Array<{ id: string; name: string; status: string }>;
  value: string;
  onChange: (siteId: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <label className="flex items-center gap-2 text-sm">
        <span className="font-medium text-neutral-700">当前站点</span>
        <Select
          value={value}
          aria-label="选择站点"
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          {sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
              {site.status === 'disabled' ? '（已停用）' : ''}
            </option>
          ))}
        </Select>
      </label>

      {value.length > 0 ? (
        <code className="rounded bg-neutral-100 px-2 py-1 font-mono text-xs text-neutral-600">
          {value}
        </code>
      ) : null}
    </div>
  );
}
