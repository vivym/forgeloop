// @vitest-environment jsdom

import { cleanup, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  boardCards,
  codeReviewHandoff,
  developmentPlan,
  developmentPlanItem,
  executionPlan,
  projectId,
  qaHandoff,
  release,
  reviewPacket,
  spec,
} from './fixtures/product-data';
import { renderRoute } from './router-test-utils';

describe('board, reports, and release readiness routes', () => {
  it('groups cross-object board cards by delivery gates instead of generic columns', async () => {
    const screen = await renderRoute('/board', {
      apiOverrides: {
        [`GET /query/board?project_id=${projectId}&limit=100`]: {
          items: [
            ...boardCards,
            {
              id: `board:${codeReviewHandoff.id}`,
              object_ref: codeReviewHandoff.ref,
              title: codeReviewHandoff.ref.title,
              column_id: 'active',
              status: codeReviewHandoff.status,
              risk: 'medium',
              driver_actor_id: codeReviewHandoff.reviewer_actor_id,
              blocked: false,
              href: `/reports?code_review_handoff_id=${codeReviewHandoff.id}`,
            },
            {
              id: `board:${qaHandoff.id}`,
              object_ref: qaHandoff.ref,
              title: qaHandoff.ref.title,
              column_id: 'validation',
              status: qaHandoff.status,
              risk: 'medium',
              driver_actor_id: 'actor-qa',
              blocked: false,
              href: `/reports?qa_handoff_id=${qaHandoff.id}`,
            },
            {
              id: `board:${spec.id}`,
              object_ref: { type: 'spec', id: spec.id, title: 'Spec board card' },
              title: 'Spec board card',
              column_id: 'spec',
              status: 'approved',
              risk: 'medium',
              blocked: false,
            },
            {
              id: `board:${executionPlan.id}`,
              object_ref: { type: 'execution_plan', id: executionPlan.id, title: 'Execution Plan board card' },
              title: 'Execution Plan board card',
              column_id: 'execution_plan',
              status: 'approved',
              risk: 'medium',
              blocked: false,
            },
          ],
        },
      },
    });

    expect(await screen.findByRole('heading', { name: 'Board' })).toBeTruthy();
    expect(await screen.findByText(/Requirement/i)).toBeTruthy();
    for (const label of ['Intake / Development Plan needed', 'Boundary', 'Spec', 'Execution Plan', 'Execution', 'Review', 'QA', 'Release']) {
      expect(screen.getByRole('region', { name: `${label} cards` })).toBeTruthy();
    }
    expect(screen.getByRole('region', { name: 'Intake / Development Plan needed cards' }).textContent).toMatch(
      /Requirement|Initiative|Tech Debt|Bug/,
    );
    expect(screen.getByRole('region', { name: 'Execution cards' }).textContent).toMatch(/Execution|Development Plan Item/);
    expect(screen.getByRole('region', { name: 'Review cards' }).textContent).toMatch(/Code Review Handoff/);
    expect(screen.getByRole('region', { name: 'QA cards' }).textContent).toMatch(/QA Handoff/);
    expect(screen.getByRole('region', { name: 'Release cards' }).textContent).toMatch(/Release/);
    const mainContent = document.querySelector('#main-content') as HTMLElement;
    const boardHrefs = [...mainContent.querySelectorAll('a')].map((link) => link.getAttribute('href'));
    expect(boardHrefs).toContain(
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
    );
    expect(boardHrefs).toContain(`/specs-plans?spec_id=${spec.id}`);
    expect(boardHrefs).toContain(`/specs-plans?execution_plan_id=${executionPlan.id}`);
    expect(boardHrefs).not.toContain('/my-work');
    expect(document.querySelector('#main-content')?.textContent ?? '').not.toMatch(
      /\bPlanning\b|\bReady\b|\bActive\b|\bValidation\b|\bDone\b/,
    );
  });

  it('shows release readiness by typed object and scoped evidence', async () => {
    const screen = await renderRoute(`/releases/${release.id}`);

    expect(await screen.findByRole('heading', { name: /release readiness/i })).toBeTruthy();
    expect(document.querySelector('[data-first-viewport]')?.textContent).toMatch(
      /scope|readiness|high-risk changes|approvals|launch disabled|rollback/i,
    );
    expect(document.querySelector('[data-first-viewport]')?.textContent).toMatch(
      /Spec|Execution Plan|execution|code review|QA|release blockers|evidence|rollback plan|observation/i,
    );
    for (const label of ['Initiative', 'Requirement', 'Tech Debt', 'Development Plan Item', 'Bug']) {
      expect((await screen.findAllByText(label)).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href'))).toContain(
      `/development-plans/${developmentPlan.id}/items/${developmentPlanItem.id}`,
    );
    const evidenceHrefs = screen
      .getAllByRole('link', { name: 'Open execution evidence' })
      .map((link) => link.getAttribute('href'));
    expect(evidenceHrefs).toContain(
      `/reports?development_plan_item_id=${developmentPlanItem.id}&code_review_handoff_id=${reviewPacket.id}`,
    );
    expect(evidenceHrefs).toContain(`/board?development_plan_item_id=${developmentPlanItem.id}`);
    expect(document.body.textContent).not.toContain('/tasks/');
    expect(document.body.textContent).not.toContain('/packages/');
    expect(document.body.textContent).not.toContain('actor-release-owner');
  });

  it('renders report index and report families', async () => {
    for (const [route, heading] of [
      ['/reports', 'Reports'],
      ['/reports/delivery', 'Delivery Flow'],
      ['/reports/quality', 'Quality'],
      ['/reports/release-readiness', 'Release Readiness'],
      ['/reports/observation', 'Observation'],
    ] as const) {
      const screen = await renderRoute(route);

      expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
      await waitFor(() => {
        expect(document.querySelector('[data-first-viewport]')?.textContent ?? '').toMatch(/suggested action: review report findings/i);
      });
      for (const label of ['Conclusion', 'Supporting signal', 'Affected objects', 'Suggested action']) {
        expect(screen.getByText(label)).toBeTruthy();
      }
      const firstViewportText = document.querySelector('[data-first-viewport]')?.textContent ?? '';
      expect(firstViewportText).toMatch(/signal available/i);
      expect(firstViewportText).toMatch(/supporting signal/i);
      expect(firstViewportText).toMatch(/affected object\(s\): 1 /i);
      expect(firstViewportText).toMatch(/suggested action: review report findings/i);
      expect(document.body.textContent).not.toMatch(/Affected objects unavailable|report group\(s\)/i);
      if (route === '/reports' || route === '/reports/delivery') {
        expect(firstViewportText).toMatch(/Development Plan Item/i);
      }
      if (route === '/reports/quality') {
        expect(firstViewportText).toMatch(/Bug/i);
      }
      if (route === '/reports/release-readiness') {
        expect(firstViewportText).toMatch(/Release/i);
      }
      if (route === '/reports/observation') {
        expect(firstViewportText).toMatch(/Execution/i);
      }
      expect(document.querySelector('[data-page-family="report"][data-workspace-layout="operational-intelligence"]')).toBeInstanceOf(HTMLElement);
      cleanup();
    }
  });

  it('rejects the retired replay report query mode', async () => {
    const screen = await renderRoute('/reports?report=replay');

    expect(await screen.findByRole('heading', { name: /not found/i })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Lifecycle replay evidence context|Raw Replay Browser/i);
    expect(document.body.innerHTML).not.toContain('/reports/replay');
  });
});
