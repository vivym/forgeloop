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
  productArchitectureSeedId,
  qaHandoff,
  release,
  reportFixtures,
  requirementDetail,
  specRevision,
  techDebtDetail,
} from './fixtures/product-data';

describe('product architecture demo data', () => {
  it('exports deterministic architecture review fixture identities', () => {
    expect(productArchitectureSeedId).toBe('project-product-architecture-demo');
    expect(initiativeDetail).toMatchObject({
      id: 'init-ai-native-rollout',
      title: 'AI-native project management rollout',
    });
    expect(requirementDetail.id).toBe('req-plan-item-governance');
    expect(bugDetail).toMatchObject({
      id: 'bug-execution-review-context',
      title: 'Execution continuation loses review context',
    });
    expect(techDebtDetail).toMatchObject({
      id: 'td-retire-workspace-page-template',
      title: 'Retire generic WorkspacePage visual template',
    });
    expect(developmentPlan.id).toBe('dp-product-architecture-visual-rebuild');
    expect(Object.keys(developmentPlanItemsById)).toEqual([
      'dpi-cockpit-command-center',
      'dpi-requirements-database-view',
      'dpi-demo-seed-visual-review',
      'dpi-development-plan-table-inspector',
    ]);
    expect(developmentPlanItemsById['dpi-cockpit-command-center'].title).toBe(
      'Rebuild Cockpit into operational command center',
    );
    expect(developmentPlanItemsById['dpi-requirements-database-view'].title).toBe(
      'Replace Requirements list with database view',
    );
    expect(developmentPlanItemsById['dpi-demo-seed-visual-review'].title).toBe(
      'Seed demo project state for visual review',
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
      id: 'pkg-demo-seed-visual-review-v1',
      objective: 'Seed demo project state execution boundary',
    });
    expect(execution).toMatchObject({
      id: 'exec-demo-seed-visual-review',
      title: 'Codex worker is seeding visual review data',
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
      id: 'rel-product-architecture-preview',
      title: 'Product architecture preview release',
    });
    expect(reportFixtures.delivery).toMatchObject({
      id: 'report-delivery-risk',
      title: 'Delivery risk: visual rebuild blocked by generic template debt',
    });
    expect(requirementDetail.attachment_refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'att-requirement-flow-image', alt_text: 'Plan Item generation flow' }),
      ]),
    );
    expect(bugDetail.attachment_refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'att-bug-reproduction-screenshot', alt_text: 'Continuation loses review context' }),
      ]),
    );
    expect(execution.evidence_refs).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'evidence-exec-demo-seed-checks' })]),
    );
  });

  it('threads the architecture review labels through default API responses', () => {
    const serializedResponses = JSON.stringify(defaultProductApiResponses);

    for (const label of [
      'Seed demo project state for visual review',
      'Requested changes on Cockpit layout density',
      'Product architecture preview release',
      'Plan Item governed Spec and Execution Plan generation',
      'Plan Item generation flow',
      'Execution continuation loses review context',
      'Retire generic WorkspacePage visual template',
      'Rewrite Development Plan table and inspector',
      'Codex worker is seeding visual review data',
      'QA pending MDX image insertion acceptance',
      'Delivery risk: visual rebuild blocked by generic template debt',
    ]) {
      expect(serializedResponses).toContain(label);
    }
    expect(Object.keys(defaultProductApiResponses).filter((key) => key.includes('/development-plans/') && key.includes('/items/') && !key.includes(developmentPlan.id))).toEqual([]);
  });

  it('rejects the retired replay report query mode', async () => {
    const key = `GET /query/reports?project_id=${productArchitectureSeedId}&report=replay`;
    const response = defaultProductApiResponses[key];
    if (typeof response !== 'function') {
      throw new Error(`${key} must be handled by a rejected response`);
    }

    const result = await response({ input: '/query/reports', key });
    expect(result).toBeInstanceOf(Response);
    const rejectedResponse = result as Response;
    expect(rejectedResponse.status).toBe(404);
    await expect(rejectedResponse.json()).resolves.toMatchObject({
      message: 'Replay report is dev-only in product architecture rebuild.',
    });
  });
});
