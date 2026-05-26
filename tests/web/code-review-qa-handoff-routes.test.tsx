// @vitest-environment jsdom

import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { codeReviewHandoff, developmentPlanItem, execution, projectId, qaHandoff } from './fixtures/product-data';
import { renderRoute } from './router-test-utils';

describe('Code review and QA handoff route panels', () => {
  it('renders code review and QA handoff controls from an execution detail', async () => {
    const screen = await renderRoute(`/executions/${execution.id}`);

    expect(await screen.findByRole('heading', { name: developmentPlanItem.title })).toBeTruthy();
    expect((await screen.findByRole('button', { name: /ready for code review/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(await screen.findByRole('heading', { name: /Code review handoff/i })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: /QA handoff/i })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /request changes/i })).toBeTruthy();
    expect(await screen.findByText(/QA handoff requires approved code review/i)).toBeTruthy();
    expect((await screen.findByRole('button', { name: /create qa handoff/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((await screen.findByRole('button', { name: /accept qa handoff/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('marks a completed execution ready for code review only before a handoff exists', async () => {
    const user = userEvent.setup();
    const screen = await renderRoute(`/executions/${execution.id}`, {
      apiOverrides: {
        [`GET /query/executions/${execution.id}`]: { ...execution, status: 'completed', worker_state: 'completed' },
        [`GET /query/code-review-handoffs?project_id=${projectId}&execution_id=${execution.id}&limit=100`]: {
          items: [],
          degraded_sources: [],
        },
        [`GET /query/qa-handoffs?project_id=${projectId}&execution_id=${execution.id}&limit=100`]: {
          items: [],
          degraded_sources: [],
        },
      },
    });

    await user.click(await screen.findByRole('button', { name: /ready for code review/i }));
    expect(await screen.findByText(/Execution marked ready for code review/i)).toBeTruthy();
  });

  it('allows a completed execution to resubmit after code review requests changes', async () => {
    const user = userEvent.setup();
    const changesRequestedReview = { ...codeReviewHandoff, status: 'changes_requested' };
    const screen = await renderRoute(`/executions/${execution.id}`, {
      apiOverrides: {
        [`GET /query/executions/${execution.id}`]: { ...execution, status: 'completed', worker_state: 'completed' },
        [`GET /query/code-review-handoffs?project_id=${projectId}&execution_id=${execution.id}&limit=100`]: {
          items: [{ ...changesRequestedReview, title: changesRequestedReview.ref.title }],
          degraded_sources: [],
        },
        [`GET /query/qa-handoffs?project_id=${projectId}&execution_id=${execution.id}&limit=100`]: {
          items: [],
          degraded_sources: [],
        },
      },
    });

    await user.click(await screen.findByRole('button', { name: /ready for code review/i }));
    expect(await screen.findByText(/Execution marked ready for code review/i)).toBeTruthy();
  });

  it('creates a QA handoff only when none exists', async () => {
    const user = userEvent.setup();
    const approvedReview = { ...codeReviewHandoff, status: 'approved' };
    const screen = await renderRoute(`/executions/${execution.id}`, {
      apiOverrides: {
        [`GET /query/code-review-handoffs?project_id=${projectId}&execution_id=${execution.id}&limit=100`]: {
          items: [{ ...approvedReview, title: approvedReview.ref.title }],
          degraded_sources: [],
        },
        [`GET /query/qa-handoffs?project_id=${projectId}&execution_id=${execution.id}&limit=100`]: {
          items: [],
          degraded_sources: [],
        },
      },
    });

    await user.click(await screen.findByRole('button', { name: /create qa handoff/i }));
    expect(await screen.findByText(/QA handoff created/i)).toBeTruthy();
  });

  it('accepts an existing QA handoff only after code review approval', async () => {
    const user = userEvent.setup();
    const approvedReview = { ...codeReviewHandoff, status: 'approved' };
    const screen = await renderRoute(`/executions/${execution.id}`, {
      apiOverrides: {
        [`GET /query/code-review-handoffs?project_id=${projectId}&execution_id=${execution.id}&limit=100`]: {
          items: [{ ...approvedReview, title: approvedReview.ref.title }],
          degraded_sources: [],
        },
        [`GET /query/qa-handoffs?project_id=${projectId}&execution_id=${execution.id}&limit=100`]: {
          items: [{ ...qaHandoff, title: qaHandoff.ref.title }],
          degraded_sources: [],
        },
      },
    });

    expect((await screen.findByRole('button', { name: /create qa handoff/i }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(await screen.findByRole('button', { name: /accept qa handoff/i }));
    expect(await screen.findByText(/QA accepted/i)).toBeTruthy();
  });

  it('accepts a blocked QA handoff after code review approval', async () => {
    const user = userEvent.setup();
    const approvedReview = { ...codeReviewHandoff, status: 'approved' };
    const blockedQa = { ...qaHandoff, status: 'blocked' };
    const screen = await renderRoute(`/executions/${execution.id}`, {
      apiOverrides: {
        [`GET /query/code-review-handoffs?project_id=${projectId}&execution_id=${execution.id}&limit=100`]: {
          items: [{ ...approvedReview, title: approvedReview.ref.title }],
          degraded_sources: [],
        },
        [`GET /query/qa-handoffs?project_id=${projectId}&execution_id=${execution.id}&limit=100`]: {
          items: [{ ...blockedQa, title: blockedQa.ref.title }],
          degraded_sources: [],
        },
      },
    });

    await user.click(await screen.findByRole('button', { name: /accept qa handoff/i }));
    expect(await screen.findByText(/QA accepted/i)).toBeTruthy();
  });

  it('does not expose terminal code-review and QA state transitions', async () => {
    const approvedReview = { ...codeReviewHandoff, status: 'approved' };
    const acceptedQa = { ...qaHandoff, status: 'accepted' };
    const screen = await renderRoute(`/executions/${execution.id}`, {
      apiOverrides: {
        [`GET /query/code-review-handoffs?project_id=${projectId}&execution_id=${execution.id}&limit=100`]: {
          items: [{ ...approvedReview, title: approvedReview.ref.title }],
          degraded_sources: [],
        },
        [`GET /query/qa-handoffs?project_id=${projectId}&execution_id=${execution.id}&limit=100`]: {
          items: [{ ...acceptedQa, title: acceptedQa.ref.title }],
          degraded_sources: [],
        },
      },
    });

    expect((await screen.findByRole('button', { name: /approve code review/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((await screen.findByRole('button', { name: /request changes/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((await screen.findByRole('button', { name: /block qa/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((await screen.findByRole('button', { name: /accept qa handoff/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('uses execution-scoped handoff queries instead of project-wide first page data', async () => {
    const screen = await renderRoute(`/executions/${execution.id}`, {
      apiOverrides: {
        [`GET /query/code-review-handoffs?project_id=${projectId}&limit=100`]: { items: [], degraded_sources: [] },
        [`GET /query/qa-handoffs?project_id=${projectId}&limit=100`]: { items: [], degraded_sources: [] },
        [`GET /query/code-review-handoffs?project_id=${projectId}&execution_id=${execution.id}&limit=100`]: {
          items: [{ ...codeReviewHandoff, title: codeReviewHandoff.ref.title }],
          degraded_sources: [],
        },
        [`GET /query/qa-handoffs?project_id=${projectId}&execution_id=${execution.id}&limit=100`]: {
          items: [{ ...qaHandoff, title: qaHandoff.ref.title }],
          degraded_sources: [],
        },
      },
    });

    expect(await screen.findByRole('button', { name: /request changes/i })).toBeTruthy();
    expect(await screen.findByRole('button', { name: /accept qa handoff/i })).toBeTruthy();
  });
});
