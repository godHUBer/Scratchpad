import type { ReactNode } from 'react';

interface EmptyStateProps {
  emoji?: string;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ emoji = '📝', title, children, action, compact }: EmptyStateProps) {
  return (
    <div
      className={`paper-flat relative flex flex-col items-center gap-3 text-center ${
        compact ? 'px-4 py-6' : 'px-6 py-10'
      }`}
    >
      <span className="tape" aria-hidden />
      <span className="text-4xl" aria-hidden>
        {emoji}
      </span>
      <h3 className="text-lg font-extrabold">{title}</h3>
      {children ? <div className="max-w-md text-sm text-ink-soft">{children}</div> : null}
      {action ? <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}
