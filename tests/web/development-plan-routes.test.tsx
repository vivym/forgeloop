// @vitest-environment jsdom

import { cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { boundarySummary, developmentPlan, developmentPlanItem, projectId, spec, specRevision } from './fixtures/product-data';
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
    expectTextContent(screen.getByTestId('gate-rail'), /Boundary/i);
    expectTextContent(screen.getByTestId('gate-rail'), /Spec/i);
    expectTextContent(screen.getByTestId('gate-rail'), /Implementation Plan Doc/i);
    expect(screen.getByRole('region', { name: /development plan item revisions/i })).toBeTruthy();
    expect(screen.getByText(/Item revision 1/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /compare item revisions/i })).toBeTruthy();
    expect(screen.getByRole('region', { name: /boundary summary revisions/i })).toBeTruthy();
    expect(screen.getByText(/Boundary summary revision 1/i)).toBeTruthy();
    expect(screen.getAllByText(boundarySummary.summary_markdown).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /compare boundary revisions/i })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bTask\b|Work Item Owner|owner_actor_id/);
  });

  it('renders the Plan Item overview as one active gate workspace with compact rails', async () => {
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`);

    expect(await screen.findByRole('heading', { name: developmentPlanItem.title })).toBeTruthy();
    expect(document.querySelector('[data-product-shell="plan-item-gate-workspace"]')).toBeInstanceOf(HTMLElement);
    expectTextContent(screen.getByTestId('plan-item-identity-row'), developmentPlanItem.title);
    expectTextContent(screen.getByTestId('plan-item-identity-row'), /Plan Item Driver|Responsible role|Risk/i);
    expectTextContent(screen.getByTestId('gate-rail'), /Boundary/i);
    expectTextContent(screen.getByTestId('gate-rail'), /Spec/i);
    expectTextContent(screen.getByTestId('gate-rail'), /Implementation Plan Doc/i);
    expectTextContent(screen.getByTestId('gate-rail'), /Execution/i);
    expectTextContent(screen.getByTestId('gate-rail'), /Code Review/i);
    expectTextContent(screen.getByTestId('gate-rail'), /QA/i);
    expectTextContent(screen.getByTestId('gate-rail'), /Release/i);
    expectTextContent(screen.getByTestId('active-gate-workspace'), /Spec|Implementation Plan Doc|QA|Code Review|Brainstorming/i);
    expect(screen.queryAllByTestId('full-gate-body')).toHaveLength(1);
    expectTextContent(screen.getByTestId('decision-evidence-rail'), /Decision/i);
    expectTextContent(screen.getByTestId('decision-evidence-rail'), /Evidence/i);
    expectTextContent(screen.getByTestId('decision-evidence-rail'), /Activity/i);
    expectTextContent(screen.getByTestId('decision-evidence-rail'), /Context/i);
    expect(screen.queryByText(/Development Plan Item Detail: Approved state/i)).toBeNull();
  });

  it('renders Development Plan Item overview and execution as gate-flow workspaces', async () => {
    for (const route of [
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/execution`,
    ]) {
      const screen = await renderRoute(route);

      expect(await screen.findByRole('heading', { name: developmentPlanItem.title })).toBeTruthy();
      expectFirstViewportContract(screen, { pageFamily: 'gate-workspace', heading: developmentPlanItem.title });
      expect(document.querySelector('[data-page-family="gate-workspace"]')).toBeTruthy();
      expect(document.querySelector('[data-product-shell="plan-item-gate-workspace"]')).toBeTruthy();
      expect(document.querySelector('[data-gate-workspace][data-primary-work-surface]')).toBeTruthy();
      expect(document.querySelector('[data-gate-workspace]')?.textContent).toContain(developmentPlanItem.next_action);
      expect(document.body.textContent).not.toMatch(/\bTask\b|Work Item Owner|owner_actor_id|\/specs\/|\/plans\//);
      cleanup();
    }
  });

  it('renders Spec and Implementation Plan focus routes as document review editors', async () => {
    for (const focus of ['spec', 'implementation-plan'] as const) {
      const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/${focus}`);

      expect(await screen.findByRole('heading', { name: developmentPlanItem.title })).toBeTruthy();
      expectFirstViewportContract(screen, { pageFamily: 'document-review', heading: developmentPlanItem.title });
      expect(document.querySelector('[data-page-family="document-review"]')).toBeTruthy();
      expect(document.querySelector('[data-document-surface][data-primary-work-surface]')).toBeTruthy();
      expect(await screen.findByLabelText(/editor toolbar/i)).toBeTruthy();
      expect(screen.getByRole('button', { name: /source mode|rich mode/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /insert image/i })).toBeTruthy();
      expect(screen.getByRole('button', { name: /save/i })).toBeTruthy();
      if (focus === 'spec') {
        expect(screen.getByRole('button', { name: /submit spec for review/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /approve spec/i })).toBeTruthy();
      } else {
        expect(screen.getByRole('button', { name: /submit implementation plan doc for review/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /approve implementation plan doc/i })).toBeTruthy();
      }
      cleanup();
    }
  });

  it('does not expose draft save when the persisted item-scoped revision body is unavailable', async () => {
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/spec`, {
      apiOverrides: {
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
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/spec`, {
      apiOverrides: {
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
      [`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/execution`, 'Execution supervision', /Codex worker is rebuilding product workspace preview data/i],
    ] as const) {
      const screen = await renderRoute(route);

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

  it('exposes item-scoped lifecycle actions only when their gate prerequisites are met', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`);

    expectButtonDisabled(await screen.findByRole('button', { name: /^generate spec$/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /submit spec for review/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /approve spec/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /request spec changes/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /reject spec/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /regenerate spec/i }));
    expectButtonEnabled(screen.getByRole('button', { name: /compare spec revisions/i }));

    expectButtonDisabled(screen.getByRole('button', { name: /^generate implementation plan doc$/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /submit implementation plan doc for review/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /approve implementation plan doc/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /request implementation plan doc changes/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /reject implementation plan doc/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /regenerate implementation plan doc/i }));
    expectButtonEnabled(screen.getByRole('button', { name: /compare implementation plan doc revisions/i }));

    expectButtonDisabled(screen.getByRole('button', { name: /^start execution$/i }));
    expectButtonEnabled(screen.getByRole('button', { name: /^interrupt execution$/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /^continue execution$/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /^ready for code review$/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /^create qa handoff$/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /^accept qa handoff$/i }));
    expectButtonEnabled(screen.getByRole('button', { name: /^block qa handoff$/i }));

    await user.click(screen.getByRole('button', { name: /compare spec revisions/i }));
    expect(await screen.findByText(/Compare Spec Revisions command completed/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /compare implementation plan doc revisions/i }));
    expect(await screen.findByText(/Compare Implementation Plan Doc Revisions command completed/i)).toBeTruthy();
  });

  it('enables generation, approval, execution, review, and QA actions at the right item statuses', async () => {
    const scenarios = [
      {
        status: { boundary_status: 'approved', spec_status: 'missing' },
        enabled: /^generate spec$/i,
        disabled: [/^generate implementation plan doc$/i, /^start execution$/i],
      },
      {
        status: { boundary_status: 'approved', spec_status: 'in_review' },
        enabled: /approve spec/i,
        disabled: [/^generate implementation plan doc$/i, /^start execution$/i],
      },
      {
        status: { boundary_status: 'approved', spec_status: 'approved', implementation_plan_status: 'missing' },
        enabled: /^generate implementation plan doc$/i,
        disabled: [/^start execution$/i],
      },
      {
        status: { boundary_status: 'approved', spec_status: 'approved', implementation_plan_status: 'in_review' },
        enabled: /approve implementation plan doc/i,
        disabled: [/^start execution$/i],
      },
      {
        status: { boundary_status: 'approved', spec_status: 'approved', implementation_plan_status: 'approved', execution_status: 'not_started' },
        enabled: /^start execution$/i,
        disabled: [/^ready for code review$/i],
      },
      {
        status: { boundary_status: 'approved', spec_status: 'approved', implementation_plan_status: 'approved', execution_status: 'completed', review_status: 'not_started' },
        enabled: /^ready for code review$/i,
        disabled: [/^create qa handoff$/i],
      },
      {
        status: { boundary_status: 'approved', spec_status: 'approved', implementation_plan_status: 'approved', execution_status: 'completed', review_status: 'approved', qa_handoff_status: 'not_started' },
        enabled: /^create qa handoff$/i,
        disabled: [/^accept qa handoff$/i],
      },
      {
        status: { boundary_status: 'approved', spec_status: 'approved', implementation_plan_status: 'approved', execution_status: 'completed', review_status: 'approved', qa_handoff_status: 'in_review' },
        enabled: /^accept qa handoff$/i,
        disabled: [/^continue execution$/i],
      },
    ] as const;

    for (const scenario of scenarios) {
      const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`, {
        apiOverrides: {
          [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: itemOverride(scenario.status),
        },
      });

      expectButtonEnabled(await screen.findByRole('button', { name: scenario.enabled }));
      for (const name of scenario.disabled) {
        expectButtonDisabled(screen.getByRole('button', { name }));
      }
      cleanup();
    }
  });

  it('keeps lifecycle actions disabled before prerequisite gates are approved', async () => {
    const pendingItem = {
      ...developmentPlanItem,
      boundary_status: 'pending',
      spec_status: 'missing',
      implementation_plan_status: 'missing',
      execution_status: 'not_started',
      review_status: 'not_started',
      qa_handoff_status: 'not_started',
      specs: [],
      implementation_plan_docs: [],
      executions: [],
      qa_handoffs: [],
    };
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`, {
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: itemOverride(pendingItem),
      },
    });

    expectButtonDisabled(await screen.findByRole('button', { name: /^generate spec$/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /^generate implementation plan doc$/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /^start execution$/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /^ready for code review$/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /^create qa handoff$/i }));
  });

  it('keeps Implementation Plan Doc and execution actions disabled when QA strategy or package boundaries are missing', async () => {
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`, {
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: itemOverride(
          {
            boundary_status: 'approved',
            spec_status: 'approved',
            implementation_plan_status: 'missing',
            execution_status: 'not_started',
          },
          {
            spec: {
              qa_owner_actor_id: undefined,
              testability_note: '',
              acceptance_criteria: [],
              test_strategy_summary: '',
            },
          },
        ),
      },
    });

    const generateImplementationPlanDoc = await screen.findByRole('button', { name: /^generate implementation plan doc$/i });
    expectButtonDisabled(generateImplementationPlanDoc);
    expect(generateImplementationPlanDoc.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.body.textContent).toMatch(/QA\/Test Owner|testability note|acceptance criteria|test strategy/i);
    expectButtonDisabled(screen.getByRole('button', { name: /^start execution$/i }));
    cleanup();

    const noPackageScreen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`, {
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: itemOverride(
          {
            boundary_status: 'approved',
            spec_status: 'approved',
            implementation_plan_status: 'approved',
            execution_status: 'not_started',
          },
          {
            runtimeBoundary: null,
          },
        ),
      },
    });

    const startExecution = await noPackageScreen.findByRole('button', { name: /^start execution$/i });
    expectButtonDisabled(startExecution);
    expect(document.body.textContent).toMatch(/runnable internal execution boundary/i);
  });

  it('allows low-risk single-surface Plan Items to generate an Implementation Plan Doc without QA strategy fields', async () => {
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`, {
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: itemOverride(
          {
            boundary_status: 'approved',
            spec_status: 'approved',
            implementation_plan_status: 'missing',
            execution_status: 'not_started',
          },
          {
            item: {
              risk: 'low',
              release_impact: 'none',
              affected_surfaces: ['apps/web/src/features/requirements'],
            },
            spec: {
              qa_owner_actor_id: undefined,
              test_owner_actor_id: undefined,
              testability_note: '',
              acceptance_criteria: [],
              test_strategy_summary: '',
            },
          },
        ),
      },
    });

    const generateImplementationPlanDoc = await screen.findByRole('button', { name: /^generate implementation plan doc$/i });
    expectButtonEnabled(generateImplementationPlanDoc);
    expect(document.body.textContent).toMatch(/QA\/test strategy is optional for low-risk, single-surface Plan Items/i);
  });

  it('uses combined verification evidence and canonical execution status gates', async () => {
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`, {
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: itemOverride(
          {
            boundary_status: 'approved',
            spec_status: 'approved',
            implementation_plan_status: 'approved',
            execution_status: 'completed',
            review_status: 'not_started',
          },
          { execution: { status: 'completed', evidence_refs: [], test_evidence_refs: [{ type: 'execution', id: 'test-evidence', title: 'Test evidence' }] } },
        ),
      },
    });

    expectButtonEnabled(await screen.findByRole('button', { name: /^ready for code review$/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /^interrupt execution$/i }));
    expectButtonDisabled(screen.getByRole('button', { name: /^continue execution$/i }));
    cleanup();

    const invalidActiveScreen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`, {
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: itemOverride(
          {
            boundary_status: 'approved',
            spec_status: 'approved',
            implementation_plan_status: 'approved',
            execution_status: 'running',
          },
          { execution: { status: 'created', worker_state: 'active' } },
        ),
      },
    });

    expectButtonDisabled(await invalidActiveScreen.findByRole('button', { name: /^interrupt execution$/i }));
  });

  it('makes audited exception QA visible and requires QA acceptance evidence', async () => {
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`, {
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: itemOverride(
          {
            boundary_status: 'approved',
            spec_status: 'approved',
            implementation_plan_status: 'approved',
            execution_status: 'completed',
            review_status: 'changes_requested',
            qa_handoff_status: 'not_started',
          },
          {
            codeReview: {
              status: 'changes_requested',
              audited_exception: { reason: 'Prepare QA while review risk is audited.' },
            },
          },
        ),
      },
    });

    expect(await screen.findByText(/Audited code review exception enables early QA preparation/i)).toBeTruthy();
    expectButtonEnabled(screen.getByRole('button', { name: /^create qa handoff$/i }));
    cleanup();

    const noEvidenceScreen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`, {
      apiOverrides: {
        [`GET /query/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`]: itemOverride(
          {
            boundary_status: 'approved',
            spec_status: 'approved',
            implementation_plan_status: 'approved',
            execution_status: 'completed',
            review_status: 'approved',
            qa_handoff_status: 'pending',
          },
          { execution: { status: 'completed', evidence_refs: [], test_evidence_refs: [] } },
        ),
      },
    });

    expectButtonDisabled(await noEvidenceScreen.findByRole('button', { name: /^accept qa handoff$/i }));
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

  it('routes Plan Item Review and QA gate cards to top-level queues', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`);

    await user.click(await screen.findByRole('button', { name: /^open code review$/i }));
    expect(await screen.findByRole('heading', { name: 'Document Reviews' })).toBeTruthy();
    expect(document.querySelector('[data-page-family="document-governance"]')).toBeTruthy();

    cleanup();
    const qaScreen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`);
    await user.click(await qaScreen.findByRole('button', { name: /^open qa handoff$/i }));
    expect(await qaScreen.findByRole('heading', { name: 'QA' })).toBeTruthy();
    expect(document.querySelector('[data-page-family="qa-handoff"]')).toBeTruthy();
  });

  it('keeps Development Plan loaded state compact while Plan Item pages expose exceptional state', async () => {
    const planScreen = await renderRoute(`/development-plans/${developmentPlan.id}`);
    expect(await planScreen.findByRole('heading', { name: developmentPlan.title })).toBeTruthy();
    expect(planScreen.queryByLabelText(/Development Plan Page .* state/i)).toBeNull();
    cleanup();

    const itemScreen = await renderRoute(`/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`);
    expect(await itemScreen.findByRole('heading', { name: developmentPlanItem.title })).toBeTruthy();
    expect(itemScreen.queryByLabelText(/Development Plan Item Detail .* state/i)).toBeNull();
    expect(document.querySelector('[data-product-shell="plan-item-gate-workspace"]')).toBeTruthy();
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
