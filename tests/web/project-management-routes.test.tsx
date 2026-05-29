// @vitest-environment jsdom

import { cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AttachmentRef } from '@forgeloop/contracts';

import {
  actorId,
  bugListItem,
  developmentPlan,
  developmentPlanItem,
  initiativeListItem,
  projectId,
  release,
  requirementListItem,
  techDebtListItem,
} from './fixtures/product-data';
import { renderRoute } from './router-test-utils';

const removedRoutes = [
  '/lanes',
  '/lanes/requirements',
  '/pipeline',
  '/work-items',
  '/work-items/wi-1',
  '/work-items/wi-1/spec-plan',
  '/tasks',
  '/tasks/task-1',
  '/tasks/new',
  '/tasks/task-1/runs/run-web-product',
  '/specs',
  '/specs/spec-1',
  '/plans',
  '/plans/plan-1',
  `/requirements/${requirementListItem.id}/spec`,
  `/requirements/${requirementListItem.id}/plan`,
  `/bugs/${bugListItem.id}/spec`,
  `/bugs/${bugListItem.id}/plan`,
  `/tech-debt/${techDebtListItem.id}/spec`,
  `/tech-debt/${techDebtListItem.id}/plan`,
  `/initiatives/${initiativeListItem.id}/spec`,
  `/initiatives/${initiativeListItem.id}/plan`,
  '/packages',
  '/runs',
  '/specs-plans',
];

const legacyOwnerPattern = new RegExp(`${['Work', 'Item', 'Owner'].join(' ')}|${['owner', 'actor', 'id'].join('_')}`);
const forbiddenProductStrings = [
  '/tasks',
  'Work Item Owner',
  'owner_actor_id',
  'Execution Package Browser',
  'Run Session Browser',
  'Review Packet Browser',
  'Raw Replay Browser',
  '/replay',
] as const;
const forbiddenPrimaryNavLabels = ['Execution Packages', 'Run Sessions', 'Review Packets', 'Replay', 'Traces'] as const;
const renderedProductRoutes = [
  '/cockpit',
  `/requirements/${requirementListItem.id}`,
  `/development-plans/${developmentPlan.id}`,
  `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
  '/reviews',
  '/executions',
  '/reports',
] as const;

const uploadedRouteAttachment = (overrides: Partial<AttachmentRef> = {}): AttachmentRef => ({
  id: 'att-source-route-upload',
  owner_object_type: 'requirement',
  owner_object_id: requirementListItem.id,
  linked_object_refs: [],
  filename: 'flow.png',
  content_type: 'image/png',
  size_bytes: 128,
  checksum_sha256: 'a'.repeat(64),
  uploaded_by_actor_id: actorId,
  created_at: '2026-05-23T00:00:00.000Z',
  evidence_category: 'image',
  caption: 'Flow',
  alt_text: 'Flow',
  visibility: 'object',
  safety_status: 'passed',
  reference_status: 'active',
  ...overrides,
});

describe('project management route IA', () => {
  it('renders grouped primary navigation without generic Tasks or direct artifact routes', async () => {
    const screen = await renderRoute('/my-work');
    for (const label of ['Cockpit', 'My Work', 'Requirements', 'Bugs', 'Tech Debt', 'Development Plans', 'Document Reviews', 'Board', 'Executions', 'Releases', 'Reports']) {
      expect(screen.getByRole('link', { name: label })).toBeTruthy();
    }
    for (const label of ['Dashboard', 'Lanes', 'Pipeline', 'Work Items', 'Tasks', 'Packages', 'Runs', 'Reviews', 'Specs', 'Plans']) {
      expect(screen.queryByRole('link', { name: label })).toBeNull();
    }
    for (const label of forbiddenPrimaryNavLabels) {
      expect(screen.queryByRole('link', { name: label })).toBeNull();
    }
  });

  it.each(renderedProductRoutes)('renders %s without historical product baggage', async (route) => {
    const screen = await renderRoute(route);
    expect((await screen.findAllByRole('heading')).length).toBeGreaterThan(0);

    const renderedText = document.body.textContent ?? '';
    const renderedMarkup = document.body.innerHTML;
    for (const forbidden of forbiddenProductStrings) {
      expect(renderedText).not.toContain(forbidden);
      expect(renderedMarkup).not.toContain(forbidden);
    }
    if (!route.startsWith('/releases')) {
      expect(renderedText).not.toContain('Release Owner');
    }
    cleanup();
  });

  it.each(removedRoutes)('does not resolve removed product route %s', async (route) => {
    const screen = await renderRoute(route);
    expect(screen.getByRole('heading', { name: /not found|404/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /generate spec|generate execution plan|start execution/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(/Execution Package Browser|Run Session Browser|Review Packet Browser|Raw Replay Browser/i);
    cleanup();
  });

  it('renders Document Reviews as a governance queue instead of direct document browsers', async () => {
    const screen = await renderRoute('/reviews');
    expect(await screen.findByRole('heading', { name: 'Document Reviews' })).toBeTruthy();
    expect(document.querySelector('[data-page-family="document-governance"]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-document-queue][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
    expect(screen.getByRole('tab', { name: 'Specs' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Execution Plans' })).toBeTruthy();
    expect((await screen.findAllByRole('link', { name: /open plan item/i }))[0]?.getAttribute('href')).toMatch(/^\/development-plans\//);
    expect(screen.getByRole('region', { name: /selected governance row/i })).toBeTruthy();
    expect(document.querySelector('[data-spec-plan-queue-row][data-desktop-row-height="44-56"]')).toBeInstanceOf(HTMLElement);
    expect(document.body.textContent).not.toMatch(/\/specs\/|\/plans\/|\/tasks\//);
  });

  it('renders focused Document Reviews context from Development Plan Item links', async () => {
    const screen = await renderRoute(`/reviews?development_plan_id=${developmentPlan.id}&development_plan_item_id=${developmentPlanItem.id}`);

    expect(await screen.findByText(/Focused governance queue/i)).toBeTruthy();
    expect(await screen.findByText(new RegExp(`Development Plan Item ${developmentPlanItem.id}`, 'i'))).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Execution Plans' }).getAttribute('href')).toBe(
      `/reviews?tab=implementation-plans&development_plan_id=${developmentPlan.id}&development_plan_item_id=${developmentPlanItem.id}`,
    );
  });

  it('renders source object workspace with role lens and item-scoped downstream actions', async () => {
    const screen = await renderRoute(`/requirements/${requirementListItem.id}`);

    expect(await screen.findByRole('heading', { name: /^Requirement$/ })).toBeTruthy();
    expect(await screen.findByText(/Product workspace clarity must be visible before teams can trust gate actions/i)).toBeTruthy();
    expect(document.querySelector('[data-product-shell="requirement-workspace"]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-page-family="source-document"]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-document-surface][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
    expect(screen.getByRole('region', { name: /requirement narrative document/i })).toBeTruthy();
    expect(screen.getByRole('region', { name: /requirement properties/i }).querySelector('[data-compact-metadata]')).toBeInstanceOf(HTMLElement);
    expect(await screen.findByRole('tablist', { name: /requirement sections/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /brief/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /development plan/i })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: /role lens/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /create development plan/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /generate development plan draft with ai/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /link existing development plan/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /add row to existing development plan/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /generate spec/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /generate execution plan/i })).toBeNull();
    expect(screen.getByRole('link', { name: /open development plan item/i }).getAttribute('href')).toBe(
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
    );
    expect(screen.getByText(/Evidence 1/i)).toBeTruthy();
    expect(screen.getByText(new RegExp(`release ${release.title}`, 'i'))).toBeTruthy();
    expect(screen.getByText(/risk medium/i)).toBeTruthy();
    expect(screen.getByText('Evidence refs')).toBeTruthy();
    expect(screen.getByText('Attachment refs')).toBeTruthy();
    expect(screen.getByText('Release refs')).toBeTruthy();
    expect(screen.getByText('Created')).toBeTruthy();
    expect(screen.getByText('Updated')).toBeTruthy();
    expect(screen.getByText(/Updated by/i)).toBeTruthy();
    expect(screen.getAllByText(actorId).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('surface-state-approved')).toBeNull();
    expect(screen.queryByTestId('surface-state-running')).toBeNull();
    expect(document.querySelector('[data-document-surface]')?.textContent).not.toMatch(/Evidence attachments|Planning links/i);
    expect(document.body.textContent).not.toMatch(legacyOwnerPattern);
    expect(document.body.textContent).not.toMatch(/source object/i);
  });

  it('uploads source narrative images through stable source-object attachment refs', async () => {
    let capturedMetadata: unknown;
    let capturedActorHeader: string | null = null;
    const screen = await renderRoute(`/requirements/${requirementListItem.id}`, {
      apiOverrides: {
        'POST /attachments': ({ init }) => {
          const form = init?.body;
          expect(form).toBeInstanceOf(FormData);
          capturedMetadata = JSON.parse(String((form as FormData).get('metadata')));
          capturedActorHeader = new Headers(init?.headers).get('x-forgeloop-actor-id');
          return uploadedRouteAttachment();
        },
      },
    });

    expect(await screen.findByRole('heading', { name: /^Requirement$/ })).toBeTruthy();
    expect(await screen.findByText(/Product workspace clarity must be visible before teams can trust gate actions/i)).toBeTruthy();
    const image = new File(['image-bytes'], 'flow.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText(/image file/i), { target: { files: [image] } });

    await waitFor(() =>
      expect((screen.getByRole('textbox', { name: /markdown editor/i }) as HTMLTextAreaElement).value).toContain(
        'attachment://att-source-route-upload',
      ),
    );
    expect(capturedActorHeader).toBe(actorId);
    expect(capturedMetadata).toEqual({
      object_type: 'requirement',
      object_id: requirementListItem.id,
      evidence_category: 'image',
      caption: 'flow',
      alt_text: 'flow',
      visibility: 'object',
    });
  });

  it('renders source object evidence routes as product-grade evidence workspaces', async () => {
    for (const [route, heading, expectedEvidence] of [
      [`/requirements/${requirementListItem.id}/evidence`, 'Requirement Evidence', /Plan Item generation flow/i],
      [`/initiatives/${initiativeListItem.id}/evidence`, 'Initiative Evidence', /Product workspace redesign evidence/i],
      [`/bugs/${bugListItem.id}/evidence`, 'Bug Evidence', /Premature action eligibility reproduction/i],
      [`/tech-debt/${techDebtListItem.id}/evidence`, 'Tech Debt Evidence', /Generic ProductPage retirement evidence/i],
    ] as const) {
      const screen = await renderRoute(route);

      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeTruthy();
      expect((await screen.findAllByText(expectedEvidence)).length).toBeGreaterThan(0);
      expect(document.querySelector('[data-page-family="source-evidence"]')).toBeInstanceOf(HTMLElement);
      expect(document.querySelector('[data-evidence-summary][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
      expect(screen.getByRole('region', { name: /evidence readiness summary/i })).toBeTruthy();
      expect(screen.getAllByText(/relevant evidence/i).length).toBeGreaterThan(0);
      expect(screen.queryByTestId('surface-state-approved')).toBeNull();
      expect(screen.getByRole('link', { name: new RegExp(`open ${heading.replace(' Evidence', '')}`, 'i') }).getAttribute('href')).toBe(route.replace('/evidence', ''));
      expect(document.querySelector('[data-evidence-summary]')?.textContent).not.toMatch(/Raw artifact links|Evidence attachments/i);
      expect(document.body.textContent).not.toMatch(/Scaffold|Generate Spec|Generate Execution Plan|Work Item Owner|owner_actor_id|\/tasks/);
      cleanup();
    }
  });

  it('renders typed list and detail source object surfaces', async () => {
    for (const [route, heading, expectedText] of [
      ['/requirements', 'Requirements', new RegExp(requirementListItem.title, 'i')],
      [`/requirements/${requirementListItem.id}`, 'Requirement', /Product workspace clarity must be visible/i],
      ['/initiatives', 'Initiatives', new RegExp(initiativeListItem.title, 'i')],
      [`/initiatives/${initiativeListItem.id}`, 'Initiative', /Coordinate the product workspace redesign/i],
      ['/tech-debt', 'Tech Debt', new RegExp(techDebtListItem.title, 'i')],
      [`/tech-debt/${techDebtListItem.id}`, 'Tech Debt', /Generic ProductPage composition/i],
      ['/bugs', 'Bugs', new RegExp(bugListItem.title, 'i')],
      [`/bugs/${bugListItem.id}`, 'Bug', /Plan Item actions must stay disabled/i],
    ] as const) {
      const screen = await renderRoute(route);
      expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
      expect((await screen.findAllByText(expectedText)).length).toBeGreaterThan(0);
      expect(document.body.textContent).not.toMatch(legacyOwnerPattern);
      cleanup();
    }
  });

  it('renders typed source lists as dense planning queues without generic source-object copy', async () => {
    for (const [route, heading, objectType, driverLabel, itemTitle, createHref, shellMarker, typeColumns] of [
      ['/requirements', 'Requirements', 'Requirement', 'Requirement Driver', new RegExp(requirementListItem.title, 'i'), '/requirements/new', 'requirement-workspace', []],
      [
        '/initiatives',
        'Initiatives',
        'Initiative',
        'Initiative Driver',
        new RegExp(initiativeListItem.title, 'i'),
        '/initiatives/new',
        'initiative-workspace',
        ['Business outcome', 'Milestone intent', 'Child Requirements', 'Child Bugs', 'Child Tech Debt', 'Release coverage'],
      ],
      [
        '/tech-debt',
        'Tech Debt',
        'Tech Debt',
        'Tech Debt Driver',
        new RegExp(techDebtListItem.title, 'i'),
        '/tech-debt/new',
        'tech-debt-workspace',
        ['Affected modules', 'Risk rationale', 'Validation strategy', 'Remediation planning coverage'],
      ],
      [
        '/bugs',
        'Bugs',
        'Bug',
        'Bug Driver',
        new RegExp(bugListItem.title, 'i'),
        '/bugs/new',
        'bug-workspace',
        ['Observed behavior', 'Expected behavior', 'Reproduction', 'Severity', 'Fix planning coverage'],
      ],
    ] as const) {
      const screen = await renderRoute(route);

      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeTruthy();
      expect(document.querySelector(`[data-product-shell="${shellMarker}"]`)).toBeInstanceOf(HTMLElement);
      expect(document.querySelector('[data-page-family="source-database"]')).toBeInstanceOf(HTMLElement);
      expect(document.querySelector('[data-typed-source-toolbar]')).toBeInstanceOf(HTMLElement);
      expect(document.querySelector('[data-typed-source-table] [data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
      expect((await screen.findAllByText(itemTitle)).length).toBeGreaterThan(0);
      expect(document.querySelector('[data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
      expect(document.body.textContent).toMatch(new RegExp(driverLabel, 'i'));
      expect(document.body.textContent).toMatch(/risk|blocker/i);
      expect(document.body.textContent).toMatch(/Development Plan coverage|Plan Item coverage|Downstream gates|Last meaningful update|Next action/i);
      expect(document.body.textContent).not.toMatch(/source object/i);
      expect(document.body.textContent).not.toMatch(/open source object to inspect planning state/i);
      expect(document.body.textContent).not.toMatch(/responsibility|assigned/i);
      expect(screen.queryByTestId('surface-state-blocked')).toBeNull();
      expect(screen.queryByTestId('surface-state-approved')).toBeNull();
      expect(screen.queryByText('Planning state unknown')).toBeNull();
      expect(screen.getByRole('searchbox', { name: new RegExp(`search ${heading}`, 'i') })).toBeTruthy();
      expect(screen.getByRole('button', { name: /view: dense/i })).toBeTruthy();
      expect(screen.getByRole('link', { name: new RegExp(`Create ${objectType}`, 'i') }).getAttribute('href')).toBe(createHref);
      expect(screen.getByRole('link', { name: /Create Development Plan/i }).getAttribute('href')).toBe('/development-plans/new');
      expect(screen.queryByRole('link', { name: /create source object/i })).toBeNull();
      expect(screen.queryByRole('link', { name: /plan source object/i })).toBeNull();
      expect(screen.getByRole('table', { name: new RegExp(`${heading} workspace`, 'i') })).toBeTruthy();
      for (const column of ['Title', 'Status', 'Priority', 'Risk', driverLabel, 'Development Plan coverage', 'Plan Item coverage', 'Downstream gates', 'Last meaningful update', 'Next action', ...typeColumns]) {
        expect(screen.getByRole('columnheader', { name: column })).toBeTruthy();
      }
      expect(screen.getAllByRole('link', { name: new RegExp(`open ${objectType}`, 'i') })[0]).toBeTruthy();
      expect(document.body.textContent).not.toMatch(legacyOwnerPattern);
      expect(document.body.textContent).not.toContain('Development Plan missing');
      expect(document.body.textContent).not.toContain('Create Development Plan from source object');
      cleanup();
    }
  });

  it('filters requirement rows with priority, driver, planning coverage, release link, and role controls', async () => {
    const urgentRequirement = {
      ...requirementListItem,
      id: 'req-urgent-filter',
      ref: { type: 'requirement', id: 'req-urgent-filter' },
      title: 'Urgent filtered requirement',
      priority: 'critical',
      driver_actor_id: 'actor-filter-owner',
      planning_coverage: { development_plan_count: 0, plan_item_count: 0, uncovered: true },
      release_refs: [],
    };
    const multiRequirementResponse = {
      items: [requirementListItem, urgentRequirement],
      degraded_sources: [],
    };
    const screen = await renderRoute('/requirements', {
      apiOverrides: {
        [`GET /query/requirements?project_id=${projectId}`]: multiRequirementResponse,
        [`GET /query/requirements?project_id=${projectId}&limit=100`]: multiRequirementResponse,
      },
    });

    expect((await screen.findAllByText(requirementListItem.title)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Urgent filtered requirement')).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /priority: critical/i }));
    await waitFor(() => expect(screen.queryByText(requirementListItem.title)).toBeNull());
    expect(screen.getAllByText('Urgent filtered requirement').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /priority: all/i }));
    fireEvent.click(screen.getByRole('button', { name: /driver: actor filter owner/i }));
    await waitFor(() => expect(screen.queryByText(requirementListItem.title)).toBeNull());
    expect(screen.getAllByText('Urgent filtered requirement').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /driver: all/i }));
    fireEvent.click(screen.getByRole('button', { name: /planning coverage: uncovered/i }));
    await waitFor(() => expect(screen.queryByText(requirementListItem.title)).toBeNull());
    expect(screen.getAllByText('Urgent filtered requirement').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /planning coverage: all/i }));
    fireEvent.click(screen.getByRole('button', { name: /release link: unlinked/i }));
    await waitFor(() => expect(screen.queryByText(requirementListItem.title)).toBeNull());
    expect(screen.getAllByText('Urgent filtered requirement').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /release link: all/i }));
    fireEvent.click(screen.getByRole('button', { name: /role filter: driver missing/i }));
    await waitFor(() => expect(screen.queryByText(requirementListItem.title)).toBeNull());
    expect(screen.queryByText('Urgent filtered requirement')).toBeNull();
  });

  it('keeps source object preview tied to the selected row and resets after filtering', async () => {
    const retryRequirement = {
      ...requirementListItem,
      id: 'req-visual-review-followup',
      ref: { type: 'requirement', id: 'req-visual-review-followup' },
      title: 'Visual review follow-up requirement',
      risk: 'high',
      updated_at: '2026-05-18T02:00:00.000Z',
      last_meaningful_update_at: '2026-05-18T02:00:00.000Z',
    };
    const multiRequirementResponse = {
      items: [requirementListItem, retryRequirement],
      degraded_sources: [],
    };
    const screen = await renderRoute('/requirements', {
      apiOverrides: {
        [`GET /query/requirements?project_id=${projectId}`]: multiRequirementResponse,
        [`GET /query/requirements?project_id=${projectId}&limit=100`]: multiRequirementResponse,
      },
    });

    expect(await screen.findByText('Visual review follow-up requirement')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /view: preview/i }));
    fireEvent.click(screen.getByText('Visual review follow-up requirement', { selector: 'span.font-semibold' }));

    const preview = screen.getByRole('region', { name: /requirement inspector/i });
    expect(preview.textContent).toContain('Updated 2026-05-18T02:00:00.000Z');

    fireEvent.change(screen.getByRole('searchbox', { name: /search requirements/i }), {
      target: { value: requirementListItem.title },
    });

    await waitFor(() => expect(screen.queryByText('Visual review follow-up requirement', { selector: 'span.font-semibold' })).toBeNull());
    expect(screen.getByRole('region', { name: /requirement inspector/i }).textContent).not.toContain('Updated 2026-05-18T02:00:00.000Z');
    expect(screen.getByRole('region', { name: /requirement inspector/i }).textContent).toContain('Updated 2026-05-18T01:00:00.000Z');
  });

  it('renders unavailable source list relationship metadata without false zeroes', async () => {
    const screen = await renderRoute('/requirements');

    expect((await screen.findAllByText(new RegExp(requirementListItem.title, 'i'))).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /view: preview/i }));

    const preview = screen.getByRole('region', { name: /requirement inspector/i });
    expect(within(preview).getByText('Related objects')).toBeTruthy();
    expect(within(preview).getByText('Release refs')).toBeTruthy();
    expect(within(preview).getAllByText('Unavailable').length).toBeGreaterThanOrEqual(1);
    expect(within(preview).queryByText('0')).toBeNull();
  });

  it('renders source list empty actions outside DataTable mobile paragraphs', async () => {
    const screen = await renderRoute('/requirements', {
      apiOverrides: {
        [`GET /query/requirements?project_id=${projectId}&limit=100`]: {
          items: [],
          degraded_sources: [],
        },
      },
    });

    expect(await screen.findByRole('heading', { name: 'No requirements match the current filters.' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'No requirements match the current filters.' }).closest('td')).toBeNull();
    expect(document.querySelector('p [data-typed-source-empty-state]')).toBeNull();
  });

  it('renders typed create forms without Task creation', async () => {
    for (const [route, fields] of [
      ['/requirements/new', ['Stakeholder problem', 'Desired outcome', 'Acceptance criteria', 'Requirement Driver']],
      ['/initiatives/new', ['Business outcome', 'Scope', 'Milestone intent', 'Initiative Driver']],
      ['/tech-debt/new', ['Current pain', 'Desired invariant', 'Affected modules', 'Validation strategy', 'Tech Debt Driver']],
      ['/bugs/new', ['Observed behavior', 'Expected behavior', 'Reproduction steps', 'Environment', 'Severity', 'Bug Driver']],
    ] as const) {
      const screen = await renderRoute(route);
      for (const field of fields) {
        expect(await screen.findByLabelText(new RegExp(field, 'i'))).toBeTruthy();
      }
      expect(screen.queryByRole('textbox', { name: /narrative markdown/i })).toBeNull();
      expect(screen.getByRole('region', { name: /narrative document/i })).toBeTruthy();
      expect(document.querySelector('[data-page-family="source-document"]')).toBeInstanceOf(HTMLElement);
      expect(document.querySelector('[data-document-surface][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
      expect(screen.getByRole('textbox', { name: /markdown editor/i })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /insert image/i })).toBeNull();
      expect(screen.queryByLabelText(/image file/i)).toBeNull();
      expect(screen.queryByTestId('surface-state-approved')).toBeNull();
      expect(screen.getByRole('link', { name: /cancel/i }).getAttribute('href')).not.toBe('/work-items');
      cleanup();
    }
  });

  it('shows authoring unsaved-change and validation states', async () => {
    const screen = await renderRoute('/requirements/new');

    fireEvent.change(await screen.findByLabelText(/stakeholder problem/i), {
      target: { value: 'Product teams need governed Plan Item generation.' },
    });

    expect(await screen.findByRole('status', { name: /draft changes/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByRole('alert', { name: /validation summary/i })).toBeTruthy();
    expect(screen.getAllByText(/desired outcome is required/i).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByLabelText(/desired outcome/i).getAttribute('aria-invalid')).toBe('true');
  });

  it('blocks route navigation for structured-field-only source drafts', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const screen = await renderRoute('/requirements/new');

    fireEvent.change(await screen.findByLabelText(/stakeholder problem/i), {
      target: { value: 'Product teams need governed Plan Item generation.' },
    });
    fireEvent.click(screen.getByRole('link', { name: 'Reports' }));

    await waitFor(() => expect(confirm).toHaveBeenCalledWith('Discard unsaved draft changes?'));
    expect(screen.getByRole('heading', { name: 'New Requirement' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Reports' })).toBeNull();
    confirm.mockRestore();
  });

  it('navigates from dirty source drafts after a single confirmed cancel', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const screen = await renderRoute('/requirements/new');

    fireEvent.change(await screen.findByLabelText(/stakeholder problem/i), {
      target: { value: 'Product teams need governed Plan Item generation.' },
    });
    fireEvent.click(screen.getByRole('link', { name: /cancel/i }));

    expect(await screen.findByRole('heading', { name: 'Requirements' })).toBeTruthy();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith('Discard unsaved draft changes?');
    confirm.mockRestore();
  });

  it('submits dirty source drafts without discard prompts blocking success navigation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const screen = await renderRoute('/requirements/new', {
      apiOverrides: {
        'POST /work-items': { id: 'req-created', driver_actor_id: actorId },
        'PATCH /requirements/req-created/narrative': { id: 'req-created' },
      },
    });

    fireEvent.change(await screen.findByLabelText(/stakeholder problem/i), {
      target: { value: 'Product teams need governed Plan Item generation.' },
    });
    fireEvent.change(screen.getByLabelText(/desired outcome/i), {
      target: { value: 'Spec and Execution Plan generation stay item-scoped.' },
    });
    fireEvent.change(screen.getByLabelText(/acceptance criteria/i), {
      target: { value: 'Plan Item generation flow is visible before document generation.' },
    });
    fireEvent.change(screen.getByLabelText(/^in scope/i), {
      target: { value: 'Plan Item governance.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByRole('heading', { name: 'Requirements' })).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });
});
