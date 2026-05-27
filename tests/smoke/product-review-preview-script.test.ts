import { describe, expect, it } from 'vitest';
import { getRequirementDetail } from '../../packages/db/src';

import {
  productArchitectureSeedId,
  productReviewPreviewEnv,
  productReviewPreviewProcessEnv,
  renderProductReviewPreviewSummary,
} from '../../scripts/product-review-preview';
import { createControlPlaneRepository } from '../../apps/control-plane-api/src/modules/core/control-plane-core.module';

describe('product review preview script helpers', () => {
  it('builds deterministic product review preview environment', () => {
    const env = productReviewPreviewEnv({ apiPort: 58988, webPort: 58772 });

    expect(env.FORGELOOP_DEMO_SEED_ID).toBe('project-product-architecture-demo');
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.VITE_FORGELOOP_API_URL).toBe('http://127.0.0.1:58988');
    expect(env.VITE_FORGELOOP_PROJECT_ID).toBe('project-product-architecture-demo');
    expect(env.VITE_FORGELOOP_QUERY_RETRY).toBe('false');
    expect(env.FORGELOOP_WEB_PORT).toBe('58772');
  });

  it('renders the preview summary with the seed id', () => {
    expect(
      renderProductReviewPreviewSummary({
        apiUrl: 'http://127.0.0.1:58988',
        webUrl: 'http://127.0.0.1:58772',
      }),
    ).toContain('Seed: project-product-architecture-demo');
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
      FORGELOOP_DEMO_SEED_ID: productArchitectureSeedId,
      FORGELOOP_REPOSITORY_MODE: 'memory',
    } as NodeJS.ProcessEnv);

    await expect(getRequirementDetail(repository, 'req-plan-item-governance')).resolves.toMatchObject({
      id: 'req-plan-item-governance',
      title: 'Plan Item governed Spec and Execution Plan generation',
    });
    await expect(repository.getDevelopmentPlan('dp-product-architecture-visual-rebuild')).resolves.toMatchObject({
      id: 'dp-product-architecture-visual-rebuild',
      title: 'Project architecture and visual rebuild',
    });
    await expect(repository.getExecution('exec-demo-seed-visual-review')).resolves.toMatchObject({
      id: 'exec-demo-seed-visual-review',
      ref: { title: 'Codex worker is seeding visual review data' },
    });
  });
});
