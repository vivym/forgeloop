// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { firstViewportContract } from '../../apps/web/src/features/product-surfaces/first-viewport-contract';
import { developmentPlan, developmentPlanItem, execution, release, requirementListItem } from './fixtures/product-data';
import { expectFirstViewportContract } from './helpers/first-viewport-contract';
import { renderRoute } from './router-test-utils';

function FixturePage() {
  return (
    <main {...{ [firstViewportContract.pageFamilyAttribute]: 'cockpit' }}>
      <h1>Cockpit</h1>
      <section {...{ [firstViewportContract.primaryWorkSurfaceAttribute]: '' }} aria-label="Primary work surface">
        Review the oldest blocked Development Plan Item before the next execution pass.
      </section>
    </main>
  );
}

describe('product-grade first viewport contract', () => {
  it('accepts a page with visible action-first affordances and page-family marker', () => {
    render(<FixturePage />);

    expectFirstViewportContract(screen, { pageFamily: 'cockpit', heading: /Cockpit/ });
  });

  it('requires the Cockpit route to expose the shared first-viewport contract', async () => {
    const rendered = await renderRoute('/cockpit');

    expect(await rendered.findByRole('heading', { name: 'Cockpit' })).toBeTruthy();
    expectFirstViewportContract(rendered, { pageFamily: 'cockpit', heading: 'Cockpit' });
    expect(document.querySelector('[data-page-family="cockpit"]')).toBeTruthy();
    expect(document.querySelector('[data-attention-queue][data-primary-work-surface]')).toBeTruthy();
    expect(document.querySelector('[data-first-viewport]')).toBeNull();
  });

  it('requires the My Work route to expose the queue first-viewport contract', async () => {
    const rendered = await renderRoute('/my-work');

    expect(await rendered.findByRole('heading', { name: 'My Work' })).toBeTruthy();
    expectFirstViewportContract(rendered, { pageFamily: 'inbox', heading: 'My Work' });
    expect(document.querySelector('[data-page-family="inbox"]')).toBeTruthy();
    expect(document.querySelector('[data-inbox-list][data-primary-work-surface]')).toBeTruthy();
  });

  it('requires Board route to expose a compact gate-flow first viewport', async () => {
    const rendered = await renderRoute('/board');

    expect(await rendered.findByRole('heading', { name: 'Board' })).toBeTruthy();
    expectFirstViewportContract(rendered, { pageFamily: 'delivery-board', heading: 'Board' });
    expect(document.querySelector('[data-page-family="delivery-board"]')).toBeTruthy();
    expect(document.querySelector('[data-board-columns][data-primary-work-surface]')).toBeTruthy();
    expect(document.querySelector('[data-board-columns]')?.textContent).toMatch(
      /Planning|Boundary|Spec|Execution Plan|Running|Review|QA|Release/,
    );
    expect(document.querySelector('[data-board-columns]')?.textContent).toMatch(/next action|role|blocker|risk/i);
    expect(document.querySelector('[data-first-viewport]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/Work Item Owner|owner_actor_id|\bTask\b|\/tasks\b|\/plans\b|\/specs\b/);
  });
});

describe('Task 5 source object first viewport contracts', () => {
  it('requires source object list routes to expose the database first-viewport contract', async () => {
    const rendered = await renderRoute('/requirements');

    expect(await rendered.findByRole('heading', { name: 'Requirements' })).toBeTruthy();
    expectFirstViewportContract(rendered, { pageFamily: 'source-database', heading: 'Requirements' });
    expect(document.querySelector('[data-database-toolbar]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-data-table][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
  });

  it('requires source object detail routes to expose the document first-viewport contract', async () => {
    const rendered = await renderRoute(`/requirements/${requirementListItem.id}`);

    expect(await rendered.findByRole('heading', { name: 'Requirement' })).toBeTruthy();
    expectFirstViewportContract(rendered, { pageFamily: 'source-document', heading: 'Requirement' });
    expect(document.querySelector('[data-document-surface][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
  });

  it('requires source object evidence routes to expose evidence readiness before attachment lists', async () => {
    const rendered = await renderRoute(`/requirements/${requirementListItem.id}/evidence`);

    expect(await rendered.findByRole('heading', { name: 'Requirement Evidence' })).toBeTruthy();
    await waitFor(() => expect(document.querySelector('[data-evidence-summary]')?.textContent ?? '').toMatch(/evidence ready/i));
    expectFirstViewportContract(rendered, { pageFamily: 'source-evidence', heading: 'Requirement Evidence' });
    expect(document.querySelector('[data-evidence-summary][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-evidence-summary]')?.textContent).toMatch(/evidence ready/i);
    expect(document.querySelector('[data-evidence-summary]')?.textContent).not.toMatch(/Evidence attachments|Raw artifact links/i);
  });
});

describe('Task 6 owner: Development Plan and Plan Item route first-viewport contracts', () => {
  it('requires Development Plan index routes to expose the planning table first-viewport contract', async () => {
    const rendered = await renderRoute('/development-plans');

    expect(await rendered.findByRole('heading', { name: 'Development Plans' })).toBeTruthy();
    expectFirstViewportContract(rendered, { pageFamily: 'planning-table', heading: 'Development Plans' });
    expect(document.querySelector('[data-plan-items-table][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-first-viewport]')).toBeNull();
  });

  it('requires Development Plan authoring to expose source-context planning controls before downstream artifacts', async () => {
    const rendered = await renderRoute('/development-plans/new');

    expect(await rendered.findByRole('heading', { name: 'New Development Plan' })).toBeTruthy();
    expectFirstViewportContract(rendered, { pageFamily: 'plan-authoring', heading: 'New Development Plan' });
    expect(document.querySelector('[data-source-context-picker][data-primary-work-surface], [data-plan-preview][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-first-viewport]')).toBeNull();
    expect(document.querySelector('[data-source-context-picker]')?.textContent).toMatch(/source/i);
    expect(document.body.textContent).toMatch(/generated only from Plan Items after boundary approval/i);
  });

  it('requires Development Plan detail routes to expose table-first gate progress before row details', async () => {
    const rendered = await renderRoute(`/development-plans/${developmentPlan.id}`);

    expect(await rendered.findByRole('heading', { name: developmentPlan.title })).toBeTruthy();
    expectFirstViewportContract(rendered, { pageFamily: 'planning-table', heading: developmentPlan.title });
    expect(document.querySelector('[data-plan-items-table][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-first-viewport]')).toBeNull();
    expect(document.querySelector('[data-plan-items-table]')?.textContent).toMatch(/Plan Item|gate|Resolve Spec review comments/i);
    expect(document.body.textContent).not.toMatch(/Work Item Owner|owner_actor_id|\bTask\b/);
  });

  it('requires Development Plan Item gate routes to expose gate-flow workspaces', async () => {
    for (const route of [
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/brainstorming`,
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/execution`,
    ]) {
      const rendered = await renderRoute(route);

      expect(await rendered.findByRole('heading', { name: developmentPlanItem.title })).toBeTruthy();
      expectFirstViewportContract(rendered, { pageFamily: 'gate-flow', heading: developmentPlanItem.title });
      expect(document.querySelector('[data-gate-workspace][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
      expect(document.querySelector('[data-first-viewport]')).toBeNull();
      expect(document.querySelector('[data-gate-workspace]')?.textContent).toMatch(/Gate progress|Current gate|Evidence side context|Execution supervision/i);
      expect(document.body.textContent).not.toMatch(/Work Item Owner|owner_actor_id|\bTask\b|\/specs\/|\/plans\//);
      cleanup();
    }
  });

  it('requires Spec and Execution Plan routes to expose document-review workspaces', async () => {
    for (const route of [
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/spec`,
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/execution-plan`,
    ]) {
      const rendered = await renderRoute(route);

      expect(await rendered.findByRole('heading', { name: developmentPlanItem.title })).toBeTruthy();
      expectFirstViewportContract(rendered, { pageFamily: 'document-review', heading: developmentPlanItem.title });
      expect(document.querySelector('[data-document-surface][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
      expect(document.querySelector('[data-first-viewport]')).toBeNull();
      expect(document.querySelector('[data-document-surface]')?.textContent).toMatch(/Spec|Execution Plan|Save/i);
      cleanup();
    }
  });
});

describe('Task 7 owner: Document Review, execution, release, and report route first-viewport contracts', () => {
  it('requires Document Reviews to expose a queue first viewport and preview workspace', async () => {
    const rendered = await renderRoute('/specs-plans');

    expect(await rendered.findByRole('heading', { name: 'Document Reviews' })).toBeTruthy();
    expectFirstViewportContract(rendered, { pageFamily: 'document-governance', heading: 'Document Reviews' });
    expect(document.querySelector('[data-document-queue][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-document-queue]')?.textContent).toMatch(/governance|reviewer|risk/i);
    expect(rendered.getByRole('region', { name: /selected governance row/i })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Work Item Owner|owner_actor_id|\bTask\b|\/specs\/|\/plans\//);
  });

  it('requires Executions to expose a supervision queue first viewport', async () => {
    const rendered = await renderRoute('/executions');

    expect(await rendered.findByRole('heading', { name: 'Executions' })).toBeTruthy();
    expectFirstViewportContract(rendered, { pageFamily: 'execution-supervision', heading: 'Executions' });
    expect(document.querySelector('[data-execution-lanes][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-execution-lanes]')?.textContent).toMatch(/worker state|allowed action|approved Execution Plan/i);
    expect(document.body.textContent).not.toMatch(/Execution Package Browser|Run Session Browser|Review Packet Browser|run session browser/i);
  });

  it('requires execution detail to expose product supervision before handoff panels', async () => {
    const rendered = await renderRoute(`/executions/${execution.id}`);

    expect(await rendered.findByRole('heading', { name: developmentPlanItem.title })).toBeTruthy();
    expectFirstViewportContract(rendered, { pageFamily: 'execution-supervision', heading: developmentPlanItem.title });
    expect(document.querySelector('[data-run-evidence][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-run-evidence]')?.textContent).toMatch(/current step|last meaningful event|PR, diff, and test evidence/i);
    expect(document.querySelector('[data-worker-controls]')?.textContent).toMatch(/Continue disabled|Retry unavailable/i);
    expect(rendered.getByRole('button', { name: /interrupt execution/i })).toBeTruthy();
    expect(rendered.getByRole('button', { name: /continue execution/i })).toBeTruthy();
    expect(rendered.getByRole('button', { name: /retry execution/i })).toBeTruthy();
    expect(rendered.getByRole('link', { name: /inspect execution/i })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Execution Package Browser|Run Session Browser|Review Packet Browser|run session browser/i);
  });

  it('requires release routes to expose readiness cockpit first viewports', async () => {
    for (const [route, heading] of [
      ['/releases', 'Releases'],
      [`/releases/${release.id}`, 'Release Readiness'],
    ] as const) {
      const rendered = await renderRoute(route);

      expect(await rendered.findByRole('heading', { name: heading })).toBeTruthy();
      expectFirstViewportContract(rendered, { pageFamily: 'release-readiness', heading });
      expect(document.querySelector('[data-readiness-blockers][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
      expect(document.querySelector('[data-readiness-blockers]')?.textContent).toMatch(/scope|readiness|risk|approval|release owner/i);
      if (route.includes(release.id)) {
        expect(document.querySelector('[data-readiness-blockers]')?.textContent).toMatch(
          /Spec|Execution Plan|execution|code review|QA|release blockers|evidence|rollback plan|observation/i,
        );
      }
      expect(document.body.textContent).not.toMatch(/Work Item Owner|owner_actor_id|\bTask\b|\/tasks\b|\/packages\b|actor-release-owner/);
      cleanup();
    }
  });

  it('requires release evidence to lead with evidence readiness and relevance', async () => {
    const rendered = await renderRoute(`/releases/${release.id}/evidence`);

    expect(await rendered.findByRole('heading', { name: 'Release Evidence' })).toBeTruthy();
    expectFirstViewportContract(rendered, { pageFamily: 'release-evidence', heading: 'Release Evidence' });
    expect(document.querySelector('[data-release-evidence-summary][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-release-evidence-summary]')?.textContent).toMatch(/evidence readiness|relevance|QA acceptance/i);
    expect(document.body.textContent).not.toMatch(/Work Item Owner|owner_actor_id|\bTask\b|\/tasks\b|\/packages\b|actor-release-owner/);
  });

  it('requires Reports to expose operational intelligence before catalog links', async () => {
    for (const [route, heading] of [
      ['/reports', 'Reports'],
      ['/reports/delivery', 'Delivery Flow'],
      ['/reports/quality', 'Quality'],
      ['/reports/release-readiness', 'Release Readiness'],
      ['/reports/observation', 'Observation'],
    ] as const) {
      const rendered = await renderRoute(route);

      expect(await rendered.findByRole('heading', { name: heading })).toBeTruthy();
      await waitFor(() => {
        expect(document.querySelector('[data-report-conclusion]')?.textContent ?? '').toMatch(/Suggested action: Review report findings/i);
      });
      expectFirstViewportContract(rendered, { pageFamily: 'report-insight', heading });
      expect(document.querySelector('[data-report-conclusion][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
      const conclusionText = document.querySelector('[data-report-conclusion]')?.textContent ?? '';
      expect(conclusionText).toMatch(/conclusion|supporting signal|affected objects|suggested action/i);
      expect(conclusionText).toMatch(/1 affected object\(s\): 1 (Development Plan Item|Bug|Release|Execution)/i);
      expect(document.body.textContent).not.toMatch(/Affected objects unavailable|report group\(s\)/i);
      expect(document.body.textContent).not.toMatch(/coming soon|placeholder|raw replay browser|\/reports\/replay/i);
      cleanup();
    }
  });

  it('rejects the retired replay report query mode before rendering report intelligence', async () => {
    const rendered = await renderRoute('/reports?report=replay');

    expect(await rendered.findByRole('heading', { name: 'Reports' })).toBeTruthy();
    expectFirstViewportContract(rendered, { pageFamily: 'report-insight', heading: 'Reports' });
    expect(document.body.textContent).not.toMatch(/Lifecycle replay evidence context|raw replay browser/i);
    expect(document.querySelector('[data-report-conclusion][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
  });
});
