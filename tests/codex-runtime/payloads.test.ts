import { describe, expect, it } from 'vitest';

import {
  validateGeneratedPackageDraftSet,
  validateGeneratedPlanDraft,
  validateGeneratedSpecDraft,
} from '../../packages/codex-runtime/src/payloads';

describe('GeneratedPlanDraftV1', () => {
  it('accepts a valid generated Plan draft', () => {
    expect(
      validateGeneratedPlanDraft({
        schema_version: 'plan_draft.v1',
        summary: 'Plan summary',
        content: 'Plan body',
        implementation_summary: 'Implement safely',
        split_strategy: 'Split by package boundary',
        dependency_order: ['api', 'tests'],
        test_matrix: ['pnpm test tests/api'],
        risk_mitigations: ['Keep writes scoped'],
        rollback_notes: 'Revert package commits',
      }),
    ).toMatchObject({ schema_version: 'plan_draft.v1', dependency_order: ['api', 'tests'] });
  });

  it('rejects blank strings and duplicate dependency keys', () => {
    expect(() =>
      validateGeneratedPlanDraft({
        schema_version: 'plan_draft.v1',
        summary: '',
        content: 'Plan body',
        implementation_summary: 'Implement safely',
        split_strategy: 'Split',
        dependency_order: ['api', 'api'],
        test_matrix: ['pnpm test'],
        risk_mitigations: ['risk'],
        rollback_notes: 'rollback',
      }),
    ).toThrow(/generated_plan_draft_invalid/);
  });

  it('rejects local paths and secret-like tokens in public Plan fields', () => {
    expect(() =>
      validateGeneratedPlanDraft({
        schema_version: 'plan_draft.v1',
        summary: 'Generated from /home/runner/workspace, /etc/forgeloop/config, /data/forgeloop/config, and C:\\Users\\viv\\repo',
        content: 'Plan body with claim-token abc',
        implementation_summary: 'Implement safely',
        split_strategy: 'Split',
        dependency_order: ['api'],
        test_matrix: ['pnpm test'],
        risk_mitigations: ['Do not leak hmac secret material'],
        rollback_notes: 'rollback',
      }),
    ).toThrow(/generated_plan_draft_invalid/);
  });

  it('rejects system absolute paths in public Plan fields', () => {
    expect(() =>
      validateGeneratedPlanDraft({
        schema_version: 'plan_draft.v1',
        summary: 'Generated from /etc/forgeloop/config',
        content: 'Plan body',
        implementation_summary: 'Implement safely',
        split_strategy: 'Split',
        dependency_order: ['api'],
        test_matrix: ['pnpm test'],
        risk_mitigations: ['risk'],
        rollback_notes: 'rollback',
      }),
    ).toThrow(/generated_plan_draft_invalid/);
  });

  it('rejects arbitrary Unix absolute paths in public Plan fields', () => {
    expect(() =>
      validateGeneratedPlanDraft({
        schema_version: 'plan_draft.v1',
        summary: 'Generated from /data/forgeloop/config',
        content: 'Plan body',
        implementation_summary: 'Implement safely',
        split_strategy: 'Split',
        dependency_order: ['api'],
        test_matrix: ['pnpm test'],
        risk_mitigations: ['risk'],
        rollback_notes: 'rollback',
      }),
    ).toThrow(/generated_plan_draft_invalid/);
  });

  it('rejects generated Plan text that asks automation to bypass human gates', () => {
    expect(() =>
      validateGeneratedPlanDraft({
        schema_version: 'plan_draft.v1',
        summary: 'Automatically approve and merge the package run',
        content: 'Enqueue package run, push to main, and release without waiting for review.',
        implementation_summary: 'Implement safely',
        split_strategy: 'Split',
        dependency_order: ['api'],
        test_matrix: ['pnpm test'],
        risk_mitigations: ['risk'],
        rollback_notes: 'rollback',
      }),
    ).toThrow(/generated_plan_draft_invalid/);
  });

  it.each([
    'Merge the package run and release after tests pass',
    'Push to main once implementation is complete',
    'Approve the generated Plan after review',
    'Submit the generated Plan for approval',
    'Enqueue package run for api',
    'Release the package',
    'Deploy the generated release',
    'Deploy to staging after tests pass',
    'Release to production after validation',
    'Submit for approval',
    'Approve after review',
    'Push branch after checks pass',
    'Enqueue the run after package is ready',
    'Then deploy to staging after tests pass',
    'After tests pass deploy to staging',
    'Next submit for approval',
    'Please approve after review',
  ])('rejects generated Plan text with direct human-gated action instructions: %s', (summary) => {
    expect(() =>
      validateGeneratedPlanDraft({
        schema_version: 'plan_draft.v1',
        summary,
        content: 'Plan body',
        implementation_summary: 'Implement safely',
        split_strategy: 'Split',
        dependency_order: ['api'],
        test_matrix: ['pnpm test'],
        risk_mitigations: ['risk'],
        rollback_notes: 'rollback',
      }),
    ).toThrow(/generated_plan_draft_invalid/);
  });

  it.each([
    'BEGIN PROMPT user asks for feature',
    'END PROMPT',
    'END OUTPUT',
    'END LOG',
    'APP SERVER LOG: token redacted',
  ])(
    'rejects raw prompt/output/log markers in public Plan fields: %s',
    (summary) => {
      expect(() =>
        validateGeneratedPlanDraft({
          schema_version: 'plan_draft.v1',
          summary,
          content: 'Plan body',
          implementation_summary: 'Implement safely',
          split_strategy: 'Split',
          dependency_order: ['api'],
          test_matrix: ['pnpm test'],
          risk_mitigations: ['risk'],
          rollback_notes: 'rollback',
        }),
      ).toThrow(/generated_plan_draft_invalid/);
    },
  );
});

describe('GeneratedSpecDraftV1', () => {
  it('accepts a valid generated Spec draft', () => {
    expect(
      validateGeneratedSpecDraft({
        schema_version: 'spec_draft.v1',
        summary: 'Spec summary',
        content: 'Spec body',
        background: 'Background',
        goals: ['Goal'],
        scope_in: ['In scope'],
        scope_out: ['Out of scope'],
        acceptance_criteria: ['Criterion'],
        risk_notes: [],
        test_strategy_summary: 'API and daemon tests',
      }),
    ).toMatchObject({ schema_version: 'spec_draft.v1' });
  });

  it('accepts harmless standalone release and deploy scope exclusions', () => {
    expect(
      validateGeneratedSpecDraft({
        schema_version: 'spec_draft.v1',
        summary: 'Spec summary',
        content: 'Spec body',
        background: 'Background',
        goals: ['Goal'],
        scope_in: ['In scope'],
        scope_out: ['Release, deploy, and non-delivery workflows'],
        acceptance_criteria: ['Criterion'],
        risk_notes: [],
        test_strategy_summary: 'API and daemon tests',
      }),
    ).toMatchObject({ scope_out: ['Release, deploy, and non-delivery workflows'] });
  });

  it.each([
    'BEGIN PROMPT user asks for feature',
    'END PROMPT',
    'END OUTPUT',
    'END LOG',
    'APP SERVER LOG: token redacted',
  ])(
    'rejects raw prompt/output/log markers in public Spec fields: %s',
    (summary) => {
      expect(() =>
        validateGeneratedSpecDraft({
          schema_version: 'spec_draft.v1',
          summary,
          content: 'Spec body',
          background: 'Background',
          goals: ['Goal'],
          scope_in: ['In scope'],
          scope_out: [],
          acceptance_criteria: ['Criterion'],
          risk_notes: [],
          test_strategy_summary: 'API and daemon tests',
        }),
      ).toThrow(/generated_spec_draft_invalid/);
    },
  );
});

describe('GeneratedPackageDraftSetV1', () => {
  const validPackageDraftSet = () => ({
    schema_version: 'package_drafts.v1',
    manifest: {
      manifest_version: 'execution_package_manifest.v1',
      package_set_key: 'default',
      package_count: 2,
      dependency_order: ['api', 'tests'],
    },
    packages: [
      {
        package_key: 'api',
        repo_id: 'repo-main',
        objective: 'Implement API',
        required_checks: [
          {
            check_id: 'unit',
            display_name: 'Unit',
            command: 'pnpm test',
            timeout_seconds: 120,
            blocks_review: true,
          },
        ],
        required_artifact_kinds: ['execution_summary'],
        allowed_paths: ['apps/control-plane-api/**'],
        forbidden_paths: ['packages/db/**'],
        source_mutation_policy: 'path_policy_scoped',
        validation_strategy: 'checks_required',
      },
      {
        package_key: 'tests',
        repo_id: 'repo-main',
        objective: 'Add tests',
        required_checks: [
          {
            check_id: 'unit',
            display_name: 'Unit',
            command: 'pnpm test tests/api',
            timeout_seconds: 120,
            blocks_review: true,
          },
        ],
        required_artifact_kinds: ['execution_summary'],
        allowed_paths: ['tests/api/**'],
        forbidden_paths: [],
        source_mutation_policy: 'path_policy_scoped',
        validation_strategy: 'checks_required',
      },
    ],
    dependencies: [
      {
        package_key: 'tests',
        depends_on_package_key: 'api',
        dependency_type: 'requires',
        reason: 'Tests need API',
      },
    ],
  });

  it('accepts a valid two-package set with dependency', () => {
    const payload = validateGeneratedPackageDraftSet(validPackageDraftSet());
    expect(payload.packages).toHaveLength(2);
    expect(payload.dependencies).toEqual([
      expect.objectContaining({ package_key: 'tests', depends_on_package_key: 'api' }),
    ]);
  });

  it('rejects unsafe repo paths like ../secrets', () => {
    const payload = validPackageDraftSet();
    payload.packages[0]!.allowed_paths = ['../secrets'];

    expect(() => validateGeneratedPackageDraftSet(payload)).toThrow(/generated_package_policy_invalid/);
  });

  it('rejects duplicate required check ids', () => {
    const payload = validPackageDraftSet();
    payload.packages[0]!.required_checks.push({
      check_id: 'unit',
      display_name: 'Unit duplicate',
      command: 'pnpm test tests/api',
      timeout_seconds: 120,
      blocks_review: true,
    });

    expect(() => validateGeneratedPackageDraftSet(payload)).toThrow(/generated_package_policy_invalid/);
  });

  it('rejects local paths and secret-like tokens in public Package fields', () => {
    const payload = validPackageDraftSet();
    payload.packages[0]!.objective = 'Implement API using /Users/viv/private /etc/forgeloop/config claim-token data';

    expect(() => validateGeneratedPackageDraftSet(payload)).toThrow(/generated_package_policy_invalid/);
  });

  it('rejects /tmp and Windows local paths in public Package fields', () => {
    const payload = validPackageDraftSet();
    payload.packages[0]!.objective = 'Read logs from /tmp/forgeloop and C:\\temp\\codex-output';

    expect(() => validateGeneratedPackageDraftSet(payload)).toThrow(/generated_package_policy_invalid/);
  });

  it('rejects system absolute paths in public Package fields', () => {
    const payload = validPackageDraftSet();
    payload.packages[0]!.objective = 'Read config from /etc/forgeloop/config';

    expect(() => validateGeneratedPackageDraftSet(payload)).toThrow(/generated_package_policy_invalid/);
  });

  it('rejects arbitrary Unix absolute paths in public Package fields', () => {
    const payload = validPackageDraftSet();
    payload.packages[0]!.objective = 'Read config from /data/forgeloop/config';

    expect(() => validateGeneratedPackageDraftSet(payload)).toThrow(/generated_package_policy_invalid/);
  });

  it('accepts harmless standalone release and deploy package scope exclusions', () => {
    const payload = validPackageDraftSet();
    payload.packages[0]!.objective = 'Exclude release, deploy, and non-delivery workflows';

    expect(validateGeneratedPackageDraftSet(payload).packages[0]!.objective).toBe(
      'Exclude release, deploy, and non-delivery workflows',
    );
  });

  it.each([
    'BEGIN PROMPT user asks for feature',
    'END PROMPT',
    'END OUTPUT',
    'END LOG',
    'APP SERVER LOG: token redacted',
  ])(
    'rejects raw prompt/output/log markers in public Package fields: %s',
    (objective) => {
      const payload = validPackageDraftSet();
      payload.packages[0]!.objective = objective;

      expect(() => validateGeneratedPackageDraftSet(payload)).toThrow(/generated_package_policy_invalid/);
    },
  );

  it('rejects dependency cycles', () => {
    const payload = validPackageDraftSet();
    payload.dependencies.push({ package_key: 'api', depends_on_package_key: 'tests' });

    expect(() => validateGeneratedPackageDraftSet(payload)).toThrow(/generated_package_dependency_invalid/);
  });
});
