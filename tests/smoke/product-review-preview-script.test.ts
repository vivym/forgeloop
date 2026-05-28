import { describe, expect, it } from 'vitest';
import { getReleaseReadinessDetail, getRequirementDetail } from '../../packages/db/src';

import {
  productWorkspacePreviewSeedId,
  productReviewPreviewEnv,
  productReviewPreviewProcessEnv,
  renderProductReviewPreviewSummary,
} from '../../scripts/product-review-preview';
import { createControlPlaneRepository } from '../../apps/control-plane-api/src/modules/core/control-plane-core.module';

describe('product review preview script helpers', () => {
  it('builds deterministic product review preview environment', () => {
    const env = productReviewPreviewEnv({ apiPort: 58988, webPort: 58772 });

    expect(env.FORGELOOP_PREVIEW_SEED_ID).toBe('project-product-workspace-preview');
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.VITE_FORGELOOP_API_URL).toBe('http://127.0.0.1:58988');
    expect(env.VITE_FORGELOOP_PROJECT_ID).toBe('project-product-workspace-preview');
    expect(env.VITE_FORGELOOP_QUERY_RETRY).toBe('false');
    expect(env.FORGELOOP_WEB_PORT).toBe('58772');
  });

  it('renders the preview summary with the seed id', () => {
    expect(
      renderProductReviewPreviewSummary({
        apiUrl: 'http://127.0.0.1:58988',
        webUrl: 'http://127.0.0.1:58772',
      }),
    ).toContain('Seed: project-product-workspace-preview');
  });

  it('sanitizes parent database configuration before spawning preview services', () => {
    const env = productReviewPreviewProcessEnv(
      {
        DATABASE_URL: 'postgres://127.0.0.1:5432/other-project',
        FORGELOOP_DATABASE_URL: 'postgres://127.0.0.1:5432/other-forgeloop-project',
        PATH: '/usr/bin',
      },
      { apiPort: 58988, webPort: 58772 },
    );

    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.FORGELOOP_DATABASE_URL).toBeUndefined();
    expect(env.FORGELOOP_REPOSITORY_MODE).toBe('memory');
    expect(env.PORT).toBe('58988');
    expect(env.PATH).toBe('/usr/bin');
  });

  it('seeds the control-plane in-memory repository for product review preview', async () => {
    const repository = await createControlPlaneRepository({
      FORGELOOP_PREVIEW_SEED_ID: productWorkspacePreviewSeedId,
      FORGELOOP_REPOSITORY_MODE: 'memory',
    } as NodeJS.ProcessEnv);

    await expect(getRequirementDetail(repository, 'req-product-workspace-clarity')).resolves.toMatchObject({
      id: 'req-product-workspace-clarity',
      title: 'Product workspace clarity and route-backed context',
    });
    await expect(repository.getDevelopmentPlan('dp-product-workspace-core-surface-redesign')).resolves.toMatchObject({
      id: 'dp-product-workspace-core-surface-redesign',
      title: 'Product workspace core surface redesign',
    });
    await expect(repository.getExecution('exec-product-workspace-preview-active')).resolves.toMatchObject({
      id: 'exec-product-workspace-preview-active',
      ref: { title: 'Codex worker is rebuilding product workspace preview data' },
    });

    const workItems = await repository.listWorkItems(productWorkspacePreviewSeedId);
    expect(workItems.filter((item) => item.kind === 'requirement')).toHaveLength(4);
    expect(workItems.filter((item) => item.kind === 'initiative')).toHaveLength(1);
    expect(workItems.filter((item) => item.kind === 'bug')).toHaveLength(1);
    expect(workItems.filter((item) => item.kind === 'tech_debt')).toHaveLength(1);

    const developmentPlans = await repository.listDevelopmentPlans(productWorkspacePreviewSeedId);
    expect(developmentPlans).toHaveLength(2);
    const planItems = (
      await Promise.all(developmentPlans.map((plan) => repository.listDevelopmentPlanItems(plan.id)))
    ).flat();
    expect(planItems.length).toBeGreaterThanOrEqual(8);
    expect(planItems.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'dpi-cockpit-command-center',
        'dpi-development-plan-table-inspector',
        'dpi-plan-item-gate-eligibility',
        'dpi-product-workspace-preview-state',
        'dpi-qa-shift-left-strategy',
        'dpi-release-blocker-closure',
        'dpi-requirements-database-view',
        'dpi-typed-source-boundary',
      ]),
    );

    await expect(repository.getExecution('exec-release-risk-closure-interrupted')).resolves.toMatchObject({
      id: 'exec-release-risk-closure-interrupted',
      status: 'interrupted',
      worker_state: 'interrupted',
    });
    const executions = await repository.listExecutions();
    expect(executions.map((execution) => execution.status)).toEqual(
      expect.arrayContaining(['running', 'interrupted']),
    );
    expect((await repository.listCodeReviewHandoffs()).map((handoff) => handoff.status)).toEqual(
      expect.arrayContaining(['changes_requested']),
    );
    expect((await repository.listQaHandoffs()).map((handoff) => handoff.status)).toEqual(
      expect.arrayContaining(['pending', 'blocked']),
    );

    await expect(
      getReleaseReadinessDetail(repository, 'rel-product-workspace-preview', {
        project_id: productWorkspacePreviewSeedId,
      }),
    ).resolves.toMatchObject({
      release_id: 'rel-product-workspace-preview',
      ready: false,
      disabled_reasons: expect.arrayContaining([expect.objectContaining({ code: expect.any(String) })]),
    });

    await expect(repository.listAttachmentsForObject('requirement', 'req-product-workspace-clarity')).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'att-requirement-flow-image',
          content_type: 'image/png',
          alt_text: 'Plan Item generation flow',
        }),
      ]),
    );
  });
});
