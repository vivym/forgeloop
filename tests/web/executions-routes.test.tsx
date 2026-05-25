// @vitest-environment jsdom

import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { developmentPlanItem, execution, executionPlanRevision, projectId } from './fixtures/product-data';
import { renderRoute } from './router-test-utils';

describe('Executions routes', () => {
  it('renders supervision lanes with compact product rows instead of raw runtime browser', async () => {
    const screen = await renderRoute('/executions', {
      apiOverrides: {
        [`GET /query/executions?project_id=${projectId}&limit=100`]: {
          degraded_sources: [],
          items: [
            executionRow('active', { status: 'running', worker_state: 'running', current_step: 'Applying approved Execution Plan' }),
            executionRow('resumable', { status: 'interrupted', worker_state: 'resumable', current_step: 'Paused at review checkpoint' }),
            executionRow('review', { status: 'awaiting_code_review', worker_state: 'completed', current_step: 'Waiting for code review handoff' }),
            executionRow('blocked', { status: 'blocked', worker_state: 'blocked', current_step: 'Fix failing route test' }),
            executionRow('recent', { status: 'completed', worker_state: 'completed', current_step: 'QA accepted' }),
          ],
        },
      },
    });

    expect(await screen.findByRole('heading', { name: 'Executions' })).toBeTruthy();
    for (const lane of ['Active', 'Resumable', 'Review pending', 'Failed / blocked', 'Completed / recent']) {
      expect(await screen.findByRole('heading', { name: lane })).toBeTruthy();
    }
    expect((await screen.findAllByText(executionPlanRevision.summary)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(developmentPlanItem.title)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/Worker state/i)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/Applying approved Execution Plan/i)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/Last event/i)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/AI-native Web API clients PR/i)).length).toBeGreaterThan(0);
    expect((await screen.findAllByText(/Allowed action/i)).length).toBeGreaterThan(0);
    expect((await screen.findAllByRole('link', { name: /inspect execution/i })).some((link) => link.getAttribute('href') === `/executions/${execution.id}`)).toBe(true);
    expect(document.body.textContent).toMatch(/Continue disabled: execution is still running/i);
    expect(document.body.textContent).not.toMatch(/Execution Package Browser|Run Session Browser|Review Packet Browser|Run Session|execution package browser/i);
  });

  it('renders execution detail as product supervision with running controls and handoff panels', async () => {
    const screen = await renderRoute(`/executions/${execution.id}`);

    expect(await screen.findByRole('heading', { name: /Build AI-native project management API clients/i })).toBeTruthy();
    expect(document.body.textContent).toMatch(new RegExp(executionPlanRevision.summary));
    expect(document.body.textContent).not.toMatch(new RegExp(`Execution ${execution.id}`));
    expect(document.body.textContent).toMatch(/Worker state/i);
    expect(document.body.textContent).toMatch(/Current step/i);
    expect(document.body.textContent).toMatch(/Last meaningful event/i);
    expect(document.body.textContent).toMatch(/PR, diff, and test evidence/i);
    expect(document.body.textContent).toMatch(/Linked Plan Item/i);
    expect(document.body.textContent).toMatch(/Continue disabled: execution is currently running/i);
    expect(document.body.textContent).toMatch(/Retry unavailable: inspect execution evidence before restarting from the approved Execution Plan path/i);
    expect(await screen.findByRole('button', { name: /interrupt execution/i })).toBeTruthy();
    expect((await screen.findByRole('button', { name: /continue execution/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((await screen.findByRole('button', { name: /retry execution/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(await screen.findByRole('link', { name: /inspect execution/i })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: /Code review handoff/i })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: /QA handoff/i })).toBeTruthy();
    expect(document.body.textContent).toMatch(/Assigned reviewer/i);
    expect(document.body.textContent).not.toMatch(/actor-reviewer/i);
    expect(document.body.textContent).not.toMatch(/Execution Package Browser|Run Session Browser|Review Packet Browser|run session browser|execution package browser|review packet browser/i);
  });

  it('renders execution detail continue control only for resumable executions', async () => {
    const screen = await renderRoute(`/executions/${execution.id}`, {
      apiOverrides: {
        [`GET /query/executions/${execution.id}`]: { ...execution, status: 'interrupted', worker_state: 'interrupted' },
      },
    });

    expect(await screen.findByRole('button', { name: /continue execution/i })).toBeTruthy();
    expect((await screen.findByRole('button', { name: /interrupt execution/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.body.textContent).toMatch(/Interrupt disabled: execution is not actively running/i);
  });

  it('treats blocked resumable executions as failed or blocked, not continuable', async () => {
    const screen = await renderRoute('/executions', {
      apiOverrides: {
        [`GET /query/executions?project_id=${projectId}&limit=100`]: {
          degraded_sources: [],
          items: [
            executionRow('blocked-resumable', {
              blocked: true,
              status: 'paused',
              worker_state: 'resumable',
              current_step: 'Blocked by missing review evidence',
            }),
          ],
        },
      },
    });

    const failedBlockedLane = await screen.findByRole('heading', { name: 'Failed / blocked' });
    expect(failedBlockedLane.closest('section')?.textContent).toMatch(/Blocked by missing review evidence/i);
    expect(failedBlockedLane.closest('section')?.textContent).toMatch(/Inspect execution/i);
    expect(failedBlockedLane.closest('section')?.textContent).toMatch(/Retry unavailable/i);
    expect(failedBlockedLane.closest('section')?.textContent).not.toMatch(/Continue execution/i);
  });

  it('exposes continue and inspect actions for resumable executions', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute('/executions', {
      apiOverrides: {
        [`GET /query/executions?project_id=${projectId}&limit=100`]: {
          degraded_sources: [],
          items: [{ ...execution, status: 'interrupted', worker_state: 'interrupted', title: execution.ref.title, href: `/executions/${execution.id}` }],
        },
      },
    });

    expect(await screen.findByRole('button', { name: /continue execution/i })).toBeTruthy();
    expect(await screen.findByRole('link', { name: /inspect execution/i })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /continue execution/i }));
    expect(await screen.findByText(/Execution continued/i)).toBeTruthy();
  });
});

function executionRow(idSuffix: string, overrides: Record<string, unknown>) {
  return {
    ...execution,
    ...overrides,
    id: `execution-${idSuffix}`,
    title: execution.ref.title,
    href: idSuffix === 'active' ? `/executions/${execution.id}` : `/executions/execution-${idSuffix}`,
    last_event_at: execution.updated_at,
  };
}
