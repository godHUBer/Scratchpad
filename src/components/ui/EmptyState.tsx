import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

interface EmptyStateProps {
  /** Inline SVG icon. Emoji are avoided: without an OS emoji font they render as empty boxes. */
  icon?: IconName;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ icon = 'bookmark', title, children, action, compact }: EmptyStateProps) {
  return (
    <div
      className={`paper-flat relative flex flex-col items-center gap-3 text-center ${
        compact ? 'px-4 py-6' : 'px-6 py-10'
      }`}
    >
      <span className="tape" aria-hidden />
      <span className="grid h-12 w-12 place-items-center rounded-2xl border-[3px] border-ink bg-cream">
        <Icon name={icon} size={26} />
      </span>
      <h3 className="text-lg font-extrabold">{title}</h3>
      {children ? <div className="max-w-md text-sm text-ink-soft">{children}</div> : null}
      {action ? <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
