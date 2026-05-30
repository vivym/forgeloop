// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CockpitLayout,
  CockpitCommandCenter,
  CompactMetadata,
  DatabaseViewLayout,
  DenseToolbar,
  DevelopmentPlanWorkspace,
  DocumentWorkspaceFrame,
  DocumentWorkspaceLayout,
  EvidenceRail,
  ExecutionSupervisionLayout,
  EvidenceDrawer,
  GateProgress,
  GateRail,
  InboxLayout,
  InspectorRail,
  PlanItemGateWorkspace,
  PlanAuthoringLayout,
  PreviewPane,
  ProductPage,
  PropertyList,
  RequirementWorkspace,
  RevisionDrawer,
  Section,
  StatusDot,
  WorkspaceSplitPane,
} from '../../apps/web/src/shared/layout';
import { EmptyState, InlineNotice, Skeleton } from '../../apps/web/src/shared/ui';
import { ErrorState } from '../../apps/web/src/shared/ui/error-state/error-state';
import { DataTable } from '../../apps/web/src/shared/ui/table/table';
import { expectFirstViewportContract } from './helpers/first-viewport-contract';

afterEach(() => {
  cleanup();
});

describe('product-grade layout primitives', () => {
  it('renders page-specific workspace shells as composition-only roots', () => {
    render(
      <>
        <CockpitCommandCenter attentionQueue={<div>Command center slots</div>} commandStrip={<div>Command strip</div>} />
        <RequirementWorkspace table={<div>Requirement slots</div>} toolbar={<div>Requirement toolbar</div>} />
        <DevelopmentPlanWorkspace inspector={<div>Plan inspector</div>} table={<div>Development plan slots</div>} />
        <PlanItemGateWorkspace gateRail={<div>Gate rail</div>} workspace={<div>Gate slots</div>} />
      </>,
    );

    expect(document.querySelector('[data-product-shell="cockpit-command-center"] [data-cockpit-attention-queue]')?.textContent).toBe('Command center slots');
    expect(document.querySelector('[data-product-shell="requirement-workspace"] [data-typed-document-table]')?.textContent).toBe('Requirement slots');
    expect(document.querySelector('[data-product-shell="development-plan-workspace"] [data-development-plan-table]')?.textContent).toBe('Development plan slots');
    expect(document.querySelector('[data-product-shell="plan-item-gate-workspace"] [data-plan-item-workspace]')?.textContent).toBe('Gate slots');
    expect(screen.queryByRole('heading')).toBeNull();
    expect(document.querySelector('[data-primary-work-surface]')).toBeNull();
  });

  it('renders neutral workspace primitives with stable markers and compact semantics', () => {
    render(
      <WorkspaceSplitPane
        minPrimary="wide"
        primary={<DocumentWorkspaceFrame aria-label="Narrative editor">Document body</DocumentWorkspaceFrame>}
        secondary={
          <InspectorRail aria-label="Inspector">
            <PropertyList
              items={[
                { label: 'Owner', value: 'Product' },
                { label: 'Risk', value: <StatusDot tone="warning" label="High" /> },
              ]}
            />
          </InspectorRail>
        }
        toolbar={
          <DenseToolbar aria-label="Document tools">
            <button type="button">Save</button>
          </DenseToolbar>
        }
      />,
    );

    expect(screen.getByRole('toolbar', { name: 'Document tools' })).toBeTruthy();
    expect(document.querySelector('[data-workspace-split-pane]')).toBeTruthy();
    expect(document.querySelector('[data-workspace-split-pane]')?.className).not.toContain('lg:grid-cols');
    expect(document.querySelector('[data-workspace-split-content]')?.className).toContain('lg:grid-cols');
    expect(document.querySelector('[data-workspace-primary]')?.textContent).toContain('Document body');
    expect(screen.getByRole('region', { name: 'Narrative editor' }).getAttribute('data-document-workspace-frame')).toBe('');
    expect(screen.getByRole('complementary', { name: 'Inspector' }).getAttribute('data-inspector-rail')).toBe('');
    expect(screen.getByText('Owner').tagName).toBe('DT');
    expect(screen.getByText('Product').tagName).toBe('DD');
    expect(screen.getByText('High').closest('[data-status-dot]')?.getAttribute('data-status-tone')).toBe('warning');
  });

  it('does not reserve split pane columns or wrappers for empty array slots', () => {
    render(
      <WorkspaceSplitPane
        minPrimary="wide"
        primary={<section>Primary workspace</section>}
        secondary={[]}
        secondaryWidth="wide"
        toolbar={[]}
      />,
    );

    expect(document.querySelector('[data-workspace-toolbar]')).toBeNull();
    expect(document.querySelector('[data-workspace-secondary]')).toBeNull();
    expect(document.querySelector('[data-workspace-split-pane]')?.className).not.toContain('lg:grid-cols');
    expect(document.querySelector('[data-workspace-split-content]')?.className).not.toContain('lg:grid-cols');
    expect(document.querySelector('[data-workspace-primary]')?.textContent).toBe('Primary workspace');
  });

  it('renders gate and evidence rails without business copy', () => {
    render(
      <WorkspaceSplitPane
        primary={<GateRail aria-label="Gate rail">Gate controls</GateRail>}
        secondary={<EvidenceRail aria-label="Evidence rail">Evidence list</EvidenceRail>}
      />,
    );

    expect(screen.getByRole('region', { name: 'Gate rail' }).getAttribute('data-gate-rail')).toBe('');
    expect(screen.getByRole('complementary', { name: 'Evidence rail' }).getAttribute('data-evidence-rail')).toBe('');
    expect(document.body.textContent).toBe('Gate controlsEvidence list');
  });

  it('does not reserve optional workspace shell rail columns when rails are absent', () => {
    const { rerender } = render(<CockpitCommandCenter attentionQueue={<div>Attention</div>} commandStrip={<div>Commands</div>} />);

    expect(document.querySelector('[data-cockpit-attention-layout]')?.className).not.toContain('xl:grid-cols');

    rerender(<CockpitCommandCenter attentionQueue={<div>Attention</div>} commandStrip={<div>Commands</div>} riskRail={<div>Risk</div>} />);
    expect(document.querySelector('[data-cockpit-attention-layout]')?.className).toContain('xl:grid-cols-[minmax(28rem,1fr)_20rem]');

    rerender(<RequirementWorkspace table={<div>Requirement rows</div>} />);

    expect(document.querySelector('[data-typed-document-layout]')?.className).not.toContain('lg:grid-cols');

    rerender(<RequirementWorkspace inspector={<div>Inspector</div>} table={<div>Requirement rows</div>} />);
    expect(document.querySelector('[data-typed-document-layout]')?.className).toContain('lg:grid-cols-[minmax(28rem,1fr)_20rem]');

    rerender(<DevelopmentPlanWorkspace table={<div>Plan rows</div>} />);
    expect(document.querySelector('[data-development-plan-layout]')?.className).not.toContain('grid-cols');

    rerender(<DevelopmentPlanWorkspace inspector={<div>Plan inspector</div>} table={<div>Plan rows</div>} />);
    expect(document.querySelector('[data-development-plan-layout]')?.className).toContain('2xl:grid-cols-[minmax(32rem,1fr)_22rem]');
  });

  it('does not reserve workspace shell rail columns for empty array slots', () => {
    const { rerender } = render(
      <CockpitCommandCenter
        attentionQueue={<div>Attention</div>}
        commandStrip={<div>Commands</div>}
        riskRail={[]}
        runtimeRail={[]}
      />,
    );

    expect(document.querySelector('[data-cockpit-attention-layout]')?.className).not.toContain('xl:grid-cols');
    expect(document.querySelector('[data-cockpit-rail]')).toBeNull();

    rerender(<RequirementWorkspace inspector={[]} table={<div>Requirement rows</div>} toolbar={[]} />);
    expect(document.querySelector('[data-typed-document-layout]')?.className).not.toContain('lg:grid-cols');
    expect(document.querySelector('[data-typed-document-toolbar]')).toBeNull();
    expect(document.querySelector('[data-typed-document-inspector]')).toBeNull();

    rerender(<DevelopmentPlanWorkspace inspector={[]} table={<div>Plan rows</div>} toolbar={[]} />);
    expect(document.querySelector('[data-development-plan-layout]')?.className).not.toContain('lg:grid-cols');
    expect(document.querySelector('[data-development-plan-toolbar]')).toBeNull();
    expect(document.querySelector('[data-development-plan-inspector]')).toBeNull();
  });

  it('keeps Plan Item workspace in the primary column when optional rails are absent', () => {
    const { rerender } = render(<PlanItemGateWorkspace workspace={<div>Gate workspace</div>} />);

    expect(document.querySelector('[data-plan-item-gate-layout]')?.className).not.toContain('grid-cols');
    expect(document.querySelector('[data-plan-item-workspace]')?.textContent).toBe('Gate workspace');

    rerender(<PlanItemGateWorkspace gateRail={<div>Gate rail</div>} workspace={<div>Gate workspace</div>} />);
    expect(document.querySelector('[data-plan-item-gate-layout]')?.className).toContain('xl:grid-cols-[18rem_minmax(32rem,1fr)]');

    rerender(<PlanItemGateWorkspace evidence={<div>Evidence rail</div>} workspace={<div>Gate workspace</div>} />);
    expect(document.querySelector('[data-plan-item-gate-layout]')?.className).toContain('2xl:grid-cols-[minmax(32rem,1fr)_20rem]');

    rerender(<PlanItemGateWorkspace evidence={<div>Evidence rail</div>} gateRail={<div>Gate rail</div>} workspace={<div>Gate workspace</div>} />);
    expect(document.querySelector('[data-plan-item-gate-layout]')?.className).toContain('xl:grid-cols-[18rem_minmax(32rem,1fr)]');
    expect(document.querySelector('[data-plan-item-gate-layout]')?.className).toContain('2xl:grid-cols-[18rem_minmax(32rem,1fr)_20rem]');
    expect(document.querySelector('[data-plan-item-side-rail]')?.className).toContain('xl:col-start-2');
  });

  it('keeps Plan Item workspace single-column for empty array rails', () => {
    render(<PlanItemGateWorkspace document={[]} evidence={[]} gateRail={[]} workspace={<div>Gate workspace</div>} />);

    expect(document.querySelector('[data-plan-item-gate-layout]')?.className).not.toContain('grid-cols');
    expect(document.querySelector('[data-plan-item-gate-rail]')).toBeNull();
    expect(document.querySelector('[data-plan-item-side-rail]')).toBeNull();
    expect(document.querySelector('[data-plan-item-workspace]')?.textContent).toBe('Gate workspace');
  });

  it('renders ProductPage without old first viewport summary markers', () => {
    render(
      <ProductPage family="cockpit" ariaLabel="Cockpit">
        <CockpitLayout
          attentionQueue={<section>Attention queue</section>}
          commandStrip={<div>Command strip</div>}
          healthRail={<aside>Health</aside>}
          riskColumn={<section>Risks</section>}
        />
      </ProductPage>,
    );

    expect(screen.getByRole('region', { name: 'Cockpit' }).getAttribute('data-page-family')).toBe('cockpit');
    expect(document.querySelectorAll('[data-primary-work-surface]')).toHaveLength(1);
    expect(document.querySelector('[data-primary-work-surface]')?.textContent).toBe('Attention queue');
    expect(document.querySelector('[data-first-viewport]')).toBeNull();
    expect(screen.queryByTestId('current-state')).toBeNull();
    expect(screen.queryByTestId('next-action')).toBeNull();
  });

  it('falls back to planning input context when PlanAuthoringLayout preview primary is omitted', () => {
    render(
      <PlanAuthoringLayout
        aiAssist={<section>AI assist</section>}
        primarySurface="preview"
        planningInputContext={<section>Planning input context</section>}
      />,
    );

    const primaryWorkSurfaces = document.querySelectorAll('[data-primary-work-surface]');
    expect(primaryWorkSurfaces).toHaveLength(1);
    expect(primaryWorkSurfaces[0]?.textContent).toBe('Planning input context');
    expect(primaryWorkSurfaces[0]?.hasAttribute('data-planning-input-picker')).toBe(true);
  });

  it('falls back to planning input context when PlanAuthoringLayout preview primary is null', () => {
    render(
      <PlanAuthoringLayout
        preview={null}
        primarySurface="preview"
        planningInputContext={<section>Planning input context</section>}
      />,
    );

    const primaryWorkSurfaces = document.querySelectorAll('[data-primary-work-surface]');
    expect(primaryWorkSurfaces).toHaveLength(1);
    expect(primaryWorkSurfaces[0]?.textContent).toBe('Planning input context');
    expect(primaryWorkSurfaces[0]?.hasAttribute('data-planning-input-picker')).toBe(true);
  });

  it('falls back to lanes when ExecutionSupervisionLayout evidence primary is omitted', () => {
    render(
      <ExecutionSupervisionLayout
        controls={<section>Worker controls</section>}
        lanes={<section>Execution lanes</section>}
        primarySurface="evidence"
      />,
    );

    const primaryWorkSurfaces = document.querySelectorAll('[data-primary-work-surface]');
    expect(primaryWorkSurfaces).toHaveLength(1);
    expect(primaryWorkSurfaces[0]?.textContent).toBe('Execution lanes');
    expect(primaryWorkSurfaces[0]?.hasAttribute('data-execution-lanes')).toBe(true);
  });

  it('falls back to lanes when ExecutionSupervisionLayout evidence primary is null', () => {
    render(
      <ExecutionSupervisionLayout
        evidence={null}
        lanes={<section>Execution lanes</section>}
        primarySurface="evidence"
      />,
    );

    const primaryWorkSurfaces = document.querySelectorAll('[data-primary-work-surface]');
    expect(primaryWorkSurfaces).toHaveLength(1);
    expect(primaryWorkSurfaces[0]?.textContent).toBe('Execution lanes');
    expect(primaryWorkSurfaces[0]?.hasAttribute('data-execution-lanes')).toBe(true);
  });

  it('keeps optional-rail layouts single-column when rail content is absent', () => {
    render(<InboxLayout list={<section>Inbox queue</section>} />);

    const primaryWorkSurface = document.querySelector('[data-primary-work-surface]');
    expect(primaryWorkSurface?.textContent).toBe('Inbox queue');
    expect(document.querySelector('[data-inspector-panel]')).toBeNull();
    expect(primaryWorkSurface?.parentElement?.className).not.toContain('xl:grid-cols');
  });

  it('keeps DatabaseViewLayout single-column when inspector is an empty array', () => {
    render(
      <DatabaseViewLayout
        inspector={[]}
        table={<section>Database table</section>}
        toolbar={<button type="button">Filter</button>}
      />,
    );

    const primaryWorkSurfaces = document.querySelectorAll('[data-primary-work-surface]');
    expect(primaryWorkSurfaces).toHaveLength(1);
    expect(primaryWorkSurfaces[0]?.textContent).toBe('FilterDatabase table');
    expect(primaryWorkSurfaces[0]?.querySelector('[data-database-toolbar]')).toBeTruthy();
    expect(document.querySelector('[data-row-preview]')).toBeNull();
    expect(primaryWorkSurfaces[0]?.parentElement?.className).not.toContain('xl:grid-cols');
  });

  it('does not render empty child wrappers inside multi-slot rails', () => {
    render(
      <DocumentWorkspaceLayout
        attachments={[]}
        document={<section>Planning input</section>}
        properties={<section>Properties</section>}
      />,
    );

    expect(document.querySelector('[data-property-rail]')?.textContent).toBe('Properties');
    expect(document.querySelector('[data-attachment-strip]')).toBeNull();
    expect(document.querySelectorAll('[data-primary-work-surface]')).toHaveLength(1);
  });

  it('rejects duplicate first viewport page-family markers', () => {
    render(
      <>
        <ProductPage family="cockpit" ariaLabel="Cockpit">
          <CockpitLayout
            attentionQueue={<section>Attention queue</section>}
            commandStrip={<div>Command strip</div>}
            healthRail={<aside>Health</aside>}
            riskColumn={<section>Risks</section>}
          />
        </ProductPage>
        <div data-page-family="cockpit">Duplicate marker</div>
      </>,
    );

    expect(() => expectFirstViewportContract(screen, { pageFamily: 'cockpit' })).toThrow();
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
    expect(row.getAttribute('tabindex')).toBe('0');
    row.focus();
    expect(document.activeElement).toBe(row);
    fireEvent.keyDown(row, { key: 'Enter' });
    fireEvent.keyDown(row, { key: ' ' });
    fireEvent.click(row);
    expect(onSelectRow).toHaveBeenCalledTimes(3);
    expect(onSelectRow).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'release-1' }));

    const headers = within(screen.getByRole('table', { name: 'Release queue' })).getAllByRole('columnheader');
    expect(headers.map((header) => header.textContent)).toEqual(['Title', 'State', 'Next action', 'Risk', 'Current gate']);
  });

  it('keeps selectable DataTable rows from stealing keyboard activation from nested links', () => {
    const onSelectRow = vi.fn();
    render(
      <DataTable
        ariaLabel="Spec queue"
        columns={[
          {
            key: 'title',
            header: 'Title',
            cell: () => <a href="/development-plans/dp-1/items/dpi-1/spec" onClick={(event) => event.preventDefault()}>Open plan item</a>,
          },
          { key: 'state', header: 'State', cell: (row) => row.state },
        ]}
        density="compact"
        getRowKey={(row) => row.id}
        onSelectRow={onSelectRow}
        rows={[{ id: 'spec-1', state: 'Needs review' }]}
      />,
    );

    const link = screen.getByRole('link', { name: 'Open plan item' });
    fireEvent.keyDown(link, { key: 'Enter' });
    fireEvent.keyDown(link, { key: ' ' });
    fireEvent.click(link);

    expect(onSelectRow).not.toHaveBeenCalled();
  });

  it('keeps selectable mobile cards keyboard-operable', () => {
    const onSelectRow = vi.fn();
    const previousMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        media: query,
        matches: query === '(max-width: 767px)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    try {
      render(
        <DataTable
          ariaLabel="Queue cards"
          columns={[
            { key: 'title', header: 'Title', cell: (row) => row.title },
            { key: 'state', header: 'State', cell: (row) => row.state },
          ]}
          getRowKey={(row) => row.id}
          onSelectRow={onSelectRow}
          rows={[{ id: 'item-1', state: 'Waiting', title: 'Release 1' }]}
          selectedRowKey="item-1"
        />,
      );

      const card = screen.getByRole('listitem');
      expect(card.getAttribute('tabindex')).toBe('0');
      expect(card.getAttribute('data-selected-row')).toBe('true');
      card.focus();
      expect(document.activeElement).toBe(card);
      fireEvent.keyDown(card, { key: 'Enter' });
      fireEvent.keyDown(card, { key: ' ' });
      expect(onSelectRow).toHaveBeenCalledTimes(2);
      expect(onSelectRow).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: 'item-1' }));
    } finally {
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: previousMatchMedia });
    }
  });

  it('keeps selectable mobile DataTable cards from stealing keyboard activation from nested links', () => {
    const onSelectRow = vi.fn();
    const previousMatchMedia = window.matchMedia;
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        media: query,
        matches: query === '(max-width: 767px)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    try {
      render(
        <DataTable
          ariaLabel="Spec queue cards"
          columns={[
            {
              key: 'title',
              header: 'Title',
              cell: () => <a href="/development-plans/dp-1/items/dpi-1/spec" onClick={(event) => event.preventDefault()}>Open plan item</a>,
            },
            { key: 'state', header: 'State', cell: (row) => row.state },
          ]}
          getRowKey={(row) => row.id}
          onSelectRow={onSelectRow}
          rows={[{ id: 'spec-1', state: 'Needs review' }]}
        />,
      );

      const cardList = document.querySelector('[data-responsive-card-list]');
      expect(cardList).toBeInstanceOf(HTMLElement);
      const link = within(cardList as HTMLElement).getByRole('link', { name: 'Open plan item' });
      fireEvent.keyDown(link, { key: 'Enter' });
      fireEvent.keyDown(link, { key: ' ' });
      fireEvent.click(link);

      expect(onSelectRow).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: previousMatchMedia });
    }
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
        <PreviewPane title={<span>Evidence preview</span>} meta="2 files">
          Preview
        </PreviewPane>
        <EvidenceDrawer content="Evidence details" title={<span>Evidence drawer</span>} />
        <RevisionDrawer
          revisions={[
            { id: 'r1', title: 'Draft updated', description: 'Owner changed', meta: 'Today' },
          ]}
          title={<span>Revision history</span>}
        />
      </>,
    );

    expect(screen.getByText('Owner').tagName).toBe('DT');
    expect(screen.getByText('Release captain').tagName).toBe('DD');
    expect(screen.getByRole('region', { name: 'Evidence preview' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Evidence drawer' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Revision history' })).toBeTruthy();
    expect(document.querySelector('[data-card-in-card="true"]')).toBeNull();
  });
});
