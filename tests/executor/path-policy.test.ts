import { performance } from 'node:perf_hooks';

import { describe, expect, it } from 'vitest';

import { compilePathPolicy, PathPolicyError } from '../../packages/executor/src/index';

const expectInvalidPolicy = (pattern: string) => {
  expect(() => compilePathPolicy({ allowed_paths: [pattern] })).toThrowError(
    expect.objectContaining({ code: 'path_policy_invalid' }),
  );
};

describe('PathPolicy', () => {
  it('rejects unsafe patterns before matching any changed files', () => {
    for (const pattern of [
      '',
      '.',
      '..',
      '/absolute/path',
      'src\\file.ts',
      'src/\x1ffile.ts',
      '!src/**',
      '{src,tests}/**',
      '@(src|tests)/**',
      '**',
      '*',
      '?',
      '?.md',
      'src/** ',
    ]) {
      expectInvalidPolicy(pattern);
    }

    expectInvalidPolicy(`src/${Array.from({ length: 129 }, (_, index) => `seg${index}`).join('/')}`);
    expectInvalidPolicy(`src/${'a'.repeat(1025)}`);
  });

  it('uses a typed error for invalid policy inputs', () => {
    try {
      compilePathPolicy({ allowed_paths: ['/tmp'] });
      expect.unreachable('compilePathPolicy should reject an absolute pattern');
    } catch (error) {
      expect(error).toBeInstanceOf(PathPolicyError);
      expect(error).toMatchObject({ code: 'path_policy_invalid' });
    }
  });

  it('treats empty allowed_paths as deny-all', () => {
    const policy = compilePathPolicy({ allowed_paths: [], forbidden_paths: [] });

    expect(policy.validateDeclaredScope([])).toEqual({ allowed: true });
    expect(policy.validateDeclaredScope(['src/index.ts'])).toMatchObject({
      allowed: false,
      code: 'path_policy_declared_scope_rejected',
      path: 'src/index.ts',
    });
    expect(policy.evaluateChangedFile({ path: 'src/index.ts' })).toMatchObject({
      allowed: false,
      code: 'path_policy_actual_changes_rejected',
      path: 'src/index.ts',
    });
  });

  it('rejects source allow rules when source mutation policy forbids source changes', () => {
    expect(() =>
      compilePathPolicy(
        { allowed_paths: ['src/**'] },
        { validationStrategy: 'checks_required', sourceMutationPolicy: 'no_source_changes' },
      ),
    ).toThrowError(expect.objectContaining({ code: 'path_policy_invalid' }));

    expect(() =>
      compilePathPolicy(
        { allow_all_repo: true },
        {
          validationStrategy: 'allow_all_repo',
          reviewedAllowAllRepo: true,
          sourceMutationPolicy: 'no_source_changes',
        },
      ),
    ).toThrowError(expect.objectContaining({ code: 'path_policy_invalid' }));
  });

  it('requires explicit reviewed allow_all_repo before permitting root-wide scope', () => {
    expect(() =>
      compilePathPolicy(
        { allow_all_repo: true },
        { validationStrategy: 'allow_all_repo', reviewedAllowAllRepo: false },
      ),
    ).toThrowError(expect.objectContaining({ code: 'path_policy_invalid' }));

    expect(() =>
      compilePathPolicy(
        { allowed_paths: ['**'] },
        { validationStrategy: 'allow_all_repo', reviewedAllowAllRepo: true },
      ),
    ).toThrowError(expect.objectContaining({ code: 'path_policy_invalid' }));

    const policy = compilePathPolicy(
      { allow_all_repo: true, forbidden_paths: ['secrets/**'] },
      { validationStrategy: 'allow_all_repo', reviewedAllowAllRepo: true },
    );

    expect(policy.evaluateChangedFile({ path: 'src/index.ts' })).toEqual({ allowed: true });
    expect(policy.evaluateChangedFile({ path: 'secrets/token.txt' })).toMatchObject({
      allowed: false,
      code: 'path_policy_actual_changes_rejected',
      path: 'secrets/token.txt',
    });

    expect(() =>
      compilePathPolicy(
        { allow_all_repo: true, allowed_paths: ['../secrets'] },
        { validationStrategy: 'allow_all_repo', reviewedAllowAllRepo: true },
      ),
    ).toThrowError(expect.objectContaining({ code: 'path_policy_invalid' }));
  });

  it('applies forbidden paths before allowed paths', () => {
    const policy = compilePathPolicy({
      allowed_paths: ['src/**'],
      forbidden_paths: ['src/private/**'],
    });

    expect(policy.evaluateChangedFile({ path: 'src/public/index.ts' })).toEqual({ allowed: true });
    expect(policy.evaluateChangedFile({ path: 'src/private/secret.ts' })).toMatchObject({
      allowed: false,
      path: 'src/private/secret.ts',
      reason: expect.stringContaining('forbidden'),
    });
  });

  it('evaluates both previous_path and path for renamed files', () => {
    const policy = compilePathPolicy({
      allowed_paths: ['src/**'],
      forbidden_paths: ['src/generated/**'],
    });

    expect(
      policy.evaluateChangedFile({
        change_kind: 'renamed',
        previous_path: 'src/old.ts',
        path: 'src/new.ts',
      }),
    ).toEqual({ allowed: true });
    expect(
      policy.evaluateChangedFile({
        change_kind: 'renamed',
        previous_path: 'src/generated/old.ts',
        path: 'src/new.ts',
      }),
    ).toMatchObject({ allowed: false, path: 'src/generated/old.ts' });
  });

  it('fails closed when renamed changed-file records omit previous_path', () => {
    const policy = compilePathPolicy({
      allowed_paths: ['src/**'],
      forbidden_paths: ['secrets/**'],
    });

    expect(
      policy.evaluateChangedFile({
        change_kind: 'renamed',
        path: 'src/key.ts',
      }),
    ).toMatchObject({
      allowed: false,
      code: 'path_policy_actual_changes_rejected',
      path: 'src/key.ts',
      reason: expect.stringContaining('previous_path'),
    });

    const malformedRenameResult = policy.evaluateChangedFile({
      change_kind: 'renamed',
      path: 'src/\x1fkey.ts',
    });
    expect(malformedRenameResult).toMatchObject({
      allowed: false,
      code: 'path_policy_actual_changes_rejected',
    });
    expect(malformedRenameResult).not.toHaveProperty('path');
  });

  it('returns fail-closed changed-file rejections for malformed paths', () => {
    const policy = compilePathPolicy({ allowed_paths: ['src/**'] });

    for (const path of ['src/../secrets.txt', 'src\\secret.ts', 'src/\x1ffile.ts']) {
      expect(() => policy.evaluateChangedFile({ path })).not.toThrow();
      const result = policy.evaluateChangedFile({ path });
      expect(result).toMatchObject({
        allowed: false,
        code: 'path_policy_actual_changes_rejected',
        reason: expect.any(String),
      });
      expect(result).not.toHaveProperty('path');
    }
  });

  it('returns fail-closed declared-scope rejections for malformed patterns', () => {
    const policy = compilePathPolicy({ allowed_paths: ['src/**'] });

    for (const path of ['src/../secrets.txt', 'src\\secret.ts', 'src/\x1ffile.ts']) {
      expect(() => policy.validateDeclaredScope([path])).not.toThrow();
      const result = policy.validateDeclaredScope([path]);
      expect(result).toMatchObject({
        allowed: false,
        code: 'path_policy_declared_scope_rejected',
        reason: expect.any(String),
      });
      expect(result).not.toHaveProperty('path');
    }
  });

  it('collapses duplicate slashes before matching paths', () => {
    const policy = compilePathPolicy({ allowed_paths: ['src/**'] });

    expect(policy.evaluateChangedFile({ path: 'src//nested///file.ts' })).toEqual({ allowed: true });
  });

  it('normalizes trailing slash directory patterns to descendants only', () => {
    const policy = compilePathPolicy({ allowed_paths: ['src/'] });

    expect(policy.evaluateChangedFile({ path: 'src/file.ts' })).toEqual({ allowed: true });
    expect(policy.evaluateChangedFile({ path: 'src' })).toMatchObject({
      allowed: false,
      path: 'src',
    });

    const explicitDirectory = compilePathPolicy({ allowed_paths: ['src', 'src/'] });
    expect(explicitDirectory.evaluateChangedFile({ path: 'src' })).toEqual({ allowed: true });
  });

  it('requires pattern segments to opt in before matching dotfiles', () => {
    const sourcePolicy = compilePathPolicy({ allowed_paths: ['src/**'] });
    const dotfilePolicy = compilePathPolicy({ allowed_paths: ['src/.config/**', '.github/**'] });

    expect(sourcePolicy.evaluateChangedFile({ path: 'src/index.ts' })).toEqual({ allowed: true });
    expect(sourcePolicy.evaluateChangedFile({ path: 'src/.env' })).toMatchObject({ allowed: false, path: 'src/.env' });
    expect(dotfilePolicy.evaluateChangedFile({ path: 'src/.config/settings.json' })).toEqual({ allowed: true });
    expect(dotfilePolicy.evaluateChangedFile({ path: '.github/workflows/ci.yml' })).toEqual({ allowed: true });
  });

  it('supports globstar matching with case-sensitive semantics', () => {
    const policy = compilePathPolicy({ allowed_paths: ['packages/**/src/**/*.ts'] });

    expect(policy.evaluateChangedFile({ path: 'packages/executor/src/path-policy.ts' })).toEqual({ allowed: true });
    expect(policy.evaluateChangedFile({ path: 'packages/a/b/src/nested/file.ts' })).toEqual({ allowed: true });
    expect(policy.evaluateChangedFile({ path: 'packages/executor/src/path-policy.TS' })).toMatchObject({
      allowed: false,
      path: 'packages/executor/src/path-policy.TS',
    });
  });

  it('keeps repeated globstar non-matches bounded for changed-file evaluation', () => {
    const repeatedGlobstars = Array.from({ length: 12 }, () => '**').join('/');
    const repeatedSegments = Array.from({ length: 12 }, () => 'a').join('/');
    const policy = compilePathPolicy({ allowed_paths: [`src/${repeatedGlobstars}/z`] });

    const startedAt = performance.now();
    expect(policy.evaluateChangedFile({ path: `src/${repeatedSegments}/y` })).toMatchObject({
      allowed: false,
      code: 'path_policy_actual_changes_rejected',
    });

    expect(performance.now() - startedAt).toBeLessThan(250);
  });

  it('uses question-mark wildcards for actual changed-file allow and forbidden checks', () => {
    const allowedPolicy = compilePathPolicy({ allowed_paths: ['src/a?.ts'] });

    expect(allowedPolicy.evaluateChangedFile({ path: 'src/a1.ts' })).toEqual({ allowed: true });
    expect(allowedPolicy.evaluateChangedFile({ path: 'src/a12.ts' })).toMatchObject({
      allowed: false,
      path: 'src/a12.ts',
    });

    const forbiddenPolicy = compilePathPolicy({
      allowed_paths: ['src/**'],
      forbidden_paths: ['src/a?.ts'],
    });

    expect(forbiddenPolicy.evaluateChangedFile({ path: 'src/a1.ts' })).toMatchObject({
      allowed: false,
      path: 'src/a1.ts',
      reason: expect.stringContaining('forbidden'),
    });
    expect(forbiddenPolicy.evaluateChangedFile({ path: 'src/a12.ts' })).toEqual({ allowed: true });
  });

  it('rejects negation, brace expansion, and extglob syntax', () => {
    expectInvalidPolicy('!packages/**');
    expectInvalidPolicy('packages/{executor,domain}/**');
    expectInvalidPolicy('packages/@(executor|domain)/**');
  });
});
