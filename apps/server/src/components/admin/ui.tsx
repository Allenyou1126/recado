/**
 * 管理台的本地 UI 原语。
 *
 * 为什么自己写而不是装 shadcn/ui：shadcn 的本质就是「把组件源码复制进仓库」，
 * 而这里需要的只有按钮、对话框与表格三样。少一层 CLI 与若干 radix 依赖，
 * 审查面积更小；行为上仍然满足 Q-13 的要求（Tailwind + 中文 + 键盘可达）。
 *
 * 键盘可达性是**硬要求**（T8.9）：原生 `<dialog>` 自带焦点陷阱与 Esc 关闭，
 * 比手写 div 弹层可靠得多。
 */

import {
  useEffect,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
  type RefObject,
} from 'react';

export function Button({
  variant = 'default',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'danger' | 'ghost';
}) {
  const styles: Record<string, string> = {
    default: 'border border-neutral-300 bg-white text-neutral-800 hover:bg-neutral-50',
    primary: 'border border-transparent bg-neutral-900 text-white hover:bg-neutral-800',
    danger: 'border border-transparent bg-red-600 text-white hover:bg-red-700',
    ghost: 'border border-transparent text-neutral-600 hover:bg-neutral-100',
  };

  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 rounded px-3 py-1.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-neutral-900 disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`}
      {...props}
    />
  );
}

/**
 * 二次确认对话框。
 *
 * **禁止 `prompt()` / `confirm()`**（Waline 管理台的明确缺陷，T8.9）：
 * 它们无法说明影响范围、无法本地化、样式不可控，还会在某些浏览器里被拦截。
 *
 * `impact` 用来显式写清「这次操作会影响什么」—— 例如「将删除 12 条评论」。
 */
export function ConfirmDialog({
  open,
  title,
  impact,
  confirmLabel = '确认',
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  impact: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref: RefObject<HTMLDialogElement | null> = useRef(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      // Esc 关闭时同步状态（原生行为会直接关掉，React 侧必须跟上）
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      className="w-[min(28rem,90vw)] rounded-lg border border-neutral-200 p-0 backdrop:bg-black/30"
      aria-labelledby="confirm-title"
    >
      <div className="flex flex-col gap-3 p-5">
        <h2 id="confirm-title" className="text-base font-semibold text-neutral-900">
          {title}
        </h2>
        <p className="text-sm text-neutral-600">{impact}</p>

        <div className="mt-2 flex justify-end gap-2">
          <Button onClick={onCancel} disabled={busy}>
            取消
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            onClick={onConfirm}
            disabled={busy}
            autoFocus
          >
            {busy ? '处理中…' : confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-neutral-700">{label}</span>
      {children}
    </label>
  );
}

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`rounded border border-neutral-300 px-2 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-900 ${props.className ?? ''}`}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`rounded border border-neutral-300 bg-white px-2 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-neutral-900 ${props.className ?? ''}`}
    />
  );
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: string }) {
  const tones: Record<string, string> = {
    neutral: 'bg-neutral-100 text-neutral-700',
    green: 'bg-green-100 text-green-800',
    amber: 'bg-amber-100 text-amber-800',
    red: 'bg-red-100 text-red-800',
  };

  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${tones[tone] ?? tones.neutral}`}>
      {children}
    </span>
  );
}

/** 统一的错误提示条 */
export function ErrorBanner({ message }: { message: string | null }) {
  if (message === null) return null;

  return (
    <p
      role="alert"
      className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
    >
      {message}
    </p>
  );
}
