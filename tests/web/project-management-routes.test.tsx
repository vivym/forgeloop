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
  '/reviews',
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
  '/specs-plans',
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
    const screen = await renderRoute('/specs-plans');
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
    const screen = await renderRoute(`/specs-plans?development_plan_id=${developmentPlan.id}&development_plan_item_id=${developmentPlanItem.id}`);

    expect(await screen.findByText(/Focused governance queue/i)).toBeTruthy();
    expect(await screen.findByText(new RegExp(`Development Plan Item ${developmentPlanItem.id}`, 'i'))).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Execution Plans' }).getAttribute('href')).toBe(
      `/specs-plans?tab=plans&development_plan_id=${developmentPlan.id}&development_plan_item_id=${developmentPlanItem.id}`,
    );
  });

  it('renders source object workspace with role lens and item-scoped downstream actions', async () => {
    const screen = await renderRoute(`/requirements/${requirementListItem.id}`);

    expect(await screen.findByRole('heading', { name: /^Requirement$/ })).toBeTruthy();
    expect(await screen.findByText(/Plan Item governance must be visible before Spec and Execution Plan generation/i)).toBeTruthy();
    expect(document.querySelector('[data-page-family="source-document"]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-document-surface][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
    expect(screen.getByRole('region', { name: /source narrative document/i })).toBeTruthy();
    expect(screen.getByRole('region', { name: /source metadata/i }).querySelector('[data-compact-metadata]')).toBeInstanceOf(HTMLElement);
    expect(await screen.findByRole('tablist', { name: /source object sections/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /brief/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /development plan/i })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: /role lens/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /create development plan/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /generate development plan/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /link existing development plan/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /add row to existing development plan/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /generate spec/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /generate execution plan/i })).toBeNull();
    expect(screen.getByRole('link', { name: /open development plan item/i }).getAttribute('href')).toBe(
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
    );
    expect(screen.getByText(/evidence 1/i)).toBeTruthy();
    expect(screen.getByText(new RegExp(`release ${release.id}`, 'i'))).toBeTruthy();
    expect(screen.getByText(/risk medium/i)).toBeTruthy();
    expect(document.querySelector('[data-document-surface]')?.textContent).not.toMatch(/Evidence attachments|Planning links/i);
    expect(document.body.textContent).not.toMatch(legacyOwnerPattern);
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
    expect(await screen.findByText(/Plan Item governance must be visible before Spec and Execution Plan generation/i)).toBeTruthy();
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
      [`/initiatives/${initiativeListItem.id}/evidence`, 'Initiative Evidence', /AI-native project management rollout evidence/i],
      [`/bugs/${bugListItem.id}/evidence`, 'Bug Evidence', /Continuation loses review context/i],
      [`/tech-debt/${techDebtListItem.id}/evidence`, 'Tech Debt Evidence', /WorkspacePage template retirement evidence/i],
    ] as const) {
      const screen = await renderRoute(route);

      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeTruthy();
      expect((await screen.findAllByText(expectedEvidence)).length).toBeGreaterThan(0);
      expect(document.querySelector('[data-page-family="source-evidence"]')).toBeInstanceOf(HTMLElement);
      expect(document.querySelector('[data-evidence-summary][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
      expect(screen.getByRole('region', { name: /evidence readiness summary/i })).toBeTruthy();
      expect(screen.getAllByText(/relevant evidence/i).length).toBeGreaterThan(0);
      expect(screen.getByRole('link', { name: /open source object/i }).getAttribute('href')).toBe(route.replace('/evidence', ''));
      expect(document.querySelector('[data-evidence-summary]')?.textContent).not.toMatch(/Raw artifact links|Evidence attachments/i);
      expect(document.body.textContent).not.toMatch(/Scaffold|Generate Spec|Generate Execution Plan|Work Item Owner|owner_actor_id|\/tasks/);
      cleanup();
    }
  });

  it('renders typed list and detail source object surfaces', async () => {
    for (const [route, heading, expectedText] of [
      ['/requirements', 'Requirements', new RegExp(requirementListItem.title, 'i')],
      [`/requirements/${requirementListItem.id}`, 'Requirement', /Plan Item governance must be visible/i],
      ['/initiatives', 'Initiatives', new RegExp(initiativeListItem.title, 'i')],
      [`/initiatives/${initiativeListItem.id}`, 'Initiative', /Coordinate AI-native project management surfaces/i],
      ['/tech-debt', 'Tech Debt', new RegExp(techDebtListItem.title, 'i')],
      [`/tech-debt/${techDebtListItem.id}`, 'Tech Debt', /Generic WorkspacePage composition/i],
      ['/bugs', 'Bugs', new RegExp(bugListItem.title, 'i')],
      [`/bugs/${bugListItem.id}`, 'Bug', /Continuation must preserve the review context/i],
    ] as const) {
      const screen = await renderRoute(route);
      expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
      expect(await screen.findByText(expectedText)).toBeTruthy();
      expect(document.body.textContent).not.toMatch(legacyOwnerPattern);
      cleanup();
    }
  });

  it('renders source object lists as dense planning queues', async () => {
    for (const [route, heading, objectType, itemTitle, createHref] of [
      ['/requirements', 'Requirements', 'Requirement', new RegExp(requirementListItem.title, 'i'), '/requirements/new'],
      ['/initiatives', 'Initiatives', 'Initiative', new RegExp(initiativeListItem.title, 'i'), '/initiatives/new'],
      ['/tech-debt', 'Tech Debt', 'Tech Debt', new RegExp(techDebtListItem.title, 'i'), '/tech-debt/new'],
      ['/bugs', 'Bugs', 'Bug', new RegExp(bugListItem.title, 'i'), '/bugs/new'],
    ] as const) {
      const screen = await renderRoute(route);

      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeTruthy();
      expect(document.querySelector('[data-page-family="source-database"]')).toBeInstanceOf(HTMLElement);
      expect(document.querySelector('[data-database-toolbar]')).toBeInstanceOf(HTMLElement);
      expect(document.querySelector('[data-data-table][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
      expect(await screen.findByText(itemTitle)).toBeTruthy();
      expect(document.querySelector('[data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
      expect(document.body.textContent).toMatch(/source object/i);
      expect(document.body.textContent).toMatch(/open source object to inspect planning state/i);
      expect(document.body.textContent).toMatch(/responsibility|assigned/i);
      expect(document.body.textContent).toMatch(/risk|blocker/i);
      if (objectType === 'Bug') {
        expect(screen.getByTestId('surface-state-blocked')).toBeTruthy();
      } else {
        expect(screen.queryByTestId('surface-state-blocked')).toBeNull();
        expect(screen.getByTestId('surface-state-approved')).toBeTruthy();
      }
      expect(screen.getByText('Planning state unknown')).toBeTruthy();
      expect(screen.getByRole('searchbox', { name: new RegExp(`search ${heading}`, 'i') })).toBeTruthy();
      expect(screen.getByRole('button', { name: /view: dense/i })).toBeTruthy();
      expect(screen.getByRole('link', { name: /create source object/i }).getAttribute('href')).toBe(createHref);
      expect(screen.getByRole('link', { name: /plan source object/i }).getAttribute('href')).toBe('/development-plans/new');
      expect(screen.getByRole('table', { name: new RegExp(`${heading} source object database`, 'i') })).toBeTruthy();
      for (const column of ['Object', 'Type', 'Gate / status', 'Risk', 'Role / actor', 'Development Plan', 'Next action', 'Last meaningful update']) {
        expect(screen.getByRole('columnheader', { name: column })).toBeTruthy();
      }
      expect(screen.getAllByText(objectType)[0]).toBeTruthy();
      expect(screen.getByRole('link', { name: new RegExp(`open ${objectType}`, 'i') })).toBeTruthy();
      expect(document.body.textContent).not.toMatch(legacyOwnerPattern);
      expect(document.body.textContent).not.toContain('Development Plan missing');
      expect(document.body.textContent).not.toContain('Create Development Plan from source object');
      cleanup();
    }
  });

  it('keeps source object preview tied to the selected row and resets after filtering', async () => {
    const retryRequirement = {
      ...requirementListItem,
      id: 'req-visual-review-followup',
      ref: { type: 'requirement', id: 'req-visual-review-followup' },
      title: 'Visual review follow-up requirement',
      risk: 'high',
      updated_at: '2026-05-18T02:00:00.000Z',
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

    const preview = screen.getByRole('region', { name: /source object preview/i });
    expect(within(preview).getByText('Updated 2026-05-18T02:00:00.000Z')).toBeTruthy();

    fireEvent.change(screen.getByRole('searchbox', { name: /search requirements/i }), {
      target: { value: requirementListItem.title },
    });

    await waitFor(() => expect(screen.queryByText('Visual review follow-up requirement', { selector: 'span.font-semibold' })).toBeNull());
    expect(within(screen.getByRole('region', { name: /source object preview/i })).queryByText('Updated 2026-05-18T02:00:00.000Z')).toBeNull();
    expect(within(screen.getByRole('region', { name: /source object preview/i })).getByText('Updated 2026-05-18T01:00:00.000Z')).toBeTruthy();
  });

  it('renders unavailable source list relationship metadata without false zeroes', async () => {
    const screen = await renderRoute('/requirements');

    expect(await screen.findByText(new RegExp(requirementListItem.title, 'i'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /view: preview/i }));

    const preview = screen.getByRole('region', { name: /source object preview/i });
    expect(within(preview).getByText('Related objects')).toBeTruthy();
    expect(within(preview).getByText('Release refs')).toBeTruthy();
    expect(within(preview).getAllByText('Unavailable').length).toBeGreaterThanOrEqual(2);
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

    expect(await screen.findByText('No requirements source objects.')).toBeTruthy();
    expect(screen.getByText('No requirements source objects.').closest('td')).toBeNull();
    expect(document.querySelector('p [data-source-object-empty-state]')).toBeNull();
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

    await waitFor(() => expect(confirm).toHaveBeenCalledWith('Discard unsaved source object draft changes?'));
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
    expect(confirm).toHaveBeenCalledWith('Discard unsaved source object draft changes?');
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
