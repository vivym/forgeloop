// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DeliveryActionRail,
  DeliveryActionSummary,
  DeliveryStageRail,
  InitiativeBreakdown,
  PackageMatrix,
} from '../../apps/web/src/features/work-items/delivery-cockpit';
import type { DeliveryPackageDisplayRow } from '../../apps/web/src/features/work-items/work-item-view-model';
import type { ProductAction, WorkItemDeliveryReadiness } from '../../apps/web/src/shared/api/types';
import { legacyRenderedClassTokens } from './helpers/no-legacy-class-scan';

const readinessFixture: WorkItemDeliveryReadiness = {
  work_item_id: 'wi-1',
  work_item_kind: 'requirement',
  active_lane: 'execution-owner',
  overall_state: 'in_progress',
  stages: [
    { id: 'spec', label: 'Spec', state: 'passed', object_refs: [], blockers: [], evidence_refs: [] },
    { id: 'plan', label: 'Plan', state: 'passed', object_refs: [], blockers: [], evidence_refs: [] },
    { id: 'packages', label: 'Packages', state: 'ready', object_refs: [], blockers: [], evidence_refs: [] },
    { id: 'execution', label: 'Execution', state: 'passed', object_refs: [], blockers: [], evidence_refs: [] },
    { id: 'review', label: 'Review', state: 'ready', object_refs: [], blockers: [], evidence_refs: [] },
    {
      id: 'integration_readiness',
      label: 'Integration Readiness',
      state: 'ready',
      object_refs: [],
      blockers: [],
      evidence_refs: [],
    },
    { id: 'quality_gate', label: 'Quality Gate', state: 'ready', object_refs: [], blockers: [], evidence_refs: [] },
    {
      id: 'release_readiness',
      label: 'Release Readiness',
      state: 'blocked',
      object_refs: [],
      blockers: [
        {
          id: 'release-blocker-1',
          label: 'Release scope is missing',
          stage_id: 'release_readiness',
          severity: 'blocking',
        },
      ],
      evidence_refs: [],
    },
  ],
  blockers: [],
  evidence: [],
  next_actions: [
    {
      id: 'run-package',
      lane_id: 'execution-owner',
      priority: 'primary',
      label: 'Run package',
      enabled: true,
      kind: 'navigate',
      target: { kind: 'object', object_type: 'execution_package', object_id: 'pkg-1', href: '/packages/pkg-1' },
    },
  ],
  degraded_sources: [],
};

function packageDisplayFixture(overrides: Partial<DeliveryPackageDisplayRow> = {}): DeliveryPackageDisplayRow {
  return {
    id: 'pkg-1',
    label: 'Review package route changes',
    href: '/packages/pkg-1',
    owner: 'actor-a',
    latestRun: 'run-1',
    stateLabel: 'Ready',
    stateTone: 'success',
    blockingReason: 'Waiting for QA approval',
    ...overrides,
  };
}

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

afterEach(() => cleanup());

describe('Delivery Cockpit presentational components', () => {
  it('renders all eight stages with keyboard anchor behavior', async () => {
    const user = userEvent.setup();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    render(
      <>
        <DeliveryStageRail stages={readinessFixture.stages} />
        {readinessFixture.stages.map((stage) => (
          <section key={stage.id} id={`delivery-stage-${stage.id}`} tabIndex={-1}>
            <h2>{stage.label}</h2>
          </section>
        ))}
      </>,
    );

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(8);

    const execution = screen.getByRole('link', { name: /Execution passed/i });
    expect(execution.getAttribute('href')).toBe('#delivery-stage-execution');
    let clickDefaultPrevented = false;
    document.addEventListener(
      'click',
      (event) => {
        clickDefaultPrevented = event.defaultPrevented;
      },
      { once: true },
    );
    await user.click(execution);
    expect(clickDefaultPrevented).toBe(false);
    await act(() => new Promise((resolve) => window.setTimeout(resolve, 0)));
    expect(document.activeElement?.getAttribute('id')).toBe('delivery-stage-execution');
    expect(scrollIntoView).toHaveBeenCalled();

    const qualityGate = screen.getByRole('link', { name: /Quality Gate/i });
    qualityGate.focus();
    await user.keyboard(' ');
    expect(document.activeElement?.getAttribute('id')).toBe('delivery-stage-quality_gate');
  });

  it('renders mobile action summary data before the stage rail', () => {
    render(<DeliveryActionSummary readiness={readinessFixture} />);

    expect(screen.getByText(/Execution Owner/i)).toBeTruthy();
    expect(screen.getByText(/0 blockers/i)).toBeTruthy();
    expect(screen.getByText('Primary action')).toBeTruthy();
    expect(screen.getByText('Run package')).toBeTruthy();
    expect(screen.getByText('Available')).toBeTruthy();
  });

  it('hardens manager mobile action summary to a read-only primary drill-down', () => {
    render(
      <DeliveryActionSummary
        readiness={{
          ...readinessFixture,
          active_lane: 'manager',
          next_actions: [
            {
              id: 'bad-command',
              lane_id: 'execution-owner',
              priority: 'primary',
              label: 'Run package',
              enabled: true,
              kind: 'command',
              command: {
                type: 'run_package',
                object_type: 'execution_package',
                object_id: 'pkg-1',
                work_item_id: 'wi-1',
                package_id: 'pkg-1',
              },
              target: { kind: 'object', object_type: 'execution_package', object_id: 'pkg-1', href: '/packages/pkg-1' },
            },
          ],
        }}
      />,
    );

    expect(screen.getByText('Open package')).toBeTruthy();
    expect(screen.queryByText('Run package')).toBeNull();
  });

  it('renders package mobile card hierarchy and hides empty blocker rows', () => {
    renderWithRouter(<PackageMatrix packages={[packageDisplayFixture({ blockingReason: undefined })]} />);

    const packageSection = screen.getByRole('heading', { name: /Package matrix/i }).closest('section');
    expect(packageSection?.getAttribute('id')).toBe('delivery-stage-packages');
    expect(packageSection?.getAttribute('tabIndex')).toBe('-1');
    expect(screen.getByText(/Owner/i).compareDocumentPosition(screen.getByText(/Latest run/i))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.queryByText(/Blocking reason/i)).toBeNull();
    expect(screen.getByRole('link', { name: /Open package/i }).getAttribute('href')).toBe('/packages/pkg-1');
  });

  it('renders Initiative breakdown unavailable state without implying release readiness', () => {
    render(<InitiativeBreakdown aggregation={{ mode: 'unavailable', label: 'Child-work aggregation unavailable' }} />);

    expect(screen.getByText(/Initiative breakdown/i)).toBeTruthy();
    expect(screen.getByText(/Child-work aggregation unavailable/i)).toBeTruthy();
    expect(screen.queryByText(/Ready for release/i)).toBeNull();
  });

  it('hides mutating actions in the manager perspective even if the backend returns them', () => {
    const actions: ProductAction[] = [
      {
        id: 'bad-command',
        lane_id: 'execution-owner',
        priority: 'primary',
        label: 'Run package',
        enabled: true,
        kind: 'command',
        command: {
          type: 'run_package',
          object_type: 'execution_package',
          object_id: 'pkg-1',
          work_item_id: 'wi-1',
          package_id: 'pkg-1',
        },
        blocked_reason: 'Execution commands are not available in manager view.',
        target: { kind: 'object', object_type: 'execution_package', object_id: 'pkg-1', href: '/packages/pkg-1' },
      },
    ];

    renderWithRouter(<DeliveryActionRail activeLane="manager" actions={actions} />);

    expect(screen.queryByRole('button', { name: /Run package/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /Run package/i })).toBeNull();
    expect(screen.queryByText('Blocked')).toBeNull();
    expect(screen.queryByText(/Execution commands are not available/i)).toBeNull();
    const openPackageLinks = screen.getAllByRole('link', { name: /Open package/i });
    expect(openPackageLinks).toHaveLength(1);
    expect(openPackageLinks[0]?.getAttribute('href')).toBe('/packages/pkg-1');
    expect(legacyRenderedClassTokens(document.body)).toEqual([]);
  });

  it('renders command actions as disabled unless a command handler is supplied', () => {
    const actions: ProductAction[] = [
      {
        id: 'run-package',
        lane_id: 'execution-owner',
        priority: 'primary',
        label: 'Run package',
        enabled: true,
        kind: 'command',
        command: {
          type: 'run_package',
          object_type: 'execution_package',
          object_id: 'pkg-1',
          work_item_id: 'wi-1',
          package_id: 'pkg-1',
        },
      },
    ];

    renderWithRouter(<DeliveryActionRail activeLane="execution-owner" actions={actions} />);

    expect(screen.getByRole('button', { name: /Run package/i }).getAttribute('disabled')).toBe('');
    expect(screen.getByText('Disabled')).toBeTruthy();
    expect(screen.queryByText('Available')).toBeNull();
  });
});
