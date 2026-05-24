import type { HTMLAttributes, ReactNode } from 'react';

import { StatusPill } from '../../ui';
import { cn } from '../../utils/cn';

export interface GateProgressGate {
  id: string;
  label: ReactNode;
  status: ReactNode;
}

export interface GateProgressProps extends Omit<HTMLAttributes<HTMLOListElement>, 'children'> {
  gates: GateProgressGate[];
  currentGateId?: string;
}

export function GateProgress({ className, currentGateId, gates, ...props }: GateProgressProps) {
  return (
    <ol className={cn('m-0 grid list-none gap-2.5 p-0', className)} data-gate-progress="" {...props}>
      {gates.map((gate) => {
        const isCurrentGate = gate.id === currentGateId;

        return (
          <li
            aria-current={isCurrentGate ? 'step' : undefined}
            className={cn(
              'grid gap-2 rounded-card border border-border bg-surface p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center',
              isCurrentGate ? 'border-primary/40 bg-primary-soft/30' : undefined,
            )}
            key={gate.id}
          >
            <div className="min-w-0">
              <div className="text-sm font-semibold text-text-primary">{gate.label}</div>
              {isCurrentGate ? <div className="text-xs font-medium text-primary">Current gate</div> : null}
            </div>
            <StatusPill tone={statusToneFor(gate.status)}>{gate.status}</StatusPill>
          </li>
        );
      })}
    </ol>
  );
}

function statusToneFor(value: ReactNode): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (typeof value !== 'string') {
    return 'neutral';
  }
  const text = value.toLowerCase();
  if (text.includes('block') || text.includes('fail') || text.includes('error')) return 'danger';
  if (text.includes('warn') || text.includes('risk') || text.includes('pending')) return 'warning';
  if (text.includes('current') || text.includes('review') || text.includes('progress')) return 'info';
  if (text.includes('ready') || text.includes('complete') || text.includes('done') || text.includes('pass')) return 'success';
  return 'neutral';
}
