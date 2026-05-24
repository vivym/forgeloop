import type { HTMLAttributes, ReactNode } from 'react';

import { InlineNotice, StatusPill } from '../../ui';
import { cn } from '../../utils/cn';

export interface PrioritySummaryProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  state: ReactNode;
  roleResponsibility: ReactNode;
  blockerRisk: ReactNode;
}

export function PrioritySummary({ blockerRisk, className, roleResponsibility, state, ...props }: PrioritySummaryProps) {
  return (
    <div className={cn('grid gap-3 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]', className)} data-priority-summary="" {...props}>
      <div className="grid gap-3 rounded-card border border-border bg-surface p-3 sm:grid-cols-2">
        <div className="grid min-w-0 gap-1">
          <div className="text-xs font-semibold uppercase text-text-secondary">Current state</div>
          <div className="min-w-0" data-testid="current-state">
            <StatusPill tone={stateToneFor(state)}>{state}</StatusPill>
          </div>
        </div>
        <div className="grid min-w-0 gap-1">
          <div className="text-xs font-semibold uppercase text-text-secondary">Role / responsibility</div>
          <div className="text-sm text-text-primary" data-testid="role-responsibility">
            {roleResponsibility}
          </div>
        </div>
      </div>
      <InlineNotice
        data-testid="blocker-risk"
        description={blockerRisk}
        title="Blocker / risk"
        tone={riskToneFor(blockerRisk)}
      />
    </div>
  );
}

function stateToneFor(value: ReactNode): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (typeof value !== 'string') {
    return 'neutral';
  }
  const text = value.toLowerCase();
  if (text.includes('blocked') || text.includes('failed') || text.includes('error')) return 'danger';
  if (text.includes('current') || text.includes('review') || text.includes('progress')) return 'info';
  if (text.includes('ready') || text.includes('complete') || text.includes('done')) return 'success';
  if (text.includes('risk') || text.includes('pending') || text.includes('needs')) return 'warning';
  return 'neutral';
}

function riskToneFor(value: ReactNode): 'neutral' | 'success' | 'warning' | 'danger' {
  if (typeof value !== 'string') {
    return 'neutral';
  }
  const text = value.toLowerCase();
  if (text.includes('none') || text.includes('no blocker') || text.includes('clear')) return 'success';
  if (text.includes('blocked') || text.includes('critical') || text.includes('error')) return 'danger';
  if (text.includes('risk') || text.includes('stale') || text.includes('pending')) return 'warning';
  return 'neutral';
}
