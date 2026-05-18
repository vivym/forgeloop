import { describe, expect, it } from 'vitest';

describe('shared infrastructure boundary', () => {
  it('exports shared providers from product-neutral modules', async () => {
    await expect(import('../../apps/control-plane-api/src/modules/auth/actor-context')).resolves.toHaveProperty(
      'actorContextFromHeaders',
    );
    await expect(import('../../apps/control-plane-api/src/modules/http/zod-validation.pipe')).resolves.toHaveProperty(
      'ZodValidationPipe',
    );
    await expect(import('../../apps/control-plane-api/src/modules/http/domain-error.filter')).resolves.toHaveProperty(
      'DomainErrorFilter',
    );
    await expect(import('../../apps/control-plane-api/src/modules/query/public-run-session-projection')).resolves.toHaveProperty(
      'PublicRunSessionProjection',
    );
  });
});
