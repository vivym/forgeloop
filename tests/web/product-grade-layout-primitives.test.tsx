// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ActionStrip,
  CompactMetadata,
  GateProgress,
  GateWorkspace,
  ObjectWorkspace,
  PlanningTableWorkspace,
  PreviewPane,
  PrioritySummary,
  QueueWorkspace,
  RevisionDrawer,
  Section,
  WorkspacePage,
} from '../../apps/web/src/shared/layout';
import { EmptyState, InlineNotice, Skeleton } from '../../apps/web/src/shared/ui';
import { ErrorState } from '../../apps/web/src/shared/ui/error-state/error-state';
import { DataTable } from '../../apps/web/src/shared/ui/table/table';

afterEach(() => {
  cleanup();
});

describe('product-grade layout primitives', () => {
  it('renders WorkspacePage as the product page root with first-viewport hooks', () => {
    render(
      <WorkspacePage
        blockerRisk="Blocked by stale evidence"
        family="release"
        heading="Release cockpit"
        layout="object"
        nextAction={<button type="button">Approve next gate</button>}
        roleResponsibility="Release owner decides"
        state="Gate review pending"
        subtitle="Operational overview"
        toolbar={<button type="button">Refresh</button>}
      >
        <section aria-label="Release body">Body</section>
      </WorkspacePage>,
    );

    const page = screen.getByRole('main', { name: 'Release cockpit' });
    expect(page.getAttribute('data-page-family')).toBe('release');
    expect(page.getAttribute('data-workspace-layout')).toBe('object');
    expect(screen.getByTestId('current-state').textContent).toContain('Gate review pending');
    expect(screen.getByTestId('next-action').textContent).toContain('Approve next gate');
    expect(screen.getByTestId('role-responsibility').textContent).toContain('Release owner decides');
    expect(screen.getByTestId('blocker-risk').textContent).toContain('Blocked by stale evidence');
  });

  it('composes specialized workspaces through WorkspacePage markers', () => {
    render(
      <>
        <ObjectWorkspace
          blockerRisk="No blockers"
          family="object"
          heading="Object"
          nextAction="Inspect object"
          roleResponsibility="Owner"
          state="Ready"
        >
          Object body
        </ObjectWorkspace>
        <QueueWorkspace
          blockerRisk="Two risks"
          family="queue"
          heading="Queue"
          nextAction="Triage first"
          roleResponsibility="Operator"
          state="Waiting"
        >
          Queue body
        </QueueWorkspace>
        <PlanningTableWorkspace
          blockerRisk="Plan drift"
          family="planning"
          heading="Planning"
          nextAction="Assign owner"
          roleResponsibility="Planner"
          state="Drafting"
        >
          Planning body
        </PlanningTableWorkspace>
        <GateWorkspace
          blockerRisk="Gate blocked"
          family="gate"
          heading="Gate"
          nextAction="Resolve gate"
          roleResponsibility="Approver"
          state="Blocked"
        >
          Gate body
        </GateWorkspace>
      </>,
    );

    expect(document.querySelector('[data-workspace-layout="object"]')).toBeTruthy();
    expect(document.querySelector('[data-workspace-layout="queue"]')).toBeTruthy();
    expect(document.querySelector('[data-workspace-layout="planning-table"]')).toBeTruthy();
    expect(document.querySelector('[data-workspace-layout="gate"]')).toBeTruthy();
  });

  it('exposes next action, responsibility, and blocker risk through shared summaries', () => {
    render(
      <>
        <ActionStrip nextAction={<button type="button">Review package</button>} secondaryActions={<button type="button">Defer</button>} />
        <PrioritySummary
          blockerRisk="Evidence is stale"
          roleResponsibility="Release captain"
          state="Needs decision"
        />
      </>,
    );

    expect(screen.getByTestId('next-action').textContent).toContain('Review package');
    expect(screen.getByTestId('current-state').textContent).toContain('Needs decision');
    expect(screen.getByTestId('role-responsibility').textContent).toContain('Release captain');
    expect(screen.getByTestId('blocker-risk').textContent).toContain('Evidence is stale');
  });

  it('renders gate progress with text labels, status text, and current gate semantics', () => {
    render(
      <GateProgress
        currentGateId="qa"
        gates={[
          { id: 'spec', label: 'Spec', status: 'Complete' },
          { id: 'qa', label: 'QA', status: 'Current review' },
          { id: 'release', label: 'Release', status: 'Blocked' },
        ]}
      />,
    );

    expect(screen.getByText('Spec')).toBeTruthy();
    expect(screen.getByText('Complete')).toBeTruthy();
    const currentGate = screen.getByText('QA').closest('li');
    expect(currentGate?.getAttribute('aria-current')).toBe('step');
    expect(currentGate?.textContent).toContain('Current gate');
    expect(screen.getByText('Blocked')).toBeTruthy();
  });

  it('keeps empty, skeleton, notice, and error states layout-preserving', () => {
    const { container } = render(
      <Section title="Work queue">
        <EmptyState title="No work items" description="Filters can be adjusted without losing the page structure." />
        <Skeleton lines={2} />
        <InlineNotice title="Sync pending" description="Results remain in place while the runtime catches up." />
        <ErrorState title="Could not load queue" description="Retry keeps this region in context." retryLabel="Retry" onRetry={() => {}} />
      </Section>,
    );

    expect(screen.getByText('No work items')).toBeTruthy();
    expect(container.querySelectorAll('[data-skeleton-line]').length).toBe(2);
    expect(screen.getByRole('status', { name: 'Sync pending' })).toBeTruthy();
    expect(screen.getByRole('alert', { name: 'Could not load queue' })).toBeTruthy();
    for (const element of [screen.getByText('No work items').parentElement, screen.getByRole('alert', { name: 'Could not load queue' })]) {
      expect(element?.className).not.toMatch(/min-h-screen|h-screen|py-24|py-32/);
    }
  });

  it('makes Section plain by default and requires explicit panel framing', () => {
    const { rerender } = render(<Section title="Plain section">Content</Section>);

    const plainSection = screen.getByRole('heading', { name: 'Plain section' }).closest('section');
    expect(plainSection?.getAttribute('data-section-variant')).toBe('plain');
    expect(plainSection?.className).not.toContain('shadow');
    expect(plainSection?.className).not.toContain('border-border');

    rerender(
      <Section title="Panel section" variant="panel">
        Content
      </Section>,
    );
    const panelSection = screen.getByRole('heading', { name: 'Panel section' }).closest('section');
    expect(panelSection?.getAttribute('data-section-variant')).toBe('panel');
    expect(panelSection?.className).toContain('border-border');
  });

  it('keeps DataTable overflow contained and supports selected rows', () => {
    const onSelectRow = vi.fn();
    render(
      <DataTable
        ariaLabel="Release queue"
        columns={[
          { key: 'title', header: 'Title', cell: (row) => row.title },
          { key: 'state', header: 'State', cell: (row) => row.state },
          { key: 'next-action', header: 'Next action', cell: (row) => row.nextAction },
          { key: 'risk', header: 'Risk', cell: (row) => row.risk },
          { key: 'current-gate', header: 'Current gate', cell: (row) => row.currentGate },
        ]}
        containedScroll
        density="compact"
        getRowKey={(row) => row.id}
        onSelectRow={onSelectRow}
        rows={[
          {
            currentGate: 'QA',
            id: 'release-1',
            nextAction: 'Approve',
            risk: 'Evidence stale',
            state: 'Blocked',
            title: 'Release 1',
          },
        ]}
        selectedRowKey="release-1"
        stickyHeader
      />,
    );

    const scrollContainer = document.querySelector('[data-table-scroll-container]');
    expect(scrollContainer).toBeInstanceOf(HTMLElement);
    expect(scrollContainer?.className).toContain('overflow-x-auto');
    const row = screen.getByRole('row', { name: /Release 1/ });
    expect(row.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(row);
    expect(onSelectRow).toHaveBeenCalledWith(expect.objectContaining({ id: 'release-1' }));

    const headers = within(screen.getByRole('table', { name: 'Release queue' })).getAllByRole('columnheader');
    expect(headers.map((header) => header.textContent)).toEqual(['Title', 'State', 'Next action', 'Risk', 'Current gate']);
  });

  it('renders compact metadata and bounded preview or drawer surfaces without nesting cards', () => {
    render(
      <>
        <CompactMetadata
          items={[
            { label: 'Owner', value: 'Release captain' },
            { label: 'Updated', value: 'Today' },
          ]}
        />
        <PreviewPane title="Evidence preview" meta="2 files">
          Preview
        </PreviewPane>
        <RevisionDrawer
          revisions={[
            { id: 'r1', title: 'Draft updated', description: 'Owner changed', meta: 'Today' },
          ]}
          title="Revision history"
        />
      </>,
    );

    expect(screen.getByText('Owner').tagName).toBe('DT');
    expect(screen.getByText('Release captain').tagName).toBe('DD');
    expect(screen.getByRole('region', { name: 'Evidence preview' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Revision history' })).toBeTruthy();
    expect(document.querySelector('[data-card-in-card="true"]')).toBeNull();
  });
});
