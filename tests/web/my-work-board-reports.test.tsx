// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { codeReviewHandoff, developmentPlan, developmentPlanItem, execution, qaHandoff } from './fixtures/product-data';
import { renderRoute } from './router-test-utils';

describe('AI-native My Work, Board, and Reports', () => {
  it('renders My Work as a role-aware inbox with typed targets and reasons', async () => {
    const screen = await renderRoute('/my-work');
    expect(await screen.findByRole('heading', { name: 'My Work' })).toBeTruthy();
    expect(await screen.findByText(/Needs boundary approval/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /open development plan item/i }).getAttribute('href')).toBe(
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
    );
    expect(document.body.textContent).not.toMatch(/\bTasks\b|Work Item Owner|owner_actor_id/);
  });

  it('renders My Work reprioritization mode when the dashboard links to it', async () => {
    const screen = await renderRoute('/my-work?mode=reprioritize');
    expect(await screen.findByText(/Reprioritization mode/i)).toBeTruthy();
  });

  it('renders Dashboard as an operational cockpit, not a placeholder', async () => {
    const screen = await renderRoute('/dashboard');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    for (const label of ['Flow health', 'Blocked work', 'Aging', 'Risk concentration', 'Role load', 'Release confidence', 'Trend reports']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByRole('link', { name: /inspect bottleneck reports/i })[0]?.getAttribute('href')).toBe('/reports');
    expect((await screen.findByRole('link', { name: /execution continuation/i })).getAttribute('href')).toBe('/reports/delivery');
    expect(screen.getByRole('link', { name: /reprioritize/i })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bTasks\b|Work Item Owner|owner_actor_id|coming soon|placeholder/i);
  });

  it('renders Board with mixed source objects and Development Plan Items', async () => {
    const screen = await renderRoute('/board');
    expect(await screen.findByRole('heading', { name: 'Board' })).toBeTruthy();
    expect(await screen.findByText(/Requirement/i)).toBeTruthy();
    expect(await screen.findByText(/Development Plan Item/i)).toBeTruthy();
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toContain(
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
    );
    expect(screen.getAllByText(/Next action/i).length).toBeGreaterThan(0);
  });

  it('renders Board focus context from typed execution links', async () => {
    const screen = await renderRoute(`/board?execution_id=${execution.id}`);
    expect(await screen.findByText(new RegExp(`Focused execution ${execution.id}`, 'i'))).toBeTruthy();
  });

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
    expect(document.body.textContent).not.toMatch(/coming soon|placeholder/i);
  });

  it('renders Reports focus context from code review and QA handoff links', async () => {
    const codeReviewScreen = await renderRoute(`/reports?code_review_handoff_id=${codeReviewHandoff.id}`);
    expect(await codeReviewScreen.findByText(new RegExp(`Focused code review handoff ${codeReviewHandoff.id}`, 'i'))).toBeTruthy();

    const qaScreen = await renderRoute(`/reports?qa_handoff_id=${qaHandoff.id}`);
    expect(await qaScreen.findByText(new RegExp(`Focused QA handoff ${qaHandoff.id}`, 'i'))).toBeTruthy();
  });
});
