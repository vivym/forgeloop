// @vitest-environment jsdom

import { cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { boundarySummary, developmentPlan, developmentPlanItem, execution, executionPlanRevision, projectId, spec, specRevision } from './fixtures/product-data';
import { expectFirstViewportContract } from './helpers/first-viewport-contract';
import { renderRoute } from './router-test-utils';

describe('Development Plan routes', () => {
  it('renders the Development Plans index as a planning-table product surface with filters and summary actions', async () => {
    const screen = await renderRoute('/development-plans');

    expect(await screen.findByRole('heading', { name: 'Development Plans' })).toBeTruthy();
    expectFirstViewportContract(screen, { pageFamily: 'planning-table', heading: 'Development Plans' });
    expect(document.querySelector('[data-page-family="planning-table"]')).toBeTruthy();
    expect(document.querySelector('[data-product-shell="development-plan-workspace"]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-development-plan-summary-bar]')?.textContent).toMatch(/total plans|active plans|blocked items|review aging|execution in progress/i);
    expect(document.querySelector('[data-plan-items-table][data-primary-work-surface]')).toBeTruthy();
    expect(screen.getByRole('table', { name: /active development plans/i })).toBeTruthy();
    for (const column of ['Development Plan', 'Typed refs', 'Plan Items', 'Responsible roles', 'Gate distribution', 'Risk', 'Status']) {
      expect(screen.getByRole('columnheader', { name: column })).toBeTruthy();
    }
    for (const filter of ['Planning input type', 'Role', 'Driver', 'Reviewer', 'Gate', 'Risk', 'Release impact', 'Status']) {
      expect(screen.getByRole('combobox', { name: filter })).toBeTruthy();
    }
    expect(screen.getByRole('link', { name: /create development plan/i }).getAttribute('href')).toBe('/development-plans/new');
    expect(screen.getByRole('link', { name: /generate with ai assistance/i }).getAttribute('href')).toBe('/development-plans/new');
    expect((await screen.findByRole('link', { name: /Product workspace clarity and route-backed context/i })).getAttribute('href')).toBe('/requirements/req-product-workspace-clarity');
    expect(document.querySelector('[data-development-plan-summary-bar]')?.textContent).toMatch(/Active plans2/i);
    expect(document.querySelector('[data-development-plan-summary-bar]')?.textContent).toMatch(/Blocked items3/i);
    expect(document.body.textContent).toMatch(/\d+ Plan Items?/i);
    expect(document.body.textContent).not.toMatch(/planning input context|\brow\b|Work Item Owner|owner_actor_id|\bTask\b/);
    expect(document.body.textContent).not.toContain('Release Owner');
  });

  it('filters the Development Plans index using real list projection fields', async () => {
    const screen = await renderRoute('/development-plans');

    expect(await screen.findByRole('link', { name: developmentPlan.title })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Role' }), { target: { value: 'developer' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Driver' }), { target: { value: developmentPlanItem.driver_actor_id } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Reviewer' }), { target: { value: 'actor-reviewer' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Gate' }), { target: { value: 'execution' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Risk' }), { target: { value: 'medium' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Release impact' }), { target: { value: 'release_scoped' } });

    expect(screen.getByRole('link', { name: developmentPlan.title })).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: 'Risk' }), { target: { value: 'critical' } });
    expect(screen.queryByRole('link', { name: developmentPlan.title })).toBeNull();
  });

  it('keeps Development Plan index summary and inspector scoped to filtered rows', async () => {
    const visiblePlan = {
      ...developmentPlan,
      id: 'dp-visible-critical-plan',
      title: 'Visible critical Development Plan',
      source_refs: [{ type: 'bug', id: 'bug-visible-critical', title: 'Visible critical bug' }],
      item_count: 1,
      blocked_count: 1,
      responsible_role: 'developer',
      responsible_roles: ['developer'],
      driver_actor_id: 'actor-critical-driver',
      driver_actor_ids: ['actor-critical-driver'],
      reviewer_actor_id: 'actor-critical-reviewer',
      reviewer_actor_ids: ['actor-critical-reviewer'],
      gate_state: 'qa',
      gate_states: ['qa'],
      risk: 'critical',
      risks: ['critical'],
      release_impact: 'release_scoped',
      release_impacts: ['release_scoped'],
      href: '/development-plans/dp-visible-critical-plan',
    };
    const screen = await renderRoute('/development-plans', {
      apiOverrides: {
        [`GET /query/development-plans?project_id=${projectId}`]: {
          items: [
            {
              ...developmentPlan,
              item_count: developmentPlan.items.length,
              blocked_count: 0,
              responsible_role: 'developer',
              responsible_roles: ['developer'],
              driver_actor_id: developmentPlanItem.driver_actor_id,
              driver_actor_ids: [developmentPlanItem.driver_actor_id],
              reviewer_actor_id: developmentPlanItem.reviewer_actor_id,
              reviewer_actor_ids: [developmentPlanItem.reviewer_actor_id],
              gate_state: 'execution',
              gate_states: ['execution'],
              risk: 'medium',
              risks: ['medium'],
              release_impact: developmentPlanItem.release_impact,
              release_impacts: [developmentPlanItem.release_impact],
              href: `/development-plans/${developmentPlan.id}`,
            },
            visiblePlan,
          ],
          degraded_sources: [],
        },
      },
    });

    expect(await screen.findByRole('link', { name: developmentPlan.title })).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Planning input type' }), { target: { value: 'bug' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Risk' }), { target: { value: 'critical' } });

    const summary = document.querySelector('[data-development-plan-summary-bar]');
    expect(summary?.textContent).toMatch(/Total plans1/i);
    expect(summary?.textContent).toMatch(/Active plans1/i);
    expect(screen.queryByRole('link', { name: developmentPlan.title })).toBeNull();
    expect(screen.getByRole('link', { name: /Visible critical Development Plan/i })).toBeTruthy();
    expect(screen.getByRole('region', { name: /selected development plan preview/i }).textContent).toContain('Visible critical Development Plan');
    expect(screen.getByRole('region', { name: /selected development plan preview/i }).textContent).not.toContain(developmentPlan.title);
  });

  it('renders a useful Development Plans empty state without reverting to a source picker placeholder', async () => {
    const screen = await renderRoute('/development-plans', {
      apiOverrides: {
        [`GET /query/development-plans?project_id=${projectId}`]: {
          items: [],
          degraded_sources: [],
        },
      },
    });

    expect(await screen.findByRole('heading', { name: 'Development Plans' })).toBeTruthy();
    expect(screen.getByText(/No active Development Plans yet/i)).toBeTruthy();
    expect(screen.getByText(/Select planning input context, then create a table of Plan Items for boundary approval/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /create development plan/i }).getAttribute('href')).toBe('/development-plans/new');
    expect(screen.getByRole('link', { name: /generate with ai assistance/i }).getAttribute('href')).toBe('/development-plans/new');
    expect(document.body.textContent).not.toMatch(/Pick a planning input first/i);
  });

  it('renders the new Development Plan route as a real authoring workspace', async () => {
    const screen = await renderRoute('/development-plans/new');

    expect(await screen.findByRole('heading', { name: 'New Development Plan' })).toBeTruthy();
    expectFirstViewportContract(screen, { pageFamily: 'plan-authoring', heading: 'New Development Plan' });
    expect(document.querySelector('[data-page-family="plan-authoring"]')).toBeTruthy();
    expect(document.querySelector('[data-planning-input-picker][data-primary-work-surface], [data-plan-preview][data-primary-work-surface]')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /development plan title/i })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: /^planning input type$/i })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: /^planning input$/i })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /manual planning guidance/i })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /ai generation guidance/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^create development plan$/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^generate ai-assisted draft$/i })).toBeTruthy();
    expect(screen.getByText(/Downstream Spec and Implementation Plan Doc documents are generated only from Plan Items after boundary approval/i)).toBeTruthy();
    expect(screen.getByText(/Validation summary/i)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Pick a planning input first|Generate Spec|Generate Implementation Plan Doc|Work Item Owner|owner_actor_id|\bTask\b/);
  });

  it('loads Development Plan planning input choices from live project source lists', async () => {
    const user = userEvent.setup();
    const createBodies: unknown[] = [];
    const liveRequirementResponse = {
      items: [
        {
          id: 'req-live-42',
          ref: { type: 'requirement', id: 'req-live-42' },
          title: 'Live Plan Item governance requirement',
          status: 'active',
          priority: 'P2',
          risk: 'low',
          driver_actor_id: 'actor-product',
          planning_coverage: { development_plan_count: 0, plan_item_count: 0, uncovered: true },
          downstream_gate_summary: {
            current_gate_counts: { boundary: 0, spec: 0, implementation_plan_doc: 0, execution: 0, code_review: 0, qa: 0, release: 0 },
            blocker_count: 0,
          },
          last_meaningful_update_at: '2026-05-18T02:30:00.000Z',
          next_action: 'Create Development Plan',
          release_refs: [],
          updated_at: '2026-05-18T02:30:00.000Z',
        },
      ],
      degraded_sources: [],
    };
    const screen = await renderRoute('/development-plans/new', {
      apiOverrides: {
        [`GET /query/requirements?project_id=${projectId}&limit=100`]: liveRequirementResponse,
        'POST /development-plans': ({ init }) => {
          createBodies.push(parseRequestBody(init));
          return { ...developmentPlan, id: 'development-plan-live-source' };
        },
      },
    });

    expect(await screen.findByRole('option', { name: 'Live Plan Item governance requirement' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Plan Item governed Spec and Implementation Plan Doc generation' })).toBeNull();
    await user.clear(screen.getByRole('textbox', { name: /development plan title/i }));
    await user.type(screen.getByRole('textbox', { name: /development plan title/i }), 'Live source planning');
    await user.selectOptions(screen.getByRole('combobox', { name: /^planning input$/i }), 'req-live-42');
    await user.click(screen.getByRole('button', { name: /^create development plan$/i }));

    expect(createBodies).toEqual([
      expect.objectContaining({
        title: 'Live source planning',
        source_ref: { type: 'requirement', id: 'req-live-42', title: 'Live Plan Item governance requirement' },
      }),
    ]);
  });

  it('submits manual and AI-assisted Development Plan authoring with planning input context only', async () => {
    const user = userEvent.setup();
    const createBodies: unknown[] = [];
    const generateBodies: unknown[] = [];
    const screen = await renderRoute('/development-plans/new', {
      apiOverrides: {
        'POST /development-plans': ({ init }) => {
          createBodies.push(parseRequestBody(init));
          return developmentPlan;
        },
        'POST /development-plans/generate-draft': ({ init }) => {
          generateBodies.push(parseRequestBody(init));
          return { ...developmentPlan, generation_state: 'draft_generated' };
        },
      },
    });

    await user.clear(await screen.findByRole('textbox', { name: /development plan title/i }));
    await user.type(screen.getByRole('textbox', { name: /development plan title/i }), 'Plan Item governance closure');
    await user.selectOptions(screen.getByRole('combobox', { name: /^planning input type$/i }), 'requirement');
    await user.selectOptions(screen.getByRole('combobox', { name: /^planning input$/i }), 'req-product-workspace-clarity');
    await user.type(screen.getByRole('textbox', { name: /manual planning guidance/i }), 'Keep the plan scoped to Plan Item governance boundaries.');
    await user.type(screen.getByRole('textbox', { name: /ai generation guidance/i }), 'Draft Plan Items from governed generation acceptance criteria.');

    await user.click(screen.getByRole('button', { name: /^create development plan$/i }));
    expect(createBodies).toEqual([
      expect.objectContaining({
        guidance: 'Keep the plan scoped to Plan Item governance boundaries.',
        title: 'Plan Item governance closure',
        source_ref: { type: 'requirement', id: 'req-product-workspace-clarity', title: 'Product workspace clarity and route-backed context' },
      }),
    ]);
    expectNoDownstreamArtifactPayload(createBodies[0]);

    cleanup();
    const generateScreen = await renderRoute('/development-plans/new', {
      apiOverrides: {
        'POST /development-plans/generate-draft': ({ init }) => {
          generateBodies.push(parseRequestBody(init));
          return { ...developmentPlan, generation_state: 'draft_generated' };
        },
      },
    });
    await user.selectOptions(await generateScreen.findByRole('combobox', { name: /^planning input type$/i }), 'requirement');
    await user.selectOptions(generateScreen.getByRole('combobox', { name: /^planning input$/i }), 'req-product-workspace-clarity');
    await user.type(generateScreen.getByRole('textbox', { name: /ai generation guidance/i }), 'Draft Plan Items from governed generation acceptance criteria.');
    await user.click(generateScreen.getByRole('button', { name: /^generate ai-assisted draft$/i }));

    expect(await generateScreen.findByText(/Development Plan draft generated with planning input context/i)).toBeTruthy();
    expect(generateScreen.getByRole('link', { name: /open development plan/i }).getAttribute('href')).toBe(
      `/development-plans/${developmentPlan.id}`,
    );
    expect(generateBodies).toEqual([
      expect.objectContaining({
        source_ref: { type: 'requirement', id: 'req-product-workspace-clarity', title: 'Product workspace clarity and route-backed context' },
        guidance: expect.stringContaining('Draft Plan Items'),
      }),
    ]);
    expectNoDownstreamArtifactPayload(generateBodies[0]);
  });

  it('renders a desktop Development Plan table with prioritized planning columns and contained overflow', async () => {
    vi.stubGlobal('innerWidth', 1440);
    vi.stubGlobal('matchMedia', createMatchMedia(1440));
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}`);

    expect(await screen.findByRole('heading', { name: developmentPlan.title })).toBeTruthy();
    expectFirstViewportContract(screen, { pageFamily: 'planning-table', heading: developmentPlan.title });
    expect(document.querySelector('[data-page-family="planning-table"]')).toBeTruthy();
    expect(document.querySelector('[data-product-shell="development-plan-workspace"]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-plan-items-table][data-primary-work-surface]')).toBeTruthy();
    for (const column of ['Plan Item', 'Typed refs', 'Current gate', 'Gate progress', 'Risk', 'Driver', 'Responsible role', 'Reviewer', 'Affected surfaces', 'Dependencies', 'Release impact', 'Next action']) {
      expect(screen.getByRole('columnheader', { name: column })).toBeTruthy();
    }
    for (const hiddenTabletColumn of ['Boundary', 'Spec', 'Implementation Plan Doc', 'Execution', 'Review', 'QA', 'QA / Review']) {
      expect(screen.queryByRole('columnheader', { name: hiddenTabletColumn })).toBeNull();
    }
    expect(screen.getByRole('region', { name: /development plan items table region/i }).contains(screen.getByRole('table', { name: /development plan items/i }))).toBe(true);
    expect(document.querySelector('[data-table-scroll-container]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-table-scroll-container]')?.className).toMatch(/overflow-x-auto/);
    expect(screen.getByRole('link', { name: developmentPlanItem.title }).getAttribute('href')).toBe(
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
    );
    expect(screen.getAllByRole('link', { name: /open plan item/i }).map((link) => link.getAttribute('href'))).toContain(
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
    );
    expect(screen.getByRole('button', { name: /add plan item/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /ai generate missing plan items/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /regenerate with guidance/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /show context manifest/i })).toBeTruthy();
    expect(screen.getByRole('region', { name: /selected plan item inspector/i })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/planning input context|\brow\b/i);
  });

  it('uses compact gate progress summary columns at 1024px instead of cramming every planning field', async () => {
    vi.stubGlobal('innerWidth', 1024);
    vi.stubGlobal('matchMedia', createMatchMedia(1024));
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}`);

    expect(await screen.findByRole('heading', { name: developmentPlan.title })).toBeTruthy();
    for (const column of ['Plan Item', 'Typed refs', 'Current gate', 'Gate progress', 'Risk', 'Driver', 'Responsible role', 'Next action']) {
      expect(screen.getByRole('columnheader', { name: column })).toBeTruthy();
    }
    for (const desktopOnlyColumn of ['Reviewer', 'Affected surfaces', 'Dependencies', 'Boundary', 'Spec', 'Implementation Plan Doc', 'Release impact']) {
      expect(screen.queryByRole('columnheader', { name: desktopOnlyColumn })).toBeNull();
    }
    expect(screen.getAllByText(/Current gate/i).length).toBeGreaterThan(0);
  });

  it('shows selected-row preview with gate progress, next action, blockers, source, and evidence context', async () => {
    vi.stubGlobal('innerWidth', 1440);
    vi.stubGlobal('matchMedia', createMatchMedia(1440));
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}`, {
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}`]: {
          ...developmentPlan,
          items: [developmentPlanItem],
        },
      },
    });

    expect((await screen.findAllByText(developmentPlanItem.title)).length).toBeGreaterThan(0);
    const preview = await screen.findByRole('region', { name: /selected plan item inspector/i });
    expect(preview.textContent).toContain(developmentPlanItem.title);
    expect(preview.textContent).toContain(developmentPlanItem.summary);
    expect(preview.textContent).toMatch(/Current gate/i);
    expect(preview.textContent).toContain(developmentPlanItem.next_action);
    expect(preview.textContent).toMatch(/Blocker \/ risk/i);
    expect(preview.textContent).toMatch(/Product workspace clarity and route-backed context/i);
    expect(preview.textContent).toMatch(/Gate evidence/i);
    expect(preview.textContent).toMatch(/Driver/i);
    expect(preview.textContent).toMatch(/Reviewer/i);
    expect(preview.textContent).toMatch(/Dependency hints/i);
    expect(preview.textContent).toMatch(/Affected surface/i);
  });

  it('renders Development Plan Item gate detail without calling it a Task', async () => {
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`);

    expect(await screen.findByRole('heading', { name: developmentPlanItem.title })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: /workflow timeline/i })).toBeTruthy();
    expect(screen.getByRole('log', { name: /codex conversation/i })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: /artifact and context/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /open boundary summary/i })).toBeTruthy();
    expect(document.body.textContent).toMatch(/Boundary Summary available|Context Preview/i);
    expect(document.body.textContent).not.toMatch(/\bTask\b|Work Item Owner|owner_actor_id/);
  });

  it('renders workflow-owned Plan Items as a chat-first workspace', async () => {
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`);

    expect(await screen.findByRole('heading', { name: developmentPlanItem.title })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: /workflow timeline/i })).toBeTruthy();
    expect(screen.getByRole('log', { name: /codex conversation/i })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: /artifact and context/i })).toBeTruthy();
    expect(screen.getByRole('form', { name: /workflow message/i })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /message/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /generate spec/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /start execution/i })).toBeNull();
  });

  it('shows Plan Item session diagnostics without operator-only recovery controls', async () => {
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`, {
      apiOverrides: {
        [`GET /plan-items/${developmentPlanItem.id}/session-diagnostics`]: {
          plan_item_id: developmentPlanItem.id,
          workflow_resolution: 'active_workflow',
          state: 'blocked_stale_lease',
          severity: 'blocked',
          summary: 'Operator recovery is required before the workflow can continue.',
          operator_intervention_required: true,
          normal_workflow_actions_available: false,
          recovery_request_available: true,
        },
      },
    });

    expect(await screen.findByText('Session health')).toBeTruthy();
    expect(await screen.findByText('Operator recovery is required before the workflow can continue.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^recover$/i })).toBeNull();
    expect(screen.queryByText(/candidate_predicate/i)).toBeNull();
    expect(screen.queryByText('workflow-1')).toBeNull();
    expect(screen.queryByText('session-1')).toBeNull();
  });

  it('shows recovered state as waiting for a separate human product action', async () => {
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`, {
      apiOverrides: {
        [`GET /plan-items/${developmentPlanItem.id}/session-diagnostics`]: {
          plan_item_id: developmentPlanItem.id,
          workflow_resolution: 'active_workflow',
          state: 'recovered',
          severity: 'info',
          summary: 'Control state recovered. Choose a separate product action before continuing.',
          operator_intervention_required: false,
          normal_workflow_actions_available: false,
          recovery_request_available: false,
        },
      },
    });

    expect(await screen.findByText('Control state recovered. Choose a separate product action before continuing.')).toBeTruthy();
    expect(screen.getByText(/Continue, fork, and archive remain separate human actions/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^continue$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /fork/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /archive/i })).toBeNull();
  });

  it('keeps the conversation visible while artifact drawer is open', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`);

    await user.click(await screen.findByRole('button', { name: /open spec doc/i }));

    expect(screen.getByRole('log', { name: /codex conversation/i })).toBeInstanceOf(HTMLElement);
    expect(screen.getByRole('region', { name: /spec doc revision/i })).toBeInstanceOf(HTMLElement);
  });

  it('shows public markdown excerpts for workflow artifacts in the drawer', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`);

    await user.click(await screen.findByRole('button', { name: /open boundary summary/i }));
    expect(screen.getByRole('region', { name: /boundary summary revision/i }).textContent).toContain(boundarySummary.summary_markdown);

    await user.click(screen.getByRole('button', { name: /open spec doc/i }));
    expect(screen.getByRole('region', { name: /spec doc revision/i }).textContent).toContain(specRevision.content);

    await user.click(screen.getByRole('button', { name: /open implementation plan doc/i }));
    expect(screen.getByRole('region', { name: /implementation plan doc revision/i }).textContent).toContain(executionPlanRevision.content);
    expect(document.body.textContent).not.toMatch(/raw-thread-id|artifact:\/\/|prompt transcript|\/Users\//i);
  });

  it('places Run generation on queued action events, not in the composer', async () => {
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`);

    const composer = await screen.findByRole('form', { name: /workflow message/i });
    expect(within(composer).queryByRole('button', { name: /run generation/i })).toBeNull();
    expect(screen.getByRole('button', { name: /run generation for spec doc/i })).toBeTruthy();
  });

  it('records workflow chat input through messages without running queued generation', async () => {
    const user = userEvent.setup();
    const posted: string[] = [];
    let itemFetchCount = 0;
    const idleWorkflowItem = {
      ...itemOverride({
        boundary_status: 'approved',
        spec_status: 'approved',
        implementation_plan_status: 'approved',
        execution_status: 'not_started',
      }),
      plan_item_workflow: workflowProjectionFixture({
        queued_actions: [],
        timeline_events: [],
        status: 'brainstorming',
      }),
    };

    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`, {
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: () => {
          itemFetchCount += 1;
          return idleWorkflowItem;
        },
        'POST /plan-item-workflows/workflow-product-workspace-preview/messages': ({ init }) => {
          posted.push(`message:${JSON.stringify(parseRequestBody(init))}`);
          return { ...idleWorkflowItem.plan_item_workflow, timeline_events: [] };
        },
      },
    });

    await user.type(await screen.findByRole('textbox', { name: /message/i }), 'Continue from the current boundary.');
    await user.click(screen.getByRole('button', { name: /^send message$/i }));

    expect(posted).toEqual([
      expect.stringContaining('message:'),
    ]);
    expect(posted[0]).toContain('"action":"continue_ai"');
    expect(posted.join('\n')).not.toContain('/actions/');
    await waitFor(() => expect(itemFetchCount).toBeGreaterThan(1));
    expect(document.body.textContent).not.toMatch(/raw-thread-id|artifact:\/\/|prompt transcript|\/Users\//i);
  });

  it('sends workflow-owned queued and artifact commands through queued-action APIs only', async () => {
    const user = userEvent.setup();
    const posted: string[] = [];
    let itemFetchCount = 0;
    let workflow = workflowProjectionFixture();
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`, {
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: () => {
          itemFetchCount += 1;
          return itemOverride(
            {
              boundary_status: 'approved',
              spec_status: 'approved',
              implementation_plan_status: 'approved',
              execution_status: 'not_started',
            },
            {
              item: {
                plan_item_workflow: workflow,
              },
            },
          );
        },
        'POST /plan-item-workflows/workflow-product-workspace-preview/actions/action-generate-spec-doc/run': ({ init }) => {
          posted.push(`run:${JSON.stringify(parseRequestBody(init))}`);
          workflow = workflowProjectionFixture({
            status: 'spec_review',
            queued_actions: [],
            timeline_events: [
              {
                id: 'event-human-spec-question',
                workflow_id: 'workflow-product-workspace-preview',
                event_type: 'human_message',
                status: 'recorded',
                actor_id: 'actor-reviewer',
                body_markdown: 'Please tighten the acceptance criteria before review.',
                created_at: '2026-05-18T00:23:30.000Z',
              },
            ],
          });
          return { id: 'action-generate-spec-doc', status: 'blocked' };
        },
        [`POST /plan-item-workflows/workflow-product-workspace-preview/artifacts/spec-doc/revisions/${specRevision.id}/approve`]: ({ init }) => {
          posted.push(`approve:${JSON.stringify(parseRequestBody(init))}`);
          return { status: 'implementation_plan_generation_queued' };
        },
        [`POST /plan-item-workflows/workflow-product-workspace-preview/artifacts/spec-doc/revisions/${specRevision.id}/request-changes`]: ({ init }) => {
          posted.push(`request:${JSON.stringify(parseRequestBody(init))}`);
          return { status: 'brainstorming' };
        },
      },
    });

    expect(await screen.findByRole('heading', { name: developmentPlanItem.title })).toBeTruthy();
    await user.click(await screen.findByRole('button', { name: /run generation for spec doc/i }));
    await user.click(screen.getByRole('button', { name: /open spec doc/i }));
    await user.click(screen.getByRole('button', { name: /^approve revision$/i }));
    await user.type(screen.getByRole('textbox', { name: /request changes feedback/i }), 'Tighten acceptance evidence.');
    await user.click(screen.getByRole('button', { name: /^request changes$/i }));

    expect(posted).toEqual([
      `run:${JSON.stringify({ actor_id: 'actor-owner' })}`,
      `approve:${JSON.stringify({ actor_id: 'actor-owner', decision_markdown: 'Approved Spec Doc from workflow drawer.' })}`,
      `request:${JSON.stringify({ actor_id: 'actor-owner', reason_markdown: 'Tighten acceptance evidence.' })}`,
    ]);
    expect(screen.getByRole('log', { name: /codex conversation/i }).textContent).toContain(
      'Please tighten the acceptance criteria before review.',
    );
    await waitFor(() => expect(itemFetchCount).toBeGreaterThan(1));
    expect(document.body.textContent).not.toMatch(/raw-thread-id|artifact:\/\/|prompt transcript|\/Users\//i);
  });

  it('refreshes workflow projection after readiness evaluation', async () => {
    const user = userEvent.setup();
    let itemFetchCount = 0;
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/execution`, {
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: () => {
          itemFetchCount += 1;
          return itemOverride(
            {
              boundary_status: 'approved',
              spec_status: 'approved',
              implementation_plan_status: 'approved',
              execution_status: 'not_started',
            },
            {
              item: {
                plan_item_workflow: workflowProjectionFixture({
                  status: 'implementation_plan_review',
                  queued_actions: [],
                  timeline_events: [],
                  readiness: { state: 'not_evaluated', can_evaluate: true, blocker_codes: [] },
                  blockers: [],
                }),
              },
            },
          );
        },
        'POST /plan-item-workflows/workflow-product-workspace-preview/execution-readiness/evaluate': ({ init }) => ({
          ...workflowProjectionFixture({ readiness: { state: 'ready', can_evaluate: false, blocker_codes: [] }, blockers: [] }),
          actor_id: (parseRequestBody(init) as { actor_id?: string }).actor_id,
        }),
      },
    });

    await user.click(await screen.findByRole('button', { name: /^evaluate readiness$/i }));

    await waitFor(() => expect(itemFetchCount).toBeGreaterThan(1));
  });

  it('starts workflow execution only from the execution-ready Plan Item workspace', async () => {
    const user = userEvent.setup();
    const posted: unknown[] = [];
    let itemFetchCount = 0;
    const readyWorkflow = workflowProjectionFixture({
      status: 'execution_ready',
      queued_actions: [],
      timeline_events: [],
      readiness: { state: 'ready', can_evaluate: false, blocker_codes: [] },
      blockers: [],
    });
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/execution`, {
      actorId: 'actor-tech',
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: () => {
          itemFetchCount += 1;
          return itemOverride(
            {
              boundary_status: 'approved',
              spec_status: 'approved',
              implementation_plan_status: 'approved',
              execution_status: 'not_started',
            },
            { item: { plan_item_workflow: readyWorkflow } },
          );
        },
        'POST /plan-item-workflows/workflow-product-workspace-preview/execution/start': ({ init }) => {
          const body = parseRequestBody(init);
          posted.push(body);
          return {
            ...readyWorkflow,
            status: 'execution_running',
            session: { ...readyWorkflow.session, status: 'running', continuity_state: 'running' },
            execution_run_summary: workflowExecutionRunSummaryFixture({ status: 'running' }),
          };
        },
      },
    });

    const startButton = await screen.findByRole('button', { name: /^start execution$/i });
    expectButtonEnabled(startButton);
    await user.click(startButton);

    expect(posted).toEqual([expect.objectContaining({ actor_id: 'actor-tech' })]);
    expect(posted[0]).not.toEqual(expect.objectContaining({ owner_actor_id: expect.anything() }));
    await waitFor(() => expect(itemFetchCount).toBeGreaterThan(1));
    expect(document.body.textContent).not.toMatch(/execution-packages\/.*\/run|force-rerun|owner_actor_id/i);
  });

  it('renders workflow execution supervision from public-safe run summary only', async () => {
    const runningWorkflow = workflowProjectionFixture({
      status: 'execution_running',
      queued_actions: [],
      timeline_events: [],
      readiness: { state: 'ready', can_evaluate: false, blocker_codes: [] },
      blockers: [],
      session: {
        status: 'running',
        role: 'active',
        continuity_state: 'running',
        can_continue: true,
        last_turn_at: '2026-05-18T00:25:00.000Z',
      },
      execution_run_summary: workflowExecutionRunSummaryFixture({
        run_session_id: 'run-session-visible',
        input_capsule_digest: `sha256:${'1'.repeat(64)}`,
        workspace_bundle_digest: `sha256:${'2'.repeat(64)}`,
        codex_thread_id_digest: `sha256:${'3'.repeat(64)}`,
        status: 'running',
      }),
    });
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/execution`, {
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: itemOverride(
          {
            boundary_status: 'approved',
            spec_status: 'approved',
            implementation_plan_status: 'approved',
            execution_status: 'running',
          },
          { item: { plan_item_workflow: runningWorkflow } },
        ),
      },
    });

    expect(await screen.findByRole('heading', { name: developmentPlanItem.title })).toBeTruthy();
    const supervision = screen.getByRole('region', { name: /execution supervision/i });
    expect(supervision.textContent).toMatch(/execution running|running/i);
    expect(supervision.textContent).toContain('run-session-visible');
    expect(supervision.textContent).toContain(`sha256:${'1'.repeat(64)}`);
    expect(supervision.textContent).toContain(`sha256:${'2'.repeat(64)}`);
    expect(supervision.textContent).toContain(`sha256:${'3'.repeat(64)}`);
    expect(supervision.textContent).not.toMatch(/thread-raw|artifact:\/\/internal|\/Users\/|lease|worker_id|credential|execution-package-hidden|runtime-job-hidden|turn-hidden/i);
    expect(document.body.textContent).not.toMatch(/thread-raw|artifact:\/\/internal|\/Users\/|lease-token|worker_id|credential/i);
  });

  it('renders Wave 7 execution, code-review, and recovery controls from public workflow projection', async () => {
    const user = userEvent.setup();
    const posted: string[] = [];
    const digest = `sha256:${'7'.repeat(64)}`;
    const workflow = workflowProjectionFixture({
      status: 'code_review',
      queued_actions: [],
      timeline_events: [],
      readiness: { state: 'ready', can_evaluate: false, blocker_codes: [] },
      blockers: [],
      execution_run_summary: workflowExecutionRunSummaryFixture({
        run_session_id: 'run-session-current',
        status: 'succeeded',
        codex_thread_id_digest: `sha256:${'8'.repeat(64)}`,
      }),
      attempt_history: [
        {
          run_session_id: 'run-session-current',
          attempt_kind: 'first_execution',
          status: 'succeeded',
          continuation_events: [
            {
              queued_action_id: 'action-continue-1',
              continuation_kind: 'relaunch_after_fencing',
              created_at: '2026-05-18T00:27:00.000Z',
            },
          ],
          created_at: '2026-05-18T00:25:00.000Z',
          updated_at: '2026-05-18T00:28:00.000Z',
        },
      ],
      current_review_packet: {
        id: 'review-packet-current',
        digest,
        previous_run_session_id: 'run-session-current',
        status: 'completed',
        decision: 'changes_requested',
        summary: 'Reviewer requested targeted UI changes.',
        evidence_refs: [
          {
            id: 'evidence-review-comment-1',
            ref_kind: 'github_comment_url',
            visibility: 'public',
            display_text: 'Reviewer comment on visual hierarchy',
            digest: `sha256:${'9'.repeat(64)}`,
            url: 'https://github.com/org/repo/pull/1#discussion_r1',
          },
        ],
      },
      latest_review_response: {
        id: 'review-response-current',
        review_packet_id: 'review-packet-current',
        previous_run_session_id: 'run-session-current',
        status: 'succeeded',
        summary: 'Codex explained the requested UI fix.',
        response_markdown: 'The layout issue is valid and should be fixed in a follow-up run.',
        created_at: '2026-05-18T00:31:00.000Z',
      },
      recovery_options: [
        { action_id: 'continue_same_session', enabled: true, required_confirmation_kind: 'none' },
        {
          action_id: 'abandon_new_session',
          enabled: true,
          next_action: 'request_fix',
          warning_copy: 'Starting a new session loses Codex thread continuity.',
          required_confirmation_kind: 'typed_phrase',
        },
        {
          action_id: 'fork_unavailable',
          enabled: false,
          blocker_code: 'workflow_fork_deferred_until_wave_8',
          warning_copy: 'Forking a workflow session is unavailable before Wave 8.',
          required_confirmation_kind: 'none',
        },
      ],
    });
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/execution`, {
      actorId: 'actor-tech',
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: itemOverride(
          {
            boundary_status: 'approved',
            spec_status: 'approved',
            implementation_plan_status: 'approved',
            execution_status: 'completed',
            review_status: 'changes_requested',
          },
          {
            item: {
              plan_item_workflow: workflow,
            },
          },
        ),
        'POST /plan-item-workflows/workflow-product-workspace-preview/execution/continue': ({ init }) => {
          posted.push(`continue:${JSON.stringify(parseRequestBody(init))}`);
          return workflow;
        },
        'POST /plan-item-workflows/workflow-product-workspace-preview/code-review/respond': ({ init }) => {
          posted.push(`respond:${JSON.stringify(parseRequestBody(init))}`);
          return workflow;
        },
        'POST /plan-item-workflows/workflow-product-workspace-preview/code-review/request-fix': ({ init }) => {
          posted.push(`fix:${JSON.stringify(parseRequestBody(init))}`);
          return workflow;
        },
        'POST /plan-item-workflows/workflow-product-workspace-preview/recovery/abandon-and-new-session': ({ init }) => {
          posted.push(`abandon:${JSON.stringify(parseRequestBody(init))}`);
          return workflow;
        },
      },
    });

    expect(await screen.findByRole('heading', { name: developmentPlanItem.title })).toBeTruthy();
    const supervision = screen.getByRole('region', { name: /execution supervision/i });
    expect(supervision.textContent).toContain('run-session-current');
    expect(supervision.textContent).toContain('First Execution');
    expect(supervision.textContent).toContain(`sha256:${'8'.repeat(64)}`);
    expect(screen.getByRole('region', { name: /code review lens/i }).textContent).toContain('review-packet-current');
    expect(screen.getByRole('region', { name: /code review lens/i }).textContent).toContain('Reviewer comment on visual hierarchy');
    expect(screen.getByRole('region', { name: /code review lens/i }).textContent).toContain('review-response-current');
    expect(screen.getByRole('region', { name: /code review lens/i }).textContent).toContain('Codex explained the requested UI fix.');
    expect(screen.getByRole('region', { name: /code review lens/i }).textContent).toContain('should be fixed in a follow-up run');
    expect(screen.getByRole('region', { name: /recovery panel/i }).textContent).toMatch(/fork unavailable|wave 8/i);

    await user.click(screen.getByRole('button', { name: /^continue execution$/i }));
    await user.type(screen.getByRole('textbox', { name: /review response prompt/i }), 'Respond with concise reasoning.');
    await user.click(screen.getByRole('button', { name: /^respond to review$/i }));
    await user.type(screen.getByRole('textbox', { name: /fix instruction/i }), 'Fix the requested layout issue.');
    await user.click(screen.getByRole('button', { name: /^request fix$/i }));
    await user.type(screen.getByRole('textbox', { name: /abandon reason/i }), 'Current session state is unsafe.');
    await user.type(screen.getByRole('textbox', { name: /type confirmation phrase/i }), 'abandon current session and start new session');
    await user.click(screen.getByRole('button', { name: /^abandon current session$/i }));

    expect(posted).toEqual([
      `continue:${JSON.stringify({ actor_id: 'actor-tech' })}`,
      `respond:${JSON.stringify({
        actor_id: 'actor-tech',
        expected_review_packet_id: 'review-packet-current',
        expected_review_packet_digest: digest,
        response_prompt_markdown: 'Respond with concise reasoning.',
      })}`,
      `fix:${JSON.stringify({
        actor_id: 'actor-tech',
        expected_review_packet_id: 'review-packet-current',
        expected_review_packet_digest: digest,
        fix_instruction_markdown: 'Fix the requested layout issue.',
      })}`,
      `abandon:${JSON.stringify({
        actor_id: 'actor-tech',
        next_action: 'request_fix',
        confirmation_phrase: 'abandon current session and start new session',
        reason: 'Current session state is unsafe.',
      })}`,
    ]);
    expect(document.body.textContent).not.toMatch(/codex_thread_id|thread-raw|artifact:\/\/internal|\/Users\/|lease-token|worker_id|credential/i);
  });

  it('disables artifact review and readiness actions outside their workflow stages with public reasons', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/execution`, {
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: itemOverride(
          {
            boundary_status: 'approved',
            spec_status: 'approved',
            implementation_plan_status: 'approved',
            execution_status: 'not_started',
          },
          {
            item: {
              plan_item_workflow: workflowProjectionFixture({
                status: 'spec_generation_queued',
                readiness: { state: 'not_evaluated', can_evaluate: false, blocker_codes: [] },
                blockers: [],
              }),
            },
          },
        ),
      },
    });

    await user.click(await screen.findByRole('button', { name: /open spec doc/i }));

    expectButtonDisabled(screen.getByRole('button', { name: /^approve revision$/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /^request changes$/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /^evaluate readiness$/i }));
    expect(document.body.textContent).toContain('Spec Doc review is available only during Spec Review.');
    expect(document.body.textContent).toContain('Execution Ready can be evaluated only during Implementation Plan Review.');
  });

  it('renders Development Plan Item overview and execution as gate-flow workspaces', async () => {
    for (const route of [
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/execution`,
    ]) {
      const screen = await renderRoute(route);

      expect(await screen.findByRole('heading', { name: developmentPlanItem.title })).toBeTruthy();
      expectFirstViewportContract(screen, { pageFamily: 'plan-item-workflow', heading: developmentPlanItem.title });
      expect(document.querySelector('[data-page-family="plan-item-workflow"]')).toBeTruthy();
      expect(document.querySelector('[data-product-shell="plan-item-workflow-workspace"]')).toBeTruthy();
      expect(document.querySelector('[data-plan-item-workflow-workspace][data-primary-work-surface]')).toBeTruthy();
      expect(document.querySelector('[data-plan-item-workflow-workspace]')?.textContent).toMatch(/Workflow timeline|Codex conversation|Context Preview/i);
      expect(document.body.textContent).not.toMatch(/\bTask\b|Work Item Owner|owner_actor_id|\/specs\/|\/plans\//);
      cleanup();
    }
  });

  it('renders Spec and Implementation Plan focus routes as document review editors', async () => {
    for (const focus of ['spec', 'implementation-plan'] as const) {
      const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/${focus}`);

      expect(await screen.findByRole('heading', { name: developmentPlanItem.title })).toBeTruthy();
      expectFirstViewportContract(screen, { pageFamily: 'plan-item-workflow', heading: developmentPlanItem.title });
      expect(document.querySelector('[data-page-family="plan-item-workflow"]')).toBeTruthy();
      expect(document.querySelector('[data-plan-item-workflow-workspace][data-primary-work-surface]')).toBeTruthy();
      expect(screen.getByRole('log', { name: /codex conversation/i })).toBeTruthy();
      expect(screen.getByRole('complementary', { name: /artifact and context/i })).toBeTruthy();
      expect(screen.queryByLabelText(/editor toolbar/i)).toBeNull();
      expect(screen.queryByRole('button', { name: /generate spec|generate implementation plan doc|start execution/i })).toBeNull();
      cleanup();
    }
  });

  it('does not expose draft save when the persisted item-scoped revision body is unavailable', async () => {
    const legacyItem = itemOverride({
      boundary_status: 'approved',
      spec_status: 'in_review',
      implementation_plan_status: 'missing',
      execution_status: 'not_started',
    });
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/spec`, {
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: legacyItem,
        [`GET /spec-revisions/${specRevision.id}`]: new Response(JSON.stringify({ message: 'revision unavailable' }), {
          headers: { 'content-type': 'application/json' },
          status: 500,
        }),
      },
    });

    expect((await screen.findAllByText(/Revision body unavailable/i)).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText(/editor toolbar/i)).toBeNull();
    expect(screen.queryByRole('textbox', { name: /markdown editor/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
  });

  it('loads and saves real item-scoped Spec revision drafts through the route API', async () => {
    const user = userEvent.setup();
    const draftBodies: unknown[] = [];
    const legacyItem = itemOverride({
      boundary_status: 'approved',
      spec_status: 'in_review',
      implementation_plan_status: 'missing',
      execution_status: 'not_started',
    });
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/spec`, {
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: legacyItem,
        [`GET /spec-revisions/${specRevision.id}`]: {
          ...specRevision,
          content: 'Persisted route Spec body',
          scope_ref: developmentPlan.source_refs[0],
          attachment_refs: [],
        },
        [`PATCH /development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/spec/draft`]: ({ init }) => {
          const body = parseRequestBody(init);
          draftBodies.push(body);
          return {
            ...specRevision,
            id: 'specrev-route-save-v2',
            content: (body as { markdown: string }).markdown,
            scope_ref: developmentPlan.source_refs[0],
            attachment_refs: [],
          };
        },
      },
    });

    expect(await screen.findByRole('heading', { name: developmentPlanItem.title })).toBeTruthy();
    const editor = await screen.findByRole('textbox', { name: /markdown editor/i }) as HTMLTextAreaElement;
    await waitFor(() => expect(editor.value).toContain('Persisted route Spec body'));
    fireEvent.change(editor, { target: { value: `${editor.value}\n\nSaved through the route draft endpoint.` } });
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(await screen.findByText(/Spec document draft saved/i)).toBeTruthy();
    expect(screen.getAllByText(/^draft$/i).length).toBeGreaterThan(0);
    expect(draftBodies).toEqual([
      expect.objectContaining({
        markdown: expect.stringContaining('Saved through the route draft endpoint.'),
        object_ref: { type: 'spec_revision', id: specRevision.id, spec_id: spec.id },
      }),
    ]);
  });

  it('prioritizes the active gate body on Development Plan Item focus routes', async () => {
    for (const [route, title, bodyText] of [
      [`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`, 'Gate summary', /Boundary|Spec|Execution/i],
      [`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/execution`, 'Execution supervision', /Execution|running/i],
    ] as const) {
      const screen = await renderRoute(route, {
        apiOverrides: {
          [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: itemOverride({
            boundary_status: 'approved',
            spec_status: 'approved',
            implementation_plan_status: 'approved',
            execution_status: route.endsWith('/execution') ? 'running' : 'not_started',
            review_status: 'not_started',
            qa_handoff_status: 'not_started',
          }),
        },
      });

      expect(await screen.findByRole('heading', { name: developmentPlanItem.title })).toBeTruthy();
      const activeBody = document.querySelector('[data-active-gate-body]');
      expect(activeBody).toBeInstanceOf(HTMLElement);
      expect(activeBody?.textContent).toContain(title);
      expect(activeBody?.textContent).toMatch(bodyText);
      const workspaceText = document.querySelector('[data-workspace-content]')?.textContent ?? '';
      expect(workspaceText.indexOf(title)).toBeGreaterThanOrEqual(0);
      expect(workspaceText.indexOf(title)).toBeLessThan(workspaceText.indexOf('Development Plan Item revisions'));
      cleanup();
    }
  });

  it('supports keyboard navigation in the Development Plan table', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}`);
    expect(await screen.findByRole('table', { name: /development plan items/i })).toBeTruthy();

    await user.tab();
    const targetOpenItemLink = screen
      .getAllByRole('link', { name: /open plan item/i })
      .find((link) => link.getAttribute('href') === `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`);
    expect(targetOpenItemLink).toBeTruthy();
    for (let index = 0; index < 50 && document.activeElement !== targetOpenItemLink; index += 1) {
      await user.tab();
    }
    expect(document.activeElement).toBe(targetOpenItemLink);
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { name: developmentPlanItem.title })).toBeTruthy();
  });

  it('does not expose retired direct Plan Item generation or execution commands', async () => {
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`, {
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: itemOverride({
          boundary_status: developmentPlanItem.boundary_status,
          spec_status: developmentPlanItem.spec_status,
          implementation_plan_status: developmentPlanItem.implementation_plan_status,
          execution_status: developmentPlanItem.execution_status,
          review_status: developmentPlanItem.review_status,
          qa_handoff_status: developmentPlanItem.qa_handoff_status,
        }),
      },
    });

    expect(await screen.findByRole('heading', { name: developmentPlanItem.title })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^generate spec$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^generate implementation plan doc$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^start execution$/i })).toBeNull();
    expect(document.body.textContent).not.toMatch(/Lifecycle actions|Generate Spec|Generate Implementation Plan Doc|Start execution/i);
  });

  it('renders release linkage, blockers, and QA evidence context in the Plan Item side rail', async () => {
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`, {
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: itemOverride(
          {
            boundary_status: 'approved',
            spec_status: 'approved',
            implementation_plan_status: 'approved',
            execution_status: 'completed',
            review_status: 'approved',
            qa_handoff_status: 'accepted',
          },
          {
            releaseContext: {
              release_refs: [
                {
                  type: 'release',
                  id: 'rel-product-workspace-preview',
                  title: 'Product workspace preview release',
                  href: '/releases/rel-product-workspace-preview',
                },
              ],
              readiness_blockers: [
                { code: 'missing_required_test_acceptance', summary: 'QA acceptance evidence required before release inclusion.' },
              ],
              evidence_refs: [
                {
                  type: 'release_evidence',
                  id: 'evidence-item-test-passed',
                  release_id: 'rel-product-workspace-preview',
                  title: 'Passed QA acceptance evidence',
                  evidence_type: 'test_report',
                  status: 'current',
                },
              ],
              qa_test_evidence_required: true,
            },
          },
        ),
      },
    });

    const rail = await screen.findByTestId('decision-evidence-rail');
    expectTextContent(rail, /Product workspace preview release/i);
    expect(screen.getByRole('link', { name: /Product workspace preview release/i }).getAttribute('href')).toBe('/releases/rel-product-workspace-preview');
    expectTextContent(rail, /QA acceptance evidence required before release inclusion/i);
    expectTextContent(rail, /Passed QA acceptance evidence/i);
    expectTextContent(rail, /QA\/test evidence required/i);
  });

  it('keeps the Release gate unavailable when QA is accepted but no owning Release is linked', async () => {
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`, {
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: itemOverride(
          {
            boundary_status: 'approved',
            spec_status: 'approved',
            implementation_plan_status: 'approved',
            execution_status: 'completed',
            review_status: 'approved',
            qa_handoff_status: 'accepted',
          },
          {
            releaseContext: {
              release_refs: [],
              readiness_blockers: [],
              evidence_refs: [],
              qa_test_evidence_required: true,
            },
          },
        ),
      },
    });

    const releaseAction = await screen.findByRole('button', { name: /Release unavailable/i });
    expectButtonDisabled(releaseAction);
    expect(within(screen.getByTestId('gate-rail')).queryByRole('link', { name: /^Release/i })).toBeNull();
    expect(document.body.textContent).toMatch(/Release gate waits for an owning Release link/i);
  });

  it('routes Plan Item Review and QA gate cards to actionable handoff surfaces', async () => {
    const user = userEvent.setup();
    const gateItem = itemOverride(
      {
        boundary_status: 'approved',
        spec_status: 'approved',
        implementation_plan_status: 'approved',
        execution_status: 'completed',
        review_status: 'changes_requested',
        qa_handoff_status: 'pending',
      },
      {
        codeReview: { execution_id: execution.id, status: 'changes_requested' },
        execution: { id: execution.id, development_plan_item_ref: execution.development_plan_item_ref },
      },
    );
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`, {
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: gateItem,
      },
    });

    await user.click(await screen.findByRole('button', { name: /^open code review$/i }));
    expect(document.querySelector('[data-page-family="execution-supervision"]')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: /Code review handoff/i })).toBeTruthy();

    cleanup();
    const qaScreen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`, {
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: gateItem,
      },
    });
    await user.click(await qaScreen.findByRole('button', { name: /^open qa handoff$/i }));
    expect(await qaScreen.findByRole('heading', { name: 'QA' })).toBeTruthy();
    expect(document.querySelector('[data-page-family="qa-handoff"]')).toBeTruthy();
    expect(await qaScreen.findAllByRole('link', { name: /^Open execution handoff$/i })).toHaveLength(2);
  });

  it('keeps Development Plan loaded state compact while Plan Item pages expose exceptional state', async () => {
    const planScreen = await renderRoute(`/development-plans/${developmentPlan.id}`);
    expect(await planScreen.findByRole('heading', { name: developmentPlan.title })).toBeTruthy();
    expect(planScreen.queryByLabelText(/Development Plan Page .* state/i)).toBeNull();
    cleanup();

    const itemScreen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`);
    expect(await itemScreen.findByRole('heading', { name: developmentPlanItem.title })).toBeTruthy();
    expect(itemScreen.queryByLabelText(/Development Plan Item Detail .* state/i)).toBeNull();
    expect(document.querySelector('[data-product-shell="plan-item-workflow-workspace"]')).toBeTruthy();
  });
});

type ItemStatusOverride = Partial<{
  boundary_status: string;
  spec_status: string;
  implementation_plan_status: string;
  execution_status: string;
  review_status: string;
  qa_handoff_status: string;
}>;

function itemOverride(
  status: ItemStatusOverride,
  options: {
    codeReview?: Record<string, unknown>;
    executions?: Array<Record<string, unknown>>;
    execution?: Record<string, unknown>;
    item?: Record<string, unknown>;
    releaseContext?: Record<string, unknown>;
    runtimeBoundary?: Record<string, unknown> | null;
    spec?: Record<string, unknown>;
    qaHandoff?: Record<string, unknown>;
  } = {},
) {
  return {
    ...developmentPlanItem,
    ...options.item,
    ...status,
    object_ref: {
      type: 'development_plan_item',
      id: developmentPlanItem.id,
      development_plan_id: developmentPlan.id,
      title: developmentPlanItem.title,
    },
    development_plan_ref: { type: 'development_plan', id: developmentPlan.id, title: developmentPlan.title },
    source_ref: developmentPlan.source_refs[0],
    boundary_summary_revisions: status.boundary_status === 'approved' ? [
      {
        ...boundarySummary,
        id: boundarySummary.revision_id,
        boundary_summary_id: boundarySummary.id,
        revision_number: 1,
        summary_markdown: boundarySummary.summary_markdown,
      },
    ] : [],
    specs: status.spec_status === 'missing' || status.spec_status === 'not_started' ? [] : [{
      id: 'spec-cockpit-command-center',
      title: 'Spec revision',
      current_revision_id: 'specrev-cockpit-command-center-v1',
      approved_revision_id: 'specrev-cockpit-command-center-v1',
      acceptance_criteria: ['Route action eligibility is visible.'],
      test_strategy_summary: 'Run Plan Item gate workspace tests.',
      qa_owner_actor_id: 'actor-qa',
      testability_note: 'QA reviewed the Spec before Implementation Plan Doc authoring.',
      ...options.spec,
    }],
    implementation_plan_docs: status.implementation_plan_status === 'missing' || status.implementation_plan_status === 'not_started' ? [] : [{ id: 'implementation-plan-doc-requirements-database-view', title: 'Implementation Plan Doc revision', current_revision_id: 'planrev-requirements-database-view-v1', approved_revision_id: 'planrev-requirements-database-view-v1' }],
    executions: options.executions ?? (status.execution_status === 'not_started' ? [] : [{
      id: 'exec-preview-seed-visual-review',
      title: 'Execution',
      status: status.execution_status ?? developmentPlanItem.execution_status,
      evidence_refs: [{ type: 'execution', id: 'evidence-exec-preview-seed-checks', title: 'Verification evidence' }],
      ...options.execution,
    }]),
    runtime_boundary: options.runtimeBoundary === null
      ? undefined
      : {
          type: 'execution_package',
          id: 'pkg-item-runtime-boundary',
          phase: 'ready',
          activity_state: 'idle',
          gate_state: 'not_submitted',
          implementation_plan_revision_id: 'planrev-requirements-database-view-v1',
          ...options.runtimeBoundary,
        },
    release_context: options.releaseContext,
    code_review_handoffs: status.review_status === 'approved' || options.codeReview !== undefined
      ? [{ id: 'review-cockpit-requested-changes', title: 'Code review', status: 'approved', ...options.codeReview }]
      : [],
    qa_handoffs: status.qa_handoff_status === 'not_started' ? [] : [{
      id: 'qa-requirements-authoring-mdx',
      title: 'QA handoff',
      status: status.qa_handoff_status === 'in_review' ? 'pending' : (status.qa_handoff_status ?? developmentPlanItem.qa_handoff_status),
      ...options.qaHandoff,
    }],
    href: `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
  };
}

function workflowProjectionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'workflow-product-workspace-preview',
    development_plan_id: developmentPlan.id,
    development_plan_item_id: developmentPlanItem.id,
    status: 'spec_generation_queued',
    active_boundary_summary_revision_id: boundarySummary.revision_id,
    active_spec_doc_revision_id: specRevision.id,
    active_implementation_plan_doc_revision_id: executionPlanRevision.id,
    session: {
      status: 'idle',
      role: 'active',
      continuity_state: 'ready',
      can_continue: true,
      last_turn_at: '2026-05-18T00:24:00.000Z',
    },
    queued_actions: [
      {
        id: 'action-generate-spec-doc',
        workflow_id: 'workflow-product-workspace-preview',
        kind: 'generate_spec_doc',
        status: 'queued',
        source_revision_id: boundarySummary.revision_id,
        expected_input_capsule_digest: `sha256:${'a'.repeat(64)}`,
        context_preview_digest: `sha256:${'b'.repeat(64)}`,
        idempotency_key: `sha256:${'c'.repeat(64)}`,
        created_by_actor_id: 'actor-reviewer',
        created_at: '2026-05-18T00:23:00.000Z',
        updated_at: '2026-05-18T00:23:00.000Z',
      },
    ],
    timeline_events: [
      {
        id: 'event-spec-queued',
        workflow_id: 'workflow-product-workspace-preview',
        event_type: 'queued_action',
        status: 'queued',
        actor_id: 'actor-reviewer',
        queued_action_id: 'action-generate-spec-doc',
        queued_action_kind: 'generate_spec_doc',
        queued_action_status: 'queued',
        created_at: '2026-05-18T00:23:00.000Z',
      },
    ],
    context_preview: {
      digest: `sha256:${'d'.repeat(64)}`,
      capsule_digest: `sha256:${'e'.repeat(64)}`,
      boundary_summary_revision_id: boundarySummary.revision_id,
      spec_doc_revision_id: specRevision.id,
      implementation_plan_doc_revision_id: executionPlanRevision.id,
      message_count: 1,
      queued_action_count: 1,
      updated_at: '2026-05-18T00:24:00.000Z',
    },
    readiness: {
      state: 'blocked',
      can_evaluate: true,
      blocker_codes: ['execution_package_missing'],
    },
    blockers: [
      {
        code: 'execution_package_missing',
        status: 'active',
        created_at: '2026-05-18T00:24:00.000Z',
      },
    ],
    created_at: '2026-05-18T00:20:00.000Z',
    updated_at: '2026-05-18T00:24:00.000Z',
    ...overrides,
  };
}

function workflowExecutionRunSummaryFixture(overrides: Record<string, unknown> = {}) {
  return {
    run_session_id: 'run-session-1',
    status: 'running',
    execution_package_version: 7,
    input_capsule_digest: `sha256:${'a'.repeat(64)}`,
    workspace_bundle_digest: `sha256:${'b'.repeat(64)}`,
    codex_thread_id_digest: `sha256:${'c'.repeat(64)}`,
    started_at: '2026-05-18T00:25:00.000Z',
    updated_at: '2026-05-18T00:26:00.000Z',
    ...overrides,
  };
}

function expectNoDownstreamArtifactPayload(body: unknown) {
  expect(body).not.toEqual(expect.objectContaining({ spec_id: expect.anything() }));
  expect(body).not.toEqual(expect.objectContaining({ spec_revision_id: expect.anything() }));
  expect(body).not.toEqual(expect.objectContaining({ implementation_plan_id: expect.anything() }));
  expect(body).not.toEqual(expect.objectContaining({ implementation_plan_revision_id: expect.anything() }));
}

function expectButtonDisabled(element: HTMLElement) {
  expect((element as HTMLButtonElement).disabled).toBe(true);
}

function expectButtonEnabled(element: HTMLElement) {
  expect((element as HTMLButtonElement).disabled).toBe(false);
}

function expectTextContent(element: HTMLElement, expected: RegExp | string) {
  if (expected instanceof RegExp) {
    expect(element.textContent).toMatch(expected);
    return;
  }
  expect(element.textContent).toContain(expected);
}

function parseRequestBody(init: RequestInit | undefined) {
  return JSON.parse(String(init?.body ?? '{}')) as unknown;
}

function createMatchMedia(width: number) {
  return (query: string): MediaQueryList => {
    const maxWidth = Number(query.match(/max-width:\s*(\d+)px/)?.[1] ?? Number.POSITIVE_INFINITY);
    const minWidth = Number(query.match(/min-width:\s*(\d+)px/)?.[1] ?? 0);
    return {
      matches: width >= minWidth && width <= maxWidth,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
  };
}
