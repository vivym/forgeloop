# Codex Remote Worker Runtime Channel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an outbound-only Codex remote worker runtime channel that can run generation and run-execution jobs through isolated Dockerized `codex app-server` tasks while preserving PRD-first human gates and existing product-state writer boundaries.

**Architecture:** Add a durable `CodexRuntimeJob` queue and sealed `CodexLaunchTokenEnvelope` handoff next to the existing runtime profile, credential, worker, and launch-lease foundation. The control plane creates or replays a runtime job, launch lease, and encrypted envelope atomically; workers poll outbound, accept, claim, materialize, execute, upload job-scoped artifacts, and terminalize the job and lease through one state machine. Automation daemon and run-worker consume terminal runtime-job evidence through their existing command boundaries, so workers never write Spec, Plan, Package, RunSession, ReviewPacket, release, or deployment state directly.

**Tech Stack:** TypeScript, NestJS, Drizzle ORM, Vitest, Node 22 WebCrypto X25519/HKDF-SHA256/AES-256-GCM, Docker CLI runner abstraction, existing `@forgeloop/codex-runtime`, `@forgeloop/codex-worker-runtime`, `@forgeloop/automation-daemon`, `@forgeloop/run-worker`, and `@forgeloop/db`.

---

## Source Material

- Spec: `docs/superpowers/specs/2026-05-22-codex-remote-worker-runtime-channel-design.md`
- Previous runtime foundation plan: `docs/superpowers/plans/2026-05-20-codex-runtime-distribution-docker-worker.md`
- Domain runtime foundation: `packages/domain/src/codex-runtime.ts`
- DB schema foundation: `packages/db/src/schema/codex-runtime.ts`
- Repository boundary: `packages/db/src/repositories/delivery-repository.ts`
- In-memory repository: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Drizzle repository: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Control-plane runtime module: `apps/control-plane-api/src/modules/codex-runtime`
- Worker runtime package: `packages/codex-worker-runtime/src`
- Generation daemon integration: `apps/automation-daemon/src`
- Run-worker integration: `packages/run-worker/src`

## Non-Negotiable Constraints

- Preserve PRD-first flow: automation may draft Spec, Plan, and ExecutionPackage artifacts only through explicit actions; package execution starts only from approved Plan and ready ExecutionPackage.
- The remote worker never writes product-state tables directly.
- Remote mode must not call the existing raw-token `createLaunchLease` API from orchestrators. Use `createOrReplayCodexRuntimeJobWithLeaseAndEnvelope`.
- Launch lease materialization remains the only path that returns raw Codex config and auth.
- Worker materialization requests may contain the decrypted launch token at the HTTP boundary, but controllers/guards must immediately convert it to a hash/proof and scrub plaintext before calling `CodexRuntimeService` or `DeliveryRepository`.
- Runtime-job rows, envelope rows, logs, poll responses, terminal responses, public events, and public summaries must not contain raw launch token, raw auth, raw prompts, raw app-server logs, local absolute paths, socket paths, raw endpoints, or raw container ids.
- Creating or replaying a job first looks up existing rows by `job_request_id` and target plus launch attempt. Only confirmed new create paths mint launch tokens or envelopes.
- Create lease, runtime job, and envelope in one repository transaction. Service-level coordination of three independently committed writes is not acceptable.
- Claim, cancel, materialize, start, and terminal operations lock the runtime job, envelope, and lease in one DB transaction before deciding.
- Use DB commit time or a monotonic DB transaction sequence for cancel/terminal ordering. Do not trust worker wall-clock timestamps for ordering.
- Worker endpoints require session token, nonce, timestamp, body digest, and replay protection bound to method, path, body digest, worker id, and session epoch.
- Worker session refresh must not strand queued jobs sealed to a discarded key.
- The remote launcher close path must not independently terminalize the launch lease before the runtime-job terminal endpoint.
- Remote runtime-job recovery is separate from existing stale launch-lease recovery that may mutate automation actions or run sessions.
- Internal artifact storage is the initial workspace bundle and runtime artifact storage backend.
- Workspace bundle archives are first stored as pending run-worker artifacts, then atomically bound to the runtime job during `createOrReplayCodexRuntimeJobWithLeaseAndEnvelope`. A remote worker can download only the bound runtime-job bundle, never an unbound pending artifact.
- Tests may bootstrap profiles and unsafe DB auth from protected local `~/.codex`, but worker execution must consume config/auth only after central storage and launch-lease materialization into per-task `CODEX_HOME`.

## File Structure

### Domain

- Modify `packages/domain/src/codex-runtime.ts`
  - Add `CodexRuntimeJob`, `CodexLaunchTokenEnvelope`, result DTOs, workload DTOs, workspace bundle DTOs, nonce identity helpers, envelope digest helpers, runtime-job transition helpers, artifact sanitizer helpers, blocker code allowlist additions, and public projection redaction.
- Modify `packages/domain/src/index.ts`
  - Export any new split files if the implementation moves runtime-job helpers out of `codex-runtime.ts`.
- Test `tests/domain/codex-runtime.test.ts`
  - Add domain contract exports, digest stability, state transition, redaction, and result validation coverage.

### Database

- Modify `packages/db/src/schema/codex-runtime.ts`
  - Add `codex_runtime_jobs`, `codex_launch_token_envelopes`, `codex_runtime_job_artifacts`, and `codex_pending_workspace_bundles`.
  - Extend worker nonce storage with method/path/body/session epoch binding if the current nonce table cannot enforce it.
- Modify `packages/db/src/schema/index.ts`
  - Ensure the new tables remain exported through `./codex-runtime`.
- Modify `packages/db/src/reset.ts`
  - Add new tables before dependent existing runtime tables in `resettableTables`.
- Modify `packages/db/src/repositories/delivery-repository.ts`
  - Add runtime-job create/replay, poll, accept, claim, materialize, start, event, artifact intake, cancel, terminal, recover-stale, launch-lease-status, and worker-session-refresh contracts.
- Modify `packages/db/src/repositories/in-memory-delivery-repository.ts`
  - Implement the same runtime-job state machine for unit and API tests.
- Modify `packages/db/src/repositories/drizzle-delivery-repository.ts`
  - Implement real transactional Drizzle behavior and row locking for create/replay, claim, materialize, cancel, terminal, and recovery.
- Test `tests/db/codex-runtime-repository.test.ts`
  - Add in-memory contract coverage for all new methods.
- Test `tests/db/codex-runtime-drizzle-concurrency.test.ts`
  - Add Drizzle/Postgres concurrency coverage for atomic create/replay and race-sensitive transitions.
- Test `tests/db/reset.test.ts` and `tests/db/schema.test.ts`
  - Add schema/reset coverage for new tables and indexes.

### Control Plane API

- Modify `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.dto.ts`
  - Add trusted runtime-job create/cancel/recover/status DTOs and worker poll/accept/claim/workload/materialize/start/event/artifact/control/terminal/session-refresh DTOs.
- Modify `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts`
  - Add runtime-job orchestration, worker selection, envelope sealing and claim, nonce verification, workload fetch, materialization replay, artifact intake validation, terminal result validation, cancellation, recovery, and worker session refresh.
- Modify `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.controller.ts`
  - Add endpoints from the spec under `/internal/codex-runtime`, `/internal/codex-launch-leases`, and `/internal/codex-workers`.
- Test `tests/api/codex-runtime-control-plane.test.ts`
  - Cover all API-level authorization, idempotency, redaction, and state transition behavior.

### Worker Runtime

- Modify `packages/codex-worker-runtime/src/control-plane-client.ts`
  - Add worker-authenticated runtime-job client methods and trusted-orchestrator runtime-job methods where used by daemon/run-worker integration.
- Create `packages/codex-worker-runtime/src/envelope-crypto.ts`
  - Own X25519/HKDF/AES-GCM encrypt/decrypt, key generation, key id derivation, AAD canonicalization, and startup probe.
- Create `packages/codex-worker-runtime/src/remote-worker-client.ts`
  - Own outbound worker loop: register, recover/scavenge, heartbeat, poll, accept, claim, fetch workload, materialize, start Docker app-server, execute, upload artifacts, terminalize, cancel, drain, session refresh, and shutdown.
- Create `packages/codex-worker-runtime/src/runtime-job-artifacts.ts`
  - Own artifact upload body/digest/ref validation and public-safe terminal result assembly.
- Create `packages/codex-worker-runtime/src/workspace-bundle.ts`
  - Own bundle manifest validation, archive digest verification, safe unpack, changed-file collection, patch creation, and path-policy checks for remote run execution.
- Modify `packages/codex-worker-runtime/src/app-server-launcher.ts`
  - Add start-from-materialization entrypoint and close strategy that delegates terminalization to runtime-job terminal calls in remote mode.
- Modify `packages/codex-worker-runtime/src/scavenger.ts`
  - Add launch-lease status lookup and symlink-safe temp-root/container cleanup for remote accepted/materializing/running jobs.
- Modify `packages/codex-worker-runtime/src/task-filesystem.ts`
  - Ensure owner-only, no-follow, under-temp-root secret writes are reusable by remote worker tasks and scavenger.
- Modify `packages/codex-worker-runtime/src/index.ts`
  - Export new remote worker, crypto, artifact, and bundle APIs.
- Test `tests/codex-worker-runtime/remote-worker-client.test.ts`
  - Add fake-control-plane integration around worker lifecycle.
- Test `tests/codex-worker-runtime/envelope-crypto.test.ts`
  - Add deterministic crypto contract and negative tests.
- Test `tests/codex-worker-runtime/workspace-bundle.test.ts`
  - Add safe and unsafe archive coverage.
- Update existing tests under `tests/codex-worker-runtime/`
  - Extend app-server launcher, local worker, task filesystem, scavenger, and real smoke tests for remote mode.

### Automation Daemon

- Modify `apps/automation-daemon/src/config.ts`
  - Add `FORGELOOP_CODEX_WORKER_MODE=remote_outbound` and remote control-plane wait/timeout config.
  - Keep `remote_outbound` rejected until Slice 1 runtime-job APIs are implemented.
- Modify `apps/automation-daemon/src/generation-runtime.ts`
  - Add remote generation runtime adapter that creates runtime jobs, renews action claims, waits for terminal result, revalidates fences, and writes drafts only through existing automation commands.
- Modify `apps/automation-daemon/src/main.ts`
  - Wire remote generation dependencies and control-plane client.
- Test `tests/automation/daemon-config.test.ts`
  - Add config validation coverage.
- Test `tests/automation/daemon.test.ts` and `tests/api/automation-daemon.integration.test.ts`
  - Add remote generation success, cancel, timeout, lost-claim, and stale-result coverage.

### Run Worker

- Modify `packages/run-worker/src/run-worker.ts`
  - Add `FORGELOOP_CODEX_RUN_WORKER_MODE=remote_outbound`, workspace-bundle creation, runtime-job delegation, lease renewal while waiting, terminal result consumption, and pre-write RunSession/package fence revalidation.
- Modify `packages/run-worker/src/lease.ts`
  - Expose renewal or keepalive primitives needed while waiting for remote terminal result.
- Modify `packages/run-worker/src/index.ts`
  - Export remote run execution helpers only if needed by control-plane composition.
- Modify control-plane run-worker composition files, especially `apps/control-plane-api/src/modules/run-control/run-control.module.ts` if present.
  - Wire remote run-worker mode without bypassing current writer boundaries.
- Test `tests/run-worker/run-worker.test.ts`
  - Add remote run execution delegation, cancellation, lease loss, out-of-policy patch, and stale terminal result coverage.
- Test `tests/codex-worker-runtime/run-session-driver.test.ts`
  - Add already-materialized app-server driver entrypoint coverage.

### Scripts and Operations

- Modify or create scripts under `scripts/` only where existing dogfood scripts require new runtime evidence.
  - Add remote worker bootstrap/run helpers after the API and worker package are implemented.
  - Do not print raw auth, raw config, tokens, endpoints, local paths, or container ids.
- Modify `scripts/automation-dogfood.ts`, `scripts/automation-dogfood-summary.ts`, and `scripts/delivery-local-codex-dogfood.ts` if they already report runtime mode and strict success.
  - Add remote mode status and Dockerized app-server evidence checks.
- Create `docs/runbooks/codex-remote-worker-runtime.md`
  - Operator runbook for central profile/auth bootstrap, same-host remote worker dogfood, worker restart/scavenge, and remote run execution smoke.
- Test `tests/smoke/automation-dogfood-script.test.ts`, `tests/smoke/delivery-local-codex-dogfood-script.test.ts`, and an opt-in remote dogfood smoke test.

## Implementation Tasks

### Task 1: Domain Runtime-Job Contracts And Blocker Codes

**Files:**
- Modify: `packages/domain/src/codex-runtime.ts`
- Modify: `packages/domain/src/index.ts` only if helpers are split
- Test: `tests/domain/codex-runtime.test.ts`

- [ ] **Step 1: Write failing domain export and blocker-code tests**

Add tests that prove these contracts exist and are public blocker codes:

```ts
import {
  codexPublicBlockerCodes,
  type CodexLaunchTokenEnvelope,
  type CodexRuntimeJob,
  type CodexRuntimeJobStatus,
} from '@forgeloop/domain';

type Expected = {
  job: CodexRuntimeJob;
  status: CodexRuntimeJobStatus;
  envelope: CodexLaunchTokenEnvelope;
};

const assertTypes = <T extends Expected>() => undefined;

it('exports runtime job and envelope contracts', () => {
  expect(assertTypes()).toBeUndefined();
});

it('allows runtime job public blocker codes', () => {
  expect(codexPublicBlockerCodes).toEqual(
    expect.arrayContaining([
      'codex_runtime_job_unavailable',
      'codex_runtime_job_expired',
      'codex_runtime_job_cancelled',
      'codex_workspace_bundle_invalid',
    ]),
  );
});
```

- [ ] **Step 2: Run the focused domain test and verify it fails**

Run: `pnpm vitest run tests/domain/codex-runtime.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because the new contracts and blocker codes do not exist.

- [ ] **Step 3: Add domain types**

Add the exact status and target/result shapes required by the spec:

```ts
export type CodexRuntimeJobStatus = 'queued' | 'accepted' | 'materializing' | 'running' | 'terminal';
export type CodexRuntimeJobTerminalStatus = 'succeeded' | 'failed' | 'cancelled' | 'expired';

export interface CodexRuntimeJob {
  id: string;
  job_request_id: string;
  target_type: CodexLaunchTarget['target_type'];
  target_id: string;
  target_kind: CodexRuntimeTargetKind;
  project_id: string;
  repo_id?: string;
  worker_id: string;
  launch_lease_id: string;
  launch_attempt: number;
  status: CodexRuntimeJobStatus;
  input_digest: string;
  input_json: Record<string, unknown>;
  workspace_acquisition_digest?: string;
  workspace_acquisition_json?: Record<string, unknown>;
  accept_idempotency_key?: string;
  accept_request_digest?: string;
  accepted_at?: IsoDateTime;
  accepted_worker_session_digest?: string;
  accepted_session_public_key_id?: string;
  accepted_session_epoch?: number;
  materializing_at?: IsoDateTime;
  materialization_request_id?: string;
  materialization_request_digest?: string;
  start_idempotency_key?: string;
  start_request_digest?: string;
  started_at?: IsoDateTime;
  last_event_at?: IsoDateTime;
  cancel_requested_at?: IsoDateTime;
  cancel_idempotency_key?: string;
  cancel_request_digest?: string;
  drain_requested_at?: IsoDateTime;
  terminal_idempotency_key?: string;
  terminal_request_digest?: string;
  terminal_at?: IsoDateTime;
  terminal_status?: CodexRuntimeJobTerminalStatus;
  terminal_reason_code?: string;
  terminal_result_json?: Record<string, unknown>;
  expires_at: IsoDateTime;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export interface CodexLaunchTokenEnvelope {
  id: string;
  runtime_job_id: string;
  launch_lease_id: string;
  worker_id: string;
  key_id: string;
  algorithm: 'x25519-hkdf-sha256-aes-256-gcm';
  ciphertext: string;
  encryption_nonce: string;
  aad_json: Record<string, string>;
  aad_digest: string;
  envelope_digest: string;
  status: 'available' | 'claimed' | 'expired' | 'revoked';
  claim_request_id?: string;
  claim_request_digest?: string;
  claimed_worker_session_digest?: string;
  claimed_key_id?: string;
  claimed_at?: IsoDateTime;
  expires_at: IsoDateTime;
  created_at: IsoDateTime;
}
```

- [ ] **Step 4: Add result, workload, and bundle contracts**

Add `CodexGenerationWorkloadV1`, `CodexRunExecutionWorkloadV1`, `CodexGenerationRuntimeJobResult`, `WorkspaceBundleV1`, and `CodexRunExecutionRuntimeJobResult` with fields exactly matching the spec. Keep raw prompt/context/log fields out of public-safe input and result types.

Use this run-execution workload shape for the worker-only workload endpoint:

```ts
export interface CodexRunExecutionWorkloadV1 {
  schema_version: 'codex_run_execution_workload.v1';
  runtime_job_id: string;
  run_session_id: string;
  execution_package_id: string;
  execution_package_version: number;
  run_worker_lease_id: string;
  workspace_bundle_id: string;
  workspace_bundle_digest: string;
  package_prompt_ref: string;
  package_prompt_digest: string;
  execution_context_ref: string;
  execution_context_digest: string;
  path_policy_digest: string;
  required_checks_digest?: string;
  output_schema_version: string;
  created_at: string;
  expires_at: string;
}
```

`input_json` stores only this workload ref, schema version, ids, versions, and digests. Rendered package prompts, execution context, and check configuration are returned only by the worker-authenticated workload endpoint or by endpoint-issued internal artifact downloads bound to the runtime job.

- [ ] **Step 5: Add domain helpers and redaction assertions**

Add helpers:

- `codexRuntimeJobIsActive(job): boolean`
- `codexRuntimeJobInputDigest(input): string`
- `codexWorkspaceAcquisitionDigest(input | undefined): string | undefined`
- `codexLaunchTokenEnvelopeDigest(input): string`
- `validateCodexRuntimeJobTerminalResult(input): Record<string, unknown>`
- `assertCodexRuntimePublicSafeValue(input, label): void`

The public-safety assertion must reject strings that look like local paths, raw app-server/control-plane endpoints, host URLs, `unix:` endpoints, `.sock`, raw container ids, and keys ending in `token`, `secret`, `auth`, `password`, `endpoint`, `container_id`, `workspace_path`, or `source_repo_path`. It must still allow explicitly product-safe next-step links and control-plane-issued artifact refs.

- [ ] **Step 6: Run domain tests**

Run: `pnpm vitest run tests/domain/codex-runtime.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/codex-runtime.ts packages/domain/src/index.ts tests/domain/codex-runtime.test.ts
git commit -m "feat: add codex runtime job domain contracts"
```

### Task 2: Runtime Job Tables And Repository Contracts

**Files:**
- Modify: `packages/db/src/schema/codex-runtime.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/reset.ts`
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Test: `tests/db/schema.test.ts`
- Test: `tests/db/reset.test.ts`
- Test: `tests/db/codex-runtime-repository.test.ts`

- [ ] **Step 1: Write failing schema and repository contract tests**

Add tests that assert the schema exports `codex_runtime_jobs`, `codex_launch_token_envelopes`, `codex_runtime_job_artifacts`, and `codex_pending_workspace_bundles`, and the repository interface has a `createOrReplayCodexRuntimeJobWithLeaseAndEnvelope` method.

- [ ] **Step 2: Run focused DB tests and verify they fail**

Run: `pnpm vitest run tests/db/schema.test.ts tests/db/reset.test.ts tests/db/codex-runtime-repository.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because tables and repository methods are missing.

- [ ] **Step 3: Add Drizzle tables**

Add tables with these critical uniqueness and lookup indexes:

```ts
uniqueIndex('codex_runtime_jobs_job_request_idx').on(table.jobRequestId),
uniqueIndex('codex_runtime_jobs_target_attempt_idx').on(
  table.projectId,
  sql`coalesce(${table.repoId}, '')`,
  table.targetType,
  table.targetId,
  table.launchAttempt,
),
index('codex_runtime_jobs_worker_status_idx').on(table.workerId, table.status),
index('codex_runtime_jobs_recovery_idx').on(table.status, table.expiresAt, table.lastEventAt),
uniqueIndex('codex_launch_token_envelopes_runtime_job_idx').on(table.runtimeJobId),
index('codex_launch_token_envelopes_worker_status_idx').on(table.workerId, table.status),
uniqueIndex('codex_runtime_job_artifacts_job_digest_idx').on(table.runtimeJobId, table.digest, table.contentType),
uniqueIndex('codex_pending_workspace_bundles_bundle_idx').on(table.bundleId),
index('codex_pending_workspace_bundles_run_worker_lease_idx').on(table.runWorkerLeaseId, table.status),
```

Fields must cover every idempotency key and digest in the spec, including accepted session/key fields and materialization/cancel/terminal request digests.

- [ ] **Step 4: Update reset order**

Add `codex_runtime_job_artifacts`, `codex_launch_token_envelopes`, `codex_runtime_jobs`, and `codex_pending_workspace_bundles` before `codex_launch_leases` in `packages/db/src/reset.ts`.

- [ ] **Step 5: Add repository input and result contracts**

Add repository types for:

- `CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput`
- `CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeResult`
- `PollCodexRuntimeJobsInput`
- `AcceptCodexRuntimeJobInput`
- `ClaimCodexLaunchTokenEnvelopeInput`
- `MaterializeCodexRuntimeJobInput`
- `StartCodexRuntimeJobInput`
- `AppendCodexRuntimeJobEventInput`
- `CreateCodexRuntimeJobArtifactInput`
- `CreatePendingWorkspaceBundleArtifactInput`
- `GetWorkspaceBundleDownloadForRuntimeJobInput`
- `CancelCodexRuntimeJobInput`
- `TerminalizeCodexRuntimeJobInput`
- `RecoverStaleCodexRuntimeJobsInput`
- `GetCodexLaunchLeaseStatusInput`
- `RefreshCodexWorkerSessionInput`

Include `request_digest` fields on all retryable mutating inputs.

`MaterializeCodexRuntimeJobInput` must contain `launch_token_hash` or an equivalent proof digest, not raw `launch_token`. The raw token exists only in the worker HTTP request body and is scrubbed by the controller/guard before service and repository calls.

- [ ] **Step 6: Run typecheck-level build**

Run: `pnpm --filter @forgeloop/db build`

Expected: FAIL until in-memory and Drizzle repositories implement the new interface.

- [ ] **Step 7: Commit schema and contracts after implementation in later tasks compiles**

Commit this task together with Task 3 if the repository interface cannot compile without in-memory implementation:

```bash
git add packages/db/src/schema/codex-runtime.ts packages/db/src/schema/index.ts packages/db/src/reset.ts packages/db/src/repositories/delivery-repository.ts tests/db/schema.test.ts tests/db/reset.test.ts tests/db/codex-runtime-repository.test.ts
git commit -m "feat: add codex runtime job repository contracts"
```

### Task 3: In-Memory Runtime Job Create/Replay Core

**Files:**
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Test: `tests/db/codex-runtime-repository.test.ts`

- [ ] **Step 1: Write failing create/replay tests**

Cover:

- New create invokes the repository-owned envelope sealer inside the same create transaction, then returns only job, lease, and sealed envelope metadata.
- Replay by same `job_request_id` returns existing job/envelope metadata and does not mint a new launch token.
- Replay by target plus launch attempt returns the same result when all fences match.
- Conflicting `job_request_id`, input digest, workspace digest, worker id, lease id, profile fence, credential fence, or envelope digest fails with `codex_runtime_job_unavailable`.
- Runtime job, launch lease, and envelope are all absent if create fails midway.
- The raw launch token never crosses the `DeliveryRepository` interface and is never returned to the orchestrator, `CodexRuntimeService`, or any service-level callback.
- Pending workspace bundle artifacts can be bound to a runtime job only by the new-create transaction; replays must return the same bound bundle metadata and must reject mismatched pending bundle ids or digests.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run tests/db/codex-runtime-repository.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because in-memory runtime-job create/replay is missing.

- [ ] **Step 3: Add private maps and clone/reset wiring**

Add maps:

- `codexRuntimeJobs`
- `codexRuntimeJobRequestIds`
- `codexRuntimeJobTargetAttempts`
- `codexLaunchTokenEnvelopes`
- `codexRuntimeJobArtifacts`

Ensure repository clone/reset paths include the maps.

- [ ] **Step 4: Implement `createOrReplayCodexRuntimeJobWithLeaseAndEnvelope`**

The method must:

1. Look up by `job_request_id`.
2. Look up by target plus launch attempt.
3. Verify replay matches canonical fences and digests.
4. Validate worker, active profile, active credential, scope, capability, Docker image digest, network policy digest, provider config digest, and active generation/run fence.
5. On the new-create path only, generate the launch token inside the repository transaction and call a repository-owned envelope sealer dependency before commit.
6. Insert launch lease, runtime job, and sealed envelope records together.
7. Return public-safe job, lease, and envelope metadata only. Do not return `lease_token` or raw launch token from this remote-mode method.
8. Update worker durable slot count only for a confirmed new active lease/job.

The repository call contract should look like this shape rather than accepting or returning plaintext:

```ts
export interface CodexLaunchTokenEnvelopeSealer {
  sealLaunchTokenEnvelope(input: {
    plaintext_launch_token: string;
    runtime_job_id: string;
    launch_lease_id: string;
    envelope_id: string;
    worker_id: string;
    worker_public_key_material: string;
    key_id: string;
    expires_at: string;
  }): Promise<Omit<CodexLaunchTokenEnvelope, 'status' | 'created_at'>>;
}

export interface CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput {
  runtime_job_id: string;
  launch_lease_id: string;
  envelope_id: string;
  job_request_id: string;
  target: CodexLaunchTarget;
  launch_attempt: number;
  worker_id: string;
  input_json: Record<string, unknown>;
  input_digest: string;
  workspace_acquisition_json?: Record<string, unknown>;
  workspace_acquisition_digest?: string;
  pending_workspace_bundle?: {
    bundle_id: string;
    pending_artifact_ref: string;
    archive_digest: string;
    manifest_digest: string;
    run_worker_lease_id: string;
    expires_at: string;
  };
  now: string;
}

export interface CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeResult {
  runtime_job: CodexRuntimeJob;
  launch_lease: CodexLaunchLease;
  envelope: CodexLaunchTokenEnvelope;
  replayed: boolean;
}
```

Implementation note: if keeping concrete crypto out of `@forgeloop/db` is necessary, inject `CodexLaunchTokenEnvelopeSealer` into the repository implementation or repository provider at construction time. Do not pass a sealer callback through `CreateOrReplayCodexRuntimeJobWithLeaseAndEnvelopeInput`, because that would let `CodexRuntimeService` observe or capture the plaintext launch token.

- [ ] **Step 5: Add replay-match helper**

Use canonical comparison of:

- target
- launch attempt
- input digest
- workspace acquisition digest
- worker id
- launch lease id
- profile revision id and profile digest
- credential binding/version/payload digest
- Docker image digest
- network policy digest
- provider config digest
- envelope digest
- pending workspace bundle id, archive ref, archive digest, manifest digest, run-worker lease id, and expiry when `target_kind` is `run_execution`

- [ ] **Step 6: Run repository tests**

Run: `pnpm vitest run tests/db/codex-runtime-repository.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS for new in-memory create/replay tests and existing launch-lease tests.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/repositories/in-memory-delivery-repository.ts tests/db/codex-runtime-repository.test.ts
git commit -m "feat: implement in-memory codex runtime job create replay"
```

### Task 4: Drizzle Atomic Create/Replay And Concurrency

**Files:**
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Test: `tests/db/codex-runtime-drizzle-concurrency.test.ts`
- Test: `tests/db/codex-runtime-repository.test.ts`

- [ ] **Step 1: Write failing Drizzle concurrency tests**

Add tests that run two concurrent `createOrReplayCodexRuntimeJobWithLeaseAndEnvelope` calls with the same `job_request_id`. Assert:

- exactly one runtime job row exists;
- exactly one launch lease row exists;
- exactly one envelope row exists;
- both callers observe the same job/envelope ids;
- only one repository-owned launch-token sealer dependency is invoked for the new create path;
- conflicting concurrent replay fails closed.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run tests/db/codex-runtime-drizzle-concurrency.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because Drizzle implementation is missing.

- [ ] **Step 3: Implement transactional create/replay**

In `DrizzleDeliveryRepository`, implement the new repository method inside `withDeliveryTransaction`. Use row locks or deterministic insert conflict handling. The decision order must be:

1. Lock or resolve existing job by `job_request_id`.
2. Lock or resolve existing job by target plus launch attempt.
3. On replay, verify all fences and return metadata without minting or storing a new launch token.
4. On new create, validate profile/credential/worker/fence rows, generate the raw launch token inside the repository transaction, invoke the repository-owned sealer dependency before commit, insert launch lease, insert runtime job, insert sealed envelope, and return only public-safe records.

- [ ] **Step 4: Avoid raw-token persistence**

Verify no new table stores `launch_token` plaintext. Only `codex_launch_leases.lease_token_hash` may persist the hashed launch token.

- [ ] **Step 5: Run focused Drizzle tests**

Run: `pnpm vitest run tests/db/codex-runtime-drizzle-concurrency.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 6: Run DB repository tests**

Run: `pnpm vitest run tests/db/codex-runtime-repository.test.ts tests/db/schema.test.ts tests/db/reset.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/repositories/drizzle-delivery-repository.ts tests/db/codex-runtime-drizzle-concurrency.test.ts
git commit -m "feat: add atomic codex runtime job create replay"
```

### Task 5: Envelope Crypto Adapter

**Files:**
- Create: `packages/codex-worker-runtime/src/envelope-crypto.ts`
- Modify: `packages/codex-worker-runtime/src/index.ts`
- Test: `tests/codex-worker-runtime/envelope-crypto.test.ts`
- Test: `tests/domain/codex-runtime.test.ts`

- [ ] **Step 1: Write failing crypto tests**

Cover:

- startup probe succeeds on Node 22 X25519 WebCrypto;
- generated worker key pair can decrypt a sealed launch token;
- AAD binds worker id, runtime job id, launch lease id, envelope id, key id, and expiry;
- changed AAD, ciphertext, nonce, key id, or private key fails decrypt;
- envelope digest is stable and excludes `envelope_digest` itself.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run tests/codex-worker-runtime/envelope-crypto.test.ts tests/domain/codex-runtime.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because crypto adapter is missing.

- [ ] **Step 3: Implement WebCrypto adapter**

Implement:

- `probeCodexLaunchTokenEnvelopeCrypto(): Promise<void>`
- `generateCodexWorkerSessionKeyPair(input): Promise<{ publicKeyMaterial; privateKeyHandle; keyId }>`
- `sealCodexLaunchTokenEnvelope(input): Promise<SealedEnvelope>`
- `decryptCodexLaunchTokenEnvelope(input): Promise<string>`
- `codexLaunchTokenEnvelopeAadDigest(aad): string`

Use `globalThis.crypto.subtle`, X25519, HKDF-SHA256, AES-256-GCM, 96-bit random AES nonce, and canonical JSON AAD bytes.

- [ ] **Step 4: Keep private keys out of logs and artifacts**

Represent private keys as `CryptoKey` handles or opaque in-memory values. Do not serialize private key material in return values or errors.

- [ ] **Step 5: Add deterministic test hook**

Allow tests to inject key material or nonce bytes through a test-only dependency object. Production code must use WebCrypto randomness.

- [ ] **Step 6: Run crypto tests**

Run: `pnpm vitest run tests/codex-worker-runtime/envelope-crypto.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/codex-worker-runtime/src/envelope-crypto.ts packages/codex-worker-runtime/src/index.ts tests/codex-worker-runtime/envelope-crypto.test.ts tests/domain/codex-runtime.test.ts
git commit -m "feat: add codex launch token envelope crypto"
```

### Task 6: Runtime Job State Machine Repository Methods

**Files:**
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Test: `tests/db/codex-runtime-repository.test.ts`
- Test: `tests/db/codex-runtime-drizzle-concurrency.test.ts`

- [ ] **Step 1: Write failing state-machine tests**

Cover:

- poll returns only queued jobs assigned to the polling worker;
- accept persists accepted session digest, key id, session epoch, idempotency key, and request digest;
- same accept replay returns same decision;
- conflicting accept replay fails closed;
- claim is single-use with same-claim replay;
- wrong worker, stale session, expired key, cancelled job, and replayed nonce are denied without oracle detail;
- materialization moves job to `materializing` and materializes lease in one operation;
- materialization repository/service inputs receive only a launch-token hash/proof, never plaintext launch token;
- materialization response-loss replay returns same raw config/auth until terminal or lease expiry;
- start rejects cancelled jobs and moves `materializing` to `running`;
- event endpoint deduplicates by sequence or idempotency key;
- terminal is exactly-once and terminalizes lease plus job atomically;
- cancel before accept terminalizes queued job and revokes lease;
- cancel after accepted/materializing/running is durable and monotonic.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run tests/db/codex-runtime-repository.test.ts tests/db/codex-runtime-drizzle-concurrency.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because state-machine methods are missing.

- [ ] **Step 3: Implement in-memory state transitions**

Use compare-and-set checks over current status, worker id, accepted session digest, key id, session epoch, non-terminal fence, and request digests. Keep error codes public-safe.

- [ ] **Step 4: Implement Drizzle state transitions**

Each mutating method must run in one transaction and lock the runtime job row plus relevant envelope and lease rows before deciding. Do not terminalize the lease without terminalizing the runtime job for remote methods.

For materialization, validate `launch_token_hash` against the lease token hash already stored on `codex_launch_leases`. Repository methods must not accept a plaintext `launch_token`.

- [ ] **Step 5: Implement launch lease status lookup**

Add repository and API support for `GET /internal/codex-launch-leases/:leaseId/status` that returns only public-safe status and terminal reason data needed by worker scavenger.

- [ ] **Step 6: Run repository tests**

Run: `pnpm vitest run tests/db/codex-runtime-repository.test.ts tests/db/codex-runtime-drizzle-concurrency.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/repositories/delivery-repository.ts packages/db/src/repositories/in-memory-delivery-repository.ts packages/db/src/repositories/drizzle-delivery-repository.ts tests/db/codex-runtime-repository.test.ts tests/db/codex-runtime-drizzle-concurrency.test.ts
git commit -m "feat: implement codex runtime job state machine"
```

### Task 7: Runtime Job Control-Plane APIs

**Files:**
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.dto.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.controller.ts`
- Test: `tests/api/codex-runtime-control-plane.test.ts`

- [ ] **Step 1: Write failing API tests**

Cover trusted orchestrator endpoints:

- `POST /internal/codex-runtime/runtime-jobs`
- `GET /internal/codex-runtime/runtime-jobs/:jobId`
- `POST /internal/codex-runtime/runtime-jobs/:jobId/cancel`
- `POST /internal/codex-runtime/runtime-jobs/recover-stale`
- `GET /internal/codex-launch-leases/:leaseId/status`
- `POST /internal/automation/action-runs/:actionRunId/claim/renew`

Cover worker endpoints:

- register and heartbeat remain compatible;
- `POST /internal/codex-workers/:workerId/session/refresh`
- `POST /internal/codex-workers/:workerId/runtime-jobs/poll`
- `POST /internal/codex-workers/:workerId/runtime-jobs/:jobId/accepted`
- `POST /internal/codex-workers/:workerId/runtime-jobs/:jobId/envelope/claim`
- `GET /internal/codex-workers/:workerId/runtime-jobs/:jobId/workload`
- `POST /internal/codex-workers/:workerId/runtime-jobs/:jobId/materialize`
- `POST /internal/codex-workers/:workerId/runtime-jobs/:jobId/started`
- `POST /internal/codex-workers/:workerId/runtime-jobs/:jobId/events`
- `POST /internal/codex-workers/:workerId/runtime-jobs/:jobId/artifacts`
- `GET /internal/codex-workers/:workerId/runtime-jobs/:jobId/control`
- `POST /internal/codex-workers/:workerId/runtime-jobs/:jobId/terminal`

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run tests/api/codex-runtime-control-plane.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because endpoints are missing.

- [ ] **Step 3: Add DTO schemas**

Add strict Zod schemas for each endpoint. Every worker mutation schema must include:

- `worker_session_token`
- `nonce`
- `nonce_timestamp`
- `body_digest`
- operation idempotency key unless naturally sequence-numbered

The worker-facing materialize HTTP DTO may include `launch_token` because the worker proves it decrypted the envelope. The controller or a dedicated guard must hash/scrub that field before calling `CodexRuntimeService`; service and repository DTOs use `launch_token_hash` or `launch_token_proof_digest` only.

- [ ] **Step 4: Add nonce verification**

Hash and store replay keys over canonical `{ method, path, body_digest, worker_id, session_epoch, nonce }`. Reusing the same nonce on a different method/path/body must be rejected because the bound digest differs.

- [ ] **Step 5: Add service methods**

The service must:

- create runtime jobs through `createOrReplayCodexRuntimeJobWithLeaseAndEnvelope`;
- call `createOrReplayCodexRuntimeJobWithLeaseAndEnvelope` without any plaintext token or sealer callback in the service input, persist only sealed envelope fields produced below the repository boundary, and never return raw launch tokens to orchestrators or service callers;
- use worker selection based on online status, scope, capabilities, durable concurrency, image digest, network policy digest, and provider config digest;
- return poll responses with only public-safe input, workspace metadata, envelope metadata, and intervals;
- map envelope claim denial to `codex_launch_materialization_denied` or `codex_worker_unavailable`;
- revalidate action claim or run-worker lease fences before materialization and before product writer consumption.

For `GET /internal/codex-workers/:workerId/runtime-jobs/:jobId/workload`, return a `CodexGenerationWorkloadV1` payload for generation jobs and a `CodexRunExecutionWorkloadV1` payload for run-execution jobs. The endpoint must be accepted-job-bound, worker-session-authenticated, nonce-protected, and absent from product/public APIs.

- [ ] **Step 6: Add action claim renewal endpoint**

Implement `POST /internal/automation/action-runs/:actionRunId/claim/renew` using the existing automation claim repository path. The daemon uses this while waiting for terminal runtime jobs.

- [ ] **Step 7: Run API tests**

Run: `pnpm vitest run tests/api/codex-runtime-control-plane.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/control-plane-api/src/modules/codex-runtime tests/api/codex-runtime-control-plane.test.ts
git commit -m "feat: add codex runtime job control plane api"
```

### Task 8: Artifact Intake And Public-Safe Terminal Results

**Files:**
- Modify: `packages/domain/src/codex-runtime.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts`
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Test: `tests/api/codex-runtime-control-plane.test.ts`
- Test: `tests/db/codex-runtime-repository.test.ts`
- Test: `tests/domain/codex-runtime.test.ts`

- [ ] **Step 1: Write failing artifact tests**

Cover:

- artifact intake accepts only owning runtime job, allowed content type, declared digest, and size limit;
- artifact refs are control-plane-issued and bound to runtime job id, project id, repo id, digest, content type, size, and target kind;
- terminalization rejects worker-invented `internal_ref`;
- terminalization rejects refs from another runtime job;
- terminal result rejects raw prompts, raw notifications, raw logs, endpoints, local paths, socket paths, raw container ids, and auth-like keys;
- oversized generated payloads must be stored as artifact refs rather than inline `terminal_result_json`.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run tests/api/codex-runtime-control-plane.test.ts tests/db/codex-runtime-repository.test.ts tests/domain/codex-runtime.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because artifact intake and terminal ref validation are incomplete.

- [ ] **Step 3: Implement artifact repository methods**

Add create/replay by artifact idempotency key and digest. Store artifact metadata, not raw large bodies, unless the existing internal artifact storage adapter requires a small in-DB test fake.

- [ ] **Step 4: Implement service validation**

Before terminalization, walk `generation_artifacts`, `patch_artifact`, `check_results`, and `execution_artifacts`. Every `internal_ref` must match a previously issued artifact for the same job and digest.

- [ ] **Step 5: Implement public-safe projections**

Keep runtime operator telemetry separate from product/public projection. Product/public projection may include blocker code, user-facing state, safe next-step link, artifact names, content types, digests, and product-safe refs only.

- [ ] **Step 6: Run focused tests**

Run: `pnpm vitest run tests/api/codex-runtime-control-plane.test.ts tests/db/codex-runtime-repository.test.ts tests/domain/codex-runtime.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/codex-runtime.ts apps/control-plane-api/src/modules/codex-runtime packages/db/src/repositories tests/api/codex-runtime-control-plane.test.ts tests/db/codex-runtime-repository.test.ts tests/domain/codex-runtime.test.ts
git commit -m "feat: add codex runtime job artifact intake"
```

### Task 9: Worker Session Refresh, Drain, And Recovery

**Files:**
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.dto.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts`
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Modify: `packages/codex-worker-runtime/src/scavenger.ts`
- Test: `tests/api/codex-runtime-control-plane.test.ts`
- Test: `tests/codex-worker-runtime/scavenger.test.ts`
- Test: `tests/db/codex-runtime-repository.test.ts`

- [ ] **Step 1: Write failing refresh and recovery tests**

Cover:

- session refresh succeeds when there are no active accepted/materializing/running jobs and no queued jobs sealed to the current key;
- refresh refuses assigned queued jobs sealed to current key unless they are cancelled/recovered first;
- refresh can keep old accepted session/key valid for already accepted/materializing/running jobs through envelope/lease expiry;
- drain stops new poll delivery and allows active jobs to finish or cancel;
- stale queued, accepted, materializing, and running jobs recover idempotently with public-safe reason codes;
- recovery repairs `terminal lease + nonterminal job`;
- recovered jobs do not write automation action or run-session product state directly;
- scavenger uses launch lease status and symlink-safe cleanup.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run tests/api/codex-runtime-control-plane.test.ts tests/codex-worker-runtime/scavenger.test.ts tests/db/codex-runtime-repository.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because refresh/drain/recovery is incomplete.

- [ ] **Step 3: Implement refresh state machine**

Persist session epoch and key id. Reject refresh that would leave sealed queued jobs decryptable only by discarded key material. Keep old key/session grace only for already accepted/materializing/running jobs.

- [ ] **Step 4: Implement remote runtime-job recovery**

Add a repository method separate from `recoverStaleCodexWorkerLeases`. It terminalizes runtime jobs and associated leases only, then returns public-safe evidence for orchestrators to consume later.

- [ ] **Step 5: Implement drain semantics**

Store drain request time on worker or jobs. Poll must not deliver new queued jobs to draining workers unless the job is already assigned and safe to complete.

- [ ] **Step 6: Extend scavenger**

On startup, the worker must:

1. Inspect owned temp roots without following symlinks.
2. Query launch lease status for known lease ids.
3. Clean only verified owned temp roots and known containers.
4. Avoid raw path/container ids in public evidence.

- [ ] **Step 7: Run focused tests**

Run: `pnpm vitest run tests/api/codex-runtime-control-plane.test.ts tests/codex-worker-runtime/scavenger.test.ts tests/db/codex-runtime-repository.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/control-plane-api/src/modules/codex-runtime packages/db/src/repositories packages/codex-worker-runtime/src/scavenger.ts tests/api/codex-runtime-control-plane.test.ts tests/codex-worker-runtime/scavenger.test.ts tests/db/codex-runtime-repository.test.ts
git commit -m "feat: add codex runtime job recovery and session refresh"
```

### Task 10: Remote Worker Control-Plane Client

**Files:**
- Modify: `packages/codex-worker-runtime/src/control-plane-client.ts`
- Test: `tests/codex-worker-runtime/control-plane-client.test.ts`

- [ ] **Step 1: Write failing client tests**

Cover:

- trusted orchestrator runtime-job create/cancel/recover methods sign body and path;
- worker poll/accept/claim/workload/materialize/start/event/artifact/control/terminal methods include session token, nonce, nonce timestamp, body digest, and idempotency key;
- GET workload and control methods bind nonce to path and empty body digest;
- failed HTTP responses map to public-safe errors without response body secret leakage.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run tests/codex-worker-runtime/control-plane-client.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because methods are missing.

- [ ] **Step 3: Implement typed client methods**

Add methods:

- `createRuntimeJob`
- `cancelRuntimeJob`
- `recoverStaleRuntimeJobs`
- `getLaunchLeaseStatus`
- `refreshWorkerSession`
- `pollRuntimeJobs`
- `acceptRuntimeJob`
- `claimLaunchTokenEnvelope`
- `fetchRuntimeJobWorkload`
- `materializeRuntimeJob`
- `startRuntimeJob`
- `appendRuntimeJobEvent`
- `uploadRuntimeJobArtifact`
- `getRuntimeJobControl`
- `terminalizeRuntimeJob`

- [ ] **Step 4: Centralize worker request signing**

Add a helper that computes canonical JSON body, `body_digest`, nonce, timestamp, and path-bound replay identity. Keep request construction testable with injected clock and nonce generator.

- [ ] **Step 5: Run client tests**

Run: `pnpm vitest run tests/codex-worker-runtime/control-plane-client.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/codex-worker-runtime/src/control-plane-client.ts tests/codex-worker-runtime/control-plane-client.test.ts
git commit -m "feat: add codex remote worker control plane client"
```

### Task 11: Remote Generation Worker Loop

**Files:**
- Create: `packages/codex-worker-runtime/src/remote-worker-client.ts`
- Create: `packages/codex-worker-runtime/src/runtime-job-artifacts.ts`
- Modify: `packages/codex-worker-runtime/src/app-server-launcher.ts`
- Modify: `packages/codex-worker-runtime/src/index.ts`
- Test: `tests/codex-worker-runtime/remote-worker-client.test.ts`
- Test: `tests/codex-worker-runtime/app-server-launcher.test.ts`

- [ ] **Step 1: Write failing remote generation worker tests**

Use a fake control plane and fake Docker launcher. Cover:

- worker registers with real X25519 public key;
- scavenger runs before online heartbeat;
- poll returns one assigned generation job;
- worker accepts, claims, decrypts, fetches workload, materializes, starts app-server, uploads artifacts, terminalizes;
- cancel before start produces cancelled terminal result;
- app-server startup failure reports public-safe startup evidence;
- launcher close in remote mode does not terminalize launch lease independently;
- cleanup removes per-task `CODEX_HOME`, auth/config, socket dir, artifact temp dir, and container handles.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run tests/codex-worker-runtime/remote-worker-client.test.ts tests/codex-worker-runtime/app-server-launcher.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because remote worker client is missing.

- [ ] **Step 3: Implement remote worker options**

Define `RemoteCodexWorkerClientOptions` with:

- control-plane client
- worker id and identity
- bootstrap token/version
- temp root
- Docker runner and Docker binary config
- supported target kinds
- max concurrency
- image/network/provider digest capabilities
- clock, sleep, nonce, and shutdown hooks for tests

- [ ] **Step 4: Implement lifecycle loop**

Lifecycle order:

1. Generate session key pair.
2. Register or refresh session.
3. Run scavenger.
4. Heartbeat online.
5. Long-poll.
6. For each job, accept, claim, decrypt, fetch workload, materialize, execute, terminalize.
7. Check control directives between app-server turns and at fixed intervals.
8. On shutdown, drain and clean active job resources.

- [ ] **Step 5: Implement generation execution path**

For `target_kind: 'generation'`, use existing `createCodexGenerationRuntime` with app-server transport from `DockerizedCodexAppServerLauncher.startFromMaterialization()`. Validate output schema before terminalization. Store raw notifications and validation reports through job-scoped artifact intake.

- [ ] **Step 6: Run worker tests**

Run: `pnpm vitest run tests/codex-worker-runtime/remote-worker-client.test.ts tests/codex-worker-runtime/app-server-launcher.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/codex-worker-runtime/src/remote-worker-client.ts packages/codex-worker-runtime/src/runtime-job-artifacts.ts packages/codex-worker-runtime/src/app-server-launcher.ts packages/codex-worker-runtime/src/index.ts tests/codex-worker-runtime/remote-worker-client.test.ts tests/codex-worker-runtime/app-server-launcher.test.ts
git commit -m "feat: add remote codex generation worker loop"
```

### Task 12: Automation Daemon Remote Generation Integration

**Files:**
- Modify: `apps/automation-daemon/src/config.ts`
- Modify: `apps/automation-daemon/src/generation-runtime.ts`
- Modify: `apps/automation-daemon/src/main.ts`
- Modify: `packages/automation/src/executor.ts` if action claim renewal context is not already exposed
- Test: `tests/automation/daemon-config.test.ts`
- Test: `tests/automation/daemon.test.ts`
- Test: `tests/api/automation-daemon.integration.test.ts`

- [ ] **Step 1: Write failing daemon tests**

Cover:

- config accepts `FORGELOOP_CODEX_WORKER_MODE=remote_outbound` only when required remote runtime job config is present;
- daemon creates runtime job instead of raw launch lease in remote mode;
- daemon renews action claim while waiting for terminal runtime job;
- lost action claim prevents draft write even if remote job succeeds;
- daemon revalidates action attempt, precondition fingerprint, and revision fences before writing draft;
- remote terminal success writes drafts through existing automation command path;
- timeout requests runtime-job cancellation and leaves action public-safe blocked.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run tests/automation/daemon-config.test.ts tests/automation/daemon.test.ts tests/api/automation-daemon.integration.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because remote generation mode is not wired.

- [ ] **Step 3: Add config parsing**

Update `CodexWorkerMode` to `disabled | local_docker | remote_outbound`. Remote generation requires:

- control-plane URL
- trusted actor signer config already used by daemon
- runtime profile id or profile selection config
- credential binding id
- wait timeout and poll interval

Keep local Docker behavior unchanged.

- [ ] **Step 4: Add remote generation runtime adapter**

The adapter must create `CodexGenerationWorkloadV1`, store or expose signed context through internal workload path, create a runtime job, wait for terminal result, validate schema/digest/task kind/prompt version/output schema version, and return the existing generation runtime result shape.

- [ ] **Step 5: Add action claim renewal while waiting**

Use `POST /internal/automation/action-runs/:actionRunId/claim/renew` before claim expiry. Stop waiting and cancel runtime job if renewal fails.

- [ ] **Step 6: Run daemon tests**

Run: `pnpm vitest run tests/automation/daemon-config.test.ts tests/automation/daemon.test.ts tests/api/automation-daemon.integration.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/automation-daemon/src packages/automation/src/executor.ts tests/automation/daemon-config.test.ts tests/automation/daemon.test.ts tests/api/automation-daemon.integration.test.ts
git commit -m "feat: wire remote codex generation mode"
```

### Task 13: Same-Host Remote Generation Dogfood Smoke

**Files:**
- Modify: `tests/codex-worker-runtime/docker-real-smoke.test.ts`
- Modify: `tests/codex-runtime/codex-app-server-schema-smoke.test.ts` only if remote smoke needs shared helpers
- Create or modify: `scripts/codex-remote-worker-dogfood.ts`
- Test: `tests/smoke/automation-dogfood-script.test.ts`

- [ ] **Step 1: Write opt-in smoke test**

The smoke should be skipped unless an explicit env such as `FORGELOOP_CODEX_REMOTE_DOGFOOD_SMOKE=1` is set. It must:

1. Read protected local `~/.codex/config.toml` and `~/.codex/auth.json` only in bootstrap code.
2. Store config/auth centrally through runtime profile and unsafe DB credential APIs.
3. Start a control-plane test server.
4. Start remote worker process or in-process client using outbound protocol.
5. Run one Spec draft generation through Dockerized app-server.
6. Assert runtime evidence includes Dockerized app-server fields.
7. Assert no host `CODEX_HOME` or raw auth/config appears in public output.

- [ ] **Step 2: Run skipped smoke by default**

Run: `pnpm vitest run tests/codex-worker-runtime/docker-real-smoke.test.ts tests/smoke/automation-dogfood-script.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS with real smoke skipped unless env is set.

- [ ] **Step 3: Implement dogfood script**

Add a script that starts the same-host remote worker against a configured control plane. The script may print runtime job id and safe digests, but not raw tokens, auth, endpoint, container id, local path, prompt, or logs.

- [ ] **Step 4: Run fake/safe smoke tests**

Run: `pnpm vitest run tests/smoke/automation-dogfood-script.test.ts tests/codex-worker-runtime/remote-worker-client.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/codex-remote-worker-dogfood.ts tests/codex-worker-runtime/docker-real-smoke.test.ts tests/smoke/automation-dogfood-script.test.ts
git commit -m "test: add remote codex generation dogfood smoke"
```

### Task 14: Workspace Bundle Storage And Safe Unpack

**Files:**
- Create: `packages/codex-worker-runtime/src/workspace-bundle.ts`
- Modify: `packages/codex-worker-runtime/src/control-plane-client.ts`
- Modify: `packages/codex-worker-runtime/src/index.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.dto.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.controller.ts`
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Modify: `packages/run-worker/src/run-worker.ts`
- Test: `tests/codex-worker-runtime/workspace-bundle.test.ts`
- Test: `tests/codex-worker-runtime/control-plane-client.test.ts`
- Test: `tests/api/codex-runtime-control-plane.test.ts`
- Test: `tests/run-worker/run-worker.test.ts`

- [ ] **Step 1: Write failing workspace bundle tests**

Cover:

- valid `workspace_bundle.v1` manifest passes digest validation;
- archive digest mismatch fails;
- path traversal fails;
- absolute paths fail;
- symlink escape fails;
- special device files fail;
- `.git` indirection outside bundle root fails;
- unpack writes only under per-job temp root;
- returned changed files and patch refs are path-policy checked;
- run-worker can store bundle bytes as a pending artifact before the runtime job row exists;
- pending bundle artifacts are atomically bound to the runtime job during runtime-job creation and only then become worker-downloadable;
- worker downloads bundle bytes only through an authenticated runtime-job-bound bundle endpoint or expiring internal artifact URL;
- download refuses wrong worker, wrong session, non-accepted job, expired job, cancelled job, digest mismatch, size mismatch, and bundle refs for another job.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run tests/codex-worker-runtime/workspace-bundle.test.ts tests/codex-worker-runtime/control-plane-client.test.ts tests/api/codex-runtime-control-plane.test.ts tests/run-worker/run-worker.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because workspace bundle support is missing.

- [ ] **Step 3: Define pending bundle storage and runtime-job binding contract**

Use internal artifact storage as the first backend. The run-worker cannot create a runtime-job-owned artifact before the runtime job exists, so use this explicit sequence:

1. Run-worker holds an active `RunWorkerLease`.
2. Run-worker creates the archive bytes and manifest.
3. Control plane stores archive bytes as a pending workspace bundle artifact bound to `run_session_id`, `execution_package_id`, `run_worker_lease_id`, `bundle_id`, `archive_digest`, `manifest_digest`, expiry, and byte limit. This pending artifact is not downloadable by remote workers.
4. Run-worker calls `createOrReplayCodexRuntimeJobWithLeaseAndEnvelope` with the pending bundle id and digests.
5. The repository transaction validates the pending bundle against the active run-worker lease and binds it to the newly created or replayed runtime job.
6. The runtime job stores `workspace_acquisition_json` containing only the now-bound `bundle_id`, `archive_ref`, digests, expiry, and size limits.
7. Worker download is allowed only for the bound runtime-job bundle.

Add an authenticated download contract:

```text
GET /internal/codex-workers/:workerId/runtime-jobs/:jobId/workspace-bundle/:bundleId
```

The response must stream or return archive bytes only after verifying:

- worker session token, nonce, timestamp, and body digest;
- accepted/materializing job ownership by worker id and accepted session grace;
- target kind is `run_execution`;
- `workspace_acquisition_json.bundle_id`, `archive_ref`, `archive_digest`, `manifest_digest`, expiry, and byte limit match the runtime job row;
- action is not cancelled and job is not terminal;
- artifact ref belongs to the same runtime job/project/repo and expected digest/content type/size.

If the existing internal artifact storage API cannot stream bytes directly, return a one-use expiring internal artifact download URL bound to the same worker id, runtime job id, session epoch, bundle id, digest, and expiry. Do not expose database credentials, host filesystem paths, repository credentials, or raw local artifact paths.

- [ ] **Step 4: Add repository/API/client methods for bundle bytes**

Add:

- repository method `createPendingWorkspaceBundleArtifact`
- repository binding path inside `createOrReplayCodexRuntimeJobWithLeaseAndEnvelope` that consumes a pending bundle and creates the runtime-job artifact binding in the same transaction as job/lease/envelope creation
- repository method `getWorkspaceBundleDownloadForRuntimeJob`
- DTO/schema for the bundle download endpoint
- service method that validates the job and artifact binding
- controller route for bundle download
- client method `downloadWorkspaceBundle`

The worker client method must write the response to a temp file under the per-job temp root and verify byte count plus `archive_digest` before unpack.

- [ ] **Step 5: Implement bundle manifest helpers**

Add:

- `createWorkspaceBundleManifest`
- `validateWorkspaceBundleManifest`
- `verifyWorkspaceBundleArchiveDigest`
- `safeUnpackWorkspaceBundle`
- `collectWorkspaceBundleChangedFiles`
- `createWorkspaceBundlePatchArtifact`

Use internal artifact refs and digests. Do not include raw archive bytes, local paths, repository credentials, or direct local artifact paths in `workspace_acquisition_json`.

- [ ] **Step 6: Add run-worker bundle creation**

Run-worker creates the bundle only after it holds an active `RunWorkerLease`. The bundle must include enough Git metadata or patch base data to compute changed files and patch output after execution. The run-worker then stores the bundle as a pending artifact and passes the pending bundle id/digests into runtime-job creation; it must not create a worker-downloadable runtime-job bundle outside the create/replay transaction.

- [ ] **Step 7: Run bundle tests**

Run: `pnpm vitest run tests/codex-worker-runtime/workspace-bundle.test.ts tests/codex-worker-runtime/control-plane-client.test.ts tests/api/codex-runtime-control-plane.test.ts tests/run-worker/run-worker.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/codex-worker-runtime/src/workspace-bundle.ts packages/codex-worker-runtime/src/control-plane-client.ts packages/codex-worker-runtime/src/index.ts apps/control-plane-api/src/modules/codex-runtime packages/db/src/repositories packages/run-worker/src/run-worker.ts tests/codex-worker-runtime/workspace-bundle.test.ts tests/codex-worker-runtime/control-plane-client.test.ts tests/api/codex-runtime-control-plane.test.ts tests/run-worker/run-worker.test.ts
git commit -m "feat: add codex workspace bundle validation"
```

### Task 15: Remote Run Execution Worker Path

**Files:**
- Modify: `packages/codex-worker-runtime/src/remote-worker-client.ts`
- Modify: `packages/codex-worker-runtime/src/app-server-launcher.ts`
- Modify: `packages/codex-worker-runtime/src/run-session-driver.ts`
- Modify: `packages/run-worker/src/run-worker.ts`
- Test: `tests/codex-worker-runtime/remote-worker-client.test.ts`
- Test: `tests/codex-worker-runtime/run-session-driver.test.ts`
- Test: `tests/run-worker/run-worker.test.ts`

- [ ] **Step 1: Write failing remote run execution tests**

Cover:

- run-worker creates runtime job for `target_kind: 'run_execution'`;
- workload endpoint returns `codex_run_execution_workload.v1` with run session id, execution package id/version, run-worker lease id, workspace bundle id/digest, package prompt ref/digest, execution context ref/digest, path policy digest, required checks digest, output schema version, and expiry;
- poll responses do not include rendered package prompt, execution context, check configuration, or raw package instructions;
- worker downloads/verifies/unpacks workspace bundle;
- worker starts Dockerized app-server from already materialized launch lease;
- run-session driver does not create or materialize a second launch lease;
- changed files, patch artifact, check results, and execution artifacts are uploaded through job-scoped artifact intake;
- out-of-policy changes are rejected before RunSession completion;
- cancellation maps to runtime-job cancellation;
- stale terminal result after lease loss/package revision change is retained only as internal artifact and does not update current RunSession.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run tests/codex-worker-runtime/remote-worker-client.test.ts tests/codex-worker-runtime/run-session-driver.test.ts tests/run-worker/run-worker.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL because remote run execution is incomplete.

- [ ] **Step 3: Add already-materialized app-server driver entrypoint**

Expose a worker-runtime entrypoint that accepts materialized runtime profile/auth and workspace path, then starts app-server without calling launch-lease creation/materialization again.

- [ ] **Step 4: Add remote run execution branch in worker**

For `target_kind: 'run_execution'`, the worker must fetch `CodexRunExecutionWorkloadV1`, download any endpoint-issued internal prompt/context refs, acquire bundle, materialize lease, start app-server with `/workspace`, execute the package prompt from the workload, upload artifacts, terminalize job, and clean up.

The workload endpoint payload is the only worker contract for run instructions. It must include or issue internal downloads for:

- rendered execution package prompt;
- execution context needed by the app-server run-session driver;
- path policy and required checks digests;
- execution package id/version and run session fence data;
- workspace bundle id and digest.

- [ ] **Step 5: Add run-worker remote delegation**

Run-worker must:

1. Hold and renew `RunWorkerLease`.
2. Create workspace bundle archive and store it as a pending workspace bundle artifact bound to the run-worker lease.
3. Create/replay runtime job with the pending bundle id and digests so the repository transaction binds the bundle to the runtime job while creating/replaying job, lease, and envelope.
4. Wait for terminal result.
5. Revalidate run-session status/update fence, execution package version, workspace bundle digest, and path policy.
6. Write RunSession, artifacts, and ReviewPacket through existing writer path only.

- [ ] **Step 6: Run run-execution tests**

Run: `pnpm vitest run tests/codex-worker-runtime/remote-worker-client.test.ts tests/codex-worker-runtime/run-session-driver.test.ts tests/run-worker/run-worker.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/codex-worker-runtime/src packages/run-worker/src tests/codex-worker-runtime/remote-worker-client.test.ts tests/codex-worker-runtime/run-session-driver.test.ts tests/run-worker/run-worker.test.ts
git commit -m "feat: run codex package execution through remote worker"
```

### Task 16: Config, Runbooks, And Strict Dogfood Closure

**Files:**
- Modify: `apps/automation-daemon/src/config.ts`
- Modify: `packages/run-worker/src/run-worker.ts`
- Modify: `scripts/automation-dogfood.ts`
- Modify: `scripts/automation-dogfood-summary.ts`
- Modify: `scripts/delivery-local-codex-dogfood.ts`
- Create: `docs/runbooks/codex-remote-worker-runtime.md`
- Test: `tests/automation/daemon-config.test.ts`
- Test: `tests/run-worker/run-worker.test.ts`
- Test: `tests/smoke/automation-dogfood-script.test.ts`
- Test: `tests/smoke/delivery-local-codex-dogfood-script.test.ts`
- Test: `tests/naming/delivery-naming.test.ts`

- [ ] **Step 1: Write failing config and dogfood tests**

Cover:

- `FORGELOOP_CODEX_WORKER_MODE=remote_outbound` and `FORGELOOP_CODEX_RUN_WORKER_MODE=remote_outbound` require complete remote config;
- strict success requires Dockerized app-server evidence;
- local `exec_fallback` and direct host `CODEX_HOME` do not count as strict remote success;
- dogfood summaries do not leak forbidden fields;
- runbook mentions central config/auth bootstrap and per-task isolation.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm vitest run tests/automation/daemon-config.test.ts tests/run-worker/run-worker.test.ts tests/smoke/automation-dogfood-script.test.ts tests/smoke/delivery-local-codex-dogfood-script.test.ts tests/naming/delivery-naming.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: FAIL until config and scripts are updated.

- [ ] **Step 3: Finalize config parsing**

Document and validate:

- `FORGELOOP_CONTROL_PLANE_URL`
- `FORGELOOP_WORKER_ID`
- `FORGELOOP_WORKER_IDENTITY`
- `FORGELOOP_WORKER_BOOTSTRAP_TOKEN`
- `FORGELOOP_WORKER_BOOTSTRAP_TOKEN_VERSION`
- `FORGELOOP_WORKER_TEMP_ROOT`
- `FORGELOOP_DOCKER_BIN`
- `FORGELOOP_CODEX_DOCKER_IMAGE_DIGEST`
- `FORGELOOP_CODEX_NETWORK_POLICY_DIGEST`
- `FORGELOOP_CODEX_WORKER_SCOPES_JSON`
- `FORGELOOP_CODEX_WORKER_CAPABILITIES`
- `FORGELOOP_WORKER_MAX_CONCURRENCY`

- [ ] **Step 4: Update dogfood reporting**

Report remote runtime mode, Dockerized app-server evidence, public-safe blocker code, artifact names/digests, and high-level timing buckets. Do not report internal ids to broad product summaries unless the existing operator output already allows them.

- [ ] **Step 5: Write runbook**

Include:

- central runtime profile/auth bootstrap from local `~/.codex` into DB;
- starting same-host remote worker;
- generation dogfood;
- run execution dogfood;
- worker drain;
- worker restart and scavenger;
- common public-safe blocker codes and next checks.

- [ ] **Step 6: Run focused closure tests**

Run: `pnpm vitest run tests/automation/daemon-config.test.ts tests/run-worker/run-worker.test.ts tests/smoke/automation-dogfood-script.test.ts tests/smoke/delivery-local-codex-dogfood-script.test.ts tests/naming/delivery-naming.test.ts --pool=forks --no-file-parallelism --maxWorkers=1`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/automation-daemon/src/config.ts packages/run-worker/src/run-worker.ts scripts/automation-dogfood.ts scripts/automation-dogfood-summary.ts scripts/delivery-local-codex-dogfood.ts docs/runbooks/codex-remote-worker-runtime.md tests/automation/daemon-config.test.ts tests/run-worker/run-worker.test.ts tests/smoke/automation-dogfood-script.test.ts tests/smoke/delivery-local-codex-dogfood-script.test.ts tests/naming/delivery-naming.test.ts
git commit -m "docs: add codex remote worker runtime runbook"
```

### Task 17: End-To-End Verification And Cleanup

**Files:**
- Modify only files touched by previous tasks if verification finds issues.

- [ ] **Step 1: Run focused runtime test suite**

Run:

```bash
pnpm vitest run \
  tests/domain/codex-runtime.test.ts \
  tests/db/codex-runtime-repository.test.ts \
  tests/db/codex-runtime-drizzle-concurrency.test.ts \
  tests/api/codex-runtime-control-plane.test.ts \
  tests/codex-worker-runtime/control-plane-client.test.ts \
  tests/codex-worker-runtime/envelope-crypto.test.ts \
  tests/codex-worker-runtime/remote-worker-client.test.ts \
  tests/codex-worker-runtime/scavenger.test.ts \
  tests/codex-worker-runtime/workspace-bundle.test.ts \
  tests/automation/daemon-config.test.ts \
  tests/automation/daemon.test.ts \
  tests/api/automation-daemon.integration.test.ts \
  tests/run-worker/run-worker.test.ts \
  tests/codex-worker-runtime/run-session-driver.test.ts \
  tests/naming/delivery-naming.test.ts \
  --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 2: Run package builds**

Run:

```bash
pnpm --filter @forgeloop/domain build
pnpm --filter @forgeloop/db build
pnpm --filter @forgeloop/codex-runtime build
pnpm --filter @forgeloop/codex-worker-runtime build
pnpm --filter @forgeloop/automation-daemon build
pnpm --filter @forgeloop/run-worker build
pnpm --filter @forgeloop/control-plane-api build
```

Expected: all PASS.

- [ ] **Step 3: Run full test suite when focused suites pass**

Run: `pnpm test`

Expected: PASS. If full suite is too slow for a development loop, capture the focused suite results and run full suite before PR review/merge.

- [ ] **Step 4: Run optional real remote dogfood**

Only when Docker and local Codex credentials are available:

```bash
FORGELOOP_CODEX_REMOTE_DOGFOOD_SMOKE=1 pnpm vitest run tests/codex-worker-runtime/docker-real-smoke.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS with Dockerized app-server evidence and no public secret/path leakage.

- [ ] **Step 5: Inspect for forbidden legacy/raw fields**

Run:

```bash
rg -n "raw launch|launch_token|secret_payload_json|CODEX_HOME|app_server_endpoint|container_id|local_ref|exec_fallback" packages apps tests scripts docs --glob '!docs/superpowers/plans/2026-05-22-codex-remote-worker-runtime-channel.md'
```

Expected: only intentional internal DTO/materialization paths or tests that assert redaction. No public projection or terminal result path leaks forbidden fields. No new legacy priority naming.

- [ ] **Step 6: Run diff check**

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 7: Final commit if cleanup changed files**

```bash
git add <changed-files>
git commit -m "test: verify codex remote worker runtime channel"
```

## Review Checklist For Implementers

- [ ] No remote orchestrator calls the raw-token `createLaunchLease` endpoint.
- [ ] Launch token plaintext exists only long enough to seal an envelope or materialize an accepted job.
- [ ] Runtime-job create/replay cannot mint, rotate, or discard a token on replay.
- [ ] Every retryable mutation stores idempotency key plus canonical request digest.
- [ ] Poll responses are public-safe and do not include workload secrets.
- [ ] Workload endpoint is worker-only and accepted-job-bound.
- [ ] Artifact refs in terminal results are control-plane-issued and job-bound.
- [ ] Terminal job plus terminal lease is committed atomically.
- [ ] Recovery never writes Spec, Plan, Package, RunSession, or ReviewPacket state directly.
- [ ] Session refresh does not strand queued envelopes sealed to discarded keys.
- [ ] Remote worker cleanup is owner-only, no-follow, and temp-root-scoped.
- [ ] Remote run execution never mounts or reads the control-plane repo path.
- [ ] Strict dogfood requires Dockerized app-server runtime evidence.

## Expected Final Verification Commands

Run these before opening or merging the implementation PR:

```bash
pnpm vitest run tests/domain/codex-runtime.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm vitest run tests/db/codex-runtime-repository.test.ts tests/db/codex-runtime-drizzle-concurrency.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm vitest run tests/api/codex-runtime-control-plane.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm vitest run tests/codex-worker-runtime/control-plane-client.test.ts tests/codex-worker-runtime/envelope-crypto.test.ts tests/codex-worker-runtime/remote-worker-client.test.ts tests/codex-worker-runtime/scavenger.test.ts tests/codex-worker-runtime/workspace-bundle.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm vitest run tests/automation/daemon-config.test.ts tests/automation/daemon.test.ts tests/api/automation-daemon.integration.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm vitest run tests/run-worker/run-worker.test.ts tests/codex-worker-runtime/run-session-driver.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm vitest run tests/naming/delivery-naming.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm --filter @forgeloop/domain build
pnpm --filter @forgeloop/db build
pnpm --filter @forgeloop/codex-runtime build
pnpm --filter @forgeloop/codex-worker-runtime build
pnpm --filter @forgeloop/automation-daemon build
pnpm --filter @forgeloop/run-worker build
pnpm --filter @forgeloop/control-plane-api build
git diff --check
```

Run `pnpm test` before merge unless the PR description explicitly records why it was deferred.
