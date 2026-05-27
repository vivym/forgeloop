import { describe, expect, it } from 'vitest';

import { defaultProductApiResponses } from './fixtures/product-api-mock';
import {
  bugDetail,
  codeReviewHandoff,
  developmentPlan,
  developmentPlanItemsById,
  execution,
  executionPackage,
  executionPlanRevision,
  initiativeDetail,
  productWorkspacePreviewSeedId,
  qaHandoff,
  release,
  reportFixtures,
  requirementDetail,
  specRevision,
  techDebtDetail,
} from './fixtures/product-data';

describe('product workspace preview data', () => {
  it('exports deterministic workspace review fixture identities', () => {
    expect(productWorkspacePreviewSeedId).toBe('project-product-workspace-preview');
    expect(initiativeDetail).toMatchObject({
      id: 'init-product-workspace-redesign',
      title: 'Product workspace redesign rollout',
    });
    expect(requirementDetail.id).toBe('req-product-workspace-clarity');
    expect(bugDetail).toMatchObject({
      id: 'bug-plan-item-action-eligibility',
      title: 'Plan Item action eligibility exposes premature execution',
    });
    expect(techDebtDetail).toMatchObject({
      id: 'td-retire-generic-product-page',
      title: 'Retire generic ProductPage visual fallback',
    });
    expect(developmentPlan.id).toBe('dp-product-workspace-core-surface-redesign');
    expect(Object.keys(developmentPlanItemsById)).toEqual([
      'dpi-cockpit-command-center',
      'dpi-requirements-database-view',
      'dpi-product-workspace-preview-state',
      'dpi-development-plan-table-inspector',
    ]);
    expect(developmentPlanItemsById['dpi-cockpit-command-center'].title).toBe(
      'Rebuild Cockpit into operational command center',
    );
    expect(developmentPlanItemsById['dpi-requirements-database-view'].title).toBe(
      'Replace Requirements list with database view',
    );
    expect(developmentPlanItemsById['dpi-product-workspace-preview-state'].title).toBe(
      'Seed product workspace state for visual review',
    );
    expect(developmentPlanItemsById['dpi-development-plan-table-inspector'].title).toBe(
      'Rewrite Development Plan table and inspector',
    );
    expect(specRevision).toMatchObject({
      id: 'specrev-cockpit-command-center-v1',
      summary: 'Cockpit operational command center Spec',
    });
    expect(executionPlanRevision).toMatchObject({
      id: 'planrev-requirements-database-view-v1',
      summary: 'Requirements database view Execution Plan',
    });
    expect(executionPackage).toMatchObject({
      id: 'pkg-product-workspace-preview-v1',
      objective: 'Seed product workspace state execution boundary',
    });
    expect(execution).toMatchObject({
      id: 'exec-product-workspace-preview-active',
      title: 'Codex worker is rebuilding product workspace preview data',
    });
    expect(codeReviewHandoff).toMatchObject({
      id: 'review-cockpit-requested-changes',
      title: 'Requested changes on Cockpit layout density',
    });
    expect(qaHandoff).toMatchObject({
      id: 'qa-requirements-authoring-mdx',
      title: 'QA pending MDX image insertion acceptance',
    });
    expect(release).toMatchObject({
      id: 'rel-product-workspace-preview',
      title: 'Product workspace preview release',
    });
    expect(reportFixtures.delivery).toMatchObject({
      id: 'report-delivery-risk',
      title: 'Delivery risk: workspace redesign blocked by generic template debt',
    });
    expect(requirementDetail.attachment_refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'att-requirement-flow-image', alt_text: 'Plan Item generation flow' }),
      ]),
    );
    expect(bugDetail.attachment_refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'att-bug-action-eligibility',
          alt_text: 'Premature action eligibility reproduction',
        }),
      ]),
    );
    expect(execution.evidence_refs).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'evidence-exec-product-workspace-checks' })]),
    );
  });

  it('threads the workspace review labels through default API responses', () => {
    const serializedResponses = JSON.stringify(defaultProductApiResponses);

    for (const label of [
      'Seed product workspace state for visual review',
      'Requested changes on Cockpit layout density',
      'Product workspace preview release',
      'Product workspace clarity and route-backed context',
      'Plan Item generation flow',
      'Plan Item action eligibility exposes premature execution',
      'Retire generic ProductPage visual fallback',
      'Rewrite Development Plan table and inspector',
      'Codex worker is rebuilding product workspace preview data',
      'QA pending MDX image insertion acceptance',
      'Delivery risk: workspace redesign blocked by generic template debt',
    ]) {
      expect(serializedResponses).toContain(label);
    }
    expect(
      Object.keys(defaultProductApiResponses).filter(
        (key) =>
          key.includes('/development-plans/') &&
          key.includes('/items/') &&
          !key.includes(developmentPlan.id) &&
          !key.includes('dp-release-risk-closure'),
      ),
    ).toEqual([]);
  });

  it('rejects the retired replay report query mode', async () => {
    const key = `GET /query/reports?project_id=${productWorkspacePreviewSeedId}&report=replay`;
    const response = defaultProductApiResponses[key];
    if (typeof response !== 'function') {
      throw new Error(`${key} must be handled by a rejected response`);
    }

    const result = await response({ input: '/query/reports', key });
    expect(result).toBeInstanceOf(Response);
    const rejectedResponse = result as Response;
    expect(rejectedResponse.status).toBe(404);
    await expect(rejectedResponse.json()).resolves.toMatchObject({
      message: 'Replay report is dev-only in product workspace rebuild.',
    });
  });
});
