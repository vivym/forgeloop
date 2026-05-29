import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../utils/cn';

interface ProductWorkspaceShellProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
}

export interface CockpitCommandCenterProps extends Omit<ProductWorkspaceShellProps, 'children'> {
  attentionQueue: ReactNode;
  commandStrip: ReactNode;
  riskRail?: ReactNode;
  runtimeRail?: ReactNode;
}

export interface TypedDocumentWorkspaceProps extends Omit<ProductWorkspaceShellProps, 'children'> {
  inspector?: ReactNode;
  table: ReactNode;
  toolbar?: ReactNode;
}

export interface DevelopmentPlanWorkspaceProps extends Omit<ProductWorkspaceShellProps, 'children'> {
  inspector?: ReactNode;
  table: ReactNode;
  toolbar?: ReactNode;
}

export interface PlanItemGateWorkspaceProps extends Omit<ProductWorkspaceShellProps, 'children'> {
  document?: ReactNode;
  evidence?: ReactNode;
  gateRail?: ReactNode;
  workspace: ReactNode;
}

function ProductWorkspaceShell({ children, className, ...props }: ProductWorkspaceShellProps) {
  return (
    <section {...props} className={cn('min-w-0', className)}>
      {children}
    </section>
  );
}

function hasRenderableSlot(slot: ReactNode): boolean {
  if (slot === null || slot === undefined || typeof slot === 'boolean') return false;
  if (typeof slot === 'string') return slot.length > 0;
  if (Array.isArray(slot)) return slot.some(hasRenderableSlot);
  return true;
}

export function CockpitCommandCenter({
  attentionQueue,
  commandStrip,
  riskRail,
  runtimeRail,
  ...props
}: CockpitCommandCenterProps) {
  const hasRiskRail = hasRenderableSlot(riskRail);
  const hasRuntimeRail = hasRenderableSlot(runtimeRail);
  const hasRail = hasRiskRail || hasRuntimeRail;
  return (
    <ProductWorkspaceShell {...props} data-product-shell="cockpit-command-center">
      <div className="grid min-w-0 gap-3" data-cockpit-command-strip="">{commandStrip}</div>
      <div className={cn('grid min-w-0 gap-4', hasRail ? 'xl:grid-cols-[minmax(28rem,1fr)_20rem]' : undefined)} data-cockpit-attention-layout="">
        <section className="min-w-0" data-cockpit-attention-queue="">{attentionQueue}</section>
        {hasRail ? (
          <div aria-label="Cockpit rail" className="grid min-w-0 content-start gap-3" data-cockpit-rail="" role="region">
            {hasRiskRail ? riskRail : null}
            {hasRuntimeRail ? runtimeRail : null}
          </div>
        ) : null}
      </div>
    </ProductWorkspaceShell>
  );
}

function TypedDocumentWorkspace({ inspector, table, toolbar, ...props }: TypedDocumentWorkspaceProps & { 'data-product-shell': string }) {
  const hasInspector = hasRenderableSlot(inspector);
  const hasToolbar = hasRenderableSlot(toolbar);

  return (
    <ProductWorkspaceShell {...props}>
      {hasToolbar ? <div className="min-w-0 overflow-x-auto" data-typed-document-toolbar="">{toolbar}</div> : null}
      <div
        className={cn('grid min-w-0 gap-4', hasInspector ? 'lg:grid-cols-[minmax(28rem,1fr)_20rem]' : undefined)}
        data-typed-document-layout=""
      >
        <section className="min-w-0" data-typed-document-table="">{table}</section>
        {hasInspector ? <aside className="min-w-0" data-typed-document-inspector="">{inspector}</aside> : null}
      </div>
    </ProductWorkspaceShell>
  );
}

export function RequirementWorkspace(props: TypedDocumentWorkspaceProps) {
  return <TypedDocumentWorkspace {...props} data-product-shell="requirement-workspace" />;
}

export function InitiativeWorkspace(props: TypedDocumentWorkspaceProps) {
  return <TypedDocumentWorkspace {...props} data-product-shell="initiative-workspace" />;
}

export function BugWorkspace(props: TypedDocumentWorkspaceProps) {
  return <TypedDocumentWorkspace {...props} data-product-shell="bug-workspace" />;
}

export function TechDebtWorkspace(props: TypedDocumentWorkspaceProps) {
  return <TypedDocumentWorkspace {...props} data-product-shell="tech-debt-workspace" />;
}

export function DevelopmentPlanWorkspace({ inspector, table, toolbar, ...props }: DevelopmentPlanWorkspaceProps) {
  const hasInspector = hasRenderableSlot(inspector);
  const hasToolbar = hasRenderableSlot(toolbar);

  return (
    <ProductWorkspaceShell {...props} data-product-shell="development-plan-workspace">
      {hasToolbar ? <div className="min-w-0 overflow-x-auto" data-development-plan-toolbar="">{toolbar}</div> : null}
      <div
        className={cn('grid min-w-0 gap-4', hasInspector ? '2xl:grid-cols-[minmax(32rem,1fr)_22rem]' : undefined)}
        data-development-plan-layout=""
      >
        <section className="min-w-0" data-development-plan-table="">{table}</section>
        {hasInspector ? <aside className="min-w-0" data-development-plan-inspector="">{inspector}</aside> : null}
      </div>
    </ProductWorkspaceShell>
  );
}

export function PlanItemGateWorkspace({
  document,
  evidence,
  gateRail,
  workspace,
  ...props
}: PlanItemGateWorkspaceProps) {
  const hasDocument = hasRenderableSlot(document);
  const hasEvidence = hasRenderableSlot(evidence);
  const hasGateRail = hasRenderableSlot(gateRail);
  const hasSideRail = hasDocument || hasEvidence;
  return (
    <ProductWorkspaceShell {...props} data-product-shell="plan-item-gate-workspace">
      <div className={cn('grid min-w-0 gap-4', planItemGateLayoutClass(hasGateRail, hasSideRail))} data-plan-item-gate-layout="">
        {hasGateRail ? <aside className="min-w-0" data-plan-item-gate-rail="">{gateRail}</aside> : null}
        <section className="min-w-0" data-plan-item-workspace="">{workspace}</section>
        {hasSideRail ? (
          <aside className={cn('grid min-w-0 content-start gap-3', hasGateRail ? 'xl:col-start-2' : undefined)} data-plan-item-side-rail="">
            {hasDocument ? document : null}
            {hasEvidence ? evidence : null}
          </aside>
        ) : null}
      </div>
    </ProductWorkspaceShell>
  );
}

function planItemGateLayoutClass(gateRail: boolean, sideRail: boolean): string | undefined {
  if (gateRail && sideRail) return 'xl:grid-cols-[18rem_minmax(32rem,1fr)] 2xl:grid-cols-[18rem_minmax(32rem,1fr)_20rem]';
  if (gateRail) return 'xl:grid-cols-[18rem_minmax(32rem,1fr)]';
  if (sideRail) return '2xl:grid-cols-[minmax(32rem,1fr)_20rem]';
  return undefined;
}
