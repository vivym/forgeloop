// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { firstViewportContract } from '../../apps/web/src/features/product-surfaces/first-viewport-contract';
import { developmentPlan, developmentPlanItem, execution } from './fixtures/product-data';
import { expectFirstViewportContract } from './helpers/first-viewport-contract';
import { renderRoute } from './router-test-utils';

function FixturePage() {
  return (
    <main {...{ [firstViewportContract.pageFamilyAttribute]: 'cockpit' }}>
      <h1>Cockpit</h1>
      <section data-testid={firstViewportContract.currentStateTestId} aria-label="Current state">
        Three gate reviews need owner attention.
      </section>
      <section data-testid={firstViewportContract.nextActionTestId} aria-label="Next action">
        Review the oldest blocked Development Plan Item.
      </section>
      <section data-testid={firstViewportContract.roleResponsibilityTestId} aria-label="Role responsibility">
        Product owner is responsible for the next decision.
      </section>
      <section data-testid={firstViewportContract.blockerRiskTestId} aria-label="Blocker or risk">
        Two execution plans are stale.
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
  });

  it('requires the My Work route to expose the queue first-viewport contract', async () => {
    const rendered = await renderRoute('/my-work');

    expect(await rendered.findByRole('heading', { name: 'My Work' })).toBeTruthy();
    expectFirstViewportContract(rendered, { pageFamily: 'queue', heading: 'My Work' });
    expect(document.querySelector('[data-workspace-layout="queue-workspace"]')).toBeInstanceOf(HTMLElement);
  });

  it('requires source object list routes to expose the queue first-viewport contract', async () => {
    const rendered = await renderRoute('/requirements');

    expect(await rendered.findByRole('heading', { name: 'Requirements' })).toBeTruthy();
    expectFirstViewportContract(rendered, { pageFamily: 'source-object-list', heading: 'Requirements' });
    expect(document.querySelector('[data-workspace-layout="queue"]')).toBeInstanceOf(HTMLElement);
  });

  it('requires source object detail routes to expose the object first-viewport contract', async () => {
    const rendered = await renderRoute('/requirements/req-1');

    expect(await rendered.findByRole('heading', { name: 'Requirement' })).toBeTruthy();
    expectFirstViewportContract(rendered, { pageFamily: 'source-object', heading: 'Requirement' });
    expect(document.querySelector('[data-workspace-layout="object"]')).toBeInstanceOf(HTMLElement);
  });

  it('requires source object evidence routes to expose evidence readiness before attachment lists', async () => {
    const rendered = await renderRoute('/requirements/req-1/evidence');

    expect(await rendered.findByRole('heading', { name: 'Requirement Evidence' })).toBeTruthy();
    expectFirstViewportContract(rendered, { pageFamily: 'evidence', heading: 'Requirement Evidence' });
    expect(document.querySelector('[data-workspace-layout="object"]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-first-viewport]')?.textContent).toMatch(/evidence ready/i);
    expect(document.querySelector('[data-first-viewport]')?.textContent).not.toMatch(/Evidence attachments|Raw artifact links/i);
  });

  it('requires Development Plan index routes to expose the planning table first-viewport contract', async () => {
    const rendered = await renderRoute('/development-plans');

    expect(await rendered.findByRole('heading', { name: 'Development Plans' })).toBeTruthy();
    expectFirstViewportContract(rendered, { pageFamily: 'development-plan-index', heading: 'Development Plans' });
    expect(document.querySelector('[data-workspace-layout="planning-table"]')).toBeInstanceOf(HTMLElement);
  });

  it('requires Development Plan authoring to expose source-context planning controls before downstream artifacts', async () => {
    const rendered = await renderRoute('/development-plans/new');

    expect(await rendered.findByRole('heading', { name: 'New Development Plan' })).toBeTruthy();
    expectFirstViewportContract(rendered, { pageFamily: 'development-plan-index', heading: 'New Development Plan' });
    expect(document.querySelector('[data-workspace-layout="planning-table"]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-first-viewport]')?.textContent).toMatch(/source context/i);
    expect(document.body.textContent).toMatch(/generated only from Plan Items after boundary approval/i);
  });

  it('requires Development Plan detail routes to expose table-first gate progress before row details', async () => {
    const rendered = await renderRoute(`/development-plans/${developmentPlan.id}`);

    expect(await rendered.findByRole('heading', { name: developmentPlan.title })).toBeTruthy();
    expect(document.querySelector('[data-page-family]')?.getAttribute('data-page-family')).toBe('development-plan-detail');
    expect(document.querySelector('[data-workspace-layout="planning-table"]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-first-viewport]')?.textContent).toMatch(/gate|Plan Item/i);
    expect(rendered.getAllByTestId(firstViewportContract.currentStateTestId)[0]?.textContent).toMatch(/active/i);
    expect(rendered.getByTestId(firstViewportContract.nextActionTestId).textContent).toMatch(/Supervise execution/i);
    expect(rendered.getAllByTestId(firstViewportContract.roleResponsibilityTestId)[0]?.textContent).toMatch(/Product and technical roles/i);
    expect(rendered.getAllByTestId(firstViewportContract.blockerRiskTestId)[0]?.textContent).toMatch(/blocked Plan Item/i);
    expect(document.body.textContent).not.toMatch(/Work Item Owner|owner_actor_id|\bTask\b/);
  });

  it('requires Development Plan Item gate routes to expose gate workspace first viewports', async () => {
    for (const route of [
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/brainstorming`,
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/spec`,
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/execution-plan`,
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}/execution`,
    ]) {
      const rendered = await renderRoute(route);

      expect(await rendered.findByRole('heading', { name: developmentPlanItem.title })).toBeTruthy();
      expectFirstViewportContract(rendered, { pageFamily: 'gate-workspace', heading: developmentPlanItem.title });
      expect(document.querySelector('[data-workspace-layout="gate"]')).toBeInstanceOf(HTMLElement);
      expect(document.querySelector('[data-first-viewport]')?.textContent).toMatch(/Gate progress|Current enabled action|Evidence side context/i);
      expect(document.body.textContent).not.toMatch(/Work Item Owner|owner_actor_id|\bTask\b|\/specs\/|\/plans\//);
      cleanup();
    }
  });

  it('requires Specs & Execution Plans to expose a queue first viewport and preview workspace', async () => {
    const rendered = await renderRoute('/specs-plans');

    expect(await rendered.findByRole('heading', { name: 'Specs & Execution Plans' })).toBeTruthy();
    expectFirstViewportContract(rendered, { pageFamily: 'spec-plan-queue', heading: 'Specs & Execution Plans' });
    expect(document.querySelector('[data-workspace-layout="queue"]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-first-viewport]')?.textContent).toMatch(/governance|reviewer|risk/i);
    expect(rendered.getByRole('region', { name: /selected governance row/i })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Work Item Owner|owner_actor_id|\bTask\b|\/specs\/|\/plans\//);
  });

  it('requires Executions to expose a supervision queue first viewport', async () => {
    const rendered = await renderRoute('/executions');

    expect(await rendered.findByRole('heading', { name: 'Executions' })).toBeTruthy();
    expectFirstViewportContract(rendered, { pageFamily: 'execution-supervision', heading: 'Executions' });
    expect(document.querySelector('[data-workspace-layout="supervision-lanes"]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-first-viewport]')?.textContent).toMatch(/worker state|allowed action|approved Execution Plan/i);
    expect(document.body.textContent).not.toMatch(/Execution Package Browser|Run Session Browser|Review Packet Browser|run session browser/i);
  });

  it('requires execution detail to expose product supervision before handoff panels', async () => {
    const rendered = await renderRoute(`/executions/${execution.id}`);

    expect(await rendered.findByRole('heading', { name: developmentPlanItem.title })).toBeTruthy();
    expectFirstViewportContract(rendered, { pageFamily: 'execution-supervision-detail', heading: developmentPlanItem.title });
    const firstViewport = document.querySelector('[data-first-viewport]');
    expect(document.querySelector('[data-workspace-layout="supervision-detail"]')).toBeInstanceOf(HTMLElement);
    expect(firstViewport?.textContent).toMatch(/current step|last meaningful event|PR, diff, and test evidence/i);
    expect(within(firstViewport as HTMLElement).getByRole('button', { name: /interrupt execution/i })).toBeTruthy();
    expect(within(firstViewport as HTMLElement).getByRole('button', { name: /continue execution/i })).toBeTruthy();
    expect(within(firstViewport as HTMLElement).getByRole('button', { name: /retry execution/i })).toBeTruthy();
    expect(within(firstViewport as HTMLElement).getByRole('link', { name: /inspect execution/i })).toBeTruthy();
    expect(firstViewport?.textContent).toMatch(/Continue disabled|Retry unavailable/i);
    expect(document.body.textContent).not.toMatch(/Execution Package Browser|Run Session Browser|Review Packet Browser|run session browser/i);
  });
});
