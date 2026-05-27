import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../utils/cn';

type SplitPaneWidth = 'standard' | 'wide';

export interface WorkspaceSplitPaneProps extends HTMLAttributes<HTMLDivElement> {
  minPrimary?: SplitPaneWidth;
  primary: ReactNode;
  secondary?: ReactNode;
  secondaryWidth?: SplitPaneWidth;
  toolbar?: ReactNode;
}

export function WorkspaceSplitPane({
  className,
  minPrimary = 'standard',
  primary,
  secondary,
  secondaryWidth = 'standard',
  toolbar,
  ...props
}: WorkspaceSplitPaneProps) {
  const hasSecondary = hasRenderableSlot(secondary);
  const hasToolbar = hasRenderableSlot(toolbar);
  const gridColumns =
    hasSecondary && (minPrimary === 'wide' || secondaryWidth === 'wide')
      ? secondaryWidth === 'wide'
        ? 'lg:grid-cols-[minmax(28rem,1fr)_24rem]'
        : 'lg:grid-cols-[minmax(28rem,1fr)_20rem]'
      : undefined;

  return (
    <div {...props} className={cn('grid min-w-0 gap-3', className)} data-workspace-split-pane="">
      {hasToolbar ? <div className="min-w-0 overflow-x-auto lg:col-span-full" data-workspace-toolbar="">{toolbar}</div> : null}
      <div className={cn('grid min-w-0 gap-4', gridColumns)} data-workspace-split-content="">
        <section className="min-w-0" data-workspace-primary="">
          {primary}
        </section>
        {hasSecondary ? <div className="min-w-0" data-workspace-secondary="">{secondary}</div> : null}
      </div>
    </div>
  );
}

function hasRenderableSlot(slot: ReactNode): boolean {
  if (slot === null || slot === undefined || typeof slot === 'boolean') return false;
  if (typeof slot === 'string') return slot.length > 0;
  if (Array.isArray(slot)) return slot.some(hasRenderableSlot);
  return true;
}

export interface DenseToolbarProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function DenseToolbar({ children, className, ...props }: DenseToolbarProps) {
  return (
    <div
      {...props}
      className={cn('flex min-w-0 flex-wrap items-center gap-2 overflow-x-auto py-1', className)}
      data-dense-toolbar=""
      role="toolbar"
    >
      {children}
    </div>
  );
}

export interface InspectorRailProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

export function InspectorRail({ children, className, ...props }: InspectorRailProps) {
  return (
    <aside {...props} className={cn('min-w-0', className)} data-inspector-rail="">
      {children}
    </aside>
  );
}

export interface PropertyListItem {
  label: ReactNode;
  value: ReactNode;
}

export interface PropertyListProps extends HTMLAttributes<HTMLDListElement> {
  items: readonly PropertyListItem[];
}

export function PropertyList({ className, items, ...props }: PropertyListProps) {
  return (
    <dl {...props} className={cn('grid min-w-0 gap-2 text-sm', className)} data-property-list="">
      {items.map((item, index) => (
        <div className="grid min-w-0 gap-1 sm:grid-cols-[8rem_minmax(0,1fr)]" key={index}>
          <dt className="min-w-0 text-text-muted">{item.label}</dt>
          <dd className="min-w-0 text-text-primary">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface GateRailProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

export function GateRail({ children, className, ...props }: GateRailProps) {
  return (
    <section {...props} className={cn('min-w-0', className)} data-gate-rail="">
      {children}
    </section>
  );
}

export interface EvidenceRailProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

export function EvidenceRail({ children, className, ...props }: EvidenceRailProps) {
  return (
    <aside {...props} className={cn('min-w-0', className)} data-evidence-rail="">
      {children}
    </aside>
  );
}

export interface DocumentWorkspaceFrameProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

export function DocumentWorkspaceFrame({ children, className, ...props }: DocumentWorkspaceFrameProps) {
  return (
    <section {...props} className={cn('min-w-0', className)} data-document-workspace-frame="">
      {children}
    </section>
  );
}

export type StatusDotTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  label: ReactNode;
  tone?: StatusDotTone;
}

const statusDotToneClasses: Record<StatusDotTone, string> = {
  danger: 'bg-red-500',
  info: 'bg-blue-500',
  neutral: 'bg-slate-400',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
};

export function StatusDot({ className, label, tone = 'neutral', ...props }: StatusDotProps) {
  return (
    <span
      {...props}
      className={cn('inline-flex min-w-0 items-center gap-2 text-sm text-text-primary', className)}
      data-status-dot=""
      data-status-tone={tone}
    >
      <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', statusDotToneClasses[tone])} />
      <span className="min-w-0">{label}</span>
    </span>
  );
}
