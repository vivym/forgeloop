import { describe, expect, it } from 'vitest';

import {
  DomainError,
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  codexLaunchTokenEnvelopeDigest,
  collectCodexRuntimeJobTerminalArtifactRefs,
  codexNetworkPolicyDigestInput,
  codexPublicBlockerCodes,
  codexRuntimeJobInputDigest,
  codexRuntimeJobIsActive,
  codexRuntimeNetworkPolicyDigest,
  codexRuntimeProfileRevisionDigest,
  codexRuntimeScopeMatches,
  codexWorkerScopeMatchesTarget,
  codexWorkspaceAcquisitionDigest,
  assertCodexRuntimePublicSafeValue,
  redactCodexLaunchMaterialization,
  validateCodexRuntimeJobTerminalResult,
  validateCodexRuntimeJobArtifactIntake,
  validateCodexDockerNetworkProxyConfig,
  validateCodexDockerRuntimeEvidence,
  validateCodexEffectiveConfigAssertions,
  validateCodexRuntimeProfileRevision,
  type CodexDockerRuntimeEvidence,
  type CodexGenerationRuntimeJobResult,
  type CodexGenerationWorkloadV1,
  type CodexDockerNetworkProxyConfig,
  type CodexCredentialBinding,
  type CodexCredentialBindingPublic,
  type CodexCredentialBindingVersion,
  type CodexLaunchLease,
  type CodexLaunchLeaseWithToken,
  type CodexLaunchMaterialization,
  type CodexLaunchTarget,
  type CodexLaunchTokenEnvelope,
  type CodexNetworkAllowlistRule,
  type CodexRunExecutionRuntimeJobResult,
  type CodexRunExecutionWorkloadV1,
  type CodexRuntimeJob,
  type CodexRuntimeJobStatus,
  type CodexRuntimeProfile,
  type CodexRuntimeProfileRevision,
  type CodexRuntimeStatusProjection,
  type CodexWorkerBootstrapToken,
  type CodexWorkerRegistration,
  type WorkspaceBundleV1,
  type ResolvedCodexCredential,
} from '@forgeloop/domain';

type ExportedCodexRuntimeContracts = {
  profile: CodexRuntimeProfile;
  profileRevision: CodexRuntimeProfileRevision;
  credentialBinding: CodexCredentialBinding;
  credentialBindingVersion: CodexCredentialBindingVersion;
  credentialBindingPublic: CodexCredentialBindingPublic;
  resolvedCredential: ResolvedCodexCredential;
  bootstrapToken: CodexWorkerBootstrapToken;
  workerRegistration: CodexWorkerRegistration;
  launchTarget: CodexLaunchTarget;
  launchLease: CodexLaunchLease;
  launchLeaseWithToken: CodexLaunchLeaseWithToken;
  launchMaterialization: CodexLaunchMaterialization;
  statusProjection: CodexRuntimeStatusProjection;
  runtimeJob: CodexRuntimeJob;
  runtimeJobStatus: CodexRuntimeJobStatus;
  launchTokenEnvelope: CodexLaunchTokenEnvelope;
  generationWorkload: CodexGenerationWorkloadV1;
  generationResult: CodexGenerationRuntimeJobResult;
  workspaceBundle: WorkspaceBundleV1;
  runExecutionWorkload: CodexRunExecutionWorkloadV1;
  runExecutionResult: CodexRunExecutionRuntimeJobResult;
};

const assertCodexRuntimeTypeExports = <T extends ExportedCodexRuntimeContracts>() => undefined;

const digestA = `sha256:${'a'.repeat(64)}`;
const digestB = `sha256:${'b'.repeat(64)}`;
const digestC = `sha256:${'c'.repeat(64)}`;

const runtimeEvidence = (overrides: Partial<CodexDockerRuntimeEvidence> = {}): CodexDockerRuntimeEvidence => ({
  runtime_profile_id: 'profile-1',
  runtime_profile_revision_id: 'profile-revision-1',
  runtime_profile_digest: digestA,
  runtime_target_kind: 'run_execution',
  source_access_mode: 'path_policy_scoped',
  environment: 'test',
  launch_lease_id: 'lease-1',
  worker_id: 'worker-1',
  docker_image_digest: digestB,
  container_id_digest: digestC,
  app_server_effective_config_digest: digestA,
  docker_policy_self_check_digest: digestB,
  app_server_attempted: true,
  selected_execution_mode: 'app_server',
  ...overrides,
});

class NonJsonFixture {
  constructor(readonly value: string) {}
}

const boundaryRoundRuntimeResultPayload = () => ({
  schema_version: 'boundary_round_result.v1',
  session_id: 'boundary-session-1',
  round_id: 'round-1',
  questions: [{ text: 'Confirm API scope?', required: true, rationale: 'Scope gates the Spec.' }],
  proposed_decisions: [{ text: 'Keep deployment out of scope.', rationale: 'Boundary only.' }],
  summary_proposal: {
    summary_markdown: 'Boundary is ready for Leader review.',
    confirmed_scope: ['Runtime generation'],
    confirmed_out_of_scope: ['Deployment'],
    accepted_assumptions: ['Leader review remains required'],
    open_risks: ['Runtime unavailable'],
    validation_expectations: ['Payload validation passes'],
  },
  needs_leader_input: true,
  public_summary: 'Generated a boundary round.',
  artifacts: [],
});

const generatedSpecRevisionPayload = () => ({
  schema_version: 'spec_revision.v1',
  development_plan_item_id: 'item-1',
  boundary_summary_revision_id: 'boundary-summary-rev-1',
  summary: 'Generated Spec revision',
  content_markdown: 'Implement the approved boundary.',
  problem_context: 'The Development Plan Item needs a Spec revision.',
  scope_in: ['Spec generation'],
  scope_out: ['Execution'],
  acceptance_criteria: ['Draft Spec revision is created'],
  test_strategy: ['API writer tests'],
  risks: ['Stale boundary'],
  assumptions: ['Leader approved boundary summary'],
  unresolved_questions: [],
  public_summary: 'Generated a Spec revision.',
});

const generatedExecutionPlanRevisionPayload = () => ({
  schema_version: 'execution_plan_revision.v1',
  development_plan_item_id: 'item-1',
  based_on_spec_revision_id: 'spec-rev-1',
  summary: 'Generated Implementation Plan Doc revision',
  content_markdown: 'Implement the approved Spec in focused slices.',
  implementation_sequence: ['Add schemas', 'Wire worker dispatch'],
  validation_strategy: ['Run targeted runtime tests'],
  allowed_paths: ['packages/codex-runtime/src/**'],
  forbidden_paths: ['packages/db/migrations/**'],
  required_checks: [
    {
      check_id: 'unit',
      command: 'pnpm vitest run tests/codex-runtime/payloads.test.ts',
      timeout_seconds: 120,
      blocks_review: true,
    },
  ],
  rollback_notes: 'Revert generated runtime changes.',
  handoff_criteria: ['Targeted tests pass'],
  public_summary: 'Generated an Implementation Plan Doc revision.',
});

const generationTerminalResult = (taskKind: string, generatedPayload: Record<string, unknown>) => ({
  task_kind: taskKind,
  prompt_version: 'generation-prompt-v1',
  output_schema_version: 'generation-output.v1',
  generated_payload: generatedPayload,
  generated_payload_digest: codexCanonicalDigest(generatedPayload),
  generation_artifacts: [],
  public_summary: 'Generated public-safe product draft.',
});

const expectDomainErrorCode = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    expect(codexPublicBlockerCodes).toContain(code);
    return;
  }

  throw new Error(`Expected DomainError ${code}`);
};

const modelProviderRule = {
  id: 'model-provider',
  protocol: 'https',
  host: 'api.openai.com',
  path_prefix: '/v1',
  purpose: 'model_provider',
} as const;

const hostFirewallPolicy = (rules: readonly CodexNetworkAllowlistRule[] = [modelProviderRule]) => ({
  mode: 'egress_allowlist' as const,
  provider: 'host_firewall' as const,
  allowlist_rules: rules,
  egress_allowlist_digest: codexCanonicalDigest(codexNetworkPolicyDigestInput('host_firewall', rules)),
  self_test_digest: codexCanonicalDigest({
    ...codexNetworkPolicyDigestInput('host_firewall', rules),
    self_test: 'host_firewall',
  }),
});

const baseRevision = (overrides: Partial<CodexRuntimeProfileRevision> = {}): CodexRuntimeProfileRevision => {
  const revision = {
    id: 'revision-1',
    profile_id: 'profile-1',
    revision_number: 1,
    status: 'active',
    environment: 'local_dogfood',
    docker_image: 'ghcr.io/forgeloop/codex-worker:2026-05-20',
    docker_image_digest: digestA,
    target_kind: 'generation',
    source_access_mode: 'artifact_only',
    codex_config_toml: 'approval_policy = "never"\nsandbox_mode = "read-only"\n',
    codex_config_digest: digestB,
    expected_effective_config_digest: digestC,
    effective_config_assertions: {
      target_kind: 'generation',
      approval_policy: 'never',
      source_write_policy: 'artifact_only',
      forbidden_writable_roots: ['workspace'],
    },
    app_server_required: true,
    allowed_driver_kind: 'app_server',
    network_policy: hostFirewallPolicy(),
    resource_limits: {
      cpu_ms: 120_000,
      memory_mb: 1024,
      pids: 64,
      fds: 256,
      workspace_bytes: 268_435_456,
      artifact_bytes: 134_217_728,
      timeout_ms: 120_000,
      output_limit_bytes: 1_000_000,
      run_output_limit_bytes: 5_000_000,
    },
    docker_policy: {
      network_disabled: false,
      app_server_only: true,
      rootless: true,
      read_only_rootfs: true,
      no_new_privileges: true,
      drop_capabilities: ['ALL'],
    },
    allowed_scopes: [{ project_id: 'project-1' }, { project_id: 'project-2', repo_id: 'repo-2' }],
    profile_digest: digestA,
    created_by_actor_id: 'actor-1',
    created_at: '2026-05-20T00:00:00.000Z',
    ...overrides,
  } satisfies CodexRuntimeProfileRevision;

  const withConfigDigest =
    overrides.codex_config_digest === undefined
      ? { ...revision, codex_config_digest: codexCanonicalDigest(revision.codex_config_toml) }
      : revision;

  return overrides.profile_digest === undefined
    ? { ...withConfigDigest, profile_digest: codexRuntimeProfileRevisionDigest(withConfigDigest) }
    : withConfigDigest;
};

const validDockerProxyConfig = (): CodexDockerNetworkProxyConfig => {
  const config = {
    proxy_image: 'ghcr.io/forgeloop/codex-network-proxy:2026-05-20',
    proxy_image_digest: digestA,
    self_test_image: 'ghcr.io/forgeloop/codex-network-self-test:2026-05-20',
    self_test_image_digest: digestB,
    provider_config_digest: digestC,
  };

  return {
    ...config,
    provider_config_digest: codexCanonicalDigest({
      proxy_image: config.proxy_image,
      proxy_image_digest: config.proxy_image_digest,
      self_test_image: config.self_test_image,
      self_test_image_digest: config.self_test_image_digest,
    }),
  };
};

describe('codex runtime domain contracts', () => {
  it('exports object model contracts for downstream packages', () => {
    expect(assertCodexRuntimeTypeExports()).toBeUndefined();
  });

  it('allows runtime job public blocker codes', () => {
    expect(codexPublicBlockerCodes).toEqual(
      expect.arrayContaining([
        'codex_runtime_job_unavailable',
        'codex_generation_workload_unsupported',
        'codex_runtime_job_expired',
        'codex_runtime_job_cancelled',
        'codex_workspace_bundle_invalid',
        'codex_runtime_job_stale',
        'codex_runtime_job_lease_terminal',
      ]),
    );
  });

  it('keeps generic public safety strict for public route-looking local paths', () => {
    expectDomainErrorCode(
      () => assertCodexRuntimePublicSafeValue({ public_summary: 'Endpoint: /api/items' }, 'generic public value'),
      'codex_docker_runtime_evidence_unsafe',
    );
  });

  it('creates stable runtime job and envelope digests', () => {
    const workloadInput = {
      schema_version: 'codex_generation_workload_ref.v1',
      runtime_job_id: 'runtime-job-1',
      task_kind: 'spec_draft',
      workload_ref: 'artifact://codex-runtime-jobs/runtime-job-1/workload',
      signed_context_digest: digestA,
      prompt_template_digest: digestB,
    };
    const sameInputWithDifferentOrder = {
      prompt_template_digest: digestB,
      signed_context_digest: digestA,
      workload_ref: 'artifact://codex-runtime-jobs/runtime-job-1/workload',
      task_kind: 'spec_draft',
      runtime_job_id: 'runtime-job-1',
      schema_version: 'codex_generation_workload_ref.v1',
    };
    const workspaceAcquisition = {
      bundle_id: 'bundle-1',
      archive_ref: 'artifact://codex-runtime-jobs/runtime-job-1/workspace-bundle',
      archive_digest: digestA,
      manifest_digest: digestB,
      expires_at: '2026-05-20T00:10:00.000Z',
      size_limit_bytes: 1_000_000,
    };
    const envelopeInput = {
      id: 'envelope-1',
      runtime_job_id: 'runtime-job-1',
      launch_lease_id: 'lease-1',
      worker_id: 'worker-1',
      key_id: 'worker-key-1',
      algorithm: 'x25519-hkdf-sha256-aes-256-gcm',
      ciphertext: 'sealed-token',
      encryption_nonce: 'nonce-1',
      aad_json: {
        runtime_job_id: 'runtime-job-1',
        launch_lease_id: 'lease-1',
      },
      aad_digest: digestA,
      envelope_digest: digestB,
      status: 'available',
      claim_request_id: 'claim-request-1',
      claim_request_digest: digestC,
      claimed_worker_session_digest: digestB,
      claimed_key_id: 'claimed-key-1',
      claimed_at: '2026-05-20T00:01:00.000Z',
      expires_at: '2026-05-20T00:10:00.000Z',
      created_at: '2026-05-20T00:00:00.000Z',
    } satisfies CodexLaunchTokenEnvelope;
    const expectedEnvelopeDigest = codexCanonicalDigest({
      id: envelopeInput.id,
      runtime_job_id: envelopeInput.runtime_job_id,
      launch_lease_id: envelopeInput.launch_lease_id,
      worker_id: envelopeInput.worker_id,
      key_id: envelopeInput.key_id,
      algorithm: envelopeInput.algorithm,
      ciphertext: envelopeInput.ciphertext,
      encryption_nonce: envelopeInput.encryption_nonce,
      aad_json: envelopeInput.aad_json,
      aad_digest: envelopeInput.aad_digest,
      expires_at: envelopeInput.expires_at,
    });

    expect(codexRuntimeJobInputDigest(workloadInput)).toBe(codexRuntimeJobInputDigest(sameInputWithDifferentOrder));
    expect(codexWorkspaceAcquisitionDigest(workspaceAcquisition)).toBe(codexCanonicalDigest(workspaceAcquisition));
    expect(codexWorkspaceAcquisitionDigest(undefined)).toBeUndefined();
    expect(codexLaunchTokenEnvelopeDigest(envelopeInput)).toBe(expectedEnvelopeDigest);
    expect(
      codexLaunchTokenEnvelopeDigest({
        ...envelopeInput,
        envelope_digest: digestA,
        status: 'claimed',
        claim_request_id: 'claim-request-2',
        claim_request_digest: digestA,
        claimed_worker_session_digest: digestC,
        claimed_key_id: 'claimed-key-2',
        claimed_at: '2026-05-20T00:02:00.000Z',
        created_at: '2026-05-20T00:03:00.000Z',
      }),
    ).toBe(expectedEnvelopeDigest);
    expect(codexLaunchTokenEnvelopeDigest({ ...envelopeInput, ciphertext: 'different-sealed-token' })).not.toBe(expectedEnvelopeDigest);
    expect(codexLaunchTokenEnvelopeDigest({ ...envelopeInput, aad_digest: digestC })).not.toBe(expectedEnvelopeDigest);
  });

  it('identifies active runtime jobs before terminal status', () => {
    const baseJob = {
      id: 'runtime-job-1',
      job_request_id: 'job-request-1',
      target_type: 'automation_action_run',
      target_id: 'action-run-1',
      target_kind: 'generation',
      project_id: 'project-1',
      worker_id: 'worker-1',
      launch_lease_id: 'lease-1',
      launch_attempt: 1,
      input_digest: digestA,
      input_json: {},
      expires_at: '2026-05-20T00:10:00.000Z',
      created_at: '2026-05-20T00:00:00.000Z',
      updated_at: '2026-05-20T00:00:00.000Z',
    } satisfies Omit<CodexRuntimeJob, 'status'>;

    expect(codexRuntimeJobIsActive({ ...baseJob, status: 'queued' })).toBe(true);
    expect(codexRuntimeJobIsActive({ ...baseJob, status: 'running' })).toBe(true);
    expect(codexRuntimeJobIsActive({ ...baseJob, status: 'terminal' })).toBe(false);
  });

  it('validates public-safe terminal runtime job results', () => {
    const generatedPayload = {
      title: 'Public spec title',
      artifact_ref: 'artifact://codex-runtime-jobs/runtime-job-1/generated-payload',
    };
    const generationResult = {
      task_kind: 'spec_draft',
      prompt_version: 'generation-prompt-v1',
      output_schema_version: 'spec-draft-output.v1',
      generated_payload: generatedPayload,
      generated_payload_digest: codexCanonicalDigest(generatedPayload),
      generation_artifacts: [
        {
          kind: 'generated_payload',
          name: 'generated payload',
          content_type: 'application/json',
          digest: digestA,
          internal_ref: 'artifact://codex-runtime-jobs/runtime-job-1/artifacts/artifact-1',
        },
      ],
      public_summary: 'Generated a spec draft.',
    };

    expect(validateCodexRuntimeJobTerminalResult(generationResult)).toEqual(generationResult);

    const deterministicArtifactRefResult = {
      ...generationResult,
      generation_artifacts: [
        {
          kind: 'generated_payload',
          name: 'generated payload',
          content_type: 'application/json',
          digest: digestA,
          internal_ref:
            'artifact://codex-runtime-jobs/dfb5b095-3534-4297-934a-b066af8441ec/artifacts/d8def3cb-2878-4349-be42-74c912d8ee78',
        },
      ],
    };
    expect(validateCodexRuntimeJobTerminalResult(deterministicArtifactRefResult)).toEqual(deterministicArtifactRefResult);

    expectDomainErrorCode(
      () =>
        validateCodexRuntimeJobTerminalResult({
          ...generationResult,
          raw_prompt: 'write the private implementation details',
        }),
      'codex_docker_runtime_evidence_unsafe',
    );
    expectDomainErrorCode(
      () =>
        validateCodexRuntimeJobTerminalResult({
          ...generationResult,
          generated_payload: {
            title: 'Public spec title',
            description: 'api_key=sk-test',
          },
        }),
      'codex_docker_runtime_evidence_unsafe',
    );
    expectDomainErrorCode(
      () =>
        validateCodexRuntimeJobTerminalResult({
          ...generationResult,
          generated_payload: {
            title: 'Public spec title',
            artifact_ref: 'artifact://http://127.0.0.1:4555/raw',
          },
        }),
      'codex_docker_runtime_evidence_unsafe',
    );
    expectDomainErrorCode(
      () =>
        validateCodexRuntimeJobTerminalResult({
          ...generationResult,
          next_step_links: [
            {
              label: 'Open generated draft',
              href: 'forgeloop://automation/action-runs/action-run-1',
            },
          ],
        }),
      'codex_docker_runtime_evidence_unsafe',
    );
    expectDomainErrorCode(
      () =>
        validateCodexRuntimeJobTerminalResult({
          ...generationResult,
          generation_artifacts: [
            {
              kind: 'log',
              name: 'app-server.log',
              content_type: 'text/plain',
              internal_ref: 'http://127.0.0.1:3845/internal/logs/raw',
            },
          ],
        }),
      'codex_docker_runtime_evidence_unsafe',
    );
  });

  it.each([
    ['boundary_brainstorming_round', boundaryRoundRuntimeResultPayload],
    ['development_plan_item_spec_revision', generatedSpecRevisionPayload],
    ['development_plan_item_execution_plan_revision', generatedExecutionPlanRevisionPayload],
  ])('validates structured terminal generation results for %s', (taskKind, payloadFactory) => {
    const result = generationTerminalResult(taskKind, payloadFactory());

    expect(validateCodexRuntimeJobTerminalResult(result)).toEqual(result);
  });

  it('allows generation artifact refs in structured terminal results without treating them as raw endpoints', () => {
    const result = {
      ...generationTerminalResult('boundary_brainstorming_round', boundaryRoundRuntimeResultPayload()),
      generation_artifacts: [
        {
          kind: 'generated_payload',
          name: 'generated-payload.json',
          content_type: 'application/json',
          digest: digestA,
          internal_ref: 'artifact://codex-runtime-jobs/runtime-job-1/artifacts/generated_payload',
        },
      ],
    };

    expect(validateCodexRuntimeJobTerminalResult(result)).toEqual(result);
    expect(collectCodexRuntimeJobTerminalArtifactRefs(result)).toEqual([
      {
        internal_ref: 'artifact://codex-runtime-jobs/runtime-job-1/artifacts/generated_payload',
        digest: digestA,
        content_type: 'application/json',
      },
    ]);
  });

  it('allows UUID product ids in structured terminal generation payloads', () => {
    const payload = {
      ...generatedSpecRevisionPayload(),
      development_plan_item_id: '550e8400-e29b-41d4-a716-446655440000',
      boundary_summary_revision_id: '550e8400-e29b-41d4-a716-446655440001',
    };
    const result = generationTerminalResult('development_plan_item_spec_revision', payload);

    expect(validateCodexRuntimeJobTerminalResult(result)).toEqual(result);
  });

  it('allows public API route prose in structured terminal generation payloads', () => {
    for (const contentMarkdown of [
      'Endpoint: /api/items is the public product route for callers.',
      '/api/items is the public product route for callers.',
    ]) {
      const payload = {
        ...generatedSpecRevisionPayload(),
        content_markdown: contentMarkdown,
      };
      const result = generationTerminalResult('development_plan_item_spec_revision', payload);

      expect(validateCodexRuntimeJobTerminalResult(result)).toEqual(result);
    }
  });

  it('rejects inline terminal generated payload digest mismatches', () => {
    expectDomainErrorCode(
      () =>
        validateCodexRuntimeJobTerminalResult({
          ...generationTerminalResult('development_plan_item_spec_revision', generatedSpecRevisionPayload()),
          generated_payload_digest: digestB,
        }),
      'codex_docker_runtime_evidence_unsafe',
    );
  });

  it.each([
    ['boundary_brainstorming_round', boundaryRoundRuntimeResultPayload],
    ['development_plan_item_spec_revision', generatedSpecRevisionPayload],
    ['development_plan_item_execution_plan_revision', generatedExecutionPlanRevisionPayload],
  ])('rejects invalid terminal generated payload structure for %s', (taskKind, payloadFactory) => {
    const wrongSchema = { ...payloadFactory(), schema_version: `${taskKind}.test.v1` };
    expectDomainErrorCode(
      () => validateCodexRuntimeJobTerminalResult(generationTerminalResult(taskKind, wrongSchema)),
      'codex_docker_runtime_evidence_unsafe',
    );

    const missingRequiredField = { ...payloadFactory() };
    delete missingRequiredField.public_summary;
    expectDomainErrorCode(
      () => validateCodexRuntimeJobTerminalResult(generationTerminalResult(taskKind, missingRequiredField)),
      'codex_docker_runtime_evidence_unsafe',
    );
  });

  it('allows oversized product generated payloads to terminalize as artifact refs', () => {
    const oversizedPayload = {
      ...generatedSpecRevisionPayload(),
      content_markdown: 'x'.repeat(70_000),
    };
    const oversizedPayloadDigest = codexCanonicalDigest(oversizedPayload);
    const generatedPayloadRef = {
      schema_version: 'generated_payload_ref.v1',
      artifact: {
        kind: 'generated_payload',
        name: 'generated-payload.json',
        content_type: 'application/json',
        digest: oversizedPayloadDigest,
        internal_ref: 'artifact://codex-runtime-jobs/runtime-job-1/artifacts/generated_payload',
      },
    };
    const result = {
      ...generationTerminalResult('development_plan_item_spec_revision', generatedPayloadRef),
      generated_payload_digest: oversizedPayloadDigest,
      generation_artifacts: [
        {
          kind: 'generated_payload',
          name: 'generated-payload.json',
          content_type: 'application/json',
          digest: oversizedPayloadDigest,
          internal_ref: 'artifact://codex-runtime-jobs/runtime-job-1/artifacts/generated_payload',
        },
      ],
    };

    expect(validateCodexRuntimeJobTerminalResult(result)).toEqual(result);
    expect(collectCodexRuntimeJobTerminalArtifactRefs(result)).toEqual([
      {
        internal_ref: 'artifact://codex-runtime-jobs/runtime-job-1/artifacts/generated_payload',
        digest: oversizedPayloadDigest,
        content_type: 'application/json',
      },
    ]);
  });

  it.each([
    ['wrong kind', { kind: 'generation_validation_report', content_type: 'application/json' }],
    ['wrong content type', { kind: 'generated_payload', content_type: 'text/plain' }],
  ])('rejects invalid generated payload artifact refs for %s', (_name, patch) => {
    const oversizedPayload = {
      ...generatedSpecRevisionPayload(),
      content_markdown: 'x'.repeat(70_000),
    };
    const oversizedPayloadDigest = codexCanonicalDigest(oversizedPayload);
    const generatedPayloadRef = {
      schema_version: 'generated_payload_ref.v1',
      artifact: {
        kind: patch.kind,
        name: 'generated-payload.json',
        content_type: patch.content_type,
        digest: oversizedPayloadDigest,
        internal_ref: 'artifact://codex-runtime-jobs/runtime-job-1/artifacts/generated_payload',
      },
    };

    expectDomainErrorCode(
      () =>
        validateCodexRuntimeJobTerminalResult({
          ...generationTerminalResult('development_plan_item_spec_revision', generatedPayloadRef),
          generated_payload_digest: oversizedPayloadDigest,
        }),
      'codex_docker_runtime_evidence_unsafe',
    );
  });

  it.each([
    [
      'wrong kind',
      {
        artifact: {
          kind: 'generation_validation_report',
          name: 'generated-payload.json',
          content_type: 'application/json',
          digest: digestA,
          internal_ref: 'artifact://codex-runtime-jobs/runtime-job-1/artifacts/generated_payload',
        },
        generated_payload_digest: digestA,
      },
    ],
    [
      'wrong content type',
      {
        artifact: {
          kind: 'generated_payload',
          name: 'generated-payload.json',
          content_type: 'text/plain',
          digest: digestA,
          internal_ref: 'artifact://codex-runtime-jobs/runtime-job-1/artifacts/generated_payload',
        },
        generated_payload_digest: digestA,
      },
    ],
    [
      'digest mismatch',
      {
        artifact: {
          kind: 'generated_payload',
          name: 'generated-payload.json',
          content_type: 'application/json',
          digest: digestB,
          internal_ref: 'artifact://codex-runtime-jobs/runtime-job-1/artifacts/generated_payload',
        },
        generated_payload_digest: digestA,
      },
    ],
    [
      'missing internal ref',
      {
        artifact: {
          kind: 'generated_payload',
          name: 'generated-payload.json',
          content_type: 'application/json',
          digest: digestA,
        },
        generated_payload_digest: digestA,
      },
    ],
  ])('rejects invalid legacy generated payload refs for %s', (_name, input) => {
    expectDomainErrorCode(
      () =>
        validateCodexRuntimeJobTerminalResult({
          task_kind: 'spec_draft',
          prompt_version: 'generation-prompt-v1',
          output_schema_version: 'spec-draft-output.v1',
          generated_payload: {
            schema_version: 'generated_payload_ref.v1',
            artifact: input.artifact,
          },
          generated_payload_digest: input.generated_payload_digest,
          generation_artifacts: [],
          public_summary: 'Generated a spec draft.',
        }),
      'codex_docker_runtime_evidence_unsafe',
    );
  });

  it('requires oversized generated payloads to be represented by artifact refs', () => {
    const oversizedPayload = {
      title: 'Public spec title',
      body: 'x'.repeat(70_000),
    };

    expectDomainErrorCode(
      () =>
        validateCodexRuntimeJobTerminalResult({
          task_kind: 'spec_draft',
          prompt_version: 'generation-prompt-v1',
          output_schema_version: 'spec-draft-output.v1',
          generated_payload: oversizedPayload,
          generated_payload_digest: codexCanonicalDigest(oversizedPayload),
          generation_artifacts: [],
          public_summary: 'Generated a spec draft.',
        }),
      'codex_docker_runtime_evidence_unsafe',
    );
  });

  it('rejects unsafe runtime job artifact metadata', () => {
    expectDomainErrorCode(
      () =>
        validateCodexRuntimeJobArtifactIntake({
          content_type: 'application/json',
          digest: digestA,
          size_bytes: 128,
          metadata_json: {
            workspace_path: '/tmp/private/codex-home',
          },
        }),
      'codex_docker_runtime_evidence_unsafe',
    );
  });

  it('allows run-execution patch artifact metadata to report safe repo-relative changed files', () => {
    expect(() =>
      validateCodexRuntimeJobArtifactIntake({
        kind: 'run_execution_patch',
        content_type: 'text/x-diff',
        digest: digestA,
        size_bytes: 128,
        metadata_json: {
          changed_files: ['README.md', 'src/index.ts', '.forgeloop/repo-owned.toml'],
        },
      }),
    ).not.toThrow();
  });

  it.each([
    {
      task_kind: 'spec_draft',
      public_summary: 'ok',
    },
    {
      task_kind: 'run_execution',
      changed_files: [],
      public_summary: 'ok',
    },
    {
      task_kind: 'run_execution',
      execution_package_id: 'package-1',
      execution_package_version: 1,
      run_session_id: 'run-session-1',
      workspace_bundle_digest: 'not-a-digest',
      changed_files: [],
      check_results: [],
      execution_artifacts: [],
      public_summary: 'ok',
    },
    {
      task_kind: 'run_execution',
      execution_package_id: 'package-1',
      execution_package_version: 1,
      run_session_id: 'run-session-1',
      workspace_bundle_digest: digestA,
      changed_files: [],
      check_results: [{ name: 'unit', status: 'unknown', summary: 'ok' }],
      execution_artifacts: [],
      public_summary: 'ok',
    },
    {
      task_kind: 'run_execution',
      execution_package_id: 'package-1',
      execution_package_version: 1,
      run_session_id: 'run-session-1',
      workspace_bundle_digest: digestA,
      changed_files: [],
      check_results: [],
      execution_artifacts: [],
      public_summary: 'ok',
      metadata: { changed_files: ['safe'] },
    },
  ])('rejects malformed terminal runtime job result %#', (result) => {
    expectDomainErrorCode(() => validateCodexRuntimeJobTerminalResult(result), 'codex_docker_runtime_evidence_unsafe');
  });

  it('allows public-safe run-execution terminal result changed files and display summaries', () => {
    const runExecutionResult = {
      task_kind: 'run_execution',
      output_schema_version: 'codex_run_execution_result.v1',
      execution_package_id: 'package-1',
      execution_package_version: 3,
      run_session_id: 'run-session-1',
      workspace_bundle_digest: digestA,
      workspace_bundle_manifest_digest: digestB,
      mounted_task_workspace_digest: digestC,
      changed_files: [
        'index.html',
        'logo.svg',
        'Dockerfile.dev',
        'package.json',
        'README.md',
        'vite.config.mts',
        'vite.config.ts',
        'src/index.ts',
        'docs/release-notes.md',
      ],
      patch_artifact: {
        content_type: 'text/x-diff',
        digest: digestB,
        internal_ref: 'artifact://codex-runtime-jobs/runtime-job-1/artifacts/patch',
      },
      check_results: [
        {
          name: 'unit',
          status: 'passed',
          summary: 'Node.js tests passed after updating app/server documentation',
          output_digest: digestC,
          output_internal_ref: 'artifact://codex-runtime-jobs/runtime-job-1/artifacts/check-output',
        },
      ],
      execution_artifacts: [
        {
          kind: 'log_summary',
          name: 'check-output.log',
          content_type: 'text/plain',
          digest: digestA,
          internal_ref: 'artifact://codex-runtime-jobs/runtime-job-1/artifacts/summary',
        },
        {
          kind: 'screenshot',
          name: 'screenshot.png',
          content_type: 'image/png',
          digest: digestB,
          internal_ref: 'artifact://codex-runtime-jobs/runtime-job-1/artifacts/screenshot',
        },
        {
          kind: 'test_report',
          name: 'junit.xml',
          content_type: 'application/xml',
          digest: digestC,
          internal_ref: 'artifact://codex-runtime-jobs/runtime-job-1/artifacts/junit',
        },
      ],
      public_summary: `Checks:3 passed; Result:passed after updating Dockerfile.dev and vite.config.mts with digest ${digestA}.`,
    } satisfies CodexRunExecutionRuntimeJobResult;

    expect(validateCodexRuntimeJobTerminalResult(runExecutionResult)).toEqual(runExecutionResult);
  });

  it('accepts run-execution terminal schema and public-safe app-server runtime evidence', () => {
    const runExecutionResult = {
      task_kind: 'run_execution',
      output_schema_version: 'codex_run_execution_result.v1',
      execution_package_id: 'package-1',
      execution_package_version: 3,
      run_session_id: 'run-session-1',
      workspace_bundle_digest: digestA,
      workspace_bundle_manifest_digest: digestB,
      mounted_task_workspace_digest: digestC,
      changed_files: ['docs/runtime-report.md'],
      check_results: [],
      execution_artifacts: [],
      runtime_evidence: runtimeEvidence(),
      public_summary: 'Run execution completed with public-safe app-server evidence.',
    } as unknown as CodexRunExecutionRuntimeJobResult;

    expect(validateCodexRuntimeJobTerminalResult(runExecutionResult)).toEqual(runExecutionResult);
  });

  it('normalizes prior run-execution terminal results without output schema version', () => {
    const priorRunExecutionResult = {
      task_kind: 'run_execution',
      execution_package_id: 'package-1',
      execution_package_version: 3,
      run_session_id: 'run-session-1',
      workspace_bundle_digest: digestA,
      workspace_bundle_manifest_digest: digestB,
      mounted_task_workspace_digest: digestC,
      changed_files: ['docs/runtime-report.md'],
      check_results: [],
      execution_artifacts: [],
      runtime_evidence: runtimeEvidence(),
      public_summary: 'Run execution completed with public-safe app-server evidence.',
    };

    expect(validateCodexRuntimeJobTerminalResult(priorRunExecutionResult)).toEqual({
      ...priorRunExecutionResult,
      output_schema_version: 'codex_run_execution_result.v1',
    });
  });

  it('rejects run-execution terminal runtime evidence without app-server execution mode', () => {
    const runExecutionResult = {
      task_kind: 'run_execution',
      output_schema_version: 'codex_run_execution_result.v1',
      execution_package_id: 'package-1',
      execution_package_version: 3,
      run_session_id: 'run-session-1',
      workspace_bundle_digest: digestA,
      workspace_bundle_manifest_digest: digestB,
      mounted_task_workspace_digest: digestC,
      changed_files: [],
      check_results: [],
      execution_artifacts: [],
      runtime_evidence: runtimeEvidence({
        selected_execution_mode: 'cli_fallback' as CodexDockerRuntimeEvidence['selected_execution_mode'],
      }),
      public_summary: 'Run execution completed with fallback evidence.',
    } as unknown as CodexRunExecutionRuntimeJobResult;

    expectDomainErrorCode(
      () => validateCodexRuntimeJobTerminalResult(runExecutionResult),
      'codex_docker_runtime_evidence_unsafe',
    );
  });

  it('rejects public route-looking paths in run-execution terminal summaries', () => {
    const runExecutionResult = {
      task_kind: 'run_execution',
      execution_package_id: 'package-1',
      execution_package_version: 3,
      run_session_id: 'run-session-1',
      workspace_bundle_digest: digestA,
      workspace_bundle_manifest_digest: digestB,
      mounted_task_workspace_digest: digestC,
      changed_files: [],
      check_results: [],
      execution_artifacts: [],
      public_summary: 'Endpoint: /api/items',
    } satisfies CodexRunExecutionRuntimeJobResult;

    expectDomainErrorCode(
      () => validateCodexRuntimeJobTerminalResult(runExecutionResult),
      'codex_docker_runtime_evidence_unsafe',
    );
  });

  it.each(['app-server log leaked', 'app-server logs leaked', 'app_server_log raw'])(
    'rejects app-server log markers in structured terminal generation payloads: %s',
    (contentMarkdown) => {
      const payload = {
        ...generatedSpecRevisionPayload(),
        content_markdown: contentMarkdown,
      };

      expectDomainErrorCode(
        () =>
          validateCodexRuntimeJobTerminalResult(
            generationTerminalResult('development_plan_item_spec_revision', payload),
          ),
        'codex_docker_runtime_evidence_unsafe',
      );
    },
  );

  it.each([
    '/var/lib/forgeloop/workspaces/runtime-job-1/src/index.ts',
    '../src/index.ts',
    'src/../index.ts',
    'C:\\workspace\\src\\index.ts',
    'C:foo',
    'C:foo/bar',
    'src\\index.ts',
    'http://127.0.0.1:4555/internal',
    'localhost:3000/internal',
    'unix:/tmp/codex.sock',
    'codex.sock',
    '4f1e2d3c4f1e',
    'api.openai.com',
    '127.0.0.1.:4555',
    '10.0.0.5.:1234',
  ])('rejects unsafe run-execution changed file %s', (changedFile) => {
    expectDomainErrorCode(
      () =>
        validateCodexRuntimeJobTerminalResult({
          task_kind: 'run_execution',
          execution_package_id: 'package-1',
          execution_package_version: 3,
          run_session_id: 'run-session-1',
          workspace_bundle_digest: digestA,
          changed_files: [changedFile],
          check_results: [],
          execution_artifacts: [],
          public_summary: 'Run completed with public-safe summary.',
        }),
      'codex_docker_runtime_evidence_unsafe',
    );
  });

  it('allows run-execution changed files only at the top-level result field', () => {
    expectDomainErrorCode(
      () =>
        validateCodexRuntimeJobTerminalResult({
          task_kind: 'run_execution',
          execution_package_id: 'package-1',
          execution_package_version: 3,
          run_session_id: 'run-session-1',
          workspace_bundle_digest: digestA,
          changed_files: ['src/index.ts'],
          check_results: [],
          execution_artifacts: [],
          metadata: {
            changed_files: ['src/secret.ts'],
          },
          public_summary: 'Run completed with public-safe summary.',
        }),
      'codex_docker_runtime_evidence_unsafe',
    );
  });

  it('rejects unsafe public runtime values without blocking safe product refs', () => {
    expect(() =>
      assertCodexRuntimePublicSafeValue(
        {
          next_step_links: [{ label: 'Open run', href: 'forgeloop://runs/run-1' }],
          artifact_ref: 'artifact://codex-runtime-jobs/runtime-job-1/artifacts/artifact-1',
          digest: digestA,
        },
        'runtime result',
      ),
    ).not.toThrow();

    for (const unsafeValue of [
      { workspace_path: '/var/lib/forgeloop/workspaces/runtime-job-1' },
      { app_server_endpoint: 'http://127.0.0.1:4555' },
      { control_plane_endpoint: 'https://control.internal/runtime-jobs' },
      { socket_ref: 'unix:/tmp/codex.sock' },
      { container_id: '4f1e2d3c4f1e' },
      { auth_token: 'raw-token' },
      { authorization: 'artifact://ok' },
      { authorization_header: 'artifact://ok' },
      { authorizationHeader: 'artifact://ok' },
      { authHeader: 'artifact://ok' },
      { api_key: 'sk-test' },
      { apiKey: 'sk-test' },
      { 'api:key': 'public text' },
      { description: 'Authorization: Bearer raw-token' },
      { artifact_ref: 'artifact://http://127.0.0.1:4555/raw' },
      { artifact_ref: 'artifact://codex-runtime-jobs/runtime-job-1/http%3A%2F%2F127.0.0.1%3A4555%2Fraw' },
      { artifact_ref: 'artifact://codex-runtime-jobs/runtime-job-1/%2Fvar%2Flib%2Fforgeloop%2Fworkspaces%2Fjob' },
      { artifact_ref: 'artifact://codex-runtime-jobs/runtime-job-1/%2e%2e/secret' },
      { artifact_ref: 'artifact:///var/lib/forgeloop/workspaces/job' },
      { next_step: 'forgeloop://runs/http%3A%2F%2F127.0.0.1%3A4555%2Fraw' },
      { next_step: 'forgeloop://http://127.0.0.1:4555/raw' },
      { socket_path: 'artifact://ok' },
      { 'socket:path': 'public text' },
      { socketPath: 'artifact://ok' },
      { socket_ref: 'artifact://ok' },
      { container_name: 'artifact://ok' },
      { containerName: 'artifact://ok' },
      { container_ref: 'artifact://ok' },
      { 'container:id': 'public text' },
      { raw_context: { project_id: 'project-1' } },
      { raw_output: 'public text' },
      { rawoutput: 'public text' },
      { rawPatch: 'public text' },
      { 'raw-patch': 'public text' },
      { authheader: 'public text' },
      { containerid: 'public text' },
      { workspacepath: 'public text' },
      { 'workspace:path': 'public text' },
      { 'source:repo:path': 'public text' },
      { 'http://127.0.0.1:4555/internal': 'public text' },
      { '/var/lib/forgeloop/workspaces/job': 'public text' },
      { '4f1e2d3c4f1e': 'public text' },
      { changed_file: 'packages/domain/src/codex-runtime.ts' },
      { changed_file_windows: 'packages\\domain\\src\\codex-runtime.ts' },
      { spaced_file: 'foo bar/baz.txt' },
      { spaced_file_windows: 'foo bar\\baz.txt' },
      { unc_file: '\\\\server\\share\\file.txt' },
      { changed_dir: 'packages/domain/' },
      { workspace_file: 'tmp/workspace/file.txt' },
      { source_file_windows: 'src\\index.ts' },
      { parent_file_windows: '..\\src\\index.ts' },
      { dot_file_windows: '.\\src\\index.ts' },
      { manifest_file: 'package.json' },
      { readme_file: 'README.md' },
      { readme: 'README' },
      { license: 'LICENSE' },
      { changelog: 'CHANGELOG' },
      { dockerfile: 'Dockerfile' },
      { dockerfile_variant: 'Dockerfile.dev' },
      { makefile: 'Makefile' },
      { makefile_variant: 'Makefile.local' },
      { env_file: '.env.local' },
      { source_dir: 'src' },
      { component_dir: 'backend' },
      { local_url: 'file:///etc/passwd' },
      { event_stream: 'ws://127.0.0.1:4555/events' },
      { tcp_endpoint: 'tcp://10.0.0.5:1234' },
      { source_url: 'ssh://internal.example/repo' },
      'codex.sock',
    ]) {
      expectDomainErrorCode(() => assertCodexRuntimePublicSafeValue(unsafeValue, 'runtime result'), 'codex_docker_runtime_evidence_unsafe');
    }
  });

  it.each([
    ['href', 'localhost:3000/internal'],
    ['url', '127.0.0.1:4555/internal'],
    ['internal_ref', '[::1]:4555/internal'],
    ['href', '::1:4555/internal'],
    ['href', '::0001'],
    ['internal_ref', '[::0001]:4555/internal'],
    ['href', '::1%lo0'],
    ['internal_ref', '[::1%lo0]:4555/internal'],
    ['url', '0:0:0:0:0:0:0:1'],
    ['url', '0000:0000:0000:0000:0000:0000:0000:0001'],
    ['internal_ref', '[0:0:0:0:0:0:0:1]:4555/internal'],
    ['internal_ref', '[0000:0000:0000:0000:0000:0000:0000:0001]:4555/internal'],
    ['href', '::ffff:127.0.0.1:4555/internal'],
    ['href', '[::ffff:127.0.0.1]:4555/internal'],
    ['href', '::ffff:10.0.0.1'],
    ['href', '[::ffff:192.168.1.10]:8080/path'],
    ['href', '0:0:0:0:0:ffff:127.0.0.1'],
    ['href', '0000:0000:0000:0000:0000:ffff:127.0.0.1'],
    ['href', '[0:0:0:0:0:ffff:10.0.0.1]:8080/path'],
    ['href', '[0000:0000:0000:0000:0000:ffff:192.168.1.10]:8080/path'],
    ['href', 'fe80::1'],
    ['href', 'fe80::1%lo0'],
    ['url', '[fe80::1]:8080/path'],
    ['url', '[fe80::1%lo0]:8080/path'],
    ['href', 'localhost.'],
    ['href', 'localhost?x'],
    ['href', '127.0.0.1.'],
    ['href', '127.0.0.1.:4555'],
    ['href', '10.0.0.5.'],
    ['href', '10.0.0.5.:1234'],
    ['url', 'control.internal/runtime-jobs'],
    ['internal_ref', 'app-server.internal/jobs'],
    ['href', 'app-server:3845/internal'],
    ['url', 'control-plane:3845/runtime-jobs'],
    ['url', 'http:127.0.0.1:4555'],
    ['url', 'http:localhost:3000'],
    ['url', 'http:app-server:3845'],
    ['url', 'tcp:10.0.0.5:1234'],
    ['url', 'ssh:internal.example:22'],
    ['url', 'redis:6379'],
    ['url', 'redis.default.svc'],
    ['url', 'control-plane.default.svc'],
    ['url', 'app-server.default.svc'],
    ['url', 'redis.default.svc.cluster.local'],
    ['internal_ref', 'app-server/jobs'],
    ['internal_ref', 'app-server.'],
    ['internal_ref', 'app-server?x'],
    ['internal_ref', 'control-plane#x'],
    ['internal_ref', 'app_server:3845/internal'],
    ['internal_ref', 'app_server'],
    ['internal_ref', 'control_plane:3845/runtime-jobs'],
    ['internal_ref', 'control_plane'],
    ['internal_ref', 'forgeloop_control-plane_1:3845/internal'],
    ['internal_ref', 'forgeloop_control-plane_1'],
    ['internal_ref', 'forgeloop-app-server-1'],
    ['internal_ref', 'forgeloop-control-plane-1'],
    ['internal_ref', 'app-server-1'],
    ['internal_ref', 'control-plane-1'],
    ['internal_ref', 'postgres_db:5432'],
    ['href', 'control.internal'],
    ['url', 'app-server.internal'],
    ['internal_ref', 'api.openai.com'],
    ['host', 'api.openai.com'],
    ['host', 'api.openai.com.'],
    ['host', 'api.openai.com?x'],
    ['host', 'api.openai.com#x'],
    ['internal_ref', '10.0.0.5'],
    ['href', '192.168.1.10'],
    ['url', '172.16.0.2'],
    ['href', '127.1'],
    ['href', '127.0.1'],
    ['href', '0177.0.0.1'],
    ['href', '0x7f.0.0.1'],
    ['href', '2130706433'],
    ['internal_ref', 'fd00::1'],
  ])('rejects host-like runtime endpoint string in %s', (field, value) => {
    expectDomainErrorCode(
      () => assertCodexRuntimePublicSafeValue({ [field]: value }, 'runtime result'),
      'codex_docker_runtime_evidence_unsafe',
    );
  });

  it.each([
    'Provider endpoint api.openai.com failed before draft publication',
    'Legacy endpoint http:127.0.0.1:4555 failed before draft publication',
    'Cache endpoint redis:6379 failed before draft publication',
    'Worker read file:///etc/passwd during setup',
    'Output at file:/tmp/codex.log before cleanup',
    'Local app server was [::1]:4555/internal',
    'Worker endpoint ::1 failed',
    'Worker endpoint ::0001 failed',
    'Worker endpoint fe80::1 failed',
    'Worker endpoint [fe80::1%lo0]:8080/path failed',
    'Worker endpoint fe80::1%lo0 failed',
    'Worker endpoint 2130706433 failed',
    'Container 4f1e2d3c4f1e failed',
    'Generated draft; local app server was http://127.0.0.1:4555/internal',
    'Worker endpoint redis.default.svc returned an error',
    'Worker endpoint app_server:3845 returned an error',
    'Worker endpoint control_plane:3845 returned an error',
    'Worker endpoint forgeloop_control-plane_1:3845 returned an error',
    'Worker endpoint forgeloop-app-server-1 returned an error',
    'Worker endpoint postgres_db:5432 returned an error',
    'Container socket unix:/tmp/codex.sock was unavailable',
    'Worker wrote temporary files under /tmp/workspace',
    'Worker read ../src/index before cleanup',
    'Worker read `/tmp/workspace` before cleanup',
    'Worker read `../src/index` before cleanup',
    'Worker read `\\\\server\\share\\file.txt` before cleanup',
    'Model response contained api_key=sk-test',
    'Authorization: Bearer raw-token appeared in summary',
  ])('rejects endpoint leakage embedded in display text %#', (publicSummary) => {
    expectDomainErrorCode(
      () =>
        validateCodexRuntimeJobTerminalResult({
          task_kind: 'spec_draft',
          prompt_version: 'generation-prompt-v1',
          output_schema_version: 'spec-draft-output.v1',
          generated_payload: {
            title: 'Public spec title',
          },
          generated_payload_digest: digestA,
          generation_artifacts: [],
          public_summary: publicSummary,
        }),
      'codex_docker_runtime_evidence_unsafe',
    );
  });

  it('rejects endpoint leakage embedded in generated payload fields', () => {
    expectDomainErrorCode(
      () =>
        validateCodexRuntimeJobTerminalResult({
          task_kind: 'spec_draft',
          prompt_version: 'generation-prompt-v1',
          output_schema_version: 'spec-draft-output.v1',
          generated_payload: {
            title: 'Public spec title',
            description: 'Provider endpoint api.openai.com failed before draft publication',
          },
          generated_payload_digest: digestA,
          generation_artifacts: [],
          public_summary: 'Generated a spec draft.',
        }),
      'codex_docker_runtime_evidence_unsafe',
    );
  });

  it.each(['endpoint:api.openai.com', 'endpoint,api.openai.com', 'endpoint|api.openai.com', 'endpoint@api.openai.com'])(
    'rejects punctuation-adjacent endpoint leakage in generated payload fields %s',
    (description) => {
      expectDomainErrorCode(
        () =>
          validateCodexRuntimeJobTerminalResult({
            task_kind: 'spec_draft',
            prompt_version: 'generation-prompt-v1',
            output_schema_version: 'spec-draft-output.v1',
            generated_payload: {
              description,
            },
            generated_payload_digest: digestA,
            generation_artifacts: [],
            public_summary: 'Generated a spec draft.',
          }),
        'codex_docker_runtime_evidence_unsafe',
      );
    },
  );

  it.each([
    'http%3A%2F%2F127.0.0.1%3A4555%2Finternal',
    'api%2Eopenai%2Ecom',
    '%2Fvar%2Flib%2Fforgeloop%2Fworkspaces%2Fjob',
    'Provider endpoint api%2Eopenai%2Ecom failed before draft publication',
  ])('rejects percent-encoded public runtime leaks %s', (value) => {
    expectDomainErrorCode(
      () =>
        validateCodexRuntimeJobTerminalResult({
          task_kind: 'spec_draft',
          prompt_version: 'generation-prompt-v1',
          output_schema_version: 'spec-draft-output.v1',
          generated_payload: {
            description: value,
          },
          generated_payload_digest: digestA,
          generation_artifacts: [],
          public_summary: 'Generated a spec draft.',
        }),
      'codex_docker_runtime_evidence_unsafe',
    );
  });

  it.each([
    { prompt: 'write private implementation details' },
    { raw_prompt: 'write private implementation details' },
    { notification: 'raw app-server notification payload' },
    { raw_notification: 'raw app-server notification payload' },
    { log: 'raw stdout from worker' },
    { logs: ['raw worker log line'] },
  ])(
    'rejects nested raw prompt or log keys %#',
    (generatedPayload) => {
      expectDomainErrorCode(
        () =>
          validateCodexRuntimeJobTerminalResult({
            task_kind: 'spec_draft',
            prompt_version: 'generation-prompt-v1',
            output_schema_version: 'spec-draft-output.v1',
            generated_payload: generatedPayload,
            generated_payload_digest: digestA,
            generation_artifacts: [],
            public_summary: 'Generated a spec draft.',
          }),
        'codex_docker_runtime_evidence_unsafe',
      );
    },
  );

  it('rejects colon-separated unsafe keys inside generated payload', () => {
    expectDomainErrorCode(
      () =>
        validateCodexRuntimeJobTerminalResult({
          task_kind: 'spec_draft',
          prompt_version: 'generation-prompt-v1',
          output_schema_version: 'spec-draft-output.v1',
          generated_payload: {
            'container:id': 'public text',
          },
          generated_payload_digest: digestA,
          generation_artifacts: [],
          public_summary: 'Generated a spec draft.',
        }),
      'codex_docker_runtime_evidence_unsafe',
    );
  });

  it.each([
    'runtime_job_id',
    'launch_lease_id',
    'worker_id',
    'key_id',
    'algorithm',
    'ciphertext',
    'encryption_nonce',
    'aad_json',
    'aad_digest',
    'expires_at',
  ])('requires launch token envelope digest field %s', (field) => {
    const envelopeInput = {
      id: 'envelope-1',
      runtime_job_id: 'runtime-job-1',
      launch_lease_id: 'lease-1',
      worker_id: 'worker-1',
      key_id: 'worker-key-1',
      algorithm: 'x25519-hkdf-sha256-aes-256-gcm',
      ciphertext: 'sealed-token',
      encryption_nonce: 'nonce-1',
      aad_json: {
        runtime_job_id: 'runtime-job-1',
        launch_lease_id: 'lease-1',
      },
      aad_digest: digestA,
      envelope_digest: digestB,
      status: 'available',
      expires_at: '2026-05-20T00:10:00.000Z',
      created_at: '2026-05-20T00:00:00.000Z',
    } satisfies CodexLaunchTokenEnvelope;
    const incompleteEnvelope = { ...envelopeInput };
    delete (incompleteEnvelope as Record<string, unknown>)[field];

    expect(() => codexLaunchTokenEnvelopeDigest(incompleteEnvelope)).toThrow(DomainError);
  });

  it('rejects malformed launch token envelope digest fields', () => {
    expect(() =>
      codexLaunchTokenEnvelopeDigest({
        id: 'envelope-1',
        runtime_job_id: 'runtime-job-1',
        launch_lease_id: 'lease-1',
        worker_id: 'worker-1',
        key_id: 'worker-key-1',
        algorithm: 'x25519-hkdf-sha256-aes-256-gcm',
        ciphertext: 'sealed-token',
        encryption_nonce: 'nonce-1',
        aad_json: {
          runtime_job_id: 'runtime-job-1',
          launch_lease_id: 'lease-1',
        },
        aad_digest: 'not-a-digest',
        expires_at: '2026-05-20T00:10:00.000Z',
      }),
    ).toThrow(DomainError);
  });

  it('treats project-only scope as project-wide while repo scope is repo-specific', () => {
    expect(codexRuntimeScopeMatches([{ project_id: 'project-1' }], { project_id: 'project-1', repo_id: 'repo-1' })).toBe(true);
    expect(codexRuntimeScopeMatches([{ project_id: 'project-1', repo_id: 'repo-1' }], { project_id: 'project-1', repo_id: 'repo-1' })).toBe(
      true,
    );
    expect(codexRuntimeScopeMatches([{ project_id: 'project-1', repo_id: 'repo-1' }], { project_id: 'project-1', repo_id: 'repo-2' })).toBe(
      false,
    );
    expect(codexRuntimeScopeMatches([{ project_id: 'project-1' }], { project_id: 'project-2', repo_id: 'repo-1' })).toBe(false);
  });

  it('requires repo-specific worker scope for source-changing run execution', () => {
    expect(
      codexWorkerScopeMatchesTarget([{ project_id: 'project-1' }], 'generation', { project_id: 'project-1', repo_id: 'repo-1' }),
    ).toBe(true);
    expect(
      codexWorkerScopeMatchesTarget([{ project_id: 'project-1' }], 'run_execution', { project_id: 'project-1', repo_id: 'repo-1' }),
    ).toBe(false);
    expect(
      codexWorkerScopeMatchesTarget([{ project_id: 'project-1', repo_id: 'repo-1' }], 'run_execution', {
        project_id: 'project-1',
        repo_id: 'repo-1',
      }),
    ).toBe(true);
    expect(codexWorkerScopeMatchesTarget([{ project_id: 'project-1', repo_id: 'repo-1' }], 'run_execution', { project_id: 'project-1' })).toBe(
      false,
    );
  });

  it('creates stable profile revision digests independent of object key order', () => {
    const left = baseRevision({
      network_policy: hostFirewallPolicy([
          {
            id: 'model-provider',
            protocol: 'https',
            host: 'api.openai.com',
            path_prefix: '/v1',
            purpose: 'model_provider',
          },
        ]),
    });
    const right = baseRevision({
      network_policy: hostFirewallPolicy([
          {
            purpose: 'model_provider',
            path_prefix: '/v1',
            host: 'api.openai.com',
            protocol: 'https',
            id: 'model-provider',
          },
        ]),
    });

    expect(codexRuntimeProfileRevisionDigest(left)).toBe(codexRuntimeProfileRevisionDigest(right));
  });

  it('creates stable network policy digests independent of allowlist rule order', () => {
    const npmRule = {
      id: 'npm',
      protocol: 'https',
      host: 'registry.npmjs.org',
      purpose: 'package_registry',
    } as const;
    expect(codexRuntimeNetworkPolicyDigest(hostFirewallPolicy([modelProviderRule, npmRule]))).toBe(
      codexRuntimeNetworkPolicyDigest(hostFirewallPolicy([npmRule, modelProviderRule])),
    );
  });

  it('excludes database timestamps from profile digests but changes when runtime config changes', () => {
    const original = baseRevision();
    const timestampOnlyChange = baseRevision({
      created_at: '2026-05-20T01:00:00.000Z',
      created_by_actor_id: 'actor-2',
      profile_digest: digestC,
    });
    const runtimeConfigChange = baseRevision({
      codex_config_digest: codexCanonicalDigest({ config: 'changed' }),
    });

    expect(codexRuntimeProfileRevisionDigest(original)).toBe(codexRuntimeProfileRevisionDigest(timestampOnlyChange));
    expect(codexRuntimeProfileRevisionDigest(original)).not.toBe(codexRuntimeProfileRevisionDigest(runtimeConfigChange));
  });

  it.each([
    ['top-level undefined', undefined],
    ['function values', () => 'not-json'],
    ['symbol values', Symbol('not-json')],
    ['class instances', new NonJsonFixture('not-json')],
    ['non-finite numbers', Number.NaN],
    ['unsupported array entries', [undefined]],
  ])('rejects %s when computing canonical digests', (_label, value) => {
    expect(() => codexCanonicalDigest(value)).toThrow(/JSON-compatible/);
  });

  it('validates self-consistent profile and Codex config digests', () => {
    expect(() => validateCodexRuntimeProfileRevision(baseRevision(), { strictRealDogfood: true })).not.toThrow();

    expectDomainErrorCode(
      () =>
        validateCodexRuntimeProfileRevision(baseRevision({ profile_digest: digestB }), {
          strictRealDogfood: true,
        }),
      'codex_runtime_profile_invalid',
    );

    expectDomainErrorCode(
      () =>
        validateCodexRuntimeProfileRevision(baseRevision({ codex_config_digest: digestB }), {
          strictRealDogfood: true,
        }),
      'codex_runtime_profile_invalid',
    );
  });

  it.each([
    ['target_kind', { target_kind: 'invalid_kind' }],
    ['source_access_mode', { source_access_mode: 'unsafe_mode' }],
    ['environment', { environment: 'prod' }],
  ])('rejects strict real dogfood profile with invalid %s', (_field, overrides) => {
    expectDomainErrorCode(
      () =>
        validateCodexRuntimeProfileRevision(baseRevision(overrides as Partial<CodexRuntimeProfileRevision>), {
          strictRealDogfood: true,
        }),
      'codex_runtime_profile_invalid',
    );
  });

  it.each([
    ['undefined revision', undefined],
    ['null revision', null],
  ])('rejects malformed strict profile object without TypeError when %s', (_label, revision) => {
    expectDomainErrorCode(
      () => validateCodexRuntimeProfileRevision(revision as unknown as CodexRuntimeProfileRevision, { strictRealDogfood: true }),
      'codex_runtime_profile_invalid',
    );
  });

  it.each([
    ['resource_limits', 'codex_runtime_profile_invalid'],
    ['network_policy', 'codex_worker_docker_policy_unavailable'],
    ['docker_policy', 'codex_worker_docker_policy_unavailable'],
    ['effective_config_assertions', 'codex_runtime_profile_invalid'],
    ['allowed_scopes', 'codex_runtime_profile_invalid'],
  ] as const)('rejects malformed strict profile without TypeError when %s is missing', (field, code) => {
    const malformed = { ...baseRevision(), [field]: undefined } as unknown as CodexRuntimeProfileRevision;

    expectDomainErrorCode(() => validateCodexRuntimeProfileRevision(malformed, { strictRealDogfood: true }), code);
  });

  it.each([
    [
      'docker_policy.drop_capabilities',
      { docker_policy: { ...baseRevision().docker_policy, drop_capabilities: undefined } },
      'codex_worker_docker_policy_unavailable',
    ],
    [
      'effective_config_assertions.forbidden_writable_roots',
      {
        effective_config_assertions: {
          ...baseRevision().effective_config_assertions,
          forbidden_writable_roots: undefined,
        },
      },
      'codex_runtime_profile_invalid',
    ],
  ] as const)('rejects malformed strict profile without TypeError when %s is missing', (_field, overrides, code) => {
    const malformed = baseRevision(overrides as unknown as Partial<CodexRuntimeProfileRevision>);

    expectDomainErrorCode(() => validateCodexRuntimeProfileRevision(malformed, { strictRealDogfood: true }), code);
  });

  it.each([
    ['null allowlist entry', null],
    ['non-object allowlist entry', 42],
  ])('rejects malformed strict profile network policy without TypeError when it contains %s', (_label, entry) => {
    const rules = [entry as unknown as CodexNetworkAllowlistRule];
    const networkPolicy = {
      mode: 'egress_allowlist' as const,
      provider: 'host_firewall' as const,
      allowlist_rules: rules,
      egress_allowlist_digest: codexCanonicalDigest(codexNetworkPolicyDigestInput('host_firewall', rules)),
      self_test_digest: digestA,
    };
    const revisionWithoutDigest = {
      ...baseRevision(),
      network_policy: networkPolicy,
    };
    const malformed = {
      ...revisionWithoutDigest,
      profile_digest: codexRuntimeProfileRevisionDigest(revisionWithoutDigest),
    } as unknown as CodexRuntimeProfileRevision;

    expectDomainErrorCode(
      () => validateCodexRuntimeProfileRevision(malformed, { strictRealDogfood: true }),
      'codex_worker_docker_policy_unavailable',
    );
  });

  it.each([
    ['missing egress_allowlist_digest', { egress_allowlist_digest: undefined }],
    ['missing self_test_digest', { self_test_digest: undefined }],
    ['malformed egress_allowlist_digest', { egress_allowlist_digest: 'digest' }],
    ['malformed self_test_digest', { self_test_digest: 'digest' }],
  ])('rejects malformed non-strict egress allowlist network policy with %s', (_label, patch) => {
    const networkPolicy = {
      ...hostFirewallPolicy(),
      ...patch,
    };
    const revisionWithoutDigest = {
      ...baseRevision(),
      network_policy: networkPolicy,
    };
    const malformed = {
      ...revisionWithoutDigest,
      profile_digest: codexRuntimeProfileRevisionDigest(revisionWithoutDigest),
    } as unknown as CodexRuntimeProfileRevision;

    expectDomainErrorCode(
      () => validateCodexRuntimeProfileRevision(malformed),
      'codex_worker_docker_policy_unavailable',
    );
  });

  it.each([
    ['empty id', { id: '' }],
    ['empty profile_id', { profile_id: '' }],
    ['invalid status', { status: 'draft' }],
    ['zero revision_number', { revision_number: 0 }],
    ['non-string docker_image', { docker_image: null }],
    ['non-string codex_config_toml', { codex_config_toml: null }],
    ['empty created_by_actor_id', { created_by_actor_id: '' }],
    ['malformed created_at timestamp', { created_at: 'not-a-date' }],
    ['impossible created_at timestamp', { created_at: '2026-02-30T00:00:00.000Z' }],
  ])('rejects malformed strict profile scalar field %s', (_label, overrides) => {
    const malformed = baseRevision(overrides as unknown as Partial<CodexRuntimeProfileRevision>);

    expectDomainErrorCode(
      () => validateCodexRuntimeProfileRevision(malformed, { strictRealDogfood: true }),
      'codex_runtime_profile_invalid',
    );
  });

  it.each([
    [
      'loopback model provider',
      { ...modelProviderRule, protocol: 'tcp', host: '127.0.0.1', port: 1 },
    ],
    ['internal metadata host', { ...modelProviderRule, protocol: 'http', host: 'metadata.google.internal' }],
    ['wildcard host', { ...modelProviderRule, host: '*.example.com' }],
    ['invalid port', { ...modelProviderRule, port: -1 }],
    ['invalid protocol', { ...modelProviderRule, protocol: 'ftp' }],
  ])('rejects unsafe strict real dogfood allowlist rule %s', (_label, rule) => {
    expectDomainErrorCode(
      () =>
        validateCodexRuntimeProfileRevision(
          baseRevision({
            network_policy: hostFirewallPolicy([rule as CodexNetworkAllowlistRule]),
          }),
          { strictRealDogfood: true },
        ),
      'codex_worker_docker_policy_unavailable',
    );
  });

  it('rejects strict real dogfood profiles with unknown network policy mode', () => {
    const policy = {
      ...hostFirewallPolicy(),
      mode: 'audit_only',
    };

    expectDomainErrorCode(
      () =>
        validateCodexRuntimeProfileRevision(
          baseRevision({
            network_policy: policy as CodexRuntimeProfileRevision['network_policy'],
          }),
          { strictRealDogfood: true },
        ),
      'codex_worker_docker_policy_unavailable',
    );
  });

  it('rejects strict real dogfood profiles with unknown network provider', () => {
    const rules = [modelProviderRule];
    const policy = {
      ...hostFirewallPolicy(rules),
      provider: 'noop_provider',
      egress_allowlist_digest: codexCanonicalDigest(codexNetworkPolicyDigestInput('noop_provider' as never, rules)),
    };

    expectDomainErrorCode(
      () =>
        validateCodexRuntimeProfileRevision(
          baseRevision({
            network_policy: policy as CodexRuntimeProfileRevision['network_policy'],
          }),
          { strictRealDogfood: true },
        ),
      'codex_worker_docker_policy_unavailable',
    );
  });

  it('rejects strict real dogfood docker network proxy policy without provider config', () => {
    const rules = [modelProviderRule];
    const policy = {
      ...hostFirewallPolicy(rules),
      provider: 'docker_network_proxy',
      egress_allowlist_digest: codexCanonicalDigest(codexNetworkPolicyDigestInput('docker_network_proxy', rules)),
      provider_config: undefined,
    };

    expectDomainErrorCode(
      () =>
        validateCodexRuntimeProfileRevision(
          baseRevision({
            network_policy: policy as CodexRuntimeProfileRevision['network_policy'],
          }),
          { strictRealDogfood: true },
        ),
      'codex_worker_docker_policy_unavailable',
    );
  });

  it.each([
    'cpu_ms',
    'memory_mb',
    'pids',
    'fds',
    'workspace_bytes',
    'artifact_bytes',
    'timeout_ms',
    'output_limit_bytes',
    'run_output_limit_bytes',
  ] as const)('rejects strict real dogfood profile with invalid resource limit %s', (field) => {
    const validRevision = baseRevision();

    expectDomainErrorCode(
      () =>
        validateCodexRuntimeProfileRevision(
          baseRevision({
            resource_limits: {
              ...validRevision.resource_limits,
              [field]: 0,
            },
          }),
          { strictRealDogfood: true },
        ),
      'codex_runtime_profile_invalid',
    );
  });

  it('rejects strict real dogfood egress allowlist profiles without a model provider rule', () => {
    const revision = baseRevision({
      network_policy: hostFirewallPolicy([
          {
            id: 'registry',
            protocol: 'https',
            host: 'registry.npmjs.org',
            purpose: 'package_registry',
          },
        ]),
    });

    expect(() => validateCodexRuntimeProfileRevision(revision, { strictRealDogfood: true })).toThrow(
      /codex_worker_docker_policy_unavailable/,
    );
  });

  it('rejects strict real dogfood profiles with disabled network policy', () => {
    expectDomainErrorCode(
      () =>
        validateCodexRuntimeProfileRevision(
          baseRevision({
            network_policy: {
              mode: 'disabled',
            },
          }),
          { strictRealDogfood: true },
        ),
      'codex_worker_docker_policy_unavailable',
    );
  });

  it('rejects strict real dogfood allowlist profiles with Docker network disabled', () => {
    const validRevision = baseRevision();

    expectDomainErrorCode(
      () =>
        validateCodexRuntimeProfileRevision(
          baseRevision({
            docker_policy: {
              ...validRevision.docker_policy,
              network_disabled: true,
            },
          }),
          { strictRealDogfood: true },
        ),
      'codex_worker_docker_policy_unavailable',
    );
  });

  it.each([
    ['app_server_only', { app_server_only: false }],
    ['rootless', { rootless: false }],
    ['read_only_rootfs', { read_only_rootfs: false }],
    ['no_new_privileges', { no_new_privileges: false }],
    ['drop_capabilities', { drop_capabilities: [] }],
  ])('rejects strict Docker policy without %s', (_field, dockerPolicyPatch) => {
    const validRevision = baseRevision();

    expectDomainErrorCode(
      () =>
        validateCodexRuntimeProfileRevision(
          baseRevision({
            docker_policy: {
              ...validRevision.docker_policy,
              ...dockerPolicyPatch,
            },
          }),
          { strictRealDogfood: true },
        ),
      'codex_worker_docker_policy_unavailable',
    );
  });

  it('allows Codex provider bearer tokens as centrally stored runtime material', () => {
    const codexConfigToml = [
      'model_provider = "x2r"',
      'model = "gpt-5.5"',
      'approval_policy = "never"',
      'sandbox_mode = "read-only"',
      '[model_providers.x2r]',
      'name = "x2r"',
      'base_url = "https://api.openai.com/v1"',
      'wire_api = "responses"',
      'experimental_bearer_token = "sk-test"',
      'requires_openai_auth = false',
      '',
    ].join('\n');

    expect(validateCodexRuntimeProfileRevision(baseRevision({ codex_config_toml: codexConfigToml }), { strictRealDogfood: true })).toEqual(
      expect.objectContaining({
        codex_config_digest: codexCanonicalDigest(codexConfigToml),
      }),
    );
  });

  it('rejects strict real dogfood profiles when provider base_url is not covered by model-provider allowlist', () => {
    const codexConfigToml = [
      'model_provider = "x2r"',
      'model = "gpt-5.5"',
      'approval_policy = "never"',
      'sandbox_mode = "read-only"',
      '[model_providers.x2r]',
      'base_url = "https://ai.x2r.store/v1"',
      'wire_api = "responses"',
      'experimental_bearer_token = "sk-test"',
      '',
    ].join('\n');

    expectDomainErrorCode(
      () => validateCodexRuntimeProfileRevision(baseRevision({ codex_config_toml: codexConfigToml }), { strictRealDogfood: true }),
      'codex_worker_docker_policy_unavailable',
    );
  });

  it.each([
    'experimental_bearer_token = "sk-test" secret_key = "x"',
    'requires_openai_auth = true auth_token = "x"',
  ])('allows centrally stored secret-bearing Codex config material %s', (codexConfigToml) => {
    expect(validateCodexRuntimeProfileRevision(baseRevision({ codex_config_toml: codexConfigToml }), { strictRealDogfood: true })).toEqual(
      expect.objectContaining({
        codex_config_digest: codexCanonicalDigest(codexConfigToml),
      }),
    );
  });

  it.each(['api_key = "${OPENAI_API_KEY}"', 'auth_token = "$ENV.AUTH_TOKEN"', 'secret = "env.SECRET"'])(
    'rejects host environment interpolation in Codex config %s',
    (codexConfigToml) => {
    expectDomainErrorCode(
      () => validateCodexRuntimeProfileRevision(baseRevision({ codex_config_toml: codexConfigToml }), { strictRealDogfood: true }),
      'codex_runtime_profile_invalid',
    );
    },
  );

  it('validates effective config assertions before prompt delivery', () => {
    const generationAssertions = baseRevision().effective_config_assertions;

    expect(validateCodexEffectiveConfigAssertions(generationAssertions, generationAssertions)).toBeUndefined();
    expect(validateCodexEffectiveConfigAssertions({ ...generationAssertions, approval_policy: 'on-request' }, generationAssertions)).toBe(
      'codex_app_server_effective_config_mismatch',
    );
    expect(codexPublicBlockerCodes).toContain('codex_app_server_effective_config_mismatch');
  });

  it('validates Docker network proxy config image pinning and provider digest', () => {
    expect(validateCodexDockerNetworkProxyConfig(validDockerProxyConfig())).toEqual(validDockerProxyConfig());

    expectDomainErrorCode(
      () =>
        validateCodexDockerNetworkProxyConfig({
          ...validDockerProxyConfig(),
          proxy_image_digest: 'latest',
        }),
      'codex_worker_docker_policy_unavailable',
    );
    expectDomainErrorCode(
      () =>
        validateCodexDockerNetworkProxyConfig({
          ...validDockerProxyConfig(),
          provider_config_digest: digestC,
        }),
      'codex_worker_docker_policy_unavailable',
    );
  });

  it.each([
    ['proxy_image', { proxy_image: null }],
    ['self_test_image', { self_test_image: null }],
  ])('rejects malformed Docker network proxy config image field %s', (_field, patch) => {
    const config = {
      ...validDockerProxyConfig(),
      ...patch,
    };
    const digestInput = {
      proxy_image: config.proxy_image,
      proxy_image_digest: config.proxy_image_digest,
      self_test_image: config.self_test_image,
      self_test_image_digest: config.self_test_image_digest,
    };

    expectDomainErrorCode(
      () =>
        validateCodexDockerNetworkProxyConfig({
          ...config,
          provider_config_digest: codexCanonicalDigest(digestInput),
        } as unknown as CodexDockerNetworkProxyConfig),
      'codex_worker_docker_policy_unavailable',
    );
  });

  it('rejects strict profiles with malformed Docker network proxy provider images', () => {
    const providerConfig = {
      ...validDockerProxyConfig(),
      proxy_image: null,
    };
    const malformedProviderConfig = {
      ...providerConfig,
      provider_config_digest: codexCanonicalDigest({
        proxy_image: providerConfig.proxy_image,
        proxy_image_digest: providerConfig.proxy_image_digest,
        self_test_image: providerConfig.self_test_image,
        self_test_image_digest: providerConfig.self_test_image_digest,
      }),
    };
    const rules = [modelProviderRule];

    expectDomainErrorCode(
      () =>
        validateCodexRuntimeProfileRevision(
          baseRevision({
            network_policy: {
              mode: 'egress_allowlist',
              provider: 'docker_network_proxy',
              allowlist_rules: rules,
              provider_config: malformedProviderConfig as unknown as CodexDockerNetworkProxyConfig,
              egress_allowlist_digest: codexCanonicalDigest(codexNetworkPolicyDigestInput('docker_network_proxy', rules)),
              self_test_digest: digestA,
            },
          }),
          { strictRealDogfood: true },
        ),
      'codex_worker_docker_policy_unavailable',
    );
  });

  it('redacts launch materialization without leaking raw secret payloads', () => {
    const payload = { api_key: 'super-secret-key', token: 'raw-token' };
    const materialization = {
      launch_target: {
        target_type: 'run_session',
        target_id: 'package-1',
        target_kind: 'run_execution',
        project_id: 'project-1',
        repo_id: 'repo-1',
      },
      profile_revision: baseRevision({ target_kind: 'run_execution', source_access_mode: 'path_policy_scoped' }),
      resolved_credentials: [
        {
          binding_id: 'credential-binding-1',
          binding_version_id: 'credential-version-1',
          payload,
          payload_digest: codexCredentialPayloadDigest(payload),
        },
      ],
      lease_id: 'lease-1',
      expires_at: '2026-05-20T00:10:00.000Z',
      materialized_at: '2026-05-20T00:00:00.000Z',
    } satisfies CodexLaunchMaterialization;

    const redacted = redactCodexLaunchMaterialization(materialization);
    const serialized = JSON.stringify(redacted);

    expect(serialized).toContain(codexCredentialPayloadDigest(payload));
    expect(serialized).not.toContain('super-secret-key');
    expect(serialized).not.toContain('raw-token');
    expect(serialized).not.toContain('"payload"');
  });

  it('accepts only public-safe Docker runtime evidence', () => {
    const validDockerRuntimeEvidence = {
      runtime_profile_id: 'profile-1',
      runtime_profile_revision_id: 'revision-1',
      runtime_profile_digest: digestA,
      runtime_target_kind: 'run_execution',
      source_access_mode: 'path_policy_scoped',
      environment: 'local_dogfood',
      credential_binding_id: 'credential-binding-1',
      credential_binding_version_id: 'credential-version-1',
      credential_payload_digest: digestB,
      launch_lease_id: 'lease-1',
      worker_id: 'worker-1',
      docker_image_digest: digestA,
      container_id_digest: digestB,
      app_server_effective_config_digest: digestC,
      network_policy_digest: digestA,
      network_policy_self_test_digest: digestB,
      docker_policy_self_check_digest: digestC,
      workspace_isolation_digest: digestA,
      app_server_attempted: true,
      selected_execution_mode: 'app_server',
    } satisfies CodexDockerRuntimeEvidence;

    expect(() => validateCodexDockerRuntimeEvidence(validDockerRuntimeEvidence)).not.toThrow();

    expect(() =>
      validateCodexDockerRuntimeEvidence({
        ...validDockerRuntimeEvidence,
        runtime_profile_id: '550e8400-e29b-41d4-a716-446655440000',
        runtime_profile_revision_id: '018f2f9e-2bb0-72bc-9233-7f4fdf2f0dd0',
        credential_binding_id: 'credential-binding-550e8400-e29b-41d4-a716-446655440000',
        credential_binding_version_id: 'credential-version-018f2f9e-2bb0-72bc-9233-7f4fdf2f0dd0',
        launch_lease_id: 'lease-550e8400-e29b-41d4-a716-446655440000',
      }),
    ).not.toThrow();

    expect(() =>
      validateCodexDockerRuntimeEvidence({
        ...validDockerRuntimeEvidence,
        runtime_target_kind: 'generation',
        worker_id: 'codex-runtime-dogfood-worker-eede4ae7916b-generation',
      }),
    ).not.toThrow();

    expect(() =>
      validateCodexDockerRuntimeEvidence({
        ...validDockerRuntimeEvidence,
        worker_id: 'codex-runtime-dogfood-worker-eede4ae7916b-run-execution',
      }),
    ).not.toThrow();

    expectDomainErrorCode(
      () =>
        validateCodexDockerRuntimeEvidence({
          runtime_profile_id: 'profile-1',
          docker_image_digest: digestA,
          container_id: '4f1e2d3c',
          workspace_path: '/var/lib/forgeloop/workspaces/package-1',
          app_server_endpoint: 'http://127.0.0.1:4555',
          secret_token: 'raw-secret',
        }),
      'codex_docker_runtime_evidence_unsafe',
    );

    for (const unsafePublicId of [
      '/var/lib/forgeloop/workspaces/package-1',
      'http://127.0.0.1:4555',
      '127.0.0.1:4555',
      '::1',
      'control.internal',
      'api.openai.com',
      'app_server:3845',
      'app_server',
      'control_plane:3845',
      'control-plane?x',
      'forgeloop_control-plane_1:3845',
      'forgeloop_control-plane_1',
      'forgeloop-control-plane-1',
      'postgres_db:5432',
      'unix:/tmp/private/codex.sock',
      'codex.sock',
      '4f1e2d3c4f1e',
      'worker api.openai.com',
    ]) {
      expectDomainErrorCode(
        () =>
          validateCodexDockerRuntimeEvidence({
            ...validDockerRuntimeEvidence,
            worker_id: unsafePublicId,
          }),
        'codex_docker_runtime_evidence_unsafe',
      );
    }

    expectDomainErrorCode(
      () =>
        validateCodexDockerRuntimeEvidence({
          ...validDockerRuntimeEvidence,
          launch_lease_id: 'Bearer raw-token',
        }),
      'codex_docker_runtime_evidence_unsafe',
    );

    for (const unsafeEnumPatch of [
      { runtime_target_kind: 'not_a_kind' },
      { source_access_mode: 'anything' },
      { environment: 'prod' },
    ]) {
      expectDomainErrorCode(
        () =>
          validateCodexDockerRuntimeEvidence({
            ...validDockerRuntimeEvidence,
            ...unsafeEnumPatch,
          }),
        'codex_docker_runtime_evidence_unsafe',
      );
    }
  });
});
