import { describe, expect, it } from 'vitest';
import { getRequirementDetail } from '../../packages/db/src';

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
  });
});
