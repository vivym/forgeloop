import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import { compileEffectivePathPolicy } from '../../packages/executor/src/index';

const scopedPolicyInput = {
  packageValidationStrategy: 'checks_required' as const,
  snapshotValidationStrategy: 'checks_required' as const,
  sourceMutationPolicy: 'path_policy_scoped' as const,
};

describe('compileEffectivePathPolicy', () => {
  it('intersects package and snapshot allowed paths', () => {
    const policy = compileEffectivePathPolicy({
      ...scopedPolicyInput,
      packagePolicy: { allowed_paths: ['packages/executor/**'] },
      snapshotPolicy: { allowed_paths: ['packages/**/src/**'] },
    });

    expect(policy.evaluateChangedFile({ path: 'packages/executor/src/index.ts' })).toEqual({ allowed: true });
    expect(policy.evaluateChangedFile({ path: 'packages/executor/package.json' })).toMatchObject({
      allowed: false,
      path: 'packages/executor/package.json',
    });
    expect(policy.evaluateChangedFile({ path: 'packages/domain/src/index.ts' })).toMatchObject({
      allowed: false,
      path: 'packages/domain/src/index.ts',
    });
  });

  it('unions package and snapshot forbidden paths', () => {
    const policy = compileEffectivePathPolicy({
      ...scopedPolicyInput,
      packagePolicy: {
        allowed_paths: ['packages/executor/**'],
        forbidden_paths: ['packages/executor/src/generated/**'],
      },
      snapshotPolicy: {
        allowed_paths: ['packages/executor/**'],
        forbidden_paths: ['packages/executor/secrets/**'],
      },
    });

    expect(policy.evaluateChangedFile({ path: 'packages/executor/src/index.ts' })).toEqual({ allowed: true });
    expect(policy.evaluateChangedFile({ path: 'packages/executor/src/generated/client.ts' })).toMatchObject({
      allowed: false,
      path: 'packages/executor/src/generated/client.ts',
      reason: expect.stringContaining('forbidden'),
    });
    expect(policy.evaluateChangedFile({ path: 'packages/executor/secrets/token.txt' })).toMatchObject({
      allowed: false,
      path: 'packages/executor/secrets/token.txt',
      reason: expect.stringContaining('forbidden'),
    });
  });

  it('does not let allow_all_repo in one layer bypass the other layer', () => {
    expect(() =>
      compileEffectivePathPolicy({
        ...scopedPolicyInput,
        packageValidationStrategy: 'allow_all_repo',
        packagePolicy: { allow_all_repo: true },
        snapshotPolicy: { allowed_paths: ['packages/executor/**'] },
      }),
    ).toThrowError(expect.objectContaining({ code: 'path_policy_invalid' }));

    const packageWidePolicy = compileEffectivePathPolicy({
      ...scopedPolicyInput,
      packageValidationStrategy: 'allow_all_repo',
      packageReviewedAllowAllRepo: true,
      packagePolicy: { allow_all_repo: true },
      snapshotPolicy: { allowed_paths: ['packages/executor/**'] },
    });

    expect(packageWidePolicy.evaluateChangedFile({ path: 'packages/executor/src/index.ts' })).toEqual({
      allowed: true,
    });
    expect(packageWidePolicy.evaluateChangedFile({ path: 'packages/domain/src/index.ts' })).toMatchObject({
      allowed: false,
      path: 'packages/domain/src/index.ts',
    });

    const snapshotWidePolicy = compileEffectivePathPolicy({
      ...scopedPolicyInput,
      snapshotValidationStrategy: 'allow_all_repo',
      snapshotReviewedAllowAllRepo: true,
      packagePolicy: { allowed_paths: ['packages/executor/**'] },
      snapshotPolicy: { allow_all_repo: true },
    });

    expect(snapshotWidePolicy.evaluateChangedFile({ path: 'packages/executor/src/index.ts' })).toEqual({
      allowed: true,
    });
    expect(snapshotWidePolicy.evaluateChangedFile({ path: 'packages/domain/src/index.ts' })).toMatchObject({
      allowed: false,
      path: 'packages/domain/src/index.ts',
    });

    expect(() =>
      compileEffectivePathPolicy({
        ...scopedPolicyInput,
        packageValidationStrategy: 'allow_all_repo',
        packageReviewedAllowAllRepo: true,
        packagePolicy: { allow_all_repo: true, allowed_paths: ['../secrets'] },
        snapshotPolicy: { allowed_paths: ['packages/executor/**'] },
      }),
    ).toThrowError(expect.objectContaining({ code: 'path_policy_invalid' }));

    expect(() =>
      compileEffectivePathPolicy({
        ...scopedPolicyInput,
        packageValidationStrategy: 'allow_all_repo',
        packageReviewedAllowAllRepo: true,
        packagePolicy: { allowed_paths: ['**'] },
        snapshotPolicy: { allowed_paths: ['packages/executor/**'] },
      }),
    ).toThrowError(expect.objectContaining({ code: 'path_policy_invalid' }));
  });

  it('uses the same effective policy for declared scope and actual changed files', () => {
    const policy = compileEffectivePathPolicy({
      ...scopedPolicyInput,
      packagePolicy: { allowed_paths: ['packages/executor/**'] },
      snapshotPolicy: { allowed_paths: ['packages/**'], forbidden_paths: ['packages/executor/private/**'] },
    });

    expect(policy.validateDeclaredScope(['packages/executor/src/index.ts'])).toEqual({ allowed: true });
    expect(policy.evaluateChangedFile({ path: 'packages/executor/src/index.ts' })).toEqual({ allowed: true });
    expect(policy.validateDeclaredScope(['packages/executor/private/token.ts'])).toMatchObject({
      allowed: false,
      code: 'path_policy_declared_scope_rejected',
      path: 'packages/executor/private/token.ts',
    });
    expect(policy.evaluateChangedFile({ path: 'packages/executor/private/token.ts' })).toMatchObject({
      allowed: false,
      code: 'path_policy_actual_changes_rejected',
      path: 'packages/executor/private/token.ts',
    });
  });

  it('rejects declared glob scopes that are broader than effective allow or overlap forbidden paths', () => {
    const narrowAllowPolicy = compileEffectivePathPolicy({
      ...scopedPolicyInput,
      packagePolicy: { allowed_paths: ['src/*'] },
      snapshotPolicy: { allowed_paths: ['src/**'] },
    });

    expect(narrowAllowPolicy.validateDeclaredScope(['src/file.ts'])).toEqual({ allowed: true });
    expect(narrowAllowPolicy.validateDeclaredScope(['src/**'])).toMatchObject({
      allowed: false,
      code: 'path_policy_declared_scope_rejected',
      path: 'src/**',
    });

    const forbiddenSubtreePolicy = compileEffectivePathPolicy({
      ...scopedPolicyInput,
      packagePolicy: { allowed_paths: ['src/**'] },
      snapshotPolicy: { allowed_paths: ['src/**'], forbidden_paths: ['src/private/**'] },
    });

    expect(forbiddenSubtreePolicy.validateDeclaredScope(['src/public/**'])).toEqual({ allowed: true });
    expect(forbiddenSubtreePolicy.validateDeclaredScope(['src/**'])).toMatchObject({
      allowed: false,
      code: 'path_policy_declared_scope_rejected',
      path: 'src/**',
      reason: expect.stringContaining('forbidden'),
    });

    const intermediateGlobstarPolicy = compileEffectivePathPolicy({
      ...scopedPolicyInput,
      packagePolicy: { allowed_paths: ['src/**'] },
      snapshotPolicy: { allowed_paths: ['src/**'], forbidden_paths: ['src/**/private/**'] },
    });

    expect(intermediateGlobstarPolicy.validateDeclaredScope(['src/public.ts'])).toEqual({ allowed: true });
    expect(intermediateGlobstarPolicy.validateDeclaredScope(['src/features/private/**'])).toMatchObject({
      allowed: false,
      code: 'path_policy_declared_scope_rejected',
      path: 'src/features/private/**',
      reason: expect.stringContaining('forbidden'),
    });

    const disjointSegmentGlobPolicy = compileEffectivePathPolicy({
      ...scopedPolicyInput,
      packagePolicy: { allowed_paths: ['src/**'] },
      snapshotPolicy: {
        allowed_paths: ['src/**'],
        forbidden_paths: ['src/private-*.ts', 'src/a?.ts'],
      },
    });

    expect(disjointSegmentGlobPolicy.validateDeclaredScope(['src/public-*.ts'])).toEqual({ allowed: true });
    expect(disjointSegmentGlobPolicy.validateDeclaredScope(['src/b?.ts'])).toEqual({ allowed: true });
    expect(disjointSegmentGlobPolicy.validateDeclaredScope(['src/private-token.ts'])).toMatchObject({
      allowed: false,
      code: 'path_policy_declared_scope_rejected',
      reason: expect.stringContaining('forbidden'),
    });
    expect(disjointSegmentGlobPolicy.validateDeclaredScope(['src/a1.ts'])).toMatchObject({
      allowed: false,
      code: 'path_policy_declared_scope_rejected',
      reason: expect.stringContaining('forbidden'),
    });

    const narrowerDeclaredGlobPolicy = compileEffectivePathPolicy({
      ...scopedPolicyInput,
      packagePolicy: { allowed_paths: ['src/a*.ts'] },
      snapshotPolicy: { allowed_paths: ['src/**'] },
    });

    expect(narrowerDeclaredGlobPolicy.evaluateChangedFile({ path: 'src/a1.ts' })).toEqual({ allowed: true });
    expect(narrowerDeclaredGlobPolicy.validateDeclaredScope(['src/a?.ts'])).toEqual({ allowed: true });

    const intermediateGlobstarSubsumptionPolicy = compileEffectivePathPolicy({
      ...scopedPolicyInput,
      packagePolicy: { allowed_paths: ['src/**/test.ts'] },
      snapshotPolicy: { allowed_paths: ['src/**'] },
    });

    expect(intermediateGlobstarSubsumptionPolicy.validateDeclaredScope(['src/**/test.ts'])).toEqual({ allowed: true });
    expect(intermediateGlobstarSubsumptionPolicy.validateDeclaredScope(['src/foo/**/test.ts'])).toEqual({ allowed: true });

    const literalXPolicy = compileEffectivePathPolicy({
      ...scopedPolicyInput,
      packagePolicy: { allowed_paths: ['src/x*'] },
      snapshotPolicy: { allowed_paths: ['src/**'] },
    });

    expect(literalXPolicy.evaluateChangedFile({ path: 'src/abc.ts' })).toMatchObject({
      allowed: false,
      path: 'src/abc.ts',
    });
    expect(literalXPolicy.validateDeclaredScope(['src/*'])).toMatchObject({
      allowed: false,
      code: 'path_policy_declared_scope_rejected',
      path: 'src/*',
    });
  });

  it('accepts no declared source mutations but rejects actual files for deny-all no_source_changes', () => {
    const policy = compileEffectivePathPolicy({
      packagePolicy: { allowed_paths: [] },
      snapshotPolicy: { allowed_paths: [] },
      packageValidationStrategy: 'checks_required',
      snapshotValidationStrategy: 'checks_required',
      sourceMutationPolicy: 'no_source_changes',
    });

    expect(policy.validateDeclaredScope([])).toEqual({ allowed: true });
    expect(policy.evaluateChangedFile({ path: 'README.md' })).toMatchObject({
      allowed: false,
      code: 'path_policy_actual_changes_rejected',
      path: 'README.md',
    });

    expect(() =>
      compileEffectivePathPolicy({
        packagePolicy: { allowed_paths: ['src/**'] },
        snapshotPolicy: { allowed_paths: [] },
        packageValidationStrategy: 'checks_required',
        snapshotValidationStrategy: 'checks_required',
        sourceMutationPolicy: 'no_source_changes',
      }),
    ).toThrowError(expect.objectContaining({ code: 'path_policy_invalid' }));

    expect(() =>
      compileEffectivePathPolicy({
        packagePolicy: { allowed_paths: [] },
        snapshotPolicy: { allow_all_repo: true },
        packageValidationStrategy: 'checks_required',
        snapshotValidationStrategy: 'allow_all_repo',
        snapshotReviewedAllowAllRepo: true,
        sourceMutationPolicy: 'no_source_changes',
      }),
    ).toThrowError(expect.objectContaining({ code: 'path_policy_invalid' }));
  });

  it('keeps repeated globstar non-matches bounded for declared scope validation', () => {
    const repeatedAllowedGlobstars = Array.from({ length: 14 }, () => '**').join('/');
    const repeatedDeclaredSegments = Array.from({ length: 14 }, () => 'a').join('/');
    const policy = compileEffectivePathPolicy({
      ...scopedPolicyInput,
      packagePolicy: { allowed_paths: [`src/${repeatedAllowedGlobstars}/z`] },
      snapshotPolicy: { allowed_paths: ['src/**'] },
    });

    const startedAt = performance.now();
    expect(policy.validateDeclaredScope([`src/${repeatedDeclaredSegments}/y`])).toMatchObject({
      allowed: false,
      code: 'path_policy_declared_scope_rejected',
    });

    expect(performance.now() - startedAt).toBeLessThan(250);
  });
});
