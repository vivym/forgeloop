// @vitest-environment jsdom

import { cleanup, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { codeReviewHandoff, developmentPlan, developmentPlanItem, execution, qaHandoff } from './fixtures/product-data';
import { renderRoute } from './router-test-utils';

describe('AI-native My Work, Board, and Reports', () => {
  it('renders My Work as a role-aware inbox with typed targets and reasons', async () => {
    const screen = await renderRoute('/my-work');
    expect(await screen.findByRole('heading', { name: 'My Work' })).toBeTruthy();
    expect(document.querySelector('[data-page-family="inbox"]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-inbox-list][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
    expect(screen.getByRole('button', { name: /Role: All/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Status: All/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Gate: All/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Risk: All/i })).toBeTruthy();
    expect(screen.getByRole('region', { name: /Selected queue item/i })).toBeTruthy();
    expect((await screen.findAllByText(/Open Development Plan Item/i))[0]).toBeTruthy();
    expect(screen.getByRole('link', { name: /open development plan item/i }).getAttribute('href')).toBe(
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
    );
    expect(document.body.textContent).not.toMatch(/\bTasks\b|Work Item Owner|owner_actor_id/);
  });

  it('renders My Work reprioritization mode when the dashboard links to it', async () => {
    const screen = await renderRoute('/my-work?mode=reprioritize');
    expect(await screen.findByText(/Reprioritization mode/i)).toBeTruthy();
  });

  it('renders Cockpit as the operational cockpit, not a placeholder', async () => {
    const screen = await renderRoute('/cockpit');
    expect(await screen.findByRole('heading', { name: 'Cockpit' })).toBeTruthy();
    expect(document.querySelector('[data-page-family="cockpit"]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-cockpit-command-strip]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-attention-queue][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-risk-readiness-rail]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-runtime-status]')).toBeInstanceOf(HTMLElement);
    for (const label of [
      'Release blockers, code-review changes, QA, Spec, and Codex continuity',
      'Release blocker rail',
      'Active and resumable Codex execution',
    ]) {
      expect(screen.getByRole('heading', { name: label })).toBeTruthy();
    }
    expect(document.body.textContent).not.toMatch(/\bTasks\b|Work Item Owner|owner_actor_id|coming soon|placeholder/i);
  });

  it('renders unknown product routes as a product-safe state', async () => {
    const screen = await renderRoute('/unknown-product-route');
    expect(await screen.findByRole('heading', { name: /not found|not available/i })).toBeTruthy();
    expect(document.body.textContent).toMatch(/not found|not available/i);
  });

  it('renders Board as a Development Plan Item gate flow', async () => {
    const screen = await renderRoute('/board');
    expect(await screen.findByRole('heading', { name: 'Board' })).toBeTruthy();
    expect(document.querySelector('[data-page-family="delivery-board"]')).toBeInstanceOf(HTMLElement);
    expect(document.querySelector('[data-board-columns][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
    for (const label of [
      'Planning',
      'Boundary',
      'Spec',
      'Execution Plan',
      'Running',
      'Review',
      'QA',
      'Release',
    ]) {
      expect(screen.getByRole('region', { name: `${label} cards` })).toBeTruthy();
    }
    expect(await screen.findByText(/Requirement/i)).toBeTruthy();
    expect((await screen.findAllByText(/Development Plan Item/i)).length).toBeGreaterThan(0);
    const boardContent = document.querySelector('#main-content')?.textContent ?? '';
    expect(boardContent).not.toMatch(/Intake \/ Development Plan needed|\bReady\b|\bActive\b|\bValidation\b|\bDone\b/);
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toContain(
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
    );
    expect(screen.getAllByText(/Next action/i).length).toBeGreaterThan(0);
    expect(boardContent).toMatch(/Type|Role|Blocker|Risk|Next action/i);
    expect(boardContent).toMatch(/Product driver|Developer|Release owner/i);
    expect(boardContent).not.toMatch(/\bactor-owner\b|\bactor-reviewer\b|owner_actor_id|Work Item Owner|\bTasks\b|\/tasks\b|\/plans\b|\/specs\b/i);
  });

  it('renders Board focus context from typed execution links', async () => {
    const screen = await renderRoute(`/board?execution_id=${execution.id}`);
    expect(await screen.findByText(/Focused Execution card/i)).toBeTruthy();
    expect(await screen.findByText(/Codex worker is rebuilding product workspace preview data/i)).toBeTruthy();
    expect(screen.queryByText(/Board cards could not be loaded/i)).toBeNull();
    expect(document.querySelector('#main-content')?.textContent ?? '').not.toContain(execution.id);
  });

  it('keeps full-flow copy when a Board focus does not match a card', async () => {
    const screen = await renderRoute('/board?execution_id=missing');

    expect(await screen.findByText(/Focus not found/i)).toBeTruthy();
    const boardContent = document.querySelector('#main-content')?.textContent ?? '';
    expect(boardContent).toMatch(/No exact board card matched this focus/i);
    expect(boardContent).toMatch(/full gate flow remains visible/i);
    expect(boardContent).not.toMatch(/Inspect the focused gate card|focused gate flow visible/i);
    expect(screen.queryByText(/Board cards could not be loaded/i)).toBeNull();
  });

  describe('reports route contracts owned by Task 7 delivery/report migration', () => {
    it('renders Reports as product metrics, not placeholders', async () => {
      const screen = await renderRoute('/reports');
      expect(await screen.findByRole('heading', { name: 'Reports' })).toBeTruthy();
      for (const label of [
        'Development Plan throughput',
        'Brainstorming bottlenecks',
        'Spec review aging',
        'Execution Plan review aging',
        'Execution outcomes',
        'Execution continuation',
        'Code review turnaround',
        'QA handoff readiness',
        'Release readiness',
        'Quality and bug escape',
      ]) {
        expect(screen.getByText(label)).toBeTruthy();
      }
      for (const label of ['Conclusion', 'Supporting signal', 'Affected objects', 'Suggested action']) {
        expect(screen.getByText(label)).toBeTruthy();
      }
      await waitFor(() => {
        expect(document.querySelector('[data-report-conclusion]')?.textContent ?? '').toMatch(/Suggested action: Review report findings/i);
      });
      const conclusionText = document.querySelector('[data-report-conclusion]')?.textContent ?? '';
      expect(conclusionText).toMatch(/Development Plan Item/i);
      expect(conclusionText).toMatch(/1 affected object\(s\): 1 Development Plan Item/i);
      expect(conclusionText).toMatch(/Suggested action: Review report findings/i);
      expect(document.body.textContent).not.toMatch(/Affected objects unavailable|report group\(s\)/i);
      expect(document.querySelector('[data-page-family="report-insight"]')).toBeInstanceOf(HTMLElement);
      expect(document.querySelector('[data-report-conclusion][data-primary-work-surface]')).toBeInstanceOf(HTMLElement);
      expect(document.body.textContent).not.toMatch(/coming soon|placeholder/i);
    });

    it('renders Reports focus context from code review and QA handoff links', async () => {
      const codeReviewScreen = await renderRoute(`/reports?code_review_handoff_id=${codeReviewHandoff.id}`);
      expect(await codeReviewScreen.findByText(new RegExp(`Focused code review handoff ${codeReviewHandoff.id}`, 'i'))).toBeTruthy();

      cleanup();
      const qaScreen = await renderRoute(`/reports?qa_handoff_id=${qaHandoff.id}`);
      expect(await qaScreen.findByText(new RegExp(`Focused QA handoff ${qaHandoff.id}`, 'i'))).toBeTruthy();
    });
  });
});
