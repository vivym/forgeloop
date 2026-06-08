import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  type CodexGenerationWorkloadV1,
  type CodexLaunchMaterialization,
  type CodexRunExecutionWorkloadV1,
  type CodexRuntimeJob,
  validateCodexRunExecutionWorkload,
} from '@forgeloop/domain';
import type { CodexDriverStreamItem, CodexSessionDriver } from '@forgeloop/executor';
import {
  type CodexAppServerTransport,
  type CodexGenerationRuntime,
  type GeneratedSpecDraftV1,
} from '../../packages/codex-runtime/src/index';
import { createCodexGenerationRuntime } from '../../packages/codex-runtime/src/runtime';

import { createRemoteCodexWorkerClient } from '../../packages/codex-worker-runtime/src/remote-worker-client';
import { sealCodexLaunchTokenEnvelope, type SealedEnvelope } from '../../packages/codex-worker-runtime/src/envelope-crypto';
import {
  createWorkspaceBundleArchive,
  createWorkspaceBundleManifest,
  workspaceBundleArchiveDigest,
  workspaceBundleManifestDigest,
} from '../../packages/codex-worker-runtime/src/workspace-bundle';

const digest = (char: string) => `sha256:${char.repeat(64)}`;
const rawDigest = (bytes: Uint8Array | string) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const codexThreadDigest = (threadId: string) =>
  codexCanonicalDigest({ kind: 'codex_app_server_thread_id', thread_id: threadId });
const runtimeArtifactRef = (runtimeJobId: string, kind: unknown) =>
  `artifact://internal/codex_runtime_job_artifact/codex_runtime_job/${runtimeJobId}/${String(kind)}`;

const generatedSpec = (patch: Partial<GeneratedSpecDraftV1> = {}): GeneratedSpecDraftV1 => ({
  schema_version: 'spec_draft.v1',
  summary: 'Public spec summary',
  content: 'Public spec content',
  background: 'Public background',
  goals: ['Ship remote worker generation'],
  scope_in: ['remote worker loop'],
  scope_out: ['run execution'],
  acceptance_criteria: ['terminal result is public safe'],
  risk_notes: ['none'],
  test_strategy_summary: 'unit tests',
  ...patch,
});

const generatedBoundaryRound = () => ({
  schema_version: 'boundary_round_result.v1',
  session_id: 'boundary-session-1',
  round_id: 'round-1',
  questions: [{ text: 'Confirm API scope?', required: true }],
  proposed_decisions: [{ text: 'Keep execution out of scope.' }],
  needs_leader_input: true,
  public_summary: 'Generated a boundary round.',
  artifacts: [],
});

const generationSignedContext = () => ({
  context_version: 'generation_context.work_item.v1',
  action_run_id: 'action-run-1',
  work_item_id: 'work-item-1',
});

const generationWorkload = (overrides: Partial<CodexGenerationWorkloadV1> = {}): CodexGenerationWorkloadV1 => ({
  schema_version: 'codex_generation_workload.v1',
  runtime_job_id: 'runtime-job-1',
  action_run_id: 'action-run-1',
  task_kind: 'spec_draft',
  prompt_version: 'generation-prompt-v1',
  output_schema_version: 'spec_draft.v1',
  signed_context_ref: 'artifact://codex-runtime-jobs/runtime-job-1/workload/context',
  signed_context_digest: codexCanonicalDigest(generationSignedContext()),
  prompt_template_digest: digest('2'),
  created_at: '2026-05-23T00:00:00.000Z',
  expires_at: '2026-05-23T00:10:00.000Z',
  ...overrides,
});

const generationWorkloadResponse = (overrides: Partial<CodexGenerationWorkloadV1> = {}) => ({
  workload: generationWorkload(overrides),
  signed_context: generationSignedContext(),
});

const reviewResponsePayload = (overrides: Record<string, unknown> = {}) => ({
  schema_version: 'review_response.v1',
  response_markdown: 'The implementation addresses the review packet without modifying files.',
  summary: 'No code changes were made.',
  public_summary: 'Prepared a read-only review response.',
  evidence_refs: [
    {
      id: 'evidence-1',
      display_text: 'Review packet',
      digest: digest('e'),
    },
  ],
  ...overrides,
});

const reviewResponseWorkload = (overrides: Partial<CodexGenerationWorkloadV1> = {}): CodexGenerationWorkloadV1 =>
  ({
    schema_version: 'codex_generation_workload.v1',
    runtime_job_id: 'runtime-job-1',
    plan_item_workflow_action_id: 'workflow-action-1',
    plan_item_workflow_id: 'workflow-1',
    codex_session_id: 'session-1',
    codex_session_turn_id: 'session-turn-1',
    review_packet_id: 'review-packet-1',
    review_packet_digest: digest('a'),
    task_kind: 'review_response',
    prompt_version: 'review-response:v1',
    output_schema_version: 'review_response.v1',
    signed_context_ref: 'artifact://codex-runtime-jobs/runtime-job-1/workload/context',
    signed_context_digest: codexCanonicalDigest({ schema_version: 'review_response_context.v1' }),
    prompt_template_digest: digest('2'),
    created_at: '2026-05-23T00:00:00.000Z',
    expires_at: '2026-05-23T00:10:00.000Z',
    codex_session_runtime_context: sessionRuntimeContext({
      expected_input_capsule_digest: digest('b'),
      turn_group_status: 'complete',
      continuation: {
        kind: 'resume_thread',
        codex_thread_id: 'thread-1',
        codex_thread_id_digest: codexThreadDigest('thread-1'),
      },
    }),
    codex_session_terminalization: sessionTerminalization({
      expected_input_capsule_digest: digest('b'),
      input_capsule_id: '11111111-1111-4111-8111-111111111111',
      input_capsule_digest: digest('b'),
      input_capsule_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-1/11111111-1111-4111-8111-111111111111',
      input_memory_bundle_ref: 'artifact://internal/codex_memory_bundle/codex_session/session-1/input-memory',
      input_memory_bundle_digest: digest('c'),
      input_environment_manifest_ref: 'artifact://internal/codex_environment_manifest/codex_session/session-1/input-environment',
      input_environment_manifest_digest: digest('d'),
    }),
    ...overrides,
  }) as CodexGenerationWorkloadV1;

const reviewResponseWorkloadResponse = (workload: CodexGenerationWorkloadV1 = reviewResponseWorkload()) => ({
  workload,
  signed_context: { schema_version: 'review_response_context.v1' },
});

const sessionRuntimeContext = (overrides: Record<string, unknown> = {}) => ({
  schema_version: 'codex_session_runtime_context.v1' as const,
  codex_session_id: 'session-1',
  codex_session_turn_id: 'session-turn-1',
  lease_id: 'session-lease-1',
  lease_epoch: 1,
  worker_id: 'worker-1',
  worker_session_digest: digest('a'),
  turn_group_status: 'intermediate' as const,
  continuation: { kind: 'start_thread' as const },
  ...overrides,
});

const sessionTerminalization = (overrides: Record<string, unknown> = {}) => ({
  schema_version: 'codex_session_terminalization.v1' as const,
  lease_token: 'session-terminalization-token-secret',
  codex_session_id: 'session-1',
  codex_session_turn_id: 'session-turn-1',
  base_memory_bundle_ref: 'artifact://internal/codex_memory_bundle/codex_session/session-1/base-memory',
  base_memory_bundle_digest: digest('b'),
  ...overrides,
});

const runExecutionPackagePrompt = 'Implement the package and report changed files.';

const runExecutionContext = () => ({
    run_spec: {
      run_session_id: 'run-session-1',
      execution_package_id: 'execution-package-1',
      expected_package_version: 7,
      executor_type: 'local_codex',
      workflow_only: false,
      project_id: 'project-1',
      repo: {
        repo_id: 'repo-1',
        base_branch: 'main',
        base_commit_sha: 'abc123',
      },
      objective: 'Implement the package.',
      package: {
        package_id: 'execution-package-1',
        objective: 'Implement the package.',
        plan_revision_id: 'plan-revision-1',
      },
      review_context: { summary: 'review context' },
      context: {
        required_checks: [],
      },
      allowed_paths: ['README.md'],
      forbidden_paths: ['secrets/**'],
      required_checks: [],
      artifact_policy: { requested_artifacts: ['execution_summary'] },
      timeout_seconds: 60,
      idempotency_key: 'run-session-1',
      source_mutation_policy: 'path_policy_scoped',
    },
  });

const runExecutionWorkload = (
  archiveDigest = digest('c'),
  manifestDigest = digest('e'),
  overrides: Partial<CodexRunExecutionWorkloadV1> = {},
): CodexRunExecutionWorkloadV1 => {
  const executionContext = runExecutionContext();
  return {
    schema_version: 'codex_run_execution_workload.v1',
    runtime_job_id: 'runtime-job-run-1',
    plan_item_workflow_id: 'workflow-1',
    development_plan_id: 'development-plan-1',
    development_plan_item_id: 'development-plan-item-1',
    run_session_id: 'run-session-1',
    execution_package_id: 'execution-package-1',
    execution_package_version: 7,
    workspace_bundle_id: 'workspace-bundle-run-1',
    workspace_bundle_digest: archiveDigest,
    package_prompt_ref: 'artifact:codex-run-execution:runtime-job-run-1:prompt',
    package_prompt_digest: codexCanonicalDigest(runExecutionPackagePrompt),
    execution_context_ref: 'artifact:codex-run-execution:runtime-job-run-1:context',
    execution_context_digest: codexCanonicalDigest(executionContext),
    path_policy_digest: codexCanonicalDigest({ allowed_paths: ['README.md'], forbidden_paths: ['secrets/**'] }),
    required_checks_digest: codexCanonicalDigest([]),
    output_schema_version: 'codex_run_execution_result.v1',
    created_at: '2026-05-23T00:00:00.000Z',
    expires_at: '2026-05-23T00:10:00.000Z',
    workspace_acquisition_json: {
      schema_version: 'workspace_bundle_acquisition.v1',
      bundle_id: 'workspace-bundle-run-1',
      archive_ref: 'artifact:codex-pending-bundles:workspace-bundle-run-1',
      archive_digest: archiveDigest,
      manifest_digest: manifestDigest,
      size_bytes: 128,
      expires_at: '2026-05-23T00:10:00.000Z',
    },
    codex_session_runtime_context: {
      schema_version: 'codex_session_runtime_context.v1',
      codex_session_id: 'session-1',
      codex_session_turn_id: 'session-turn-1',
      lease_id: 'lease-run-1',
      lease_epoch: 1,
      worker_id: 'worker-1',
      worker_session_digest: codexCredentialPayloadDigest('session-1'),
      expected_input_capsule_digest: digest('b'),
      turn_group_status: 'complete',
      continuation: {
        kind: 'resume_thread',
        codex_thread_id: 'thread-1',
        codex_thread_id_digest: codexThreadDigest('thread-1'),
      },
    },
    codex_session_terminalization: {
      schema_version: 'codex_session_terminalization.v1',
      lease_token: 'session-terminalization-token-secret',
      codex_session_lease_id: 'session-lease-1',
      codex_session_lease_epoch: 1,
      codex_session_worker_id: 'worker-1',
      codex_session_worker_session_digest: codexCredentialPayloadDigest('session-1'),
      codex_session_id: 'session-1',
      codex_session_turn_id: 'session-turn-1',
      expected_input_capsule_digest: digest('b'),
      input_capsule_id: '11111111-1111-4111-8111-111111111111',
      input_capsule_digest: digest('b'),
      input_capsule_ref:
        'artifact://internal/codex_runtime_capsule/codex_session/session-1/11111111-1111-4111-8111-111111111111',
      input_memory_bundle_ref: 'artifact://internal/codex_memory_bundle/codex_session/session-1/input-memory',
      input_memory_bundle_digest: digest('d'),
      input_environment_manifest_ref: 'artifact://internal/codex_environment_manifest/codex_session/session-1/input-environment',
      input_environment_manifest_digest: digest('f'),
    },
    ...overrides,
  };
};

const runExecutionWorkloadResponse = (workload: CodexRunExecutionWorkloadV1) => ({
  workload,
  package_prompt: runExecutionPackagePrompt,
  execution_context_json: runExecutionContext(),
});

const runExecutionOutputCapsule = () => ({
  id: '22222222-2222-4222-8222-222222222222',
  codex_session_id: 'session-1',
  created_from_turn_id: 'session-turn-1',
  sequence: 2,
  artifact_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-1/22222222-2222-4222-8222-222222222222',
  digest: digest('2'),
  size_bytes: '123',
  manifest_digest: digest('3'),
  thread_state_digest: digest('4'),
  memory_state_digest: digest('5'),
  environment_manifest_digest: digest('6'),
  codex_thread_id_digest: codexThreadDigest('thread-1'),
  codex_cli_version: '0.133.0',
  app_server_protocol_digest: digest('7'),
  runtime_profile_revision_id: 'profile-rev-1',
  trusted_runtime_manifest_digest: digest('8'),
  credential_binding_lineage_digest: digest('9'),
  created_by_actor_id: 'worker-1',
  created_at: '2026-05-23T00:00:00.000Z',
});

const runExecutionPublicEvidence = () => ({
  runtime_profile_id: 'profile-1',
  runtime_profile_revision_id: 'profile-rev-1',
  runtime_profile_digest: digest('7'),
  runtime_target_kind: 'run_execution' as const,
  source_access_mode: 'path_policy_scoped' as const,
  environment: 'test' as const,
  launch_lease_id: 'lease-run-1',
  worker_id: 'worker-1',
  docker_image_digest: digest('4'),
  container_id_digest: digest('9'),
  app_server_effective_config_digest: digest('6'),
  docker_policy_self_check_digest: digest('a'),
  app_server_attempted: true as const,
  selected_execution_mode: 'app_server' as const,
});

const generationPublicEvidence = () => ({
  ...runExecutionPublicEvidence(),
  runtime_target_kind: 'generation' as const,
  source_access_mode: 'artifact_only' as const,
});

const runExecutionCapsuleManager = (calls?: string[]) => ({
  materializeBaseMemory: vi.fn(),
  restore: vi.fn(async () => {
    calls?.push('restore');
  }),
  repairLocator: vi.fn(async () => {
    calls?.push('repair');
  }),
  package: vi.fn(async () => {
    calls?.push('package');
    return {
      capsule: runExecutionOutputCapsule(),
      outputMemoryBundleRef: 'artifact://internal/codex_memory_bundle/codex_session/session-1/output-memory',
      outputMemoryBundleDigest: digest('b'),
      outputEnvironmentManifestRef: 'artifact://internal/codex_environment_manifest/codex_session/session-1/output-environment',
      outputEnvironmentManifestDigest: digest('c'),
    };
  }),
});

const runExecutionLauncher = (workerTempRoot: string, calls?: string[]) => ({
  startFromMaterialization: vi.fn(async (_materialization: CodexLaunchMaterialization, input?: Record<string, unknown>) => {
    const capsuleHookInput = {
      codexHomeHostPath: join(workerTempRoot, 'codex-home'),
      codexHomeContainerPath: '/codex-home' as const,
      artifactHostPath: join(workerTempRoot, 'artifacts'),
    };
    await mkdir(capsuleHookInput.codexHomeHostPath, { recursive: true });
    await mkdir(capsuleHookInput.artifactHostPath, { recursive: true });
    await (input?.beforeAppServerStart as ((paths: typeof capsuleHookInput) => Promise<void>) | undefined)?.(capsuleHookInput);
    calls?.push('docker-start');
    await (input?.afterAppServerStart as ((paths: typeof capsuleHookInput) => Promise<void>) | undefined)?.(capsuleHookInput);
    return {
      endpoint: 'docker-exec:' + digest('8'),
      containerWorkspacePath: '/workspace' as const,
      capsuleHookInput,
      publicEvidence: runExecutionPublicEvidence(),
      close: vi.fn(async () => undefined),
    };
  }),
});

const runExecutionBundleFixture = async (workerTempRoot: string) => {
  const bundleManifest = createWorkspaceBundleManifest({
    bundleId: 'workspace-bundle-run-1',
    createdAt: '2026-05-23T00:00:00.000Z',
    allowedPaths: ['**'],
    forbiddenPaths: [],
    files: [{ path: 'README.md', content: '# Remote run\n' }],
  });
  const bundleArchive = createWorkspaceBundleArchive({
    manifest: bundleManifest,
    files: [{ path: 'README.md', content: '# Remote run\n' }],
  });
  const bundleArchivePath = join(workerTempRoot, 'bundle.archive');
  await writeFile(bundleArchivePath, bundleArchive);
  const archiveDigest = workspaceBundleArchiveDigest(bundleArchive);
  const manifestDigest = workspaceBundleManifestDigest(bundleManifest);
  return {
    bundleArchive,
    bundleArchivePath,
    archiveDigest,
    manifestDigest,
    workload: runExecutionWorkload(archiveDigest, manifestDigest),
  };
};

const createRunExecutionHarness = async (
  options: {
    tempSlug?: string;
    workload?: CodexRunExecutionWorkloadV1;
    workloadFactory?: (fixture: Awaited<ReturnType<typeof runExecutionBundleFixture>>) => CodexRunExecutionWorkloadV1;
    job?: CodexRuntimeJob;
    jobFactory?: (input: {
      fixture: Awaited<ReturnType<typeof runExecutionBundleFixture>>;
      workload: CodexRunExecutionWorkloadV1;
    }) => CodexRuntimeJob;
    acceptRuntimeJob?: () => Promise<unknown>;
    claimLaunchTokenEnvelope?: (envelope: SealedEnvelope | undefined) => Promise<unknown>;
    fetchRuntimeJobWorkload?: () => Promise<unknown>;
    materializeRuntimeJob?: () => Promise<CodexLaunchMaterialization>;
    startRuntimeJob?: () => Promise<unknown>;
    capsuleManager?: ReturnType<typeof runExecutionCapsuleManager>;
    launcher?: ReturnType<typeof runExecutionLauncher>;
    driverKind?: CodexSessionDriver['kind'];
    resumeRun?: (input: Parameters<CodexSessionDriver['resumeRun']>[0]) => AsyncIterable<CodexDriverStreamItem>;
  } = {},
) => {
  const workerTempRoot = await mkdtemp(join(tmpdir(), options.tempSlug ?? 'forgeloop-remote-run-worker-harness-'));
  const fixture = await runExecutionBundleFixture(workerTempRoot);
  const workload = options.workloadFactory?.(fixture) ?? options.workload ?? fixture.workload;
  const job =
    options.jobFactory?.({ fixture, workload }) ?? options.job ?? runExecutionRuntimeJob(fixture.archiveDigest, fixture.manifestDigest);
  const calls: string[] = [];
  const terminalized: Record<string, unknown>[] = [];
  const uploadedArtifacts: Record<string, unknown>[] = [];
  const startRun = vi.fn(async function* () {
    throw new Error('startRun must not be called for workflow execution');
  });
  const resumeRun = vi.fn(
    options.resumeRun ??
      (async function* () {
        yield {
          kind: 'terminal',
          status: 'succeeded',
          summary: 'Remote package run completed.',
          runtimeMetadata: { codex_thread_id: 'thread-1' },
        } satisfies CodexDriverStreamItem;
      }),
  );
  let sealedEnvelope: SealedEnvelope | undefined;
  const capsuleManager = options.capsuleManager ?? runExecutionCapsuleManager(calls);
  const launcher = options.launcher ?? runExecutionLauncher(workerTempRoot, calls);
  const controlPlaneClient = {
    registerWorker: async (input: Record<string, unknown>) => {
      calls.push('register');
      sealedEnvelope = await sealCodexLaunchTokenEnvelope({
        plaintext_launch_token: 'launch-token-run-secret',
        runtime_job_id: 'runtime-job-run-1',
        launch_lease_id: 'lease-run-1',
        envelope_id: 'envelope-run-1',
        worker_id: 'worker-1',
        worker_public_key_material: String(input.session_public_key_material),
        key_id: String(input.session_public_key_id),
        expires_at: '2026-05-23T00:10:00.000Z',
      });
      return {
        worker: { session_epoch: 1 },
        session_token: 'session-1',
        session_expires_at: '2026-05-23T00:10:00.000Z',
      };
    },
    heartbeatWorker: async () => {
      calls.push('heartbeat');
      return {};
    },
    pollRuntimeJobs: async () => {
      calls.push('poll');
      return { runtime_jobs: [{ runtime_job: job, envelope: { id: 'envelope-run-1' } }] };
    },
    acceptRuntimeJob: async () => {
      calls.push('accept');
      return options.acceptRuntimeJob === undefined
        ? { runtime_job: { ...job, status: 'accepted' } }
        : options.acceptRuntimeJob();
    },
    getRuntimeJobControl: async () => {
      calls.push('control');
      return { control: { cancel_requested: false } };
    },
    claimLaunchTokenEnvelope: async () => {
      calls.push('claim');
      return options.claimLaunchTokenEnvelope === undefined
        ? { envelope: sealedEnvelope }
        : options.claimLaunchTokenEnvelope(sealedEnvelope);
    },
    fetchRuntimeJobWorkload: async () => {
      calls.push('workload');
      return options.fetchRuntimeJobWorkload === undefined
        ? runExecutionWorkloadResponse(workload)
        : options.fetchRuntimeJobWorkload();
    },
    downloadWorkspaceBundle: async () => {
      calls.push('download-bundle');
      return {
        archive_path: fixture.bundleArchivePath,
        archive_digest: fixture.archiveDigest,
        size_bytes: fixture.bundleArchive.byteLength,
        content_type: 'application/vnd.forgeloop.workspace-bundle',
      };
    },
    materializeRuntimeJob: async () => {
      calls.push('materialize');
      return options.materializeRuntimeJob === undefined ? runExecutionMaterialization() : options.materializeRuntimeJob();
    },
    startRuntimeJob: async () => {
      calls.push('start');
      return options.startRuntimeJob === undefined
        ? { runtime_job: { ...job, status: 'running' } }
        : options.startRuntimeJob();
    },
    appendRuntimeJobEvent: async () => {
      calls.push('event');
      return {};
    },
    uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
      calls.push(`artifact:${input.kind}`);
      uploadedArtifacts.push(input);
      return {
        artifact: {
          kind: input.kind,
          name: input.name,
          content_type: input.content_type,
          digest: input.digest,
          internal_ref: runtimeArtifactRef('runtime-job-run-1', input.kind),
        },
      };
    },
    terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
      calls.push('terminal');
      terminalized.push(input);
      return {};
    },
  };
  const worker = createRemoteCodexWorkerClient({
    workerId: 'worker-1',
    workerIdentity: 'remote-dev',
    version: 'test',
    bootstrapToken: 'bootstrap-secret',
    bootstrapTokenVersion: 1,
    workerTempRoot,
    allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
    capabilities: ['run_execution'],
    dockerImageDigests: [digest('4')],
    networkPolicyDigests: [digest('b')],
    hostUid: 501,
    hostGid: 20,
    maxConcurrency: 1,
    controlPlaneClient,
    launcher,
    capsuleManager,
    scavenger: async () => {
      calls.push('scavenge');
    },
    runExecutionDriverFactory: () => ({
      kind: options.driverKind ?? 'app_server',
      startRun,
      resumeRun,
      sendInput: async () => ({}),
      cancelRun: async () => ({}),
      close: async () => undefined,
    }),
    now: () => '2026-05-23T00:00:00.000Z',
    nonceFactory: () => `nonce-${calls.length}`,
  });
  return {
    ...fixture,
    worker,
    workerTempRoot,
    calls,
    terminalized,
    uploadedArtifacts,
    startRun,
    resumeRun,
    launcher,
    capsuleManager,
  };
};

const runtimeJob = (workloadOverrides: Partial<CodexGenerationWorkloadV1> = {}): CodexRuntimeJob => ({
  id: 'runtime-job-1',
  job_request_id: 'job-request-1',
  target_type: 'automation_action_run',
  target_id: 'action-run-1',
  target_kind: 'generation',
  project_id: 'project-1',
  repo_id: 'repo-1',
  worker_id: 'worker-1',
  launch_lease_id: 'lease-1',
  launch_attempt: 1,
  status: 'queued',
  input_digest: codexCanonicalDigest(generationWorkload(workloadOverrides)),
  input_json: generationWorkload(workloadOverrides),
  expires_at: '2026-05-23T00:10:00.000Z',
  created_at: '2026-05-23T00:00:00.000Z',
  updated_at: '2026-05-23T00:00:00.000Z',
});

const runExecutionRuntimeJob = (archiveDigest = digest('c'), manifestDigest = digest('e')): CodexRuntimeJob => ({
  ...runtimeJob(),
  id: 'runtime-job-run-1',
  job_request_id: 'job-request-run-1',
  target_type: 'run_session',
  target_id: 'run-session-1',
  target_kind: 'run_execution',
  launch_lease_id: 'lease-run-1',
  workflow_id: 'workflow-1',
  codex_session_id: 'session-1',
  codex_session_turn_id: 'session-turn-1',
  input_digest: codexCanonicalDigest(runExecutionWorkload(archiveDigest, manifestDigest)),
  input_json: runExecutionWorkload(archiveDigest, manifestDigest),
  workspace_acquisition_digest: digest('d'),
  workspace_acquisition_json: {
    schema_version: 'workspace_bundle_acquisition.v1',
    bundle_id: 'workspace-bundle-run-1',
    archive_ref: 'artifact:codex-pending-bundles:workspace-bundle-run-1',
    archive_digest: archiveDigest,
    manifest_digest: manifestDigest,
    size_bytes: 128,
    expires_at: '2026-05-23T00:10:00.000Z',
  },
});

const materialization = (): CodexLaunchMaterialization => ({
  launch_target: {
    target_type: 'automation_action_run',
    target_id: 'action-run-1',
    target_kind: 'generation',
    project_id: 'project-1',
    repo_id: 'repo-1',
  },
  lease_id: 'lease-1',
  expires_at: '2026-05-23T00:10:00.000Z',
  materialized_at: '2026-05-23T00:00:01.000Z',
  resolved_credentials: [
    {
      binding_id: 'cred-1',
      binding_version_id: 'cred-v1',
      payload: { OPENAI_API_KEY: 'sk-test' },
      payload_digest: digest('3'),
    },
  ],
  profile_revision: {
    id: 'profile-rev-1',
    profile_id: 'profile-1',
    revision_number: 1,
    status: 'active',
    environment: 'test',
    docker_image: 'ghcr.io/forgeloop/codex',
    docker_image_digest: digest('4'),
    target_kind: 'generation',
    source_access_mode: 'artifact_only',
    codex_config_toml: 'approval_policy = "never"',
    codex_config_digest: digest('5'),
    expected_effective_config_digest: digest('6'),
    effective_config_assertions: {
      target_kind: 'generation',
      approval_policy: 'never',
      source_write_policy: 'artifact_only',
      forbidden_writable_roots: ['workspace'],
    },
    app_server_required: true,
    allowed_driver_kind: 'app_server',
    network_policy: { mode: 'disabled' },
    resource_limits: {
      cpu_ms: 1000,
      memory_mb: 512,
      pids: 64,
      fds: 128,
      workspace_bytes: 0,
      artifact_bytes: 10_000,
      timeout_ms: 60_000,
      output_limit_bytes: 100_000,
      run_output_limit_bytes: 100_000,
    },
    docker_policy: {
      app_server_only: true,
      rootless: true,
      read_only_rootfs: true,
      no_new_privileges: true,
      drop_capabilities: ['ALL'],
    },
    allowed_scopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
    profile_digest: digest('7'),
    created_by_actor_id: 'actor-1',
    created_at: '2026-05-23T00:00:00.000Z',
  },
});

const runExecutionMaterialization = (): CodexLaunchMaterialization => ({
  ...materialization(),
  launch_target: {
    target_type: 'run_session',
    target_id: 'run-session-1',
    target_kind: 'run_execution',
    project_id: 'project-1',
    repo_id: 'repo-1',
  },
  lease_id: 'lease-run-1',
  profile_revision: {
    ...materialization().profile_revision,
    target_kind: 'run_execution',
    source_access_mode: 'path_policy_scoped',
    effective_config_assertions: {
      target_kind: 'run_execution',
      sandbox_type: 'workspace-write',
    },
  },
});

const appServerTransport = (payload: unknown): CodexAppServerTransport => ({
  initialize: async () => undefined,
  request: async (method) => {
    if (method === 'thread/start') {
      return {
        thread_id: 'thread-1',
        config: { approval_policy: 'never', sandbox: 'read-only', writable_roots: [] },
      };
    }
    if (method === 'turn/start') {
      return {
        turn_id: 'turn-1',
        config: { approval_policy: 'never', sandbox_policy: 'read-only', writable_roots: [] },
      };
    }
    return {};
  },
  notifications: async function* () {
    yield { method: 'item/agentMessage/delta', params: { delta: JSON.stringify(payload) } };
    yield { method: 'turn/completed', params: { turn: { status: 'completed' } } };
  },
  close: async () => undefined,
});

const recordingAppServerTransport = (payload: unknown, methods: string[]): CodexAppServerTransport => ({
  initialize: async () => undefined,
  request: async (method) => {
    methods.push(method);
    if (method === 'thread/start' || method === 'thread/resume') {
      return {
        thread_id: 'thread-1',
        config: { approval_policy: 'never', sandbox: 'read-only', writable_roots: [] },
      };
    }
    if (method === 'turn/start') {
      return {
        turn_id: `turn-${methods.filter((called) => called === 'turn/start').length}`,
        config: { approval_policy: 'never', sandbox_policy: 'read-only', writable_roots: [] },
      };
    }
    return {};
  },
  notifications: async function* () {
    yield { method: 'item/agentMessage/delta', params: { delta: JSON.stringify(payload) } };
    yield { method: 'turn/completed', params: { turn: { status: 'completed' } } };
  },
  close: async () => undefined,
});

describe('remote codex worker client', () => {
  it('registers, scavenges, runs one assigned generation job through app-server, uploads artifacts, and terminalizes', async () => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-'));
    const calls: string[] = [];
    let sealedEnvelope: SealedEnvelope | undefined;
    const uploadedArtifacts: Record<string, unknown>[] = [];
    const terminalized: Record<string, unknown>[] = [];
    const sessionClose = vi.fn(async () => undefined);
    const controlPlaneClient = {
      registerWorker: async (input: Record<string, unknown>) => {
        calls.push('register');
        expect(input.session_public_key_algorithm).toBe('x25519');
        expect(typeof input.session_public_key_material).toBe('string');
        expect(String(input.session_public_key_material).length).toBeGreaterThan(10);
        sealedEnvelope = await sealCodexLaunchTokenEnvelope({
          plaintext_launch_token: 'launch-token-secret',
          runtime_job_id: 'runtime-job-1',
          launch_lease_id: 'lease-1',
          envelope_id: 'envelope-1',
          worker_id: 'worker-1',
          worker_public_key_material: String(input.session_public_key_material),
          key_id: String(input.session_public_key_id),
          expires_at: '2026-05-23T00:10:00.000Z',
        });
        return {
          worker: { session_epoch: 1 },
          session_token: 'session-1',
          session_expires_at: '2026-05-23T00:10:00.000Z',
        };
      },
      heartbeatWorker: async () => {
        calls.push('heartbeat');
        return {};
      },
      pollRuntimeJobs: async () => {
        calls.push('poll');
        return {
          runtime_jobs: [
            {
              runtime_job: runtimeJob(),
              envelope: { id: 'envelope-1' },
            },
          ],
        };
      },
      acceptRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
        calls.push('accept');
        expect(input.accepted_worker_session_digest).toBe(codexCredentialPayloadDigest('session-1'));
        return { runtime_job: { ...runtimeJob(), status: 'accepted' } };
      },
      getRuntimeJobControl: async () => {
        calls.push('control');
        return { control: { cancel_requested: false, drain_requested: false } };
      },
      claimLaunchTokenEnvelope: async () => {
        calls.push('claim');
        expect(sealedEnvelope).toBeDefined();
        return { envelope: sealedEnvelope };
      },
      fetchRuntimeJobWorkload: async () => {
        calls.push('workload');
        return generationWorkloadResponse();
      },
      materializeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
        calls.push('materialize');
        expect(input.launch_token).toBe('launch-token-secret');
        return materialization();
      },
      startRuntimeJob: async () => {
        calls.push('start');
        return { runtime_job: { ...runtimeJob(), status: 'running' } };
      },
      appendRuntimeJobEvent: async () => {
        calls.push('event');
        return {};
      },
      uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
        calls.push(`artifact:${input.kind}`);
        uploadedArtifacts.push(input);
        return {
          artifact: {
            kind: input.kind,
            name: input.name,
            content_type: input.content_type,
            digest: input.digest,
            internal_ref: runtimeArtifactRef('runtime-job-1', input.kind),
          },
        };
      },
      terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
        calls.push('terminal');
        terminalized.push(input);
        return {};
      },
    };
    const launcher = {
      startFromMaterialization: vi.fn(async () => ({
        endpoint: 'docker-exec:' + digest('8'),
        createTransport: () => appServerTransport(generatedSpec()),
        containerWorkspacePath: '/workspace' as const,
        publicEvidence: {
          runtime_profile_id: 'profile-1',
          runtime_profile_revision_id: 'profile-rev-1',
          runtime_profile_digest: digest('7'),
          runtime_target_kind: 'generation' as const,
          source_access_mode: 'artifact_only' as const,
          environment: 'test' as const,
          launch_lease_id: 'lease-1',
          worker_id: 'worker-1',
          docker_image_digest: digest('4'),
          container_id_digest: digest('9'),
          app_server_effective_config_digest: digest('6'),
          docker_policy_self_check_digest: digest('a'),
          app_server_attempted: true as const,
          selected_execution_mode: 'app_server' as const,
        },
        close: sessionClose,
      })),
    };

    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot,
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient,
      launcher,
      scavenger: async () => {
        calls.push('scavenge');
      },
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => `nonce-${calls.length}`,
    });

    const result = await worker.runOnce();

    expect(result).toEqual({ processed: 1 });
    expect(calls.slice(0, 4)).toEqual(['register', 'scavenge', 'heartbeat', 'poll']);
    expect(calls).toContain('accept');
    expect(calls).toContain('claim');
    expect(calls).toContain('workload');
    expect(calls).toContain('materialize');
    expect(calls).toContain('start');
    expect(calls).toContain('terminal');
    expect(launcher.startFromMaterialization).toHaveBeenCalledWith(
      materialization(),
      expect.objectContaining({ workerSessionToken: 'session-1', terminalizeLaunchLeaseOnClose: false }),
    );
    expect(sessionClose).toHaveBeenCalledWith('succeeded', 'generation complete');
    expect(uploadedArtifacts.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(['generated_payload', 'generation_validation_report']),
    );
    for (const artifact of uploadedArtifacts) {
      expect(artifact.bytes).toBeInstanceOf(Uint8Array);
      expect(artifact.digest).toBe(rawDigest(artifact.bytes as Uint8Array));
      expect(artifact.size_bytes).toBe((artifact.bytes as Uint8Array).byteLength);
      expect(artifact.artifact_idempotency_key).toBe(
        codexCanonicalDigest({
          kind: artifact.kind,
          name: artifact.name,
          digest: artifact.digest,
        }),
      );
    }
    expect(terminalized[0]).toMatchObject({
      launch_lease_id: 'lease-1',
      terminal_status: 'succeeded',
      terminal_result_json: {
        task_kind: 'spec_draft',
        generated_payload: generatedSpec(),
        generated_payload_digest: codexCanonicalDigest(generatedSpec()),
        generation_artifacts: expect.arrayContaining([
          expect.objectContaining({
            kind: 'generated_payload',
            internal_ref: runtimeArtifactRef('runtime-job-1', 'generated_payload'),
          }),
        ]),
      },
    });
    expect(JSON.stringify(terminalized[0])).not.toContain('launch-token-secret');
    await expect(stat(workerTempRoot)).resolves.toBeDefined();
  });

  it('dispatches Boundary Brainstorming workloads without falling through to package drafts', async () => {
    const boundaryWorkload = { task_kind: 'boundary_brainstorming_round' as const, output_schema_version: 'boundary_round_result.v1' };
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      scavenger: async () => undefined,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: '2026-05-23T00:10:00.000Z' };
        },
        heartbeatWorker: async () => {
          return {};
        },
        pollRuntimeJobs: async () => {
          return { runtime_jobs: [{ runtime_job: runtimeJob(boundaryWorkload), envelope: { id: 'envelope-1' } }] };
        },
        acceptRuntimeJob: async () => {
          return { runtime_job: { ...runtimeJob(boundaryWorkload), status: 'accepted' } };
        },
        getRuntimeJobControl: async () => {
          return { control: { cancel_requested: false, drain_requested: false } };
        },
        claimLaunchTokenEnvelope: async () => {
          return { envelope: sealedEnvelope };
        },
        fetchRuntimeJobWorkload: async () => {
          return generationWorkloadResponse(boundaryWorkload);
        },
        materializeRuntimeJob: async () => {
          return materialization();
        },
        startRuntimeJob: async () => {
          return { runtime_job: { ...runtimeJob(boundaryWorkload), status: 'running' } };
        },
        appendRuntimeJobEvent: async () => {
          return {};
        },
        uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => ({
          artifact: {
            kind: input.kind,
            name: input.name,
            content_type: input.content_type,
            digest: input.digest,
            internal_ref: runtimeArtifactRef('runtime-job-1', input.kind),
          },
        }),
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(async () => {
          return {
            endpoint: 'docker-exec:' + digest('8'),
            createTransport: () => appServerTransport(generatedBoundaryRound()),
            containerWorkspacePath: '/workspace' as const,
            publicEvidence: {
              runtime_profile_id: 'profile-1',
              runtime_profile_revision_id: 'profile-rev-1',
              runtime_profile_digest: digest('7'),
              runtime_target_kind: 'generation' as const,
              source_access_mode: 'artifact_only' as const,
              environment: 'test' as const,
              launch_lease_id: 'lease-1',
              worker_id: 'worker-1',
              docker_image_digest: digest('4'),
              container_id_digest: digest('9'),
              app_server_effective_config_digest: digest('6'),
              docker_policy_self_check_digest: digest('a'),
              app_server_attempted: true as const,
              selected_execution_mode: 'app_server' as const,
            },
            close: async () => undefined,
          };
        }),
      },
      generationRuntimeFactory: (config) => {
        const runtime = createCodexGenerationRuntime(config);
        return {
          ...runtime,
          generatePackageDrafts: async () => {
            throw new Error('package_drafts_fallthrough');
          },
        };
      },
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-boundary',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });
    expect(terminalized[0]).toMatchObject({
      terminal_status: 'succeeded',
      terminal_result_json: {
        task_kind: 'boundary_brainstorming_round',
        generated_payload: generatedBoundaryRound(),
      },
    });
  });

  it('terminalizes read-only review response output with capsule, memory, and environment refs', async () => {
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-remote-review-response-'));
    const outputCapsule = {
      id: '22222222-2222-4222-8222-222222222222',
      codex_session_id: 'session-1',
      created_from_turn_id: 'session-turn-1',
      sequence: 2,
      artifact_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-1/22222222-2222-4222-8222-222222222222',
      digest: digest('2'),
      size_bytes: '123',
      manifest_digest: digest('3'),
      thread_state_digest: digest('4'),
      memory_state_digest: digest('5'),
      environment_manifest_digest: digest('6'),
      codex_thread_id_digest: codexThreadDigest('thread-1'),
      codex_cli_version: '0.133.0',
      app_server_protocol_digest: digest('7'),
      runtime_profile_revision_id: 'profile-rev-1',
      trusted_runtime_manifest_digest: digest('8'),
      credential_binding_lineage_digest: digest('9'),
      created_by_actor_id: 'worker-1',
      created_at: '2026-05-23T00:00:00.000Z',
    };
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot,
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(reviewResponseWorkload()), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(reviewResponseWorkload()), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => reviewResponseWorkloadResponse(),
        materializeRuntimeJob: async () => ({
          ...materialization(),
          launch_target: {
            target_type: 'plan_item_workflow_action',
            target_id: 'workflow-action-1',
            target_kind: 'generation',
            project_id: 'project-1',
            repo_id: 'repo-1',
          },
        }),
        startRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(reviewResponseWorkload()), status: 'running' } }),
        markCodexSessionRunnerOwner: async () => ({}),
        appendRuntimeJobEvent: async () => ({}),
        uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => ({
          artifact: {
            kind: input.kind,
            name: input.name,
            content_type: input.content_type,
            digest: input.digest,
            internal_ref: runtimeArtifactRef('runtime-job-1', input.kind),
          },
        }),
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(async (_materialization: CodexLaunchMaterialization, input?: Record<string, unknown>) => {
          const capsuleHookInput = {
            codexHomeHostPath: join(workerTempRoot, 'codex-home'),
            codexHomeContainerPath: '/codex-home' as const,
            artifactHostPath: join(workerTempRoot, 'artifacts'),
          };
          await mkdir(capsuleHookInput.codexHomeHostPath, { recursive: true });
          await mkdir(capsuleHookInput.artifactHostPath, { recursive: true });
          await (input?.beforeAppServerStart as ((paths: typeof capsuleHookInput) => Promise<void>) | undefined)?.(capsuleHookInput);
          await (input?.afterAppServerStart as ((paths: typeof capsuleHookInput) => Promise<void>) | undefined)?.(capsuleHookInput);
          return {
            endpoint: 'docker-exec:' + digest('8'),
            containerWorkspacePath: '/workspace' as const,
            capsuleHookInput,
            publicEvidence: generationPublicEvidence(),
            close: async () => undefined,
          };
        }),
      },
      generationRuntimeFactory: () =>
        ({
          generateReviewResponse: async (input: Record<string, unknown>) => ({
            taskKind: 'review_response',
            promptVersion: String(input.promptVersion),
            outputSchemaVersion: String(input.outputSchemaVersion),
            generated: reviewResponsePayload(),
            generationArtifacts: [],
            codexThread: {
              codex_thread_id: 'thread-1',
              codex_thread_id_digest: codexThreadDigest('thread-1'),
              app_server_turn_id: 'app-server-turn-1',
            },
            publicSummary: 'Prepared a read-only review response.',
          }),
        }) as unknown as CodexGenerationRuntime,
      capsuleManager: {
        materializeBaseMemory: vi.fn(),
        restore: vi.fn(),
        repairLocator: vi.fn(),
        package: vi.fn(async () => ({
          capsule: outputCapsule,
          outputMemoryBundleRef: 'artifact://internal/codex_memory_bundle/codex_session/session-1/output-memory',
          outputMemoryBundleDigest: digest('a'),
          outputEnvironmentManifestRef: 'artifact://internal/codex_environment_manifest/codex_session/session-1/output-environment',
          outputEnvironmentManifestDigest: digest('b'),
        })),
      },
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-review-response',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(terminalized[0]).toMatchObject({
      terminal_status: 'succeeded',
      terminal_result_json: {
        task_kind: 'review_response',
        output_schema_version: 'review_response.v1',
        generated_payload: reviewResponsePayload(),
        output_capsule: outputCapsule,
        output_memory_bundle_ref: 'artifact://internal/codex_memory_bundle/codex_session/session-1/output-memory',
        output_memory_bundle_digest: digest('a'),
        output_environment_manifest_ref: 'artifact://internal/codex_environment_manifest/codex_session/session-1/output-environment',
        output_environment_manifest_digest: digest('b'),
      },
    });
  });

  it.each([
    ['patch artifact payload', { patch_artifact: { internal_ref: 'artifact://internal/patch', digest: digest('1') } }, []],
    ['changed files payload', { changed_files: ['README.md'] }, []],
    ['workspace bundle payload', { workspace_bundle: { id: 'bundle-1' } }, []],
    ['commit payload', { commit: { sha: 'abc123' } }, []],
    ['pull request payload', { pull_request: { url: 'https://github.test/pr/1' } }, []],
    ['run-execution artifact', {}, [{ kind: 'run_execution_patch', name: 'run-execution.patch', content_type: 'text/x-diff' }]],
  ])('fails review response terminalization for mutation output: %s', async (_name, payloadOverride, artifactOverride) => {
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-remote-review-response-mutation-'));
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot,
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(reviewResponseWorkload()), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(reviewResponseWorkload()), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => reviewResponseWorkloadResponse(),
        materializeRuntimeJob: async () => materialization(),
        startRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(reviewResponseWorkload()), status: 'running' } }),
        appendRuntimeJobEvent: async () => ({}),
        uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => ({
          artifact: {
            kind: input.kind,
            name: input.name,
            content_type: input.content_type,
            digest: input.digest,
            internal_ref: runtimeArtifactRef('runtime-job-1', input.kind),
          },
        }),
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(async (_materialization: CodexLaunchMaterialization, input?: Record<string, unknown>) => {
          const capsuleHookInput = {
            codexHomeHostPath: join(workerTempRoot, 'codex-home'),
            codexHomeContainerPath: '/codex-home' as const,
            artifactHostPath: join(workerTempRoot, 'artifacts'),
          };
          await mkdir(capsuleHookInput.codexHomeHostPath, { recursive: true });
          await mkdir(capsuleHookInput.artifactHostPath, { recursive: true });
          await (input?.beforeAppServerStart as ((paths: typeof capsuleHookInput) => Promise<void>) | undefined)?.(capsuleHookInput);
          await (input?.afterAppServerStart as ((paths: typeof capsuleHookInput) => Promise<void>) | undefined)?.(capsuleHookInput);
          return {
            endpoint: 'docker-exec:' + digest('8'),
            containerWorkspacePath: '/workspace' as const,
            capsuleHookInput,
            publicEvidence: generationPublicEvidence(),
            close: async () => undefined,
          };
        }),
      },
      generationRuntimeFactory: () =>
        ({
          generateReviewResponse: async (input: Record<string, unknown>) => ({
            taskKind: 'review_response',
            promptVersion: String(input.promptVersion),
            outputSchemaVersion: String(input.outputSchemaVersion),
            generated: reviewResponsePayload(payloadOverride),
            generationArtifacts: artifactOverride,
            publicSummary: 'Mutation output should be rejected.',
          }),
        }) as unknown as CodexGenerationRuntime,
      capsuleManager: runExecutionCapsuleManager(),
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-review-response-mutation',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'read_only_review_response_mutation_artifact',
    });
  });

  it('passes trusted session runtime context to generation runtime without leaking terminalization token', async () => {
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    const runtimeInputs: Record<string, unknown>[] = [];
    const events: string[] = [];
    const trustedContext = sessionRuntimeContext();
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-'));
    const outputCapsule = {
      id: '11111111-1111-4111-8111-111111111111',
      codex_session_id: 'session-1',
      created_from_turn_id: 'session-turn-1',
      sequence: 1,
      artifact_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-1/11111111-1111-4111-8111-111111111111',
      digest: digest('1'),
      size_bytes: '123',
      manifest_digest: digest('2'),
      thread_state_digest: digest('3'),
      memory_state_digest: digest('4'),
      environment_manifest_digest: digest('5'),
      codex_thread_id_digest: codexThreadDigest('thread-1'),
      codex_cli_version: '0.133.0',
      app_server_protocol_digest: digest('6'),
      runtime_profile_revision_id: 'profile-rev-1',
      trusted_runtime_manifest_digest: digest('7'),
      credential_binding_lineage_digest: digest('8'),
      created_by_actor_id: 'worker-1',
      created_at: '2026-05-23T00:00:00.000Z',
    };
    const capsuleManager = {
      materializeBaseMemory: vi.fn(async (input: { baseMemoryBundleRef: string; baseMemoryBundleDigest: string }) => {
        events.push('base-memory');
        expect(input.baseMemoryBundleRef).toBe('artifact://internal/codex_memory_bundle/codex_session/session-1/base-memory');
        expect(input.baseMemoryBundleDigest).toBe(digest('b'));
      }),
      restore: vi.fn(),
      repairLocator: vi.fn(),
      package: vi.fn(async () => ({
        capsule: outputCapsule,
        outputMemoryBundleRef: 'artifact://internal/codex_memory_bundle/codex_session/session-1/memory-1',
        outputMemoryBundleDigest: digest('9'),
        outputEnvironmentManifestRef: 'artifact://internal/codex_environment_manifest/codex_session/session-1/env-1',
        outputEnvironmentManifestDigest: digest('a'),
      })),
    };
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot,
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () =>
          generationWorkloadResponse({
            codex_session_runtime_context: trustedContext,
            codex_session_terminalization: sessionTerminalization(),
          }),
        materializeRuntimeJob: async () => materialization(),
        startRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'running' } }),
        markCodexSessionRunnerOwner: async () => ({}),
        appendRuntimeJobEvent: async () => ({}),
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(async (_materialization: CodexLaunchMaterialization, input?: Record<string, unknown>) => {
          await mkdir(join(workerTempRoot, 'codex-home'), { recursive: true });
          await mkdir(join(workerTempRoot, 'artifacts'), { recursive: true });
          expect(input).toMatchObject({ writeConfigAndAuth: false });
          await (input?.beforeAppServerStart as (paths: {
            codexHomeHostPath: string;
            codexHomeContainerPath: string;
            artifactHostPath: string;
          }) => Promise<void>)({
            codexHomeHostPath: join(workerTempRoot, 'codex-home'),
            codexHomeContainerPath: '/codex-home',
            artifactHostPath: join(workerTempRoot, 'artifacts'),
          });
          events.push('app-server-start');
          return {
            endpoint: 'docker-exec:' + digest('8'),
            containerWorkspacePath: '/workspace' as const,
            capsuleHookInput: {
              codexHomeHostPath: join(workerTempRoot, 'codex-home'),
              codexHomeContainerPath: '/codex-home',
              artifactHostPath: join(workerTempRoot, 'artifacts'),
            },
            publicEvidence: {
              runtime_profile_id: 'profile-1',
              runtime_profile_revision_id: 'profile-rev-1',
              runtime_profile_digest: digest('7'),
              runtime_target_kind: 'generation' as const,
              source_access_mode: 'artifact_only' as const,
              environment: 'test' as const,
              launch_lease_id: 'lease-1',
              worker_id: 'worker-1',
              docker_image_digest: digest('4'),
              container_id_digest: digest('9'),
              app_server_effective_config_digest: digest('6'),
              docker_policy_self_check_digest: digest('a'),
              app_server_attempted: true as const,
              selected_execution_mode: 'app_server' as const,
            },
            close: async () => undefined,
          };
        }),
      },
      generationRuntimeFactory: () =>
        ({
          generateSpecDraft: async (input) => {
            runtimeInputs.push(input);
            return {
              taskKind: 'spec_draft',
              promptVersion: input.promptVersion,
              outputSchemaVersion: input.outputSchemaVersion,
              generated: generatedSpec(),
              generationArtifacts: [],
              publicSummary: 'Generated public spec.',
            };
          },
          generatePlanDraft: vi.fn(),
          generatePackageDrafts: vi.fn(),
          generateBoundaryBrainstormingRound: vi.fn(),
          generateDevelopmentPlanItemSpecRevision: vi.fn(),
          generateDevelopmentPlanItemExecutionPlanRevision: vi.fn(),
        }) as unknown as CodexGenerationRuntime,
      capsuleManager,
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-1',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(events.indexOf('base-memory')).toBeLessThan(events.indexOf('app-server-start'));
    expect(runtimeInputs[0]).toMatchObject({ codexSessionRuntimeContext: trustedContext });
    expect(JSON.stringify(runtimeInputs)).not.toContain('session-terminalization-token-secret');
    expect(JSON.stringify(terminalized)).not.toContain('session-terminalization-token-secret');
    expect(JSON.stringify(terminalized)).not.toContain('launch-token-secret');
  });

  it('starts a first session turn from a clean Codex home when no base memory bundle exists yet', async () => {
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    const runtimeInputs: Record<string, unknown>[] = [];
    const events: string[] = [];
    const trustedContext = sessionRuntimeContext();
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-'));
    const outputCapsule = {
      id: '11111111-1111-4111-8111-111111111111',
      codex_session_id: 'session-1',
      created_from_turn_id: 'session-turn-1',
      sequence: 1,
      artifact_ref: 'artifact://internal/codex_runtime_capsule/codex_session/session-1/11111111-1111-4111-8111-111111111111',
      digest: digest('1'),
      size_bytes: '123',
      manifest_digest: digest('2'),
      thread_state_digest: digest('3'),
      memory_state_digest: digest('4'),
      environment_manifest_digest: digest('5'),
      codex_thread_id_digest: codexThreadDigest('thread-1'),
      codex_cli_version: '0.133.0',
      app_server_protocol_digest: digest('6'),
      runtime_profile_revision_id: 'profile-rev-1',
      trusted_runtime_manifest_digest: digest('7'),
      credential_binding_lineage_digest: digest('8'),
      created_by_actor_id: 'worker-1',
      created_at: '2026-05-23T00:00:00.000Z',
    };
    const capsuleManager = {
      materializeBaseMemory: vi.fn(),
      restore: vi.fn(),
      repairLocator: vi.fn(),
      package: vi.fn(async () => ({
        capsule: outputCapsule,
        outputMemoryBundleRef: 'artifact://internal/codex_memory_bundle/codex_session/session-1/memory-1',
        outputMemoryBundleDigest: digest('9'),
        outputEnvironmentManifestRef: 'artifact://internal/codex_environment_manifest/codex_session/session-1/env-1',
        outputEnvironmentManifestDigest: digest('a'),
      })),
    };
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot,
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () =>
          generationWorkloadResponse({
            codex_session_runtime_context: trustedContext,
            codex_session_terminalization: sessionTerminalization({
              base_memory_bundle_ref: undefined,
              base_memory_bundle_digest: undefined,
            }),
          }),
        materializeRuntimeJob: async () => materialization(),
        startRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'running' } }),
        markCodexSessionRunnerOwner: async () => ({}),
        appendRuntimeJobEvent: async () => ({}),
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(async (_materialization: CodexLaunchMaterialization, input?: Record<string, unknown>) => {
          await mkdir(join(workerTempRoot, 'codex-home'), { recursive: true });
          await mkdir(join(workerTempRoot, 'artifacts'), { recursive: true });
          await (input?.beforeAppServerStart as (paths: {
            codexHomeHostPath: string;
            codexHomeContainerPath: string;
            artifactHostPath: string;
          }) => Promise<void>)?.({
            codexHomeHostPath: join(workerTempRoot, 'codex-home'),
            codexHomeContainerPath: '/codex-home',
            artifactHostPath: join(workerTempRoot, 'artifacts'),
          });
          events.push('app-server-start');
          return {
            endpoint: 'docker-exec:' + digest('8'),
            containerWorkspacePath: '/workspace' as const,
            capsuleHookInput: {
              codexHomeHostPath: join(workerTempRoot, 'codex-home'),
              codexHomeContainerPath: '/codex-home',
              artifactHostPath: join(workerTempRoot, 'artifacts'),
            },
            publicEvidence: {
              runtime_profile_id: 'profile-1',
              runtime_profile_revision_id: 'profile-rev-1',
              runtime_profile_digest: digest('7'),
              runtime_target_kind: 'generation' as const,
              source_access_mode: 'artifact_only' as const,
              environment: 'test' as const,
              launch_lease_id: 'lease-1',
              worker_id: 'worker-1',
              docker_image_digest: digest('4'),
              container_id_digest: digest('9'),
              app_server_effective_config_digest: digest('6'),
              docker_policy_self_check_digest: digest('a'),
              app_server_attempted: true as const,
              selected_execution_mode: 'app_server' as const,
            },
            close: async () => undefined,
          };
        }),
      },
      generationRuntimeFactory: () =>
        ({
          generateSpecDraft: async (input) => {
            runtimeInputs.push(input);
            return {
              taskKind: 'spec_draft',
              promptVersion: input.promptVersion,
              outputSchemaVersion: input.outputSchemaVersion,
              generated: generatedSpec(),
              generationArtifacts: [],
              publicSummary: 'Generated public spec.',
            };
          },
          generatePlanDraft: vi.fn(),
          generatePackageDrafts: vi.fn(),
          generateBoundaryBrainstormingRound: vi.fn(),
          generateDevelopmentPlanItemSpecRevision: vi.fn(),
          generateDevelopmentPlanItemExecutionPlanRevision: vi.fn(),
        }) as unknown as CodexGenerationRuntime,
      capsuleManager,
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-clean-first-turn',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(events).toEqual(['app-server-start']);
    expect(capsuleManager.materializeBaseMemory).not.toHaveBeenCalled();
    expect(capsuleManager.restore).not.toHaveBeenCalled();
    expect(capsuleManager.repairLocator).not.toHaveBeenCalled();
    expect(runtimeInputs[0]).toMatchObject({ codexSessionRuntimeContext: trustedContext });
    expect(terminalized[0]).toMatchObject({
      terminal_status: 'succeeded',
      terminal_result_json: {
        output_capsule: outputCapsule,
        output_memory_bundle_ref: 'artifact://internal/codex_memory_bundle/codex_session/session-1/memory-1',
      },
    });
  });

  it('rejects unknown terminalization fields instead of accepting compatibility aliases', async () => {
    const terminalized: Record<string, unknown>[] = [];
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async () => ({ worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' }),
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
        fetchRuntimeJobWorkload: async () =>
          generationWorkloadResponse({
            codex_session_runtime_context: sessionRuntimeContext(),
            codex_session_terminalization: sessionTerminalization({
              unknown_terminalization_field: digest('f'),
            }),
          }),
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher: { startFromMaterialization: vi.fn() },
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-unknown-terminalization-field',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_generation_workload_unsupported',
    });
  });

  it('restores capsule inputs before launch and packages output capsule before successful terminalization', async () => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-'));
    const events: string[] = [];
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    const inputCapsuleId = '22222222-2222-4222-8222-222222222222';
    const outputCapsuleId = '33333333-3333-4333-8333-333333333333';
    const outputMemoryBundleRef = 'artifact://internal/codex_memory_bundle/codex_session/session-1/memory-2';
    const outputEnvironmentManifestRef = 'artifact://internal/codex_environment_manifest/codex_session/session-1/env-2';
    const outputCapsule = {
      id: outputCapsuleId,
      codex_session_id: 'session-1',
      created_from_turn_id: 'session-turn-1',
      sequence: 2,
      artifact_ref: `artifact://internal/codex_runtime_capsule/codex_session/session-1/${outputCapsuleId}`,
      digest: digest('c'),
      size_bytes: '123',
      manifest_digest: digest('d'),
      thread_state_digest: digest('e'),
      memory_state_digest: digest('f'),
      environment_manifest_digest: digest('1'),
      codex_thread_id_digest: codexThreadDigest('thread-1'),
      codex_cli_version: '0.133.0',
      app_server_protocol_digest: digest('2'),
      runtime_profile_revision_id: 'profile-rev-1',
      trusted_runtime_manifest_digest: digest('3'),
      credential_binding_lineage_digest: digest('4'),
      created_by_actor_id: 'worker-1',
      created_at: '2026-05-23T00:00:00.000Z',
    };
    const terminalization = sessionTerminalization({
      expected_input_capsule_digest: digest('b'),
      input_capsule_id: inputCapsuleId,
      input_capsule_digest: digest('b'),
      input_capsule_ref: `artifact://internal/codex_runtime_capsule/codex_session/session-1/${inputCapsuleId}`,
      input_memory_bundle_ref: 'artifact://internal/codex_memory_bundle/codex_session/session-1/memory-1',
      input_memory_bundle_digest: digest('5'),
      input_environment_manifest_ref: 'artifact://internal/codex_environment_manifest/codex_session/session-1/env-1',
      input_environment_manifest_digest: digest('6'),
    });
    const controlPlaneClient = {
      registerWorker: async (input: Record<string, unknown>) => {
        sealedEnvelope = await sealCodexLaunchTokenEnvelope({
          plaintext_launch_token: 'launch-token-secret',
          runtime_job_id: 'runtime-job-1',
          launch_lease_id: 'lease-1',
          envelope_id: 'envelope-1',
          worker_id: 'worker-1',
          worker_public_key_material: String(input.session_public_key_material),
          key_id: String(input.session_public_key_id),
          expires_at: '2026-05-23T00:10:00.000Z',
        });
        return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
      },
      heartbeatWorker: async () => ({}),
      pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
      acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
      getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
      claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
      fetchRuntimeJobWorkload: async () =>
        generationWorkloadResponse({
          codex_session_runtime_context: sessionRuntimeContext({
            expected_input_capsule_digest: digest('b'),
            continuation: {
              kind: 'resume_thread',
              codex_thread_id: 'thread-1',
              codex_thread_id_digest: codexThreadDigest('thread-1'),
            },
          }),
          codex_session_terminalization: terminalization,
        }),
      materializeRuntimeJob: async () => materialization(),
      startRuntimeJob: async () => {
        events.push('runtime-job-start');
        return { runtime_job: { ...runtimeJob(), status: 'running' } };
      },
      markCodexSessionRunnerOwner: async () => ({}),
      appendRuntimeJobEvent: async () => ({}),
      uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => ({
        artifact: {
          kind: input.kind,
          name: input.name,
          content_type: input.content_type,
          digest: input.digest,
          internal_ref: runtimeArtifactRef('runtime-job-1', input.kind),
        },
      }),
      terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
        events.push('terminalize');
        terminalized.push(input);
        return {};
      },
    };
    const launcher = {
      startFromMaterialization: vi.fn(async (_materialization: CodexLaunchMaterialization, input?: Record<string, unknown>) => {
        events.push('launcher-called');
        expect(input).toMatchObject({ writeConfigAndAuth: false });
        await mkdir(join(workerTempRoot, 'codex-home'), { recursive: true });
        await mkdir(join(workerTempRoot, 'artifacts'), { recursive: true });
        await (input?.beforeAppServerStart as (paths: { codexHomeHostPath: string; codexHomeContainerPath: string; artifactHostPath: string }) => Promise<void>)({
          codexHomeHostPath: join(workerTempRoot, 'codex-home'),
          codexHomeContainerPath: '/codex-home',
          artifactHostPath: join(workerTempRoot, 'artifacts'),
        });
        events.push('app-server-start');
        await (input?.afterAppServerStart as (paths: { codexHomeHostPath: string; codexHomeContainerPath: string; artifactHostPath: string }) => Promise<void>)?.({
          codexHomeHostPath: join(workerTempRoot, 'codex-home'),
          codexHomeContainerPath: '/codex-home',
          artifactHostPath: join(workerTempRoot, 'artifacts'),
        });
        return {
          endpoint: 'docker-exec:' + digest('8'),
          createTransport: () => recordingAppServerTransport(generatedSpec(), events),
          containerWorkspacePath: '/workspace' as const,
          capsuleHookInput: {
            codexHomeHostPath: join(workerTempRoot, 'codex-home'),
            codexHomeContainerPath: '/codex-home',
            artifactHostPath: join(workerTempRoot, 'artifacts'),
          },
          publicEvidence: {
            runtime_profile_id: 'profile-1',
            runtime_profile_revision_id: 'profile-rev-1',
            runtime_profile_digest: digest('7'),
            runtime_target_kind: 'generation' as const,
            source_access_mode: 'artifact_only' as const,
            environment: 'test' as const,
            launch_lease_id: 'lease-1',
            worker_id: 'worker-1',
            docker_image_digest: digest('4'),
            container_id_digest: digest('9'),
            app_server_effective_config_digest: digest('6'),
            docker_policy_self_check_digest: digest('a'),
            app_server_attempted: true as const,
            selected_execution_mode: 'app_server' as const,
          },
          close: async () => undefined,
        };
      }),
    };
    const capsuleManager = {
      restore: vi.fn(async (input: { inputCapsuleId: string }) => {
        events.push(`restore:${input.inputCapsuleId}`);
      }),
      repairLocator: vi.fn(async (input: { codexThreadIdDigest: string }) => {
        events.push(`repair:${input.codexThreadIdDigest}`);
      }),
      package: vi.fn(async () => {
        events.push('package');
        return {
          capsule: outputCapsule,
          outputMemoryBundleRef,
          outputMemoryBundleDigest: digest('7'),
          memoryDeltaArtifactRef: 'artifact://internal/codex_memory_delta/codex_session/session-1/memory-delta-2',
          memoryDeltaDigest: digest('8'),
          outputEnvironmentManifestRef,
          outputEnvironmentManifestDigest: digest('9'),
        };
      }),
    };
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot,
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient,
      launcher,
      capsuleManager,
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-capsule',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(events.indexOf(`restore:${inputCapsuleId}`)).toBeLessThan(events.indexOf('app-server-start'));
    expect(events.indexOf(`repair:${codexThreadDigest('thread-1')}`)).toBeGreaterThan(events.indexOf('app-server-start'));
    expect(events.indexOf(`repair:${codexThreadDigest('thread-1')}`)).toBeLessThan(events.indexOf('thread/resume'));
    expect(events).not.toContain('thread/start');
    expect(events).toContain('thread/resume');
    expect(capsuleManager.repairLocator).toHaveBeenCalledWith(expect.objectContaining({ codexHomeContainerPath: '/codex-home' }));
    expect(events.indexOf('package')).toBeLessThan(events.indexOf('terminalize'));
    expect(terminalized[0]).toMatchObject({
      terminal_status: 'succeeded',
      terminal_result_json: {
        output_capsule: outputCapsule,
        output_memory_bundle_ref: outputMemoryBundleRef,
        output_memory_bundle_digest: digest('7'),
        memory_delta_artifact_ref: 'artifact://internal/codex_memory_delta/codex_session/session-1/memory-delta-2',
        memory_delta_digest: digest('8'),
        output_environment_manifest_ref: outputEnvironmentManifestRef,
        output_environment_manifest_digest: digest('9'),
      },
    });
  });

  it('restores a capsule-backed fork and starts a fresh thread without locator repair', async () => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-'));
    const events: string[] = [];
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    const inputCapsuleId = '22222222-2222-4222-8222-222222222222';
    const outputCapsuleId = '33333333-3333-4333-8333-333333333333';
    const outputCapsule = {
      id: outputCapsuleId,
      codex_session_id: 'session-1',
      created_from_turn_id: 'session-turn-1',
      sequence: 2,
      artifact_ref: `artifact://internal/codex_runtime_capsule/codex_session/session-1/${outputCapsuleId}`,
      digest: digest('c'),
      size_bytes: '123',
      manifest_digest: digest('d'),
      thread_state_digest: digest('e'),
      memory_state_digest: digest('f'),
      environment_manifest_digest: digest('1'),
      codex_thread_id_digest: codexThreadDigest('thread-1'),
      codex_cli_version: '0.133.0',
      app_server_protocol_digest: digest('2'),
      runtime_profile_revision_id: 'profile-rev-1',
      trusted_runtime_manifest_digest: digest('3'),
      credential_binding_lineage_digest: digest('4'),
      created_by_actor_id: 'worker-1',
      created_at: '2026-05-23T00:00:00.000Z',
    };
    const terminalization = sessionTerminalization({
      expected_input_capsule_digest: digest('b'),
      input_capsule_id: inputCapsuleId,
      input_capsule_digest: digest('b'),
      input_capsule_ref: `artifact://internal/codex_runtime_capsule/codex_session/session-1/${inputCapsuleId}`,
      input_memory_bundle_ref: 'artifact://internal/codex_memory_bundle/codex_session/session-1/memory-1',
      input_memory_bundle_digest: digest('5'),
      input_environment_manifest_ref: 'artifact://internal/codex_environment_manifest/codex_session/session-1/env-1',
      input_environment_manifest_digest: digest('6'),
    });
    const controlPlaneClient = {
      registerWorker: async (input: Record<string, unknown>) => {
        sealedEnvelope = await sealCodexLaunchTokenEnvelope({
          plaintext_launch_token: 'launch-token-secret',
          runtime_job_id: 'runtime-job-1',
          launch_lease_id: 'lease-1',
          envelope_id: 'envelope-1',
          worker_id: 'worker-1',
          worker_public_key_material: String(input.session_public_key_material),
          key_id: String(input.session_public_key_id),
          expires_at: '2026-05-23T00:10:00.000Z',
        });
        return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
      },
      heartbeatWorker: async () => ({}),
      pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
      acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
      getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
      claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
      fetchRuntimeJobWorkload: async () =>
        generationWorkloadResponse({
          codex_session_runtime_context: sessionRuntimeContext({
            expected_input_capsule_digest: digest('b'),
            continuation: { kind: 'start_thread' },
          }),
          codex_session_terminalization: terminalization,
        }),
      materializeRuntimeJob: async () => materialization(),
      startRuntimeJob: async () => {
        events.push('runtime-job-start');
        return { runtime_job: { ...runtimeJob(), status: 'running' } };
      },
      markCodexSessionRunnerOwner: async () => ({}),
      appendRuntimeJobEvent: async () => ({}),
      uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => ({
        artifact: {
          kind: input.kind,
          name: input.name,
          content_type: input.content_type,
          digest: input.digest,
          internal_ref: runtimeArtifactRef('runtime-job-1', input.kind),
        },
      }),
      terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
        events.push('terminalize');
        terminalized.push(input);
        return {};
      },
    };
    const launcher = {
      startFromMaterialization: vi.fn(async (_materialization: CodexLaunchMaterialization, input?: Record<string, unknown>) => {
        events.push('launcher-called');
        expect(input).toMatchObject({ writeConfigAndAuth: false });
        await mkdir(join(workerTempRoot, 'codex-home'), { recursive: true });
        await mkdir(join(workerTempRoot, 'artifacts'), { recursive: true });
        await (input?.beforeAppServerStart as (paths: { codexHomeHostPath: string; codexHomeContainerPath: string; artifactHostPath: string }) => Promise<void>)({
          codexHomeHostPath: join(workerTempRoot, 'codex-home'),
          codexHomeContainerPath: '/codex-home',
          artifactHostPath: join(workerTempRoot, 'artifacts'),
        });
        events.push('app-server-start');
        await (input?.afterAppServerStart as (paths: { codexHomeHostPath: string; codexHomeContainerPath: string; artifactHostPath: string }) => Promise<void>)?.({
          codexHomeHostPath: join(workerTempRoot, 'codex-home'),
          codexHomeContainerPath: '/codex-home',
          artifactHostPath: join(workerTempRoot, 'artifacts'),
        });
        return {
          endpoint: 'docker-exec:' + digest('8'),
          createTransport: () => recordingAppServerTransport(generatedSpec(), events),
          containerWorkspacePath: '/workspace' as const,
          capsuleHookInput: {
            codexHomeHostPath: join(workerTempRoot, 'codex-home'),
            codexHomeContainerPath: '/codex-home',
            artifactHostPath: join(workerTempRoot, 'artifacts'),
          },
          publicEvidence: {
            runtime_profile_id: 'profile-1',
            runtime_profile_revision_id: 'profile-rev-1',
            runtime_profile_digest: digest('7'),
            runtime_target_kind: 'generation' as const,
            source_access_mode: 'artifact_only' as const,
            environment: 'test' as const,
            launch_lease_id: 'lease-1',
            worker_id: 'worker-1',
            docker_image_digest: digest('4'),
            container_id_digest: digest('9'),
            app_server_effective_config_digest: digest('6'),
            docker_policy_self_check_digest: digest('a'),
            app_server_attempted: true as const,
            selected_execution_mode: 'app_server' as const,
          },
          close: async () => undefined,
        };
      }),
    };
    const capsuleManager = {
      restore: vi.fn(async (input: { inputCapsuleId: string }) => {
        events.push(`restore:${input.inputCapsuleId}`);
      }),
      repairLocator: vi.fn(async () => {
        events.push('repair');
      }),
      package: vi.fn(async () => {
        events.push('package');
        return {
          capsule: outputCapsule,
          outputMemoryBundleRef: 'artifact://internal/codex_memory_bundle/codex_session/session-1/memory-2',
          outputMemoryBundleDigest: digest('7'),
          outputEnvironmentManifestRef: 'artifact://internal/codex_environment_manifest/codex_session/session-1/env-2',
          outputEnvironmentManifestDigest: digest('9'),
        };
      }),
    };
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot,
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient,
      launcher,
      capsuleManager,
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-capsule-fork',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(events.indexOf(`restore:${inputCapsuleId}`)).toBeLessThan(events.indexOf('app-server-start'));
    expect(events).not.toContain('repair');
    expect(capsuleManager.repairLocator).not.toHaveBeenCalled();
    expect(events).toContain('thread/start');
    expect(events).not.toContain('thread/resume');
    expect(events.indexOf('package')).toBeLessThan(events.indexOf('terminalize'));
    expect(terminalized[0]).toMatchObject({
      terminal_status: 'succeeded',
      terminal_result_json: {
        output_capsule: outputCapsule,
      },
    });
  });

  it('defensively rejects resume turns that omit input capsule restore context', async () => {
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () =>
          generationWorkloadResponse({
            codex_session_runtime_context: sessionRuntimeContext({
              continuation: {
                kind: 'resume_thread',
                codex_thread_id: 'thread-1',
                codex_thread_id_digest: codexThreadDigest('thread-1'),
              },
            }),
            codex_session_terminalization: sessionTerminalization(),
          }),
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher: { startFromMaterialization: vi.fn() },
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-missing-restore',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_runtime_capsule_missing',
    });
  });

  it('fails closed when output capsule packaging fails after a Codex turn', async () => {
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    const uploadedArtifacts: Record<string, unknown>[] = [];
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () =>
          generationWorkloadResponse({
            codex_session_runtime_context: sessionRuntimeContext(),
            codex_session_terminalization: sessionTerminalization(),
          }),
        materializeRuntimeJob: async () => materialization(),
        startRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'running' } }),
        markCodexSessionRunnerOwner: async () => ({}),
        appendRuntimeJobEvent: async () => ({}),
        uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          uploadedArtifacts.push(input);
          return {
            artifact: {
              kind: input.kind,
              name: input.name,
              content_type: input.content_type,
              digest: input.digest,
              internal_ref: runtimeArtifactRef('runtime-job-1', input.kind),
            },
          };
        },
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(async () => ({
          endpoint: 'docker-exec:' + digest('8'),
          createTransport: () => appServerTransport(generatedSpec()),
          containerWorkspacePath: '/workspace' as const,
          capsuleHookInput: {
            codexHomeHostPath: '/tmp/codex-home-redacted',
            codexHomeContainerPath: '/codex-home',
            artifactHostPath: '/tmp/artifacts-redacted',
          },
          publicEvidence: {
            runtime_profile_id: 'profile-1',
            runtime_profile_revision_id: 'profile-rev-1',
            runtime_profile_digest: digest('7'),
            runtime_target_kind: 'generation' as const,
            source_access_mode: 'artifact_only' as const,
            environment: 'test' as const,
            launch_lease_id: 'lease-1',
            worker_id: 'worker-1',
            docker_image_digest: digest('4'),
            container_id_digest: digest('9'),
            app_server_effective_config_digest: digest('6'),
            docker_policy_self_check_digest: digest('a'),
            app_server_attempted: true as const,
            selected_execution_mode: 'app_server' as const,
          },
          close: async () => undefined,
        })),
      },
      capsuleManager: {
        restore: vi.fn(),
        package: vi.fn(async () => {
          throw new Error('codex_runtime_capsule_unknown_path');
        }),
      },
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-package-failure',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_runtime_capsule_unknown_path',
    });
    expect(uploadedArtifacts.find((artifact) => artifact.kind === 'startup_failure_evidence')).toMatchObject({
      metadata_json: {
        failure_stage: 'generation_capsule_packaging',
        failure_subcode: 'runtime_capsule_unknown_path',
      },
    });
  });

  it('keeps a CodexSession runner open for intermediate success and attaches resume turns without relaunching', async () => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-'));
    const calls: string[] = [];
    const transportMethods: string[] = [];
    const terminalized: Record<string, unknown>[] = [];
    const heartbeatPayloads: Record<string, unknown>[] = [];
    const closed = vi.fn(async () => undefined);
    const packagedTurns: string[] = [];
    let sealedEnvelope: SealedEnvelope | undefined;
    let pollCount = 0;
    let nowMs = Date.parse('2026-05-23T00:00:00.000Z');
    const startContext = sessionRuntimeContext();
    const resumeContext = sessionRuntimeContext({
      codex_session_turn_id: 'session-turn-2',
      lease_id: 'session-lease-2',
      lease_epoch: 2,
      runner_runtime_job_id: 'runtime-job-1',
      runner_launch_lease_id: 'lease-1',
      continuation: {
        kind: 'resume_thread',
        codex_thread_id: 'thread-1',
        codex_thread_id_digest: codexThreadDigest('thread-1'),
      },
    });
    const runtimeJob2 = { ...runtimeJob(), id: 'runtime-job-2', job_request_id: 'job-request-2', launch_lease_id: 'lease-2' };
    const controlPlaneClient = {
      registerWorker: async (input: Record<string, unknown>) => {
        calls.push('register');
        sealedEnvelope = await sealCodexLaunchTokenEnvelope({
          plaintext_launch_token: 'launch-token-secret',
          runtime_job_id: 'runtime-job-1',
          launch_lease_id: 'lease-1',
          envelope_id: 'envelope-1',
          worker_id: 'worker-1',
          worker_public_key_material: String(input.session_public_key_material),
          key_id: String(input.session_public_key_id),
          expires_at: '2026-05-23T00:10:00.000Z',
        });
        return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: '2026-05-23T00:10:00.000Z' };
      },
      heartbeatWorker: async (_workerId: string, input: Record<string, unknown>) => {
        calls.push('heartbeat');
        heartbeatPayloads.push(input);
        return {};
      },
      pollRuntimeJobs: async () => {
        calls.push('poll');
        pollCount += 1;
        return {
          runtime_jobs:
            pollCount === 1
              ? [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }]
              : [{ runtime_job: runtimeJob2 }],
        };
      },
      acceptRuntimeJob: async (_workerId: string, jobId: string) => {
        calls.push(`accept:${jobId}`);
        return { runtime_job: { ...(jobId === 'runtime-job-1' ? runtimeJob() : runtimeJob2), status: 'accepted' } };
      },
      getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
      claimLaunchTokenEnvelope: async (_workerId: string, jobId: string) => {
        calls.push(`claim:${jobId}`);
        return { envelope: sealedEnvelope };
      },
      fetchRuntimeJobWorkload: async (_workerId: string, jobId: string) => {
        calls.push(`workload:${jobId}`);
        return generationWorkloadResponse({
          runtime_job_id: jobId,
          codex_session_runtime_context: jobId === 'runtime-job-1' ? startContext : resumeContext,
          codex_session_terminalization: sessionTerminalization({
            lease_token: `token-${jobId}`,
            ...(jobId === 'runtime-job-1'
              ? {}
              : {
                  codex_session_turn_id: 'session-turn-2',
                  expected_input_capsule_digest: digest('1'),
                  input_capsule_id: '11111111-1111-4111-8111-111111111111',
                  input_capsule_digest: digest('1'),
                  input_capsule_ref:
                    'artifact://internal/codex_runtime_capsule/codex_session/session-1/11111111-1111-4111-8111-111111111111',
                  input_memory_bundle_ref: 'artifact://internal/codex_memory_bundle/codex_session/session-1/memory-1',
                  input_memory_bundle_digest: digest('b'),
                  input_environment_manifest_ref: 'artifact://internal/codex_environment_manifest/codex_session/session-1/env-1',
                  input_environment_manifest_digest: digest('d'),
                }),
          }),
        });
      },
      materializeRuntimeJob: async (_workerId: string, jobId: string) => {
        calls.push(`materialize:${jobId}`);
        return materialization();
      },
      startRuntimeJob: async (_workerId: string, jobId: string) => {
        calls.push(`start:${jobId}`);
        return { runtime_job: { ...(jobId === 'runtime-job-1' ? runtimeJob() : runtimeJob2), status: 'running' } };
      },
      markCodexSessionRunnerOwner: async (_workerId: string, jobId: string, input: Record<string, unknown>) => {
        calls.push(`mark-runner:${jobId}`);
        expect(input).toMatchObject({
          session_id: 'session-1',
          runner_launch_lease_id: 'lease-1',
          runner_runtime_job_id: 'runtime-job-1',
        });
        return {};
      },
      attachCodexSessionRunnerRuntimeJob: async (_workerId: string, jobId: string, input: Record<string, unknown>) => {
        calls.push(`attach-runner:${jobId}`);
        expect(input).toMatchObject({
          session_id: 'session-1',
          runner_launch_lease_id: 'lease-1',
          runner_runtime_job_id: 'runtime-job-1',
          attach_idempotency_key: codexCanonicalDigest({ runtime_job_id: 'runtime-job-2', operation: 'attach_session_runner' }),
        });
        return { runtime_job: { ...runtimeJob2, status: 'running' } };
      },
      appendRuntimeJobEvent: async (_workerId: string, jobId: string) => {
        calls.push(`event:${jobId}`);
        return {};
      },
      uploadRuntimeJobArtifact: async (_workerId: string, jobId: string, input: Record<string, unknown>) => ({
        artifact: {
          kind: input.kind,
          name: input.name,
          content_type: input.content_type,
          digest: input.digest,
          internal_ref: runtimeArtifactRef(jobId, input.kind),
        },
      }),
      terminalizeRuntimeJob: async (_workerId: string, jobId: string, input: Record<string, unknown>) => {
        calls.push(`terminal:${jobId}`);
        terminalized.push(input);
        return {};
      },
    };
    const launcher = {
      startFromMaterialization: vi.fn(async () => ({
        endpoint: 'docker-exec:' + digest('8'),
        createTransport: () => recordingAppServerTransport(generatedSpec(), transportMethods),
        containerWorkspacePath: '/workspace' as const,
        capsuleHookInput: {
          codexHomeHostPath: join(workerTempRoot, 'codex-home'),
          codexHomeContainerPath: '/codex-home',
          artifactHostPath: join(workerTempRoot, 'artifacts'),
        },
        publicEvidence: {
          runtime_profile_id: 'profile-1',
          runtime_profile_revision_id: 'profile-rev-1',
          runtime_profile_digest: digest('7'),
          runtime_target_kind: 'generation' as const,
          source_access_mode: 'artifact_only' as const,
          environment: 'test' as const,
          launch_lease_id: 'lease-1',
          worker_id: 'worker-1',
          docker_image_digest: digest('4'),
          container_id_digest: digest('9'),
          app_server_effective_config_digest: digest('6'),
          docker_policy_self_check_digest: digest('a'),
          app_server_attempted: true as const,
          selected_execution_mode: 'app_server' as const,
        },
        close: closed,
      })),
    };
    const capsuleManager = {
      restore: vi.fn(),
      package: vi.fn(async (input: { codexSessionTurnId: string }) => {
        packagedTurns.push(input.codexSessionTurnId);
        const sequence = packagedTurns.length;
        const id =
          sequence === 1
            ? '11111111-1111-4111-8111-111111111111'
            : '22222222-2222-4222-8222-222222222222';
        const capsule = {
          id,
          codex_session_id: 'session-1',
          created_from_turn_id: input.codexSessionTurnId,
          sequence,
          artifact_ref: `artifact://internal/codex_runtime_capsule/codex_session/session-1/${id}`,
          digest: digest(sequence === 1 ? '1' : '2'),
          size_bytes: '123',
          manifest_digest: digest(sequence === 1 ? '3' : '4'),
          thread_state_digest: digest('5'),
          memory_state_digest: digest('6'),
          environment_manifest_digest: digest('7'),
          codex_thread_id_digest: codexThreadDigest('thread-1'),
          codex_cli_version: '0.133.0',
          app_server_protocol_digest: digest('8'),
          runtime_profile_revision_id: 'profile-rev-1',
          trusted_runtime_manifest_digest: digest('9'),
          credential_binding_lineage_digest: digest('a'),
          created_by_actor_id: 'worker-1',
          created_at: '2026-05-23T00:00:00.000Z',
        };
        return {
          capsule,
          outputMemoryBundleRef: `artifact://internal/codex_memory_bundle/codex_session/session-1/memory-${sequence}`,
          outputMemoryBundleDigest: digest(sequence === 1 ? 'b' : 'c'),
          outputEnvironmentManifestRef: `artifact://internal/codex_environment_manifest/codex_session/session-1/env-${sequence}`,
          outputEnvironmentManifestDigest: digest(sequence === 1 ? 'd' : 'e'),
        };
      }),
    };
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot,
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient,
      launcher,
      capsuleManager,
      scavenger: async () => undefined,
      now: () => new Date(nowMs).toISOString(),
      nonceFactory: () => `nonce-${calls.length}`,
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });
    nowMs += 16_000;
    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(heartbeatPayloads[0]).toMatchObject({ active_lease_count: 0 });
    expect(heartbeatPayloads[1]).toMatchObject({
      active_lease_count: 1,
      codex_session_runners: [
        {
          session_id: 'session-1',
          runner_launch_lease_id: 'lease-1',
          runner_runtime_job_id: 'runtime-job-1',
          runner_expires_at: '2026-05-23T00:10:16.000Z',
        },
      ],
    });
    expect(launcher.startFromMaterialization).toHaveBeenCalledTimes(1);
    expect(calls).toContain('mark-runner:runtime-job-1');
    expect(calls).toContain('attach-runner:runtime-job-2');
    expect(calls).not.toContain('claim:runtime-job-2');
    expect(calls).not.toContain('materialize:runtime-job-2');
    expect(calls).not.toContain('start:runtime-job-2');
    expect(closed).not.toHaveBeenCalled();
    expect(transportMethods.filter((method) => method === 'thread/start')).toHaveLength(1);
    expect(transportMethods.filter((method) => method === 'thread/resume')).toHaveLength(1);
    expect(terminalized).toHaveLength(2);
    expect(terminalized[0]?.terminal_result_json).toMatchObject({
      codex_session_thread: {
        codex_thread_id: 'thread-1',
        codex_thread_id_digest: codexThreadDigest('thread-1'),
        app_server_turn_id: 'turn-1',
      },
      output_capsule: {
        created_from_turn_id: 'session-turn-1',
      },
    });
    expect(terminalized[1]?.terminal_result_json).toMatchObject({
      codex_session_thread: {
        codex_thread_id: 'thread-1',
        codex_thread_id_digest: codexThreadDigest('thread-1'),
        app_server_turn_id: 'turn-2',
      },
      output_capsule: {
        created_from_turn_id: 'session-turn-2',
      },
    });
    expect(JSON.stringify(terminalized)).not.toContain('launch-token-secret');
  });

  it('rejects generation workload when session runtime context and terminalization are not paired', async () => {
    const terminalized: Record<string, unknown>[] = [];
    let sealedEnvelope: SealedEnvelope | undefined;
    const materializeRuntimeJob = vi.fn(async () => materialization());
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () =>
          generationWorkloadResponse({
            codex_session_runtime_context: sessionRuntimeContext(),
          }),
        materializeRuntimeJob,
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher: { startFromMaterialization: vi.fn() },
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-1',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(materializeRuntimeJob).not.toHaveBeenCalled();
    expect(terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_generation_workload_unsupported',
    });
    expect(JSON.stringify(terminalized[0])).not.toContain('launch-token-secret');
  });

  it('runs one assigned run-execution job by downloading the workspace bundle and terminalizing package evidence', async () => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-remote-run-worker-'));
    const bundleManifest = createWorkspaceBundleManifest({
      bundleId: 'workspace-bundle-run-1',
      createdAt: '2026-05-23T00:00:00.000Z',
      allowedPaths: ['**'],
      forbiddenPaths: [],
      files: [{ path: 'README.md', content: '# Remote run\n' }],
    });
    const bundleArchive = createWorkspaceBundleArchive({
      manifest: bundleManifest,
      files: [{ path: 'README.md', content: '# Remote run\n' }],
    });
    const bundleArchivePath = join(workerTempRoot, 'bundle.archive');
    await writeFile(bundleArchivePath, bundleArchive);
    const archiveDigest = workspaceBundleArchiveDigest(bundleArchive);
    const manifestDigest = workspaceBundleManifestDigest(bundleManifest);
    const workload = runExecutionWorkload(archiveDigest, manifestDigest);
    let sealedEnvelope: SealedEnvelope | undefined;
    const calls: string[] = [];
    const uploadedArtifacts: Record<string, unknown>[] = [];
    const terminalized: Record<string, unknown>[] = [];
    const driverInputs: string[] = [];
    const driverObjectives: string[] = [];
    const outputCapsule = runExecutionOutputCapsule();
    const capsuleManager = runExecutionCapsuleManager(calls);
    const controlPlaneClient = {
      registerWorker: async (input: Record<string, unknown>) => {
        calls.push('register');
        sealedEnvelope = await sealCodexLaunchTokenEnvelope({
          plaintext_launch_token: 'launch-token-run-secret',
          runtime_job_id: 'runtime-job-run-1',
          launch_lease_id: 'lease-run-1',
          envelope_id: 'envelope-run-1',
          worker_id: 'worker-1',
          worker_public_key_material: String(input.session_public_key_material),
          key_id: String(input.session_public_key_id),
          expires_at: '2026-05-23T00:10:00.000Z',
        });
        return {
          worker: { session_epoch: 1 },
          session_token: 'session-1',
          session_expires_at: '2026-05-23T00:10:00.000Z',
        };
      },
      heartbeatWorker: async () => {
        calls.push('heartbeat');
        return {};
      },
      pollRuntimeJobs: async () => {
        calls.push('poll');
        return { runtime_jobs: [{ runtime_job: runExecutionRuntimeJob(archiveDigest, manifestDigest), envelope: { id: 'envelope-run-1' } }] };
      },
      acceptRuntimeJob: async () => {
        calls.push('accept');
        return { runtime_job: { ...runExecutionRuntimeJob(archiveDigest, manifestDigest), status: 'accepted' } };
      },
      getRuntimeJobControl: async () => {
        calls.push('control');
        return { control: { cancel_requested: false } };
      },
      claimLaunchTokenEnvelope: async () => {
        calls.push('claim');
        return { envelope: sealedEnvelope };
      },
      fetchRuntimeJobWorkload: async () => {
        calls.push('workload');
        return runExecutionWorkloadResponse(workload);
      },
      downloadWorkspaceBundle: async (_workerId: string, _jobId: string, bundleId: string, input: Record<string, unknown>) => {
        calls.push('download-bundle');
        expect(bundleId).toBe('workspace-bundle-run-1');
        expect(input.expectedArchiveDigest).toBe(archiveDigest);
        return {
          archive_path: bundleArchivePath,
          archive_digest: archiveDigest,
          size_bytes: bundleArchive.byteLength,
          content_type: 'application/vnd.forgeloop.workspace-bundle',
        };
      },
      materializeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
        calls.push('materialize');
        expect(input.launch_token).toBe('launch-token-run-secret');
        return runExecutionMaterialization();
      },
      startRuntimeJob: async () => {
        calls.push('start');
        return { runtime_job: { ...runExecutionRuntimeJob(archiveDigest, manifestDigest), status: 'running' } };
      },
      appendRuntimeJobEvent: async () => {
        calls.push('event');
        return {};
      },
      uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
        calls.push(`artifact:${input.kind}`);
        uploadedArtifacts.push(input);
        return {
          artifact: {
            kind: input.kind,
            name: input.name,
            content_type: input.content_type,
            digest: input.digest,
            internal_ref: runtimeArtifactRef('runtime-job-run-1', input.kind),
          },
        };
      },
      terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
        calls.push('terminal');
        terminalized.push(input);
        return {};
      },
    };
    const launcher = runExecutionLauncher(workerTempRoot, calls);
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot,
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['run_execution'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient,
      launcher,
      capsuleManager,
      scavenger: async () => {
        calls.push('scavenge');
      },
      runExecutionDriverFactory: ({ workspacePath }) => ({
        kind: 'app_server',
        async *startRun() {
          throw new Error('startRun must not be called for workflow execution');
        },
        async *resumeRun(input) {
          driverInputs.push(input.workspacePath);
          driverObjectives.push(input.runSpec.objective);
          expect(input.runtimeMetadata).toMatchObject({ codex_thread_id: 'thread-1' });
          await writeFile(join(workspacePath, 'README.md'), '# Remote run changed\n');
          await mkdir(join(workspacePath, '.forgeloop'), { recursive: true });
          await writeFile(join(workspacePath, '.forgeloop', 'repo-owned.toml'), 'setting = true\n');
          yield {
            kind: 'terminal',
            status: 'succeeded',
            summary: 'Remote package run completed.',
            runtimeMetadata: { active_turn_id: 'app-server-turn-1', codex_thread_id: 'thread-1' },
          } satisfies CodexDriverStreamItem;
        },
        sendInput: async () => ({}),
        cancelRun: async () => ({}),
        close: async () => undefined,
      }),
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => `nonce-${calls.length}`,
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(calls.indexOf('restore')).toBeLessThan(calls.indexOf('docker-start'));
    expect(calls.indexOf('repair')).toBeGreaterThan(calls.indexOf('docker-start'));
    expect(calls).toEqual(
      expect.arrayContaining([
        'accept',
        'claim',
        'workload',
        'download-bundle',
        'materialize',
        'restore',
        'docker-start',
        'repair',
        'start',
        'artifact:run_execution_patch',
        'package',
        'terminal',
      ]),
    );
    expect(launcher.startFromMaterialization).toHaveBeenCalledWith(
      runExecutionMaterialization(),
      expect.objectContaining({ workerSessionToken: 'session-1', terminalizeLaunchLeaseOnClose: false, originalWorkspacePath: expect.any(String) }),
    );
    const [, startOptions] = launcher.startFromMaterialization.mock.calls[0]!;
    const jobRoot = String(startOptions.taskWorkspaceRoot);
    expect(driverInputs).toEqual(['/workspace']);
    expect(driverObjectives).toEqual(['Implement the package and report changed files.']);
    expect(uploadedArtifacts.map((entry) => entry.kind)).toContain('run_execution_patch');
    const patchUpload = uploadedArtifacts.find((entry) => entry.kind === 'run_execution_patch');
    expect(patchUpload?.bytes).toEqual(
      Buffer.from('diff --git a/.forgeloop/repo-owned.toml b/.forgeloop/repo-owned.toml\ndiff --git a/README.md b/README.md\n'),
    );
    expect(patchUpload?.digest).toBe(rawDigest(patchUpload?.bytes as Uint8Array));
    expect(terminalized[0]).toMatchObject({
      launch_lease_id: 'lease-run-1',
      terminal_status: 'succeeded',
      reason_code: 'codex_runtime_job_succeeded',
      terminal_result_json: {
        task_kind: 'run_execution',
        output_schema_version: 'codex_run_execution_result.v1',
        execution_package_id: 'execution-package-1',
        execution_package_version: 7,
        run_session_id: 'run-session-1',
        workspace_bundle_digest: archiveDigest,
        workspace_bundle_manifest_digest: manifestDigest,
        mounted_task_workspace_digest: manifestDigest,
        changed_files: ['.forgeloop/repo-owned.toml', 'README.md'],
        patch_artifact: {
          content_type: 'text/x-diff',
          digest: workspaceBundleArchiveDigest(
            Buffer.from('diff --git a/.forgeloop/repo-owned.toml b/.forgeloop/repo-owned.toml\ndiff --git a/README.md b/README.md\n'),
          ),
          internal_ref: runtimeArtifactRef('runtime-job-run-1', 'run_execution_patch'),
        },
        runtime_evidence: expect.objectContaining({
          app_server_attempted: true,
          selected_execution_mode: 'app_server',
          runtime_target_kind: 'run_execution',
        }),
        codex_session_thread: {
          codex_thread_id: 'thread-1',
          codex_thread_id_digest: codexThreadDigest('thread-1'),
          app_server_turn_id: 'app-server-turn-1',
        },
        output_capsule: outputCapsule,
        output_memory_bundle_ref: 'artifact://internal/codex_memory_bundle/codex_session/session-1/output-memory',
        output_memory_bundle_digest: digest('b'),
        output_environment_manifest_ref: 'artifact://internal/codex_environment_manifest/codex_session/session-1/output-environment',
        output_environment_manifest_digest: digest('c'),
        codex_session_turn_id: 'session-turn-1',
      },
    });
    expect(JSON.stringify(terminalized[0])).not.toContain('launch-token-run-secret');
    expect(JSON.stringify(terminalized[0])).not.toContain(workerTempRoot);
    await expect(stat(jobRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(stat(join(workerTempRoot, 'runtime-job-run-1'))).resolves.toMatchObject({ mode: expect.any(Number) });
  });

  it.each([
    [
      'missing codex_session_runtime_context',
      (workload: CodexRunExecutionWorkloadV1) => ({
        ...workload,
        codex_session_runtime_context: undefined,
      }),
    ],
    [
      'start_thread continuation',
      (workload: CodexRunExecutionWorkloadV1) => ({
        ...workload,
        codex_session_runtime_context: {
          ...workload.codex_session_runtime_context!,
          continuation: { kind: 'start_thread' },
        },
      }),
    ],
    [
      'input capsule digest mismatch',
      (workload: CodexRunExecutionWorkloadV1) => ({
        ...workload,
        codex_session_terminalization: {
          ...workload.codex_session_terminalization!,
          input_capsule_digest: digest('9'),
        },
      }),
    ],
    [
      'worker session digest mismatch',
      (workload: CodexRunExecutionWorkloadV1) => ({
        ...workload,
        codex_session_runtime_context: {
          ...workload.codex_session_runtime_context!,
          worker_session_digest: digest('9'),
        },
      }),
    ],
    [
      'thread digest mismatch',
      (workload: CodexRunExecutionWorkloadV1) => ({
        ...workload,
        codex_session_runtime_context: {
          ...workload.codex_session_runtime_context!,
          continuation: {
            ...workload.codex_session_runtime_context!.continuation,
            codex_thread_id_digest: codexThreadDigest('thread-2'),
          },
        },
      }),
    ],
  ])('fails closed before workspace acquisition for run-execution continuity mismatch: %s', async (_name, mutateWorkload) => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-remote-run-worker-continuity-'));
    const fixture = await runExecutionBundleFixture(workerTempRoot);
    const harness = await createRunExecutionHarness({
      tempSlug: 'forgeloop-remote-run-worker-continuity-harness-',
      workload: mutateWorkload(fixture.workload),
    });

    await expect(harness.worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(harness.calls).toEqual(expect.arrayContaining(['accept', 'claim', 'workload', 'artifact:startup_failure_evidence', 'terminal']));
    expect(harness.calls).not.toEqual(expect.arrayContaining(['download-bundle', 'materialize', 'restore', 'docker-start', 'start', 'package']));
    expect(harness.startRun).not.toHaveBeenCalled();
    expect(harness.resumeRun).not.toHaveBeenCalled();
    expect(harness.terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_runtime_job_unavailable',
    });
    expect(harness.uploadedArtifacts.find((artifact) => artifact.kind === 'startup_failure_evidence')).toMatchObject({
      metadata_json: {
        reason_code: 'codex_runtime_job_unavailable',
        failure_stage: 'run_execution_continuity_validation',
        failure_subcode: 'run_execution_continuity_mismatch',
        app_server_started: false,
      },
    });
    expect(JSON.stringify(harness.terminalized[0])).not.toContain('launch-token-run-secret');
    expect(JSON.stringify(harness.uploadedArtifacts)).not.toContain('artifact://internal/codex_runtime_capsule');
  });

  it('carries fix-loop lineage and restores the latest capsule before resuming run execution', async () => {
    const fixLoopWorkload = runExecutionWorkload(undefined, undefined, {
      previous_run_session_id: 'run-session-previous-1',
      previous_review_packet_id: 'review-packet-1',
      review_packet_digest: digest('a'),
    });
    expect(validateCodexRunExecutionWorkload(fixLoopWorkload)).toMatchObject({
      run_session_id: 'run-session-1',
      previous_run_session_id: 'run-session-previous-1',
      previous_review_packet_id: 'review-packet-1',
      review_packet_digest: digest('a'),
      codex_session_runtime_context: {
        continuation: { kind: 'resume_thread' },
        expected_input_capsule_digest: digest('b'),
        codex_session_id: 'session-1',
        codex_session_turn_id: 'session-turn-1',
        turn_group_status: 'complete',
      },
    });
    expect(() =>
      validateCodexRunExecutionWorkload({
        ...fixLoopWorkload,
        previous_review_packet_id: undefined,
      }),
    ).toThrow(/fix-loop lineage requires/);
    expect(() =>
      validateCodexRunExecutionWorkload({
        ...fixLoopWorkload,
        codex_session_runtime_context: {
          ...fixLoopWorkload.codex_session_runtime_context,
          expected_input_capsule_digest: undefined,
        },
      }),
    ).toThrow(/expected_input_capsule_digest/);
    const harness = await createRunExecutionHarness({
      tempSlug: 'forgeloop-remote-run-worker-fix-loop-',
      workloadFactory: (fixture) =>
        runExecutionWorkload(fixture.archiveDigest, fixture.manifestDigest, {
          previous_run_session_id: 'run-session-previous-1',
          previous_review_packet_id: 'review-packet-1',
          review_packet_digest: digest('a'),
        }),
      jobFactory: ({ fixture, workload }) => ({
        ...runExecutionRuntimeJob(fixture.archiveDigest, fixture.manifestDigest),
        input_json: workload,
        input_digest: codexCanonicalDigest(workload),
      }),
      resumeRun: async function* () {
        yield {
          kind: 'terminal',
          status: 'succeeded',
          summary: 'Fix loop completed.',
          runtimeMetadata: { active_turn_id: 'app-server-turn-1', codex_thread_id: 'thread-1' },
        } satisfies CodexDriverStreamItem;
      },
    });

    await expect(harness.worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(harness.calls.indexOf('restore')).toBeLessThan(harness.calls.indexOf('docker-start'));
    expect(harness.calls.indexOf('restore')).toBeLessThan(harness.calls.indexOf('terminal'));
    expect(harness.resumeRun).toHaveBeenCalledTimes(1);
  });

  it('fails closed before accept when polled run-execution lineage is incomplete', async () => {
    const harness = await createRunExecutionHarness({
      tempSlug: 'forgeloop-remote-run-worker-poll-lineage-',
      job: {
        ...runExecutionRuntimeJob(),
        workflow_id: undefined,
      },
    });

    await expect(harness.worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(harness.calls).toEqual(['register', 'scavenge', 'heartbeat', 'poll', 'control', 'artifact:startup_failure_evidence', 'terminal']);
    expect(harness.startRun).not.toHaveBeenCalled();
    expect(harness.resumeRun).not.toHaveBeenCalled();
    expect(harness.terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_runtime_job_unavailable',
    });
    expect(harness.uploadedArtifacts.find((artifact) => artifact.kind === 'startup_failure_evidence')).toMatchObject({
      metadata_json: {
        failure_stage: 'run_execution_continuity_validation',
        failure_subcode: 'run_execution_continuity_mismatch',
        app_server_started: false,
      },
    });
  });

  it('fails closed before workspace acquisition when accepted runtime-job lineage diverges', async () => {
    const harness = await createRunExecutionHarness({
      tempSlug: 'forgeloop-remote-run-worker-accepted-lineage-',
      acceptRuntimeJob: async () => ({
        runtime_job: {
          ...runExecutionRuntimeJob(),
          workflow_id: 'workflow-other',
          status: 'accepted',
        },
      }),
    });

    await expect(harness.worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(harness.calls).toEqual(['register', 'scavenge', 'heartbeat', 'poll', 'accept', 'control', 'artifact:startup_failure_evidence', 'terminal']);
    expect(harness.startRun).not.toHaveBeenCalled();
    expect(harness.resumeRun).not.toHaveBeenCalled();
    expect(harness.terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_runtime_job_unavailable',
    });
    expect(harness.uploadedArtifacts.find((artifact) => artifact.kind === 'startup_failure_evidence')).toMatchObject({
      metadata_json: {
        failure_stage: 'run_execution_continuity_validation',
        failure_subcode: 'run_execution_continuity_mismatch',
        app_server_started: false,
      },
    });
  });

  it('fails closed when accept does not return a runtime job for lineage verification', async () => {
    const harness = await createRunExecutionHarness({
      tempSlug: 'forgeloop-remote-run-worker-accept-missing-job-',
      acceptRuntimeJob: async () => ({}),
    });

    await expect(harness.worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(harness.calls).toEqual(expect.arrayContaining(['accept', 'artifact:startup_failure_evidence', 'terminal']));
    expect(harness.calls).not.toEqual(expect.arrayContaining(['claim', 'workload', 'download-bundle', 'materialize', 'restore', 'docker-start', 'start']));
    expect(harness.startRun).not.toHaveBeenCalled();
    expect(harness.resumeRun).not.toHaveBeenCalled();
    expect(harness.terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_runtime_job_unavailable',
    });
  });

  it('fails closed before workload fetch when claimed envelope lineage diverges', async () => {
    const harness = await createRunExecutionHarness({
      tempSlug: 'forgeloop-remote-run-worker-claim-lineage-',
      claimLaunchTokenEnvelope: async (envelope) => ({
        envelope: {
          ...envelope!,
          launch_lease_id: 'lease-other',
        },
      }),
    });

    await expect(harness.worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(harness.calls).toEqual(expect.arrayContaining(['accept', 'claim', 'artifact:startup_failure_evidence', 'terminal']));
    expect(harness.calls).not.toEqual(expect.arrayContaining(['workload', 'download-bundle', 'materialize', 'restore', 'docker-start', 'start', 'package']));
    expect(harness.startRun).not.toHaveBeenCalled();
    expect(harness.resumeRun).not.toHaveBeenCalled();
    expect(harness.terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_runtime_job_unavailable',
    });
    expect(harness.uploadedArtifacts.find((artifact) => artifact.kind === 'startup_failure_evidence')).toMatchObject({
      metadata_json: {
        failure_stage: 'run_execution_continuity_validation',
        failure_subcode: 'run_execution_continuity_mismatch',
        app_server_started: false,
      },
    });
  });

  it('fails closed before capsule restore when materialization lineage diverges', async () => {
    const harness = await createRunExecutionHarness({
      tempSlug: 'forgeloop-remote-run-worker-materialization-lineage-',
      materializeRuntimeJob: async () => ({
        ...runExecutionMaterialization(),
        lease_id: 'lease-other',
      }),
    });

    await expect(harness.worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(harness.calls).toEqual(expect.arrayContaining(['download-bundle', 'materialize', 'artifact:startup_failure_evidence', 'terminal']));
    expect(harness.calls).not.toEqual(expect.arrayContaining(['restore', 'docker-start', 'start', 'package']));
    expect(harness.startRun).not.toHaveBeenCalled();
    expect(harness.resumeRun).not.toHaveBeenCalled();
    expect(harness.terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_runtime_job_unavailable',
    });
    expect(harness.uploadedArtifacts.find((artifact) => artifact.kind === 'startup_failure_evidence')).toMatchObject({
      metadata_json: {
        failure_stage: 'launch_materialization',
        failure_subcode: 'run_execution_continuity_mismatch',
        app_server_started: false,
      },
    });
  });

  it('fails closed after runtime-job start lineage divergence without resuming the thread', async () => {
    const harness = await createRunExecutionHarness({
      tempSlug: 'forgeloop-remote-run-worker-start-lineage-',
      startRuntimeJob: async () => ({
        runtime_job: {
          ...runExecutionRuntimeJob(),
          target_id: 'run-session-other',
          status: 'running',
        },
      }),
    });

    await expect(harness.worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(harness.calls).toEqual(expect.arrayContaining(['restore', 'docker-start', 'start', 'artifact:startup_failure_evidence', 'terminal']));
    expect(harness.calls).not.toContain('event');
    expect(harness.calls).not.toContain('package');
    expect(harness.startRun).not.toHaveBeenCalled();
    expect(harness.resumeRun).not.toHaveBeenCalled();
    expect(harness.terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_runtime_job_unavailable',
    });
    expect(harness.uploadedArtifacts.find((artifact) => artifact.kind === 'startup_failure_evidence')).toMatchObject({
      metadata_json: {
        failure_stage: 'runtime_job_start',
        app_server_started: true,
      },
    });
  });

  it('fails closed when start does not return a runtime job for lineage verification', async () => {
    const harness = await createRunExecutionHarness({
      tempSlug: 'forgeloop-remote-run-worker-start-missing-job-',
      startRuntimeJob: async () => ({}),
    });

    await expect(harness.worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(harness.calls).toEqual(expect.arrayContaining(['restore', 'docker-start', 'start', 'artifact:startup_failure_evidence', 'terminal']));
    expect(harness.calls).not.toContain('event');
    expect(harness.calls).not.toContain('package');
    expect(harness.startRun).not.toHaveBeenCalled();
    expect(harness.resumeRun).not.toHaveBeenCalled();
    expect(harness.terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_runtime_job_unavailable',
    });
  });

  it('fails closed before Docker startup when capsule restore fails', async () => {
    const calls: string[] = [];
    const capsuleManager = {
      ...runExecutionCapsuleManager(calls),
      restore: vi.fn(async () => {
        calls.push('restore');
        throw new Error('codex_runtime_capsule_unknown_path');
      }),
    };
    const harness = await createRunExecutionHarness({
      tempSlug: 'forgeloop-remote-run-worker-restore-failure-',
      capsuleManager,
      launcher: runExecutionLauncher(await mkdtemp(join(tmpdir(), 'forgeloop-remote-run-worker-restore-launcher-')), calls),
    });

    await expect(harness.worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(calls).toContain('restore');
    expect(calls).not.toContain('docker-start');
    expect(harness.calls).not.toContain('start');
    expect(harness.startRun).not.toHaveBeenCalled();
    expect(harness.resumeRun).not.toHaveBeenCalled();
    expect(harness.terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_runtime_capsule_unknown_path',
    });
    expect(harness.uploadedArtifacts.find((artifact) => artifact.kind === 'startup_failure_evidence')).toMatchObject({
      metadata_json: {
        failure_stage: 'run_execution_capsule_restore',
        failure_subcode: 'runtime_capsule_restore_failed',
        app_server_started: false,
      },
    });
  });

  it('rejects non app-server run-execution drivers before resuming', async () => {
    const harness = await createRunExecutionHarness({
      tempSlug: 'forgeloop-remote-run-worker-fake-driver-',
      driverKind: 'fake',
    });

    await expect(harness.worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(harness.startRun).not.toHaveBeenCalled();
    expect(harness.resumeRun).not.toHaveBeenCalled();
    expect(harness.terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_app_server_resume_failed',
    });
    expect(harness.uploadedArtifacts.find((artifact) => artifact.kind === 'startup_failure_evidence')).toMatchObject({
      metadata_json: {
        failure_stage: 'run_execution_driver_terminal',
        failure_subcode: 'app_server_resume_failed',
        app_server_started: true,
      },
    });
  });

  it('fails closed when resumeRun throws and never calls startRun or packages an output capsule', async () => {
    const harness = await createRunExecutionHarness({
      tempSlug: 'forgeloop-remote-run-worker-resume-failure-',
      resumeRun: async function* () {
        throw new Error('codex_app_server_resume_failed');
      },
    });

    await expect(harness.worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(harness.calls).toEqual(expect.arrayContaining(['restore', 'docker-start', 'start', 'event', 'artifact:startup_failure_evidence', 'terminal']));
    expect(harness.calls).not.toContain('package');
    expect(harness.startRun).not.toHaveBeenCalled();
    expect(harness.resumeRun).toHaveBeenCalledTimes(1);
    expect(harness.terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_app_server_resume_failed',
    });
    expect(harness.uploadedArtifacts.find((artifact) => artifact.kind === 'startup_failure_evidence')).toMatchObject({
      metadata_json: {
        failure_stage: 'run_execution_driver_terminal',
        failure_subcode: 'app_server_resume_failed',
        app_server_started: true,
      },
    });
  });

  it('rejects missing terminal Codex thread evidence before packaging output capsule', async () => {
    const harness = await createRunExecutionHarness({
      tempSlug: 'forgeloop-remote-run-worker-missing-terminal-thread-',
      resumeRun: async function* () {
        yield {
          kind: 'terminal',
          status: 'succeeded',
          summary: 'Remote package run completed without thread evidence.',
          runtimeMetadata: { active_turn_id: 'app-server-turn-1' },
        } satisfies CodexDriverStreamItem;
      },
    });

    await expect(harness.worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(harness.calls).toEqual(expect.arrayContaining(['restore', 'docker-start', 'start', 'event', 'artifact:startup_failure_evidence', 'terminal']));
    expect(harness.calls).not.toContain('package');
    expect(harness.startRun).not.toHaveBeenCalled();
    expect(harness.resumeRun).toHaveBeenCalledTimes(1);
    expect(harness.terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_app_server_resume_failed',
    });
    expect(harness.uploadedArtifacts.find((artifact) => artifact.kind === 'startup_failure_evidence')).toMatchObject({
      metadata_json: {
        failure_stage: 'run_execution_driver_terminal',
        failure_subcode: 'app_server_resume_failed',
        app_server_started: true,
      },
    });
  });

  it('rejects terminal evidence for a replacement Codex thread before packaging output capsule', async () => {
    const harness = await createRunExecutionHarness({
      tempSlug: 'forgeloop-remote-run-worker-replacement-thread-',
      resumeRun: async function* () {
        yield {
          kind: 'terminal',
          status: 'succeeded',
          summary: 'Remote package run completed on a different thread.',
          runtimeMetadata: { codex_thread_id: 'thread-2' },
        } satisfies CodexDriverStreamItem;
      },
    });

    await expect(harness.worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(harness.calls).toEqual(expect.arrayContaining(['restore', 'docker-start', 'start', 'event', 'artifact:startup_failure_evidence', 'terminal']));
    expect(harness.calls).not.toContain('package');
    expect(harness.startRun).not.toHaveBeenCalled();
    expect(harness.resumeRun).toHaveBeenCalledTimes(1);
    expect(harness.terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_app_server_resume_failed',
    });
    expect(harness.uploadedArtifacts.find((artifact) => artifact.kind === 'startup_failure_evidence')).toMatchObject({
      metadata_json: {
        failure_stage: 'run_execution_driver_terminal',
        failure_subcode: 'app_server_resume_failed',
        app_server_started: true,
      },
    });
  });

  it('rejects forbidden symlink changes from the default run-execution collector', async () => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-remote-run-worker-symlink-'));
    const bundleManifest = createWorkspaceBundleManifest({
      bundleId: 'workspace-bundle-run-1',
      createdAt: '2026-05-23T00:00:00.000Z',
      allowedPaths: ['**'],
      forbiddenPaths: ['secrets/**'],
      files: [{ path: 'README.md', content: '# Remote run\n' }],
    });
    const bundleArchive = createWorkspaceBundleArchive({
      manifest: bundleManifest,
      files: [{ path: 'README.md', content: '# Remote run\n' }],
    });
    const bundleArchivePath = join(workerTempRoot, 'bundle.archive');
    await writeFile(bundleArchivePath, bundleArchive);
    const archiveDigest = workspaceBundleArchiveDigest(bundleArchive);
    const manifestDigest = workspaceBundleManifestDigest(bundleManifest);
    const workload = runExecutionWorkload(archiveDigest, manifestDigest);
    let sealedEnvelope: SealedEnvelope | undefined;
    const calls: string[] = [];
    const uploadedArtifacts: Record<string, unknown>[] = [];
    const terminalized: Record<string, unknown>[] = [];
    const controlPlaneClient = {
      registerWorker: async (input: Record<string, unknown>) => {
        calls.push('register');
        sealedEnvelope = await sealCodexLaunchTokenEnvelope({
          plaintext_launch_token: 'launch-token-run-secret',
          runtime_job_id: 'runtime-job-run-1',
          launch_lease_id: 'lease-run-1',
          envelope_id: 'envelope-run-1',
          worker_id: 'worker-1',
          worker_public_key_material: String(input.session_public_key_material),
          key_id: String(input.session_public_key_id),
          expires_at: '2026-05-23T00:10:00.000Z',
        });
        return {
          worker: { session_epoch: 1 },
          session_token: 'session-1',
          session_expires_at: '2026-05-23T00:10:00.000Z',
        };
      },
      heartbeatWorker: async () => {
        calls.push('heartbeat');
        return {};
      },
      pollRuntimeJobs: async () => {
        calls.push('poll');
        return { runtime_jobs: [{ runtime_job: runExecutionRuntimeJob(archiveDigest, manifestDigest), envelope: { id: 'envelope-run-1' } }] };
      },
      acceptRuntimeJob: async () => {
        calls.push('accept');
        return { runtime_job: { ...runExecutionRuntimeJob(archiveDigest, manifestDigest), status: 'accepted' } };
      },
      getRuntimeJobControl: async () => ({ control: { cancel_requested: false } }),
      claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
      fetchRuntimeJobWorkload: async () => (runExecutionWorkloadResponse(workload)),
      downloadWorkspaceBundle: async () => ({
        archive_path: bundleArchivePath,
        archive_digest: archiveDigest,
        size_bytes: bundleArchive.byteLength,
        content_type: 'application/vnd.forgeloop.workspace-bundle',
      }),
      materializeRuntimeJob: async () => runExecutionMaterialization(),
      startRuntimeJob: async () => ({ runtime_job: { ...runExecutionRuntimeJob(archiveDigest, manifestDigest), status: 'running' } }),
      appendRuntimeJobEvent: async () => ({}),
      uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
        calls.push(`artifact:${input.kind}`);
        uploadedArtifacts.push(input);
        return {
          artifact: {
            kind: input.kind,
            name: input.name,
            content_type: input.content_type,
            digest: input.digest,
            internal_ref: runtimeArtifactRef('runtime-job-run-1', input.kind),
          },
        };
      },
      terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
        calls.push('terminal');
        terminalized.push(input);
        return {};
      },
    };
    const launcher = runExecutionLauncher(workerTempRoot);
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot,
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['run_execution'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient,
      launcher,
      capsuleManager: runExecutionCapsuleManager(),
      scavenger: async () => undefined,
      runExecutionDriverFactory: ({ workspacePath }) => ({
        kind: 'app_server',
        async *startRun() {
          throw new Error('startRun must not be called for workflow execution');
        },
        async *resumeRun() {
          await mkdir(join(workspacePath, 'secrets'), { recursive: true });
          await symlink('../README.md', join(workspacePath, 'secrets', 'readme-link'));
          yield {
            kind: 'terminal',
            status: 'succeeded',
            summary: 'Remote package run completed.',
            runtimeMetadata: { codex_thread_id: 'thread-1' },
          } satisfies CodexDriverStreamItem;
        },
        sendInput: async () => ({}),
        cancelRun: async () => ({}),
        close: async () => undefined,
      }),
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => `nonce-${calls.length}`,
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(calls).toContain('artifact:startup_failure_evidence');
    expect(calls).not.toContain('artifact:run_execution_patch');
    const startupFailure = uploadedArtifacts.find((artifact) => artifact.kind === 'startup_failure_evidence');
    expect(startupFailure).toMatchObject({
      metadata_json: {
        reason_code: 'codex_workspace_bundle_invalid',
        failure_subcode: 'entry_path_forbidden',
        failure_stage: 'run_execution_result_collection',
        app_server_started: true,
        public_summary: 'Remote Codex workspace bundle validation failed.',
      },
    });
    expect(JSON.stringify(startupFailure)).not.toContain(workerTempRoot);
    expect(JSON.stringify(startupFailure)).not.toContain('launch-token-run-secret');
    expect(terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_workspace_bundle_invalid',
    });
  });

  it('preserves control-plane workspace bundle download denials as runtime unavailable for run execution', async () => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-remote-run-worker-download-denied-'));
    const archiveDigest = digest('c');
    const manifestDigest = digest('e');
    const workload = runExecutionWorkload(archiveDigest, manifestDigest);
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    const uploadedArtifacts: Record<string, unknown>[] = [];
    const controlPlaneClient = {
      registerWorker: async (input: Record<string, unknown>) => {
        sealedEnvelope = await sealCodexLaunchTokenEnvelope({
          plaintext_launch_token: 'launch-token-run-secret',
          runtime_job_id: 'runtime-job-run-1',
          launch_lease_id: 'lease-run-1',
          envelope_id: 'envelope-run-1',
          worker_id: 'worker-1',
          worker_public_key_material: String(input.session_public_key_material),
          key_id: String(input.session_public_key_id),
          expires_at: '2026-05-23T00:10:00.000Z',
        });
        return {
          worker: { session_epoch: 1 },
          session_token: 'session-1',
          session_expires_at: '2026-05-23T00:10:00.000Z',
        };
      },
      heartbeatWorker: async () => ({}),
      pollRuntimeJobs: async () => ({
        runtime_jobs: [{ runtime_job: runExecutionRuntimeJob(archiveDigest, manifestDigest), envelope: { id: 'envelope-run-1' } }],
      }),
      acceptRuntimeJob: async () => ({ runtime_job: { ...runExecutionRuntimeJob(archiveDigest, manifestDigest), status: 'accepted' } }),
      getRuntimeJobControl: async () => ({ control: { cancel_requested: false } }),
      claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
      fetchRuntimeJobWorkload: async () => (runExecutionWorkloadResponse(workload)),
      downloadWorkspaceBundle: async () => {
        throw new Error('codex_control_plane_request_failed:403');
      },
      uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
        uploadedArtifacts.push(input);
        return {};
      },
      terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
        terminalized.push(input);
        return {};
      },
    };
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot,
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['run_execution'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient,
      launcher: { startFromMaterialization: vi.fn() },
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-download-denied',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_runtime_job_unavailable',
    });
    expect(uploadedArtifacts.find((artifact) => artifact.kind === 'startup_failure_evidence')).toMatchObject({
      metadata_json: {
        reason_code: 'codex_runtime_job_unavailable',
        failure_stage: 'workspace_bundle_acquisition',
        failure_subcode: 'control_plane_request_failed',
        app_server_started: false,
      },
    });
  });

  it('records public-safe post-start control-plane diagnostics for run execution failures', async () => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-remote-run-worker-control-denied-'));
    const bundleManifest = createWorkspaceBundleManifest({
      bundleId: 'workspace-bundle-run-1',
      createdAt: '2026-05-23T00:00:00.000Z',
      allowedPaths: ['**'],
      forbiddenPaths: [],
      files: [{ path: 'README.md', content: '# Remote run\n' }],
    });
    const bundleArchive = createWorkspaceBundleArchive({
      manifest: bundleManifest,
      files: [{ path: 'README.md', content: '# Remote run\n' }],
    });
    const bundleArchivePath = join(workerTempRoot, 'bundle.archive');
    await writeFile(bundleArchivePath, bundleArchive);
    const archiveDigest = workspaceBundleArchiveDigest(bundleArchive);
    const manifestDigest = workspaceBundleManifestDigest(bundleManifest);
    const workload = runExecutionWorkload(archiveDigest, manifestDigest);
    let sealedEnvelope: SealedEnvelope | undefined;
    const uploadedArtifacts: Record<string, unknown>[] = [];
    const terminalized: Record<string, unknown>[] = [];
    let controlCalls = 0;
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot,
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['run_execution'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-run-secret',
            runtime_job_id: 'runtime-job-run-1',
            launch_lease_id: 'lease-run-1',
            envelope_id: 'envelope-run-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: '2026-05-23T00:10:00.000Z' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runExecutionRuntimeJob(archiveDigest, manifestDigest), envelope: { id: 'envelope-run-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runExecutionRuntimeJob(archiveDigest, manifestDigest), status: 'accepted' } }),
        getRuntimeJobControl: async () => {
          controlCalls += 1;
          if (controlCalls > 4) {
            throw new Error('codex_control_plane_request_failed:503');
          }
          return { control: { cancel_requested: false } };
        },
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => (runExecutionWorkloadResponse(workload)),
        downloadWorkspaceBundle: async () => ({
          archive_path: bundleArchivePath,
          archive_digest: archiveDigest,
          size_bytes: bundleArchive.byteLength,
          content_type: 'application/vnd.forgeloop.workspace-bundle',
        }),
        materializeRuntimeJob: async () => runExecutionMaterialization(),
        startRuntimeJob: async () => ({ runtime_job: { ...runExecutionRuntimeJob(archiveDigest, manifestDigest), status: 'running' } }),
        appendRuntimeJobEvent: async () => ({}),
        uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          uploadedArtifacts.push(input);
          return {};
        },
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher: runExecutionLauncher(workerTempRoot),
      capsuleManager: runExecutionCapsuleManager(),
      scavenger: async () => undefined,
      runExecutionDriverFactory: () => ({
        kind: 'app_server',
        async *startRun() {
          throw new Error('startRun must not be called for workflow execution');
        },
        async *resumeRun() {
          await new Promise(() => undefined);
        },
        sendInput: async () => ({}),
        cancelRun: async () => ({}),
        close: async () => undefined,
      }),
      sleep: async () => undefined,
      controlPollIntervalMs: 1,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => `nonce-control-denied-${controlCalls}`,
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_runtime_job_unavailable',
    });
    expect(uploadedArtifacts.find((artifact) => artifact.kind === 'startup_failure_evidence')).toMatchObject({
      metadata_json: {
        reason_code: 'codex_runtime_job_unavailable',
        failure_stage: 'run_execution_control_poll',
        failure_subcode: 'control_plane_request_failed',
        app_server_started: true,
      },
    });
  });

  it('records public-safe app-server terminal diagnostics for run execution failures', async () => {
    const workerTempRoot = await mkdtemp(join(tmpdir(), 'forgeloop-remote-run-worker-driver-terminal-'));
    const bundleManifest = createWorkspaceBundleManifest({
      bundleId: 'workspace-bundle-run-1',
      createdAt: '2026-05-23T00:00:00.000Z',
      allowedPaths: ['**'],
      forbiddenPaths: [],
      files: [{ path: 'README.md', content: '# Remote run\n' }],
    });
    const bundleArchive = createWorkspaceBundleArchive({
      manifest: bundleManifest,
      files: [{ path: 'README.md', content: '# Remote run\n' }],
    });
    const bundleArchivePath = join(workerTempRoot, 'bundle.archive');
    await writeFile(bundleArchivePath, bundleArchive);
    const archiveDigest = workspaceBundleArchiveDigest(bundleArchive);
    const manifestDigest = workspaceBundleManifestDigest(bundleManifest);
    const workload = runExecutionWorkload(archiveDigest, manifestDigest);
    let sealedEnvelope: SealedEnvelope | undefined;
    const uploadedArtifacts: Record<string, unknown>[] = [];
    const terminalized: Record<string, unknown>[] = [];
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot,
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['run_execution'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-run-secret',
            runtime_job_id: 'runtime-job-run-1',
            launch_lease_id: 'lease-run-1',
            envelope_id: 'envelope-run-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: '2026-05-23T00:10:00.000Z' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runExecutionRuntimeJob(archiveDigest, manifestDigest), envelope: { id: 'envelope-run-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runExecutionRuntimeJob(archiveDigest, manifestDigest), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: false } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => (runExecutionWorkloadResponse(workload)),
        downloadWorkspaceBundle: async () => ({
          archive_path: bundleArchivePath,
          archive_digest: archiveDigest,
          size_bytes: bundleArchive.byteLength,
          content_type: 'application/vnd.forgeloop.workspace-bundle',
        }),
        materializeRuntimeJob: async () => runExecutionMaterialization(),
        startRuntimeJob: async () => ({ runtime_job: { ...runExecutionRuntimeJob(archiveDigest, manifestDigest), status: 'running' } }),
        appendRuntimeJobEvent: async () => ({}),
        uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          uploadedArtifacts.push(input);
          return {};
        },
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher: runExecutionLauncher(workerTempRoot),
      capsuleManager: runExecutionCapsuleManager(),
      scavenger: async () => undefined,
      runExecutionDriverFactory: () => ({
        kind: 'app_server',
        async *startRun() {
          throw new Error('startRun must not be called for workflow execution');
        },
        async *resumeRun() {
          yield {
            kind: 'terminal',
            status: 'failed',
            summary: 'Codex app-server thread became idle before turn completion.',
          } satisfies CodexDriverStreamItem;
        },
        sendInput: async () => ({}),
        cancelRun: async () => ({}),
        close: async () => undefined,
      }),
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-driver-terminal',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_app_server_unavailable',
    });
    expect(uploadedArtifacts.find((artifact) => artifact.kind === 'startup_failure_evidence')).toMatchObject({
      metadata_json: {
        reason_code: 'codex_app_server_unavailable',
        failure_stage: 'run_execution_driver_terminal',
        failure_subcode: 'app_server_thread_idle_before_turn_completed',
        app_server_started: true,
      },
    });
  });

  it('terminalizes an accepted job as cancelled when control is cancelled before start', async () => {
    const terminalized: Record<string, unknown>[] = [];
    const launcher = {
      startFromMaterialization: vi.fn(),
    };
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async () => ({ worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' }),
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: true, drain_requested: true } }),
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher,
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-1',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(launcher.startFromMaterialization).not.toHaveBeenCalled();
    expect(terminalized).toHaveLength(1);
    expect(terminalized[0]).toMatchObject({
      terminal_status: 'cancelled',
      reason_code: 'codex_runtime_job_cancelled',
    });
  });

  it('terminalizes startup failures with public-safe evidence', async () => {
    const terminalized: Record<string, unknown>[] = [];
    let sealedEnvelope: SealedEnvelope | undefined;
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => (generationWorkloadResponse()),
        materializeRuntimeJob: async () => materialization(),
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(async () => {
          throw new Error('codex_app_server_unavailable: socket missing /tmp/private.sock');
        }),
      },
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-1',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(terminalized).toHaveLength(1);
    expect(terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_app_server_unavailable',
    });
    expect(JSON.stringify(terminalized[0])).not.toContain('/tmp/private.sock');
    expect(JSON.stringify(terminalized[0])).not.toContain('launch-token-secret');
  });

  it.each([
    [
      'structured app-server error',
      Object.assign(new Error('jsonrpc_error'), { code: 'codex_generation_turn_failed' }),
      'codex_generation_turn_failed',
      'app_server_turn_failed',
    ],
    [
      'usage-limited app-server turn',
      new Error('codex_generation_usage_limited'),
      'codex_generation_usage_limited',
      'app_server_usage_limit_exceeded',
    ],
    [
      'public generation error message',
      new Error('codex_generation_raw_log_too_large'),
      'codex_generation_raw_log_too_large',
      'app_server_raw_log_too_large',
    ],
  ])('preserves public generation failure codes from %s', async (_name, thrownError, expectedReasonCode, expectedFailureSubcode) => {
    const terminalized: Record<string, unknown>[] = [];
    const uploadedArtifacts: Record<string, unknown>[] = [];
    let sealedEnvelope: SealedEnvelope | undefined;
    const boundaryWorkload = generationWorkload({
      task_kind: 'boundary_brainstorming_round',
      prompt_version: 'boundary-brainstorming-round:v1',
      output_schema_version: 'boundary_round_result.v1',
    });
    const generationRuntimeFactory = vi.fn(() => {
      const runtime = createCodexGenerationRuntime({ mode: 'fake' });
      vi.spyOn(runtime, 'generateBoundaryBrainstormingRound').mockImplementation(async () => {
        throw thrownError;
      });
      return runtime;
    });
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({
          runtime_jobs: [{ runtime_job: { ...runtimeJob(), input_json: boundaryWorkload }, envelope: { id: 'envelope-1' } }],
        }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), input_json: boundaryWorkload, status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => ({ workload: boundaryWorkload, signed_context: generationSignedContext() }),
        materializeRuntimeJob: async () => materialization(),
        startRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), input_json: boundaryWorkload, status: 'running' } }),
        appendRuntimeJobEvent: async () => ({}),
        uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          uploadedArtifacts.push(input);
          return {
            artifact: {
              kind: input.kind,
              name: input.name,
              content_type: input.content_type,
              digest: input.digest,
              internal_ref: runtimeArtifactRef('runtime-job-1', input.kind),
            },
          };
        },
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(async () => ({
          endpoint: 'docker-exec:' + digest('8'),
          containerWorkspacePath: '/workspace' as const,
          publicEvidence: {
            runtime_profile_id: 'profile-1',
            runtime_profile_revision_id: 'profile-rev-1',
            runtime_profile_digest: digest('7'),
            runtime_target_kind: 'generation' as const,
            source_access_mode: 'artifact_only' as const,
            environment: 'test' as const,
            launch_lease_id: 'lease-1',
            worker_id: 'worker-1',
            docker_image_digest: digest('4'),
            container_id_digest: digest('9'),
            app_server_effective_config_digest: digest('6'),
            docker_policy_self_check_digest: digest('a'),
            app_server_attempted: true as const,
            selected_execution_mode: 'app_server' as const,
          },
          close: async () => undefined,
        })),
      },
      scavenger: async () => undefined,
      generationRuntimeFactory,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-1',
      controlPollIntervalMs: 1,
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(generationRuntimeFactory).toHaveBeenCalled();
    expect(terminalized).toHaveLength(1);
    expect(terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: expectedReasonCode,
    });
    expect(uploadedArtifacts.find((artifact) => artifact.kind === 'startup_failure_evidence')).toMatchObject({
      metadata_json: {
        reason_code: expectedReasonCode,
        runtime_target_kind: 'generation',
        app_server_started: true,
        failure_stage: 'generation_runtime_turn',
        failure_subcode: expectedFailureSubcode,
        runtime_evidence_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        generation_output_schema_sent: false,
        generation_context_operation: 'start',
        public_summary: 'Remote Codex app-server startup or generation failed.',
      },
    });
    expect(JSON.stringify(terminalized[0])).not.toContain('launch-token-secret');
    expect(JSON.stringify(uploadedArtifacts)).not.toContain('launch-token-secret');
  });

  it.each([
    ['missing signed context', { workload: generationWorkload() }],
    [
      'mismatched signed context',
      {
        workload: generationWorkload(),
        signed_context: { context_version: 'generation_context.work_item.v1', action_run_id: 'wrong-action' },
      },
    ],
  ])('rejects generation workload responses with %s', async (_name, workloadResponse) => {
    const terminalized: Record<string, unknown>[] = [];
    let sealedEnvelope: SealedEnvelope | undefined;
    const materializeRuntimeJob = vi.fn(async () => materialization());
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => workloadResponse,
        materializeRuntimeJob,
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(),
      },
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-1',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(materializeRuntimeJob).not.toHaveBeenCalled();
    expect(terminalized).toHaveLength(1);
    expect(terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_runtime_job_unavailable',
    });
    expect(JSON.stringify(terminalized[0])).not.toContain('launch-token-secret');
  });

  it('terminalizes unknown generation task kinds as unsupported workload without legacy fallback', async () => {
    const terminalized: Record<string, unknown>[] = [];
    let sealedEnvelope: SealedEnvelope | undefined;
    const unsupportedWorkload = {
      ...generationWorkload(),
      task_kind: 'future_generation_kind',
    };
    const materializeRuntimeJob = vi.fn(async () => materialization());
    const launcher = { startFromMaterialization: vi.fn() };
    const generatePackageDrafts = vi.fn(async () => {
      throw new Error('package_drafts_fallthrough');
    });
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({
          runtime_jobs: [
            {
              runtime_job: runtimeJob({ task_kind: 'future_generation_kind' as CodexGenerationWorkloadV1['task_kind'] }),
              envelope: { id: 'envelope-1' },
            },
          ],
        }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => ({ workload: unsupportedWorkload, signed_context: generationSignedContext() }),
        materializeRuntimeJob,
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher,
      generationRuntimeFactory: () => ({
        generateSpecDraft: vi.fn(),
        generatePlanDraft: vi.fn(),
        generatePackageDrafts,
        generateBoundaryBrainstormingRound: vi.fn(),
        generateDevelopmentPlanItemSpecRevision: vi.fn(),
        generateDevelopmentPlanItemExecutionPlanRevision: vi.fn(),
      } as unknown as CodexGenerationRuntime),
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-1',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(materializeRuntimeJob).not.toHaveBeenCalled();
    expect(launcher.startFromMaterialization).not.toHaveBeenCalled();
    expect(generatePackageDrafts).not.toHaveBeenCalled();
    expect(terminalized).toHaveLength(1);
    expect(terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_generation_workload_unsupported',
    });
    expect(JSON.stringify(terminalized[0])).not.toContain('launch-token-secret');
  });

  it('supports an injected worker loop sleep and shutdown predicate', async () => {
    const calls: string[] = [];
    const sleeps: number[] = [];
    let shouldContinueChecks = 0;
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async () => {
          calls.push('register');
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => {
          calls.push('heartbeat');
          return {};
        },
        pollRuntimeJobs: async () => {
          calls.push('poll');
          return { runtime_jobs: [] };
        },
        acceptRuntimeJob: async () => ({}),
        getRuntimeJobControl: async () => ({ control: {} }),
        terminalizeRuntimeJob: async () => ({}),
      },
      launcher: {
        startFromMaterialization: vi.fn(),
      },
      scavenger: async () => {
        calls.push('scavenge');
      },
      sleep: async (durationMs) => {
        sleeps.push(durationMs);
      },
      pollIntervalMs: 25,
      shouldContinue: () => {
        shouldContinueChecks += 1;
        return shouldContinueChecks < 4;
      },
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-loop',
    });

    await expect(worker.runLoop()).resolves.toEqual({ iterations: 2, processed: 0 });

    expect(calls).toEqual(['register', 'scavenge', 'heartbeat', 'poll', 'poll']);
    expect(sleeps).toEqual([25]);
  });

  it('uses poll heartbeat intervals to keep idle worker registration fresh', async () => {
    const calls: string[] = [];
    let nowValue = '2026-05-23T00:00:00.000Z';
    let shouldContinueChecks = 0;
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async () => {
          calls.push('register');
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => {
          calls.push('heartbeat');
          return {};
        },
        pollRuntimeJobs: async () => {
          calls.push('poll');
          return { runtime_jobs: [], heartbeat_interval_ms: 25 };
        },
        acceptRuntimeJob: async () => ({}),
        getRuntimeJobControl: async () => ({ control: {} }),
        terminalizeRuntimeJob: async () => ({}),
      },
      launcher: {
        startFromMaterialization: vi.fn(),
      },
      scavenger: async () => {
        calls.push('scavenge');
      },
      sleep: async () => {
        nowValue = '2026-05-23T00:00:00.030Z';
      },
      pollIntervalMs: 30,
      shouldContinue: () => {
        shouldContinueChecks += 1;
        return shouldContinueChecks < 4;
      },
      now: () => nowValue,
      nonceFactory: () => `nonce-${calls.length}`,
    });

    await expect(worker.runLoop()).resolves.toEqual({ iterations: 2, processed: 0 });

    expect(calls).toEqual(['register', 'scavenge', 'heartbeat', 'poll', 'heartbeat', 'poll']);
  });

  it('refreshes an expired registered session before the next poll', async () => {
    const calls: string[] = [];
    const pollTokens: unknown[] = [];
    let nowValue = '2026-05-23T00:00:00.000Z';
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async () => {
          calls.push('register');
          return {
            worker: { session_epoch: 1 },
            session_token: 'session-1',
            session_expires_at: '2026-05-23T00:00:01.000Z',
          };
        },
        refreshWorkerSession: async (_workerId: string, input: Record<string, unknown>) => {
          calls.push('refresh');
          expect(input.workerSessionToken).toBe('session-1');
          expect(input.next_session_public_key_algorithm).toBe('x25519');
          return {
            worker: { session_epoch: 2 },
            session_token: 'session-2',
            session_expires_at: '2026-05-23T00:10:00.000Z',
          };
        },
        heartbeatWorker: async () => {
          calls.push('heartbeat');
          return {};
        },
        pollRuntimeJobs: async (_workerId: string, input: Record<string, unknown>) => {
          calls.push('poll');
          pollTokens.push(input.workerSessionToken);
          return { runtime_jobs: [] };
        },
        acceptRuntimeJob: async () => ({}),
        getRuntimeJobControl: async () => ({ control: {} }),
        terminalizeRuntimeJob: async () => ({}),
      },
      launcher: {
        startFromMaterialization: vi.fn(),
      },
      scavenger: async () => {
        calls.push('scavenge');
      },
      now: () => nowValue,
      nonceFactory: () => 'nonce-refresh',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 0 });
    nowValue = '2026-05-23T00:00:02.000Z';
    await expect(worker.runOnce()).resolves.toEqual({ processed: 0 });

    expect(calls).toEqual(['register', 'scavenge', 'heartbeat', 'poll', 'refresh', 'heartbeat', 'poll']);
    expect(pollTokens).toEqual(['session-1', 'session-2']);
  });

  it('polls control while generation is running and terminalizes cancellation', async () => {
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    const closed: Array<[string, string]> = [];
    let receivedSignal: AbortSignal | undefined;
    let controlCalls = 0;
    const eventTypes: unknown[] = [];
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => {
          controlCalls += 1;
          return {
            control: {
              cancel_requested: receivedSignal !== undefined && controlCalls >= 2,
              drain_requested: receivedSignal !== undefined && controlCalls >= 2,
            },
          };
        },
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => (generationWorkloadResponse()),
        materializeRuntimeJob: async () => materialization(),
        startRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'running' } }),
        appendRuntimeJobEvent: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          eventTypes.push(input.event_type);
          return {};
        },
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(async () => ({
          endpoint: 'docker-exec:' + digest('8'),
          createTransport: () => appServerTransport(generatedSpec()),
          containerWorkspacePath: '/workspace' as const,
          publicEvidence: {
            runtime_profile_id: 'profile-1',
            runtime_profile_revision_id: 'profile-rev-1',
            runtime_profile_digest: digest('7'),
            runtime_target_kind: 'generation' as const,
            source_access_mode: 'artifact_only' as const,
            environment: 'test' as const,
            launch_lease_id: 'lease-1',
            worker_id: 'worker-1',
            docker_image_digest: digest('4'),
            container_id_digest: digest('9'),
            app_server_effective_config_digest: digest('6'),
            docker_policy_self_check_digest: digest('a'),
            app_server_attempted: true as const,
            selected_execution_mode: 'app_server' as const,
          },
          close: async (status, summary) => {
            closed.push([status, summary]);
          },
        })),
      },
      generationRuntimeFactory: () =>
        ({
          generateSpecDraft: async (input) => {
            receivedSignal = input.signal;
            return new Promise((resolve, reject) => {
              input.signal?.addEventListener('abort', () => reject(new Error('codex_generation_cancelled')), { once: true });
            });
          },
          generatePlanDraft: async () => {
            throw new Error('unexpected');
          },
          generatePackageDrafts: async () => {
            throw new Error('unexpected');
          },
        }) satisfies CodexGenerationRuntime,
      scavenger: async () => undefined,
      sleep: async () => undefined,
      controlPollIntervalMs: 1,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-control',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(receivedSignal?.aborted).toBe(true);
    expect(eventTypes).toContain('runtime_job_worker_heartbeat');
    expect(terminalized).toHaveLength(1);
    expect(terminalized[0]).toMatchObject({
      terminal_status: 'cancelled',
      reason_code: 'codex_runtime_job_cancelled',
    });
    expect(closed).toEqual([['failed', 'codex_runtime_job_cancelled']]);
  });

  it('aborts generation when control polling fails while running', async () => {
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    let receivedSignal: AbortSignal | undefined;
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => (generationWorkloadResponse()),
        materializeRuntimeJob: async () => materialization(),
        startRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'running' } }),
        appendRuntimeJobEvent: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          if (input.event_type === 'runtime_job_worker_heartbeat') {
            throw new Error('codex_runtime_job_unavailable');
          }
          return {};
        },
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(async () => ({
          endpoint: 'docker-exec:' + digest('8'),
          createTransport: () => appServerTransport(generatedSpec({ content: 'x'.repeat(70_000) })),
          containerWorkspacePath: '/workspace' as const,
          publicEvidence: {
            runtime_profile_id: 'profile-1',
            runtime_profile_revision_id: 'profile-rev-1',
            runtime_profile_digest: digest('7'),
            runtime_target_kind: 'generation' as const,
            source_access_mode: 'artifact_only' as const,
            environment: 'test' as const,
            launch_lease_id: 'lease-1',
            worker_id: 'worker-1',
            docker_image_digest: digest('4'),
            container_id_digest: digest('9'),
            app_server_effective_config_digest: digest('6'),
            docker_policy_self_check_digest: digest('a'),
            app_server_attempted: true as const,
            selected_execution_mode: 'app_server' as const,
          },
          close: async () => undefined,
        })),
      },
      generationRuntimeFactory: () =>
        ({
          generateSpecDraft: async (input) => {
            receivedSignal = input.signal;
            return new Promise((resolve, reject) => {
              input.signal?.addEventListener('abort', () => reject(new Error('codex_generation_cancelled')), { once: true });
            });
          },
          generatePlanDraft: async () => {
            throw new Error('unexpected');
          },
          generatePackageDrafts: async () => {
            throw new Error('unexpected');
          },
        }) satisfies CodexGenerationRuntime,
      scavenger: async () => undefined,
      sleep: async () => undefined,
      controlPollIntervalMs: 1,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-control-error',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(receivedSignal?.aborted).toBe(true);
    expect(terminalized).toHaveLength(1);
    expect(terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_runtime_job_unavailable',
    });
  });

  it('maps materialization failures to cancellation when control was cancelled during startup', async () => {
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    let controlCalls = 0;
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => {
          controlCalls += 1;
          return { control: { cancel_requested: controlCalls >= 3, drain_requested: controlCalls >= 3 } };
        },
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => (generationWorkloadResponse()),
        materializeRuntimeJob: async () => {
          throw new Error('codex_runtime_job_unavailable');
        },
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(),
      },
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-startup-cancel',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(terminalized).toHaveLength(1);
    expect(terminalized[0]).toMatchObject({
      terminal_status: 'cancelled',
      reason_code: 'codex_runtime_job_cancelled',
    });
  });

  it('does not overwrite successful generation with failed terminalization when success terminal response is lost', async () => {
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => (generationWorkloadResponse()),
        materializeRuntimeJob: async () => materialization(),
        startRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'running' } }),
        uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => ({
          artifact: {
            kind: input.kind,
            name: input.name,
            content_type: input.content_type,
            digest: input.digest,
            internal_ref: runtimeArtifactRef('runtime-job-1', input.kind),
          },
        }),
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          throw new Error('codex_control_plane_request_failed:502');
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(async () => ({
          endpoint: 'docker-exec:' + digest('8'),
          createTransport: () => appServerTransport(generatedSpec({ content: 'x'.repeat(70_000) })),
          containerWorkspacePath: '/workspace' as const,
          publicEvidence: {
            runtime_profile_id: 'profile-1',
            runtime_profile_revision_id: 'profile-rev-1',
            runtime_profile_digest: digest('7'),
            runtime_target_kind: 'generation' as const,
            source_access_mode: 'artifact_only' as const,
            environment: 'test' as const,
            launch_lease_id: 'lease-1',
            worker_id: 'worker-1',
            docker_image_digest: digest('4'),
            container_id_digest: digest('9'),
            app_server_effective_config_digest: digest('6'),
            docker_policy_self_check_digest: digest('a'),
            app_server_attempted: true as const,
            selected_execution_mode: 'app_server' as const,
          },
          close: async () => undefined,
        })),
      },
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-terminal-lost',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(terminalized).toHaveLength(2);
    expect(terminalized.every((entry) => entry.terminal_status === 'succeeded')).toBe(true);
  });

  it('terminalizes cancelled when cancellation races with success terminalization', async () => {
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: terminalized.length > 0, drain_requested: terminalized.length > 0 } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => (generationWorkloadResponse()),
        materializeRuntimeJob: async () => materialization(),
        startRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'running' } }),
        uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => ({
          artifact: {
            kind: input.kind,
            name: input.name,
            content_type: input.content_type,
            digest: input.digest,
            internal_ref: runtimeArtifactRef('runtime-job-1', input.kind),
          },
        }),
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          if (input.terminal_status === 'succeeded') {
            throw new Error('codex_runtime_job_unavailable');
          }
          return {};
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(async () => ({
          endpoint: 'docker-exec:' + digest('8'),
          createTransport: () => appServerTransport(generatedSpec({ content: 'x'.repeat(70_000) })),
          containerWorkspacePath: '/workspace' as const,
          publicEvidence: {
            runtime_profile_id: 'profile-1',
            runtime_profile_revision_id: 'profile-rev-1',
            runtime_profile_digest: digest('7'),
            runtime_target_kind: 'generation' as const,
            source_access_mode: 'artifact_only' as const,
            environment: 'test' as const,
            launch_lease_id: 'lease-1',
            worker_id: 'worker-1',
            docker_image_digest: digest('4'),
            container_id_digest: digest('9'),
            app_server_effective_config_digest: digest('6'),
            docker_policy_self_check_digest: digest('a'),
            app_server_attempted: true as const,
            selected_execution_mode: 'app_server' as const,
          },
          close: async () => undefined,
        })),
      },
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => `nonce-terminal-cancel-${terminalized.length}`,
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(terminalized.map((entry) => entry.terminal_status)).toEqual(['succeeded', 'succeeded', 'cancelled']);
  });

  it('terminalizes cancelled when success terminal transport responses are unconfirmed and control is cancelled', async () => {
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: terminalized.length > 0, drain_requested: terminalized.length > 0 } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => (generationWorkloadResponse()),
        materializeRuntimeJob: async () => materialization(),
        startRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'running' } }),
        uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => ({
          artifact: {
            kind: input.kind,
            name: input.name,
            content_type: input.content_type,
            digest: input.digest,
            internal_ref: runtimeArtifactRef('runtime-job-1', input.kind),
          },
        }),
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          if (input.terminal_status === 'succeeded') {
            throw new Error('codex_control_plane_request_failed:502');
          }
          return {};
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(async () => ({
          endpoint: 'docker-exec:' + digest('8'),
          createTransport: () => appServerTransport(generatedSpec()),
          containerWorkspacePath: '/workspace' as const,
          publicEvidence: {
            runtime_profile_id: 'profile-1',
            runtime_profile_revision_id: 'profile-rev-1',
            runtime_profile_digest: digest('7'),
            runtime_target_kind: 'generation' as const,
            source_access_mode: 'artifact_only' as const,
            environment: 'test' as const,
            launch_lease_id: 'lease-1',
            worker_id: 'worker-1',
            docker_image_digest: digest('4'),
            container_id_digest: digest('9'),
            app_server_effective_config_digest: digest('6'),
            docker_policy_self_check_digest: digest('a'),
            app_server_attempted: true as const,
            selected_execution_mode: 'app_server' as const,
          },
          close: async () => undefined,
        })),
      },
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => `nonce-terminal-transport-cancel-${terminalized.length}`,
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(terminalized.map((entry) => entry.terminal_status)).toEqual(['succeeded', 'succeeded', 'cancelled']);
  });

  it('uses a generated payload artifact ref for oversized generation results', async () => {
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    const uploadedArtifacts: Record<string, unknown>[] = [];
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => (generationWorkloadResponse()),
        materializeRuntimeJob: async () => materialization(),
        startRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'running' } }),
        uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          uploadedArtifacts.push(input);
          return {
            artifact: {
              kind: input.kind,
              name: input.name,
              content_type: input.content_type,
              digest: input.digest,
              internal_ref: runtimeArtifactRef('runtime-job-1', input.kind),
            },
          };
        },
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(async () => ({
          endpoint: 'docker-exec:' + digest('8'),
          createTransport: () => appServerTransport(generatedSpec({ content: 'x'.repeat(70_000) })),
          containerWorkspacePath: '/workspace' as const,
          publicEvidence: {
            runtime_profile_id: 'profile-1',
            runtime_profile_revision_id: 'profile-rev-1',
            runtime_profile_digest: digest('7'),
            runtime_target_kind: 'generation' as const,
            source_access_mode: 'artifact_only' as const,
            environment: 'test' as const,
            launch_lease_id: 'lease-1',
            worker_id: 'worker-1',
            docker_image_digest: digest('4'),
            container_id_digest: digest('9'),
            app_server_effective_config_digest: digest('6'),
            docker_policy_self_check_digest: digest('a'),
            app_server_attempted: true as const,
            selected_execution_mode: 'app_server' as const,
          },
          close: async () => undefined,
        })),
      },
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-oversized',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(terminalized[0]?.terminal_result_json).toMatchObject({
      generated_payload: {
        schema_version: 'generated_payload_ref.v1',
        artifact: {
          kind: 'generated_payload',
          internal_ref: runtimeArtifactRef('runtime-job-1', 'generated_payload'),
        },
      },
    });
    const generatedPayloadArtifact = uploadedArtifacts.find((artifact) => artifact.kind === 'generated_payload');
    expect(generatedPayloadArtifact).toMatchObject({
      metadata_json: {
        generated_payload_digest: codexCanonicalDigest(generatedSpec({ content: 'x'.repeat(70_000) })),
      },
    });
    expect(JSON.stringify(generatedPayloadArtifact?.metadata_json)).not.toContain('generated_payload":{"content"');
    expect(JSON.stringify(terminalized[0]?.terminal_result_json)).not.toContain('x'.repeat(100));
  });

  it('fails oversized generation when generated payload artifact ref is unavailable', async () => {
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => (generationWorkloadResponse()),
        materializeRuntimeJob: async () => materialization(),
        startRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'running' } }),
        uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => ({
          artifact: {
            kind: input.kind,
            name: input.name,
            content_type: input.content_type,
            digest: input.digest,
          },
        }),
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(async () => ({
          endpoint: 'docker-exec:' + digest('8'),
          createTransport: () => appServerTransport(generatedSpec({ content: 'x'.repeat(70_000) })),
          containerWorkspacePath: '/workspace' as const,
          publicEvidence: {
            runtime_profile_id: 'profile-1',
            runtime_profile_revision_id: 'profile-rev-1',
            runtime_profile_digest: digest('7'),
            runtime_target_kind: 'generation' as const,
            source_access_mode: 'artifact_only' as const,
            environment: 'test' as const,
            launch_lease_id: 'lease-1',
            worker_id: 'worker-1',
            docker_image_digest: digest('4'),
            container_id_digest: digest('9'),
            app_server_effective_config_digest: digest('6'),
            docker_policy_self_check_digest: digest('a'),
            app_server_attempted: true as const,
            selected_execution_mode: 'app_server' as const,
          },
          close: async () => undefined,
        })),
      },
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-oversized-no-ref',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(terminalized).toHaveLength(1);
    expect(terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_runtime_job_unavailable',
    });
    expect(JSON.stringify(terminalized[0])).not.toContain('x'.repeat(100));
  });

  it('uploads cleanup failure evidence before terminal success and keeps success when cleanup fails', async () => {
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    const uploadedArtifacts: Record<string, unknown>[] = [];
    const operations: string[] = [];
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => (generationWorkloadResponse()),
        materializeRuntimeJob: async () => materialization(),
        startRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'running' } }),
        uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          uploadedArtifacts.push(input);
          operations.push(`artifact:${String(input.kind)}`);
          return {
            artifact: {
              kind: input.kind,
              name: input.name,
              content_type: input.content_type,
              digest: input.digest,
              internal_ref: runtimeArtifactRef('runtime-job-1', input.kind),
            },
          };
        },
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          operations.push(`terminal:${String(input.terminal_status)}`);
          return {};
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(async () => ({
          endpoint: 'docker-exec:' + digest('8'),
          createTransport: () => appServerTransport(generatedSpec()),
          containerWorkspacePath: '/workspace' as const,
          publicEvidence: {
            runtime_profile_id: 'profile-1',
            runtime_profile_revision_id: 'profile-rev-1',
            runtime_profile_digest: digest('7'),
            runtime_target_kind: 'generation' as const,
            source_access_mode: 'artifact_only' as const,
            environment: 'test' as const,
            launch_lease_id: 'lease-1',
            worker_id: 'worker-1',
            docker_image_digest: digest('4'),
            container_id_digest: digest('9'),
            app_server_effective_config_digest: digest('6'),
            docker_policy_self_check_digest: digest('a'),
            app_server_attempted: true as const,
            selected_execution_mode: 'app_server' as const,
          },
          close: async () => {
            operations.push('cleanup');
            throw new Error('cleanup failed /tmp/private');
          },
        })),
      },
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-cleanup',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(terminalized).toHaveLength(1);
    expect(terminalized[0]).toMatchObject({ terminal_status: 'succeeded' });
    expect(uploadedArtifacts.map((entry) => entry.kind)).toContain('cleanup_failure_evidence');
    expect(operations.indexOf('artifact:cleanup_failure_evidence')).toBeLessThan(operations.indexOf('terminal:succeeded'));
    expect(JSON.stringify(uploadedArtifacts)).not.toContain('/tmp/private');
  });

  it('reports terminal-result failures after successful generation artifact upload without blaming artifact upload', async () => {
    let sealedEnvelope: SealedEnvelope | undefined;
    const terminalized: Record<string, unknown>[] = [];
    const uploadedArtifacts: Record<string, unknown>[] = [];
    const worker = createRemoteCodexWorkerClient({
      workerId: 'worker-1',
      workerIdentity: 'remote-dev',
      version: 'test',
      bootstrapToken: 'bootstrap-secret',
      bootstrapTokenVersion: 1,
      workerTempRoot: await mkdtemp(join(tmpdir(), 'forgeloop-remote-worker-')),
      allowedScopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
      capabilities: ['generation'],
      dockerImageDigests: [digest('4')],
      networkPolicyDigests: [digest('b')],
      hostUid: 501,
      hostGid: 20,
      maxConcurrency: 1,
      controlPlaneClient: {
        registerWorker: async (input: Record<string, unknown>) => {
          sealedEnvelope = await sealCodexLaunchTokenEnvelope({
            plaintext_launch_token: 'launch-token-secret',
            runtime_job_id: 'runtime-job-1',
            launch_lease_id: 'lease-1',
            envelope_id: 'envelope-1',
            worker_id: 'worker-1',
            worker_public_key_material: String(input.session_public_key_material),
            key_id: String(input.session_public_key_id),
            expires_at: '2026-05-23T00:10:00.000Z',
          });
          return { worker: { session_epoch: 1 }, session_token: 'session-1', session_expires_at: 'later' };
        },
        heartbeatWorker: async () => ({}),
        pollRuntimeJobs: async () => ({ runtime_jobs: [{ runtime_job: runtimeJob(), envelope: { id: 'envelope-1' } }] }),
        acceptRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'accepted' } }),
        getRuntimeJobControl: async () => ({ control: { cancel_requested: false, drain_requested: false } }),
        claimLaunchTokenEnvelope: async () => ({ envelope: sealedEnvelope }),
        fetchRuntimeJobWorkload: async () => (generationWorkloadResponse()),
        materializeRuntimeJob: async () => materialization(),
        startRuntimeJob: async () => ({ runtime_job: { ...runtimeJob(), status: 'running' } }),
        uploadRuntimeJobArtifact: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          uploadedArtifacts.push(input);
          return {
            artifact: {
              kind: input.kind,
              name: input.name,
              content_type: input.content_type,
              digest: input.digest,
              internal_ref: runtimeArtifactRef('runtime-job-1', input.kind),
            },
          };
        },
        terminalizeRuntimeJob: async (_workerId: string, _jobId: string, input: Record<string, unknown>) => {
          terminalized.push(input);
          return {};
        },
      },
      launcher: {
        startFromMaterialization: vi.fn(async () => ({
          endpoint: 'docker-exec:' + digest('8'),
          createTransport: () => appServerTransport(generatedSpec()),
          containerWorkspacePath: '/workspace' as const,
          publicEvidence: {
            runtime_profile_id: 'profile-1',
            runtime_profile_revision_id: 'profile-rev-1',
            runtime_profile_digest: digest('7'),
            runtime_target_kind: 'generation' as const,
            source_access_mode: 'artifact_only' as const,
            environment: 'test' as const,
            launch_lease_id: 'lease-1',
            worker_id: 'worker-1',
            docker_image_digest: digest('4'),
            container_id_digest: 'not-a-digest',
            app_server_effective_config_digest: digest('6'),
            docker_policy_self_check_digest: digest('a'),
            app_server_attempted: true as const,
            selected_execution_mode: 'app_server' as const,
          },
          close: async () => undefined,
        })),
      },
      scavenger: async () => undefined,
      now: () => '2026-05-23T00:00:00.000Z',
      nonceFactory: () => 'nonce-terminal-result-failure',
    });

    await expect(worker.runOnce()).resolves.toEqual({ processed: 1 });

    expect(uploadedArtifacts.map((artifact) => artifact.kind)).toEqual(
      expect.arrayContaining(['generated_payload', 'generation_validation_report', 'startup_failure_evidence']),
    );
    expect(uploadedArtifacts.find((artifact) => artifact.kind === 'startup_failure_evidence')).toMatchObject({
      metadata_json: {
        reason_code: 'codex_runtime_job_unavailable',
        runtime_target_kind: 'generation',
        app_server_started: true,
        failure_stage: 'generation_terminal_result',
        failure_subcode: 'runtime_job_terminal_result_unavailable',
        runtime_evidence_digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    });
    expect(terminalized).toHaveLength(1);
    expect(terminalized[0]).toMatchObject({
      terminal_status: 'failed',
      reason_code: 'codex_runtime_job_unavailable',
    });
    expect(JSON.stringify(terminalized[0])).not.toContain('x'.repeat(100));
    expect(JSON.stringify(uploadedArtifacts)).not.toContain('launch-token-secret');
  });
});
