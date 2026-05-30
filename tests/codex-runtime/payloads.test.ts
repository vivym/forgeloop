import { describe, expect, it } from 'vitest';

import {
  validateBoundaryRoundRuntimeResult,
  validateGeneratedExecutionPlanRevision,
  validateGeneratedPackageDraftSet,
  validateGeneratedPlanDraft,
  validateGeneratedSpecRevision,
  validateGeneratedSpecDraft,
} from '../../packages/codex-runtime/src/payloads';

const validBoundaryRoundResult = () => ({
  schema_version: 'boundary_round_result.v1',
  session_id: 'boundary-session-1',
  round_id: 'round-1',
  questions: [{ text: 'Which repo owns the API change?', required: true, rationale: 'Ownership gates scope.' }],
  proposed_decisions: [{ text: 'Keep execution out of scope.', rationale: 'This round only closes boundary.' }],
  summary_proposal: {
    summary_markdown: 'Boundary is ready for Leader review.',
    confirmed_scope: ['API contract'],
    confirmed_out_of_scope: ['Deployment'],
    accepted_assumptions: ['Repository exists'],
    open_risks: ['Runtime availability'],
    validation_expectations: ['API tests pass'],
  },
  needs_leader_input: true,
  public_summary: 'Boundary round produced one required question.',
  artifacts: [],
});

const validGeneratedSpecRevision = () => ({
  schema_version: 'spec_revision.v1',
  development_plan_item_id: 'item-1',
  boundary_summary_revision_id: 'boundary-summary-rev-1',
  summary: 'Generate runtime spec',
  content_markdown: 'Implement the approved runtime boundary.',
  problem_context: 'The product flow needs a generated Spec revision.',
  scope_in: ['Spec generation'],
  scope_out: ['Execution'],
  acceptance_criteria: ['Draft Spec is created'],
  test_strategy: ['API writer tests'],
  risks: ['Stale boundary'],
  assumptions: ['Leader approved boundary summary'],
  unresolved_questions: [],
  public_summary: 'Generated a draft Spec revision.',
});

const validGeneratedExecutionPlanRevision = () => ({
  schema_version: 'execution_plan_revision.v1',
  development_plan_item_id: 'item-1',
  based_on_spec_revision_id: 'spec-rev-1',
  summary: 'Generate runtime execution plan',
  content_markdown: 'Implement in focused runtime slices.',
  implementation_sequence: ['Add schemas', 'Wire writer tests'],
  validation_strategy: ['pnpm vitest run tests/api/spec-plan-service.test.ts'],
  allowed_paths: ['packages/codex-runtime/src/**'],
  forbidden_paths: ['packages/db/migrations/**'],
  required_checks: [{ check_id: 'unit', command: 'pnpm test', timeout_seconds: 120, blocks_review: true }],
  rollback_notes: 'Revert generated runtime slices.',
  handoff_criteria: ['Tests pass'],
  public_summary: 'Generated a draft Implementation Plan Doc revision.',
});

describe('Superpowers generation result payloads', () => {
  it('accepts Boundary round, Spec revision, and Implementation Plan Doc revision payloads', () => {
    expect(validateBoundaryRoundRuntimeResult(validBoundaryRoundResult())).toMatchObject({
      schema_version: 'boundary_round_result.v1',
      needs_leader_input: true,
    });
    expect(validateGeneratedSpecRevision(validGeneratedSpecRevision())).toMatchObject({
      schema_version: 'spec_revision.v1',
      development_plan_item_id: 'item-1',
    });
    expect(validateGeneratedExecutionPlanRevision(validGeneratedExecutionPlanRevision())).toMatchObject({
      schema_version: 'execution_plan_revision.v1',
      based_on_spec_revision_id: 'spec-rev-1',
    });
  });

  it('allows ordinary product endpoint wording while still rejecting raw runtime endpoints', () => {
    expect(
      validateGeneratedSpecRevision({
        ...validGeneratedSpecRevision(),
        content_markdown: 'Document the API endpoint contract for product callers. Endpoint: /api/items.',
      }),
    ).toMatchObject({ schema_version: 'spec_revision.v1' });
  });

  it('allows UUID product ids and plan commands or paths that contain release/deploy wording', () => {
    expect(
      validateGeneratedSpecRevision({
        ...validGeneratedSpecRevision(),
        development_plan_item_id: '550e8400-e29b-41d4-a716-446655440000',
        boundary_summary_revision_id: '550e8400-e29b-41d4-a716-446655440001',
      }),
    ).toMatchObject({ development_plan_item_id: '550e8400-e29b-41d4-a716-446655440000' });
    expect(
      validateGeneratedExecutionPlanRevision({
        ...validGeneratedExecutionPlanRevision(),
        development_plan_item_id: '550e8400-e29b-41d4-a716-446655440000',
        based_on_spec_revision_id: '550e8400-e29b-41d4-a716-446655440002',
        allowed_paths: ['apps/deploy/**'],
        required_checks: [{ check_id: 'release-check', command: 'pnpm run release:check', timeout_seconds: 120, blocks_review: true }],
      }),
    ).toMatchObject({ based_on_spec_revision_id: '550e8400-e29b-41d4-a716-446655440002' });
  });

  it.each([
    [
      'boundary raw endpoint',
      () => validateBoundaryRoundRuntimeResult({ ...validBoundaryRoundResult(), public_summary: 'endpoint unix:/tmp/codex.sock' }),
    ],
    [
      'boundary auth filename',
      () => validateBoundaryRoundRuntimeResult({ ...validBoundaryRoundResult(), public_summary: 'auth.json content leaked' }),
    ],
    [
      'boundary raw container id',
      () => validateBoundaryRoundRuntimeResult({ ...validBoundaryRoundResult(), public_summary: 'container abcdef123456' }),
    ],
    ['spec raw auth marker', () => validateGeneratedSpecRevision({ ...validGeneratedSpecRevision(), content_markdown: 'auth_json leaked' })],
    [
      'spec config filename',
      () => validateGeneratedSpecRevision({ ...validGeneratedSpecRevision(), content_markdown: 'config.toml content leaked' }),
    ],
    [
      'spec bare local endpoint',
      () =>
        validateGeneratedSpecRevision({
          ...validGeneratedSpecRevision(),
          content_markdown: 'Local endpoint localhost:3000/internal handled the job.',
        }),
    ],
    [
      'spec provider endpoint',
      () =>
        validateGeneratedSpecRevision({
          ...validGeneratedSpecRevision(),
          content_markdown: 'Provider endpoint api.openai.com failed before draft publication.',
        }),
    ],
    [
      'spec raw container id',
      () => validateGeneratedSpecRevision({ ...validGeneratedSpecRevision(), content_markdown: 'container abcdef123456' }),
    ],
    [
      'execution-plan raw logs',
      () =>
        validateGeneratedExecutionPlanRevision({
          ...validGeneratedExecutionPlanRevision(),
          content_markdown: 'container_id abc123 and APP SERVER LOG',
        }),
    ],
    [
      'execution-plan hyphenated app-server log',
      () =>
        validateGeneratedExecutionPlanRevision({
          ...validGeneratedExecutionPlanRevision(),
          content_markdown: 'app-server logs leaked',
        }),
    ],
    [
      'execution-plan underscored app server log',
      () =>
        validateGeneratedExecutionPlanRevision({
          ...validGeneratedExecutionPlanRevision(),
          content_markdown: 'app_server_log raw',
        }),
    ],
    [
      'execution-plan auth command',
      () =>
        validateGeneratedExecutionPlanRevision({
          ...validGeneratedExecutionPlanRevision(),
          required_checks: [{ check_id: 'leak', command: 'cat auth.json', timeout_seconds: 30, blocks_review: true }],
        }),
    ],
    [
      'execution-plan local endpoint allowed path',
      () =>
        validateGeneratedExecutionPlanRevision({
          ...validGeneratedExecutionPlanRevision(),
          allowed_paths: ['localhost:3000/internal'],
        }),
    ],
    [
      'execution-plan backslash allowed path',
      () =>
        validateGeneratedExecutionPlanRevision({
          ...validGeneratedExecutionPlanRevision(),
          allowed_paths: ['src\\index.ts'],
        }),
    ],
    [
      'execution-plan provider host allowed path',
      () =>
        validateGeneratedExecutionPlanRevision({
          ...validGeneratedExecutionPlanRevision(),
          allowed_paths: ['api.openai.com'],
        }),
    ],
    [
      'execution-plan raw container id',
      () =>
        validateGeneratedExecutionPlanRevision({
          ...validGeneratedExecutionPlanRevision(),
          rollback_notes: 'container abcdef123456',
        }),
    ],
  ])('rejects unsafe public runtime fields for %s payloads', (_name, validate) => {
    expect(validate).toThrow(/generated_|boundary_round/);
  });
});

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

  it('rejects home-relative paths in public Plan fields', () => {
    expect(() =>
      validateGeneratedPlanDraft({
        schema_version: 'plan_draft.v1',
        summary: 'Generated from ~/.codex/session.json',
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

  it('accepts API routes in public Plan fields', () => {
    expect(
      validateGeneratedPlanDraft({
        schema_version: 'plan_draft.v1',
        summary: 'Plan API route handling',
        content: 'Validate GET /api/work-items and POST /api/work-items/:id.',
        implementation_summary: 'Implement safely',
        split_strategy: 'Split',
        dependency_order: ['api'],
        test_matrix: ['pnpm test'],
        risk_mitigations: ['risk'],
        rollback_notes: 'rollback',
      }),
    ).toMatchObject({ content: 'Validate GET /api/work-items and POST /api/work-items/:id.' });
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
    'If tests pass deploy to staging',
    'Finally merge to main after checks pass',
    'No release work is included. Finally merge to main after checks pass',
    'No release work is included; finally merge to main after checks pass',
    'This plan has no blockers, deploy to staging after tests pass',
    'Exclude release work; submit for approval',
    'Deploy to staging after tests pass and no release work is included',
    'Deploy to staging after tests pass while release work is out of scope',
    'Deploy to staging after tests pass with release work excluded',
    'Do not automatically deploy and deploy to staging after tests pass',
    'No deploy work is included and deploy to staging after tests pass',
    'Exclude deploy work and deploy to staging after tests pass',
    'Exclude docs and deploy to staging after tests pass',
    'Exclude release work and submit for approval',
    'Perform a staging deployment after tests pass',
    'Run the staging deployment after tests pass',
    'Deploying to staging after tests pass is required',
    'Deployment to staging after tests pass is required',
    'Releasing to production after validation is required',
    'Request approval after checks pass',
    'Send for approval after checks pass',
    'No deploy work is included and perform a staging deployment after tests pass',
    'Deployments to staging after tests pass are required',
    'Releases to production after validation are required',
    'Merges to main after checks pass are required',
    'Pushes to main after checks pass are required',
    'Promote to production after validation',
    'Promotion to production after validation is required',
    'Merging to main after checks pass is required',
    'Pushing to main after checks pass is required',
    'Merged to main after checks pass is required',
    'Pushed to main after checks pass is required',
    'Approving after review is required',
    'Enqueuing package run after checks pass is required',
    'Submitting the generated plan after checks pass is required',
    'Released to production after validation is required',
    'Deployed to staging after tests pass is required',
    'Promoted to production after validation is required',
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
    'No release or deploy work is included',
    'Do not deploy automatically',
    'Do not automatically deploy',
    'Release work is out of scope',
    'Release work is excluded',
    'Deploy work is out of scope',
    'Release/deploy work is out of scope',
  ])('accepts negated or out-of-scope Plan text that mentions gated actions: %s', (summary) => {
    expect(
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
    ).toMatchObject({ summary });
  });

  it('accepts benign HMAC algorithm mentions in public Plan fields', () => {
    expect(
      validateGeneratedPlanDraft({
        schema_version: 'plan_draft.v1',
        summary: 'Use HMAC validation for internal command signatures',
        content: 'Plan body',
        implementation_summary: 'Implement safely',
        split_strategy: 'Split',
        dependency_order: ['api'],
        test_matrix: ['pnpm test'],
        risk_mitigations: ['risk'],
        rollback_notes: 'rollback',
      }),
    ).toMatchObject({ summary: 'Use HMAC validation for internal command signatures' });
  });

  it.each([
    'BEGIN PROMPT user asks for feature',
    'BEGIN',
    'END PROMPT',
    'END OUTPUT',
    'END LOG',
    'END',
    'APP SERVER LOG: token redacted',
    'APP SERVER LOG',
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

  it('rejects unsafe public Plan structured document keys', () => {
    expect(() =>
      validateGeneratedPlanDraft({
        schema_version: 'plan_draft.v1',
        summary: 'Plan summary',
        content: 'Plan body',
        implementation_summary: 'Implement safely',
        split_strategy: 'Split',
        dependency_order: ['api'],
        test_matrix: ['pnpm test'],
        risk_mitigations: ['risk'],
        rollback_notes: 'rollback',
        structured_document: {
          '/Users/viv/private/raw-output.log': 'redacted',
        },
      }),
    ).toThrow(/generated_plan_draft_invalid/);
  });

  it('rejects gated Plan instructions in public structured document keys', () => {
    expect(() =>
      validateGeneratedPlanDraft({
        schema_version: 'plan_draft.v1',
        summary: 'Plan summary',
        content: 'Plan body',
        implementation_summary: 'Implement safely',
        split_strategy: 'Split',
        dependency_order: ['api'],
        test_matrix: ['pnpm test'],
        risk_mitigations: ['risk'],
        rollback_notes: 'rollback',
        structured_document: {
          'Finally merge to main after checks pass': 'redacted',
        },
      }),
    ).toThrow(/generated_plan_draft_invalid/);
  });
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
    'Deployed to staging without waiting for review',
    'Promote to production without review',
    'Promoted to production without review',
    'Released without approval',
    'Approving without review',
  ])('rejects inflected human-gate bypass wording in public Spec fields: %s', (summary) => {
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
  });

  it('accepts API routes in public Spec fields', () => {
    expect(
      validateGeneratedSpecDraft({
        schema_version: 'spec_draft.v1',
        summary: 'Spec summary',
        content: 'Expose GET /api/work-items for reads.',
        background: 'Background',
        goals: ['Goal'],
        scope_in: ['In scope'],
        scope_out: ['Out of scope'],
        acceptance_criteria: ['Criterion'],
        risk_notes: [],
        test_strategy_summary: 'API and daemon tests',
      }),
    ).toMatchObject({ content: 'Expose GET /api/work-items for reads.' });
  });

  it.each([
    'BEGIN PROMPT user asks for feature',
    'BEGIN',
    'END PROMPT',
    'END OUTPUT',
    'END LOG',
    'END',
    'APP SERVER LOG: token redacted',
    'APP SERVER LOG',
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

  it('rejects unsafe public Spec structured document keys', () => {
    expect(() =>
      validateGeneratedSpecDraft({
        schema_version: 'spec_draft.v1',
        summary: 'Spec summary',
        content: 'Spec body',
        background: 'Background',
        goals: ['Goal'],
        scope_in: ['In scope'],
        scope_out: [],
        acceptance_criteria: ['Criterion'],
        risk_notes: [],
        test_strategy_summary: 'API and daemon tests',
        structured_document: {
          'claim-token': 'redacted',
        },
      }),
    ).toThrow(/generated_spec_draft_invalid/);
  });
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
    'Deployed to staging without waiting for review',
    'Promote to production without review',
    'Promoted to production without review',
    'Released without approval',
    'Approving without review',
  ])('rejects inflected human-gate bypass wording in public Package fields: %s', (objective) => {
    const payload = validPackageDraftSet();
    payload.packages[0]!.objective = objective;

    expect(() => validateGeneratedPackageDraftSet(payload)).toThrow(/generated_package_policy_invalid/);
  });

  it.each([
    'BEGIN PROMPT user asks for feature',
    'BEGIN',
    'END PROMPT',
    'END OUTPUT',
    'END LOG',
    'END',
    'APP SERVER LOG: token redacted',
    'APP SERVER LOG',
  ])(
    'rejects raw prompt/output/log markers in public Package fields: %s',
    (objective) => {
      const payload = validPackageDraftSet();
      payload.packages[0]!.objective = objective;

      expect(() => validateGeneratedPackageDraftSet(payload)).toThrow(/generated_package_policy_invalid/);
    },
  );

  it('rejects unsafe public Package metadata keys', () => {
    const payload = validPackageDraftSet();
    payload.dependencies[0]!.metadata = {
      '/Users/viv/private/raw-output.log': 'redacted',
    };

    expect(() => validateGeneratedPackageDraftSet(payload)).toThrow(/generated_package_policy_invalid/);
  });

  it('rejects dependency cycles', () => {
    const payload = validPackageDraftSet();
    payload.dependencies.push({ package_key: 'api', depends_on_package_key: 'tests' });

    expect(() => validateGeneratedPackageDraftSet(payload)).toThrow(/generated_package_dependency_invalid/);
  });
});
