# Codex Remote Worker Runtime Channel Design

Date: 2026-05-22

## Overview

This spec extends the Codex runtime distribution layer from local Docker dogfood into an outbound remote worker runtime. The goal is to let a Codex worker run on another machine, receive delegated generation or run-execution jobs from the control plane, materialize centrally configured Codex runtime profiles and credentials, execute each task inside an isolated Dockerized `codex app-server`, and report public-safe progress and terminal results back to Forgeloop.

The workflow remains PRD-first and human-gated:

- Codex may draft Spec, Plan, and ExecutionPackage artifacts through explicit automation actions.
- Package execution starts only from an approved Plan and a ready ExecutionPackage.
- The remote worker never directly writes product state.
- Approval, review, merge, release, and deployment remain outside automation.

This design intentionally separates authorization/materialization from remote scheduling:

- `CodexLaunchLease` answers whether a specific task can materialize a runtime profile and credential.
- `CodexRuntimeJob` answers how that task is delegated to a worker and how progress or terminal results are reported.
- `CodexLaunchTokenEnvelope` answers how the one-time launch token is transferred to a remote worker without storing or returning it in plaintext.

## Current State

The merged Codex runtime foundation already provides the local shape that remote mode should reuse:

- `packages/codex-runtime` owns Codex app-server generation primitives, protocol helpers, app-server endpoint transport, generated payload validation, and real schema smoke coverage.
- `packages/codex-worker-runtime` owns Docker command construction, per-task filesystem creation, workspace isolation, network policy self-test, Dockerized app-server launch, Docker exec transport, local worker selection, scavenger helpers, and run-session driver wrapping.
- `apps/control-plane-api/src/modules/codex-runtime` owns runtime profiles, unsafe DB credentials, worker registration, heartbeat, launch leases, lease materialization, terminalization, and stale worker recovery.
- Automation generation can run through a local in-process worker shim with Dockerized app-server.
- Run execution can use local Dockerized app-server through run-worker composition when configured.

The remaining gaps are remote-worker specific:

- Worker mode accepts only `disabled` and `local_docker`; there is no `remote_outbound` mode.
- There is no durable runtime-job queue for worker polling and terminal handoff.
- Launch tokens are returned directly to local orchestration; there is no sealed envelope handoff.
- The worker session public key is recorded, but launch-token decryption is not implemented.
- Scavenger code exists, but the control-plane status API it needs is not complete.
- Remote run execution has no workspace-bundle acquisition model.
- Generation artifacts from app-server raw notifications and parsed output are not yet persisted as first-class internal artifacts.

## Goals

1. Add an outbound remote worker channel for Codex runtime jobs.
2. Keep launch lease materialization as the only path that returns raw Codex auth.
3. Transfer raw launch tokens to remote workers only through sealed, one-time envelopes.
4. Run remote generation tasks through Dockerized Codex app-server with per-task `CODEX_HOME`.
5. Run remote package execution tasks through the same runtime-job model using a workspace bundle.
6. Preserve existing command writer boundaries for Spec, Plan, Package, RunSession, and ReviewPacket state.
7. Make queued, accepted, materializing, running, cancelled, expired, and failed remote jobs recoverable and idempotent.
8. Keep all public responses, events, summaries, and terminal evidence free of raw secrets, raw prompts, raw logs, host paths, raw endpoints, and raw container ids.
9. Support a first implementation that runs a remote worker process on the same machine for dogfood while using the same outbound protocol required for another machine.

## Non-Goals

- No UI for editing runtime profiles, credentials, workers, or runtime jobs in this slice.
- No KMS, Vault, or external secret manager in this slice.
- No inbound worker control port, SSH, or server-initiated connection to worker machines.
- No Kubernetes scheduler or autoscaler.
- No cross-machine lossless app-server session migration.
- No direct remote worker writes to product-state tables.
- No automatic Spec approval, Plan approval, Package readiness, ReviewPacket approval, merge, release, deployment, or production push.
- No `codex exec`, CLI fallback, or host-level `CODEX_HOME` path as a strict success path.
- No worker-side git clone credential system in the first remote run-execution slice.

## Architecture Summary

The architecture has four cooperating resources.

### CodexLaunchLease

`CodexLaunchLease` remains the short-lived authorization record for runtime materialization. It binds:

- launch target;
- worker id;
- runtime profile revision;
- credential binding version;
- Docker image digest;
- network policy digest;
- generation action claim fence or run-worker lease fence;
- expiry;
- launch attempt.

Materialization returns raw profile config and raw credential payload only to the selected worker with the correct worker session token, launch token, nonce, timestamp, and materialization request hash.

### CodexRuntimeJob

`CodexRuntimeJob` is the durable remote work item. It binds a target task to a selected worker and launch lease, then records worker progress and terminal output.

Initial status model:

```ts
type CodexRuntimeJobStatus = 'queued' | 'accepted' | 'materializing' | 'running' | 'terminal';

type CodexRuntimeJobTargetKind = 'generation' | 'run_execution';
```

Important fields:

```ts
interface CodexRuntimeJob {
  id: string;
  job_request_id: string;
  target_type: 'automation_action_run' | 'run_session';
  target_id: string;
  target_kind: CodexRuntimeJobTargetKind;
  project_id: string;
  repo_id?: string;
  worker_id: string;
  launch_lease_id: string;
  launch_attempt: number;
  status: CodexRuntimeJobStatus;
  input_digest: string;
  input_json: Record<string, unknown>;
  workspace_acquisition_json?: Record<string, unknown>;
  accept_idempotency_key?: string;
  accept_request_digest?: string;
  accepted_at?: string;
  accepted_worker_session_digest?: string;
  accepted_session_public_key_id?: string;
  accepted_session_epoch?: number;
  materializing_at?: string;
  materialization_request_id?: string;
  materialization_request_digest?: string;
  start_idempotency_key?: string;
  start_request_digest?: string;
  started_at?: string;
  last_event_at?: string;
  cancel_requested_at?: string;
  cancel_idempotency_key?: string;
  cancel_request_digest?: string;
  drain_requested_at?: string;
  terminal_idempotency_key?: string;
  terminal_request_digest?: string;
  terminal_at?: string;
  terminal_status?: 'succeeded' | 'failed' | 'cancelled' | 'expired';
  terminal_reason_code?: string;
  terminal_result_json?: Record<string, unknown>;
  expires_at: string;
  created_at: string;
  updated_at: string;
}
```

Rules:

- Runtime jobs store only public-safe input and terminal result data.
- A runtime job does not store raw launch tokens, raw auth, raw prompts, raw app-server logs, local absolute paths, socket paths, or raw container ids.
- Runtime jobs are idempotent by `job_request_id` and by target plus launch attempt.
- A runtime job can terminalize exactly once.
- Runtime-job recovery must be idempotent.
- Runtime-job state transitions are compare-and-set updates over the current status, assigned worker id, worker session token, and non-terminal fence.
- The repository must enforce uniqueness for `job_request_id`, for active target plus launch attempt, and for one envelope per runtime job.
- Creating or replaying a job first looks up an existing row by `job_request_id` and by target plus launch attempt. Only a confirmed new create path generates a launch token or seals an envelope.
- Replaying `job_request_id` returns the already-created runtime job and envelope metadata; it must not preallocate, mint, rotate, or discard a new launch token or envelope.
- Replaying `job_request_id` or target plus launch attempt succeeds only when target, launch attempt, input digest, workspace acquisition digest, worker id, lease id, profile fence, credential fence, and envelope digest match the original row. Any mismatch fails closed with `codex_runtime_job_unavailable`.
- Runtime-job input stores only canonical request metadata and digests. Raw prompts and signed generation context stay in the existing automation context path or internal artifacts and are fetched only by trusted orchestrator code.
- Inline `terminal_result_json` has a strict byte limit. Oversized generated payloads, notification streams, validation reports, patches, and check logs are stored as internal artifacts referenced by digest and ref.
- Accept persists the accepted worker session digest, public key id, and session epoch. Later claim, workload, materialize, start, event, and terminal calls for that job accept either the current worker session or this persisted per-job accepted session while it remains within the job's envelope and lease expiry.
- Mutating endpoints persist an idempotency key and canonical request digest where retries can cross process or network boundaries. Replays with the same key and digest return the same decision; conflicting replays fail closed.

### CodexLaunchTokenEnvelope

`CodexLaunchTokenEnvelope` is the sealed one-time handoff for raw launch tokens.

Fields:

```ts
interface CodexLaunchTokenEnvelope {
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
  claimed_at?: string;
  expires_at: string;
  created_at: string;
}
```

Envelope rules:

- Create/replay first resolves an existing runtime job by `job_request_id` and target plus launch attempt. Only when no matching job exists does the control plane allocate runtime job id, envelope id, launch lease id, and launch token, then create the launch lease, runtime job, and envelope in one repository transaction.
- If the backing store cannot support that atomic transaction, Slice 1 must add a dedicated repository operation with an equivalent all-or-nothing contract. Service-level coordination of three independently committed writes is not acceptable for remote mode.
- The raw launch token exists only long enough to seal the envelope.
- The DB stores ciphertext, encryption nonce, public authenticated data, and digests, not plaintext.
- Authenticated data includes worker id, runtime job id, launch lease id, envelope id, key id, and expiry.
- `envelope_digest` is computed over canonical public envelope fields, ciphertext, encryption nonce, and AAD digest, excluding `envelope_digest` itself.
- Claiming the envelope is single-use and worker-bound.
- Claiming is idempotent by `claim_request_id`, worker id, worker session digest, key id, and envelope id. A retry with the same claim identity replays the same ciphertext and AAD until the envelope or runtime job expires or terminalizes. A retry with a different claim identity is denied.
- Public errors for claim or decrypt failure use `codex_launch_materialization_denied` or `codex_worker_unavailable`; internal telemetry may retain `codex_launch_token_envelope_denied` after redaction. Public responses must not disclose whether ciphertext, token, key, claim id, or worker identity failed.
- The envelope uses the worker session public key that was active when the job was created. Claim rejects if the worker session, key id, or key expiry no longer matches the accepted worker session.
- The worker session key must be valid for the full envelope TTL plus a small clock-skew allowance. The control plane does not create new envelopes for keys that are too close to expiry.
- If the service observes an old active launch lease without a matching runtime job and envelope, recovery revokes or expires that lease before retrying. It must not attempt to reconstruct an envelope because the raw launch token is no longer available.
- Remote workers generate a real X25519 session key pair at registration time and keep the private key out of logs and persistent task artifacts. On session refresh, old session token/private-key material is retained only for already accepted/materializing/running jobs until those jobs terminalize or their envelope/lease expires, then destroyed.

### RemoteCodexWorkerClient

`RemoteCodexWorkerClient` is an independent process. It connects outbound to the control plane.

Responsibilities:

- Register the worker and publish capabilities.
- Run scavenger before becoming online.
- Heartbeat while idle and while executing.
- Long-poll for assigned runtime jobs.
- Accept one job at a time per lease slot.
- Claim and decrypt launch-token envelope after accepting the job.
- Materialize launch lease.
- Start Dockerized Codex app-server through `DockerizedCodexAppServerLauncher`.
- Execute generation or run-execution workload.
- Report started, progress events, terminal result, and public-safe failure evidence.
- Handle cancel, drain, session refresh, and shutdown.
- Clean up container, per-task `CODEX_HOME`, socket dirs, artifacts temp dir, and workspace bundle temp dir.

Worker filesystem rules:

- The worker creates a fresh per-job temp root with owner-only permissions before writing workload files, `CODEX_HOME`, auth, config, sockets, artifacts, or workspace bundles.
- Secret file writes use no-follow semantics, reject pre-existing symlinks, and verify the final path remains under the per-job temp root.
- Cleanup recursively removes only verified owned temp roots and never follows symlinks.
- Scavenger applies the same path safety rules when cleaning after crashes or recovered jobs.

Worker selection rules:

- The control plane selects only workers that are online, not disabled, not draining unless the job is already assigned, within allowed scope, under durable concurrency limits, and compatible with target kind, Docker image digest, network policy digest, and provider config digest.
- Durable concurrency is derived from active runtime jobs and active launch leases, not only from worker-reported heartbeat counts.
- Worker poll never performs scheduling across workers. It returns only jobs already assigned to the polling worker.
- Multiple processes using the same worker id are not supported in this slice unless they share the same worker session and concurrency accounting. Otherwise, duplicate worker ids are rejected at registration.

Repository and API boundary rules:

- Slice 1 adds `CodexRuntimeJob` and `CodexLaunchTokenEnvelope` domain contracts, DB tables, migrations, Drizzle repository implementation, and InMemory repository implementation before any daemon or worker mode can be enabled.
- Remote mode uses a new repository/service operation, `createOrReplayCodexRuntimeJobWithLeaseAndEnvelope`, rather than the existing `createLaunchLease` API that accepts and returns raw launch tokens for local orchestration.
- The existing raw-token `createLaunchLease` contract remains available only for current local Docker composition until remote mode can fully replace it. Remote orchestrators must not call it.
- Runtime-job repository methods must cover create/replay, poll, accept, claim envelope, materialize, start, append event, cancel, terminalize, recover stale, and launch-lease status lookup.
- New blocker codes and telemetry codes are added to the domain/runtime allowlists in the same Slice 1 change that introduces the runtime-job state machine.
- Configuration parsers for automation daemon and run-worker reject `remote_outbound` until the required Slice 1 contract is present; adding the env value is part of enabling the first remote generation implementation, not a docs-only switch.

## Phase 1: Remote Generation Closure

Phase 1 delivers remote execution for generation tasks:

- `spec_draft`;
- `plan_draft`;
- `package_drafts`.

### Generation Flow

1. Automation daemon claims an `ensure_*_draft` action.
2. Automation daemon fetches the signed generation context.
3. Automation daemon requests a `CodexRuntimeJob` for target kind `generation`.
4. Control plane validates the action claim fence and profile/credential/worker fences.
5. Control plane resolves existing runtime job rows for `job_request_id` and target plus launch attempt.
6. If no matching job exists, control plane allocates runtime job id, launch lease id, envelope id, and launch token, then creates the queued runtime job, active launch lease, and available sealed envelope in one repository transaction.
7. Control plane returns public-safe runtime job metadata without raw launch token.
8. Remote worker polls and receives the queued job without raw launch token.
9. Remote worker marks the job accepted.
10. Remote worker claims and decrypts the envelope.
11. Remote worker fetches the generation workload through a worker-session-authenticated internal workload endpoint.
12. Remote worker materializes the launch lease through a remote runtime-job materialization operation that atomically marks the runtime job `materializing`.
13. Remote worker writes per-task Codex config and auth under its lease temp root.
14. Remote worker starts Dockerized `codex app-server` and marks the runtime job `running`.
15. Remote worker runs the generation prompt.
16. Remote worker stores or reports public-safe artifact refs and generated payload.
17. Remote worker calls the runtime-job terminal endpoint.
18. Control plane terminalizes the runtime job and associated launch lease in one repository transaction.
19. Automation daemon waits for terminal job result.
20. Automation daemon calls the existing signed automation command to write the draft.
21. Automation daemon completes, gate-pends, blocks, or fails the action.

### Generation Workload Acquisition

Runtime-job poll cannot expose raw prompts or raw generation context, but the worker still needs executable input. Phase 1 therefore introduces `CodexGenerationWorkloadV1`.

```ts
interface CodexGenerationWorkloadV1 {
  schema_version: 'codex_generation_workload.v1';
  runtime_job_id: string;
  action_run_id: string;
  task_kind: 'spec_draft' | 'plan_draft' | 'package_drafts';
  prompt_version: string;
  output_schema_version: string;
  signed_context_ref: string;
  signed_context_digest: string;
  prompt_template_digest: string;
  created_at: string;
  expires_at: string;
}
```

Workload rules:

- `input_json` stores only workload ref, schema version, task kind, prompt version, output schema version, and digests.
- The signed generation context and rendered prompt are stored as internal artifacts or retrievable through an internal workload endpoint bound to the runtime job, worker id, worker session token, action claim fence, and expiry.
- Workload fetch revalidates the runtime job is accepted or materializing for the requesting worker and that the action claim fence is still active.
- Workload responses are never exposed through product/public APIs, poll responses, runtime-job terminal results, public summaries, or public events.
- The worker deletes local workload files during normal cleanup and scavenger cleanup. Public evidence may include only workload digests.

Daemon wait rules:

- The automation daemon keeps the action claim alive while it waits for a terminal runtime job through the explicit action-claim renewal endpoint added with this slice.
- If the action claim is lost, the daemon must not write the generated draft. It records a public-safe blocker and leaves the terminal runtime result as an internal artifact for retry or inspection.
- Before writing the draft, the daemon revalidates the action attempt, precondition fingerprint, and current Spec/Plan/Package revision fences used to create the job.
- Waiting is bounded by the runtime job expiry and by the action lock horizon. On timeout, the daemon requests runtime-job cancellation and lets recovery terminalize any stale lease.

### Generation Runtime Output

`terminal_result_json` for generation contains only:

```ts
interface CodexGenerationRuntimeJobResult {
  task_kind: 'spec_draft' | 'plan_draft' | 'package_drafts';
  prompt_version: string;
  output_schema_version: string;
  generated_payload: Record<string, unknown>;
  generated_payload_digest: string;
  generation_artifacts: Array<{
    kind: string;
    name: string;
    content_type: string;
    digest?: string;
    internal_ref?: string;
  }>;
  public_summary: string;
}
```

The result must not include the raw prompt, raw notification stream, raw app-server log, raw context object, HMAC headers, claim token, local paths, auth, or launch token.

Generation artifact rules:

- `generated_payload` may be inline only when it is below the configured runtime-result byte limit and validates against the current output schema.
- Raw app-server notifications, model trace payloads, validation reports, and prompt/context digests are persisted through the job-scoped artifact intake endpoint and referenced by digest; only redacted control-plane-issued artifact refs are copied into `terminal_result_json`.
- Workers may not invent `internal_ref` values. Terminal results can reference only artifact refs previously issued by control-plane artifact intake for the same runtime job, project, repo, digest, content type, and size.
- Generation artifact refs are converted to the existing `ArtifactRef` command shape before automation commands write product state. The bridge must emit `artifact://` storage URIs and must not emit `local_ref`.
- The automation daemon treats the terminal result as untrusted until it revalidates schema, digest, task kind, prompt version, and output schema version.
- App-server protocol compatibility is verified by the same schema-smoke path used by the local Docker runtime; remote generation must fail closed on unknown required schema fields.

### Phase 1 Acceptance

Phase 1 is accepted when:

- `FORGELOOP_CODEX_WORKER_MODE=remote_outbound` can run Spec, Plan, and Package draft generation through a remote worker process.
- The remote worker can run on the same host as dogfood while using only the remote channel.
- The worker uses Dockerized app-server and per-task `CODEX_HOME`.
- The action writer boundary remains unchanged.
- Raw auth is returned only from launch lease materialization.
- Raw launch token is not stored in runtime-job rows, envelope rows, logs, poll responses, or terminal responses.
- Queued, accepted, materializing, and running generation jobs recover with public-safe blocker codes.
- Cancelling a generation job attempts app-server turn interrupt and terminalizes job and lease.
- Existing fake generation tests still pass.
- Real opt-in Docker app-server smoke can prove the path with current Codex app-server schema.

## Phase 2: Remote Run Execution

Phase 2 extends the same runtime-job channel to package execution. The main addition is `WorkspaceBundle`, because a remote worker cannot mount the control-plane machine's local repo path.

### Workspace Bundle

Initial bundle mode:

```ts
interface WorkspaceBundleV1 {
  schema_version: 'workspace_bundle.v1';
  bundle_id: string;
  project_id: string;
  repo_id: string;
  run_session_id: string;
  execution_package_id: string;
  base_commit_sha: string;
  allowed_paths: string[];
  forbidden_paths: string[];
  source_mutation_policy: 'path_policy_scoped';
  archive_ref: string;
  archive_digest: string;
  manifest_digest: string;
  created_at: string;
}
```

Bundle rules:

- The bundle is created only after the run-worker has an active run-worker lease.
- The bundle includes enough Git metadata or patch base data to compute changed files and produce a patch artifact after execution.
- The bundle digest is validated before unpack.
- The bundle is unpacked only under the worker's per-lease temp root.
- Unpack rejects path traversal, absolute paths, symlink escape, special device files, and `.git` indirection outside the bundle root.
- The container sees the unpacked workspace at `/workspace`.
- Returned changed files, patch, and artifacts are revalidated against the ExecutionPackage path policy before RunSession completion.
- The worker downloads the bundle through a worker-session-authenticated internal endpoint or receives an expiring internal artifact URL bound to the runtime job. It never receives direct database credentials or control-plane host filesystem paths.
- Bundle acquisition metadata in `workspace_acquisition_json` contains only `bundle_id`, `archive_ref`, digests, expiry, and size limits. It does not contain raw archive bytes, local paths, or repository credentials.
- Bundle creation and patch extraction are owned by the run-worker/control-plane side. The remote worker only validates, unpacks, executes, summarizes, and uploads artifacts.
- The run-worker keeps the RunWorkerLease alive while waiting for remote terminal result. If the lease is lost, it must not complete the RunSession from that runtime job without a fresh fence check.

### Run Execution Flow

1. Human or existing workflow marks an ExecutionPackage ready.
2. A RunSession is created.
3. Run-worker claims a RunWorkerLease.
4. Run-worker prepares `workspace_bundle.v1`.
5. Run-worker requests a runtime job with target kind `run_execution`.
6. Control plane validates run-session fence, package version fence, run-worker lease fence, profile fence, credential fence, and worker capability.
7. Control plane resolves existing runtime job rows first; only a new create path mints the launch token and creates the runtime job, launch lease, and envelope in one repository transaction.
8. Remote worker polls, accepts, claims envelope, materializes the launch lease, and atomically moves the runtime job to `materializing`.
9. Remote worker downloads and validates workspace bundle.
10. Remote worker starts Dockerized app-server with `/workspace` and marks the runtime job `running`.
11. Existing Codex app-server run-session driver executes the package prompt.
12. Remote worker captures changed files, checks, artifacts, execution summary, and public events.
13. Remote worker calls the runtime-job terminal endpoint, which terminalizes launch lease and runtime job atomically.
14. Run-worker/control-plane consumes terminal result and writes RunSession, artifacts, and ReviewPacket through existing product-state boundaries.

Run result rules:

- Remote run-execution terminal results include changed-file lists, patch artifact refs, check summaries, run metadata, and public-safe blocker codes, not raw terminal logs or host paths.
- Patch refs, check output refs, and execution artifact refs must be issued by the job-scoped artifact intake endpoint before terminalization. Terminalization rejects refs that are not bound to the same runtime job, project, repo, digest, content type, size, and package path policy.
- The control plane revalidates execution package version, run-session status/update fence, RunWorkerLease fence, workspace bundle digest, and package path policy before writing a terminal RunSession.
- If the remote worker succeeds after cancellation, lease loss, package revision change, or RunSession replacement, the result is retained only as an internal artifact and must not update the current RunSession.
- Remote run execution starts Codex from an already materialized launch lease by reusing `DockerizedCodexAppServerLauncher.startFromMaterialization()` or an equivalent worker-runtime entrypoint. It must not call a driver path that creates or materializes a second launch lease.

`terminal_result_json` for run execution contains only:

```ts
interface CodexRunExecutionRuntimeJobResult {
  task_kind: 'run_execution';
  execution_package_id: string;
  execution_package_version: number;
  run_session_id: string;
  workspace_bundle_digest: string;
  changed_files: string[];
  patch_artifact?: {
    content_type: 'text/x-diff';
    digest: string;
    internal_ref: string;
  };
  check_results: Array<{
    name: string;
    status: 'passed' | 'failed' | 'skipped';
    summary: string;
    output_digest?: string;
    output_internal_ref?: string;
  }>;
  execution_artifacts: Array<{
    kind: string;
    name: string;
    content_type: string;
    digest?: string;
    internal_ref?: string;
  }>;
  public_summary: string;
}
```

### Phase 2 Acceptance

Phase 2 is accepted when:

- `FORGELOOP_CODEX_RUN_WORKER_MODE=remote_outbound` can run a local Codex package execution through remote worker channel.
- Remote worker does not mount or read the control-plane repo path.
- Workspace bundle validation rejects unsafe archives.
- Returned patch and changed files are rejected if they violate package path policy.
- RunSession cancellation maps to runtime job cancellation.
- Lost remote worker heartbeats move run sessions to stalled or failed with public-safe blocker codes.
- ReviewPacket and artifact persistence remain controlled by existing run-worker/control-plane writer boundaries.

## Control Plane APIs

The API remains internal.

Trusted orchestrator endpoints:

```text
POST /internal/codex-runtime/runtime-jobs
GET  /internal/codex-runtime/runtime-jobs/:jobId
POST /internal/codex-runtime/runtime-jobs/:jobId/cancel
POST /internal/codex-runtime/runtime-jobs/recover-stale
GET  /internal/codex-launch-leases/:leaseId/status
POST /internal/automation/action-runs/:actionRunId/claim/renew
```

Worker session endpoints:

```text
POST /internal/codex-workers/register
POST /internal/codex-workers/:workerId/heartbeat
POST /internal/codex-workers/:workerId/session/refresh
POST /internal/codex-workers/:workerId/runtime-jobs/poll
POST /internal/codex-workers/:workerId/runtime-jobs/:jobId/accepted
POST /internal/codex-workers/:workerId/runtime-jobs/:jobId/envelope/claim
GET  /internal/codex-workers/:workerId/runtime-jobs/:jobId/workload
POST /internal/codex-workers/:workerId/runtime-jobs/:jobId/materialize
POST /internal/codex-workers/:workerId/runtime-jobs/:jobId/started
POST /internal/codex-workers/:workerId/runtime-jobs/:jobId/events
POST /internal/codex-workers/:workerId/runtime-jobs/:jobId/artifacts
GET  /internal/codex-workers/:workerId/runtime-jobs/:jobId/control
POST /internal/codex-workers/:workerId/runtime-jobs/:jobId/terminal
```

Endpoint rules:

- Orchestrator endpoints require trusted automation actor signing.
- Worker endpoints require worker session token, nonce, nonce timestamp, body digest, and replay protection. Replay protection binds nonce to method, path, body digest, worker id, and session epoch with a bounded TTL and clock-skew allowance.
- Worker session refresh rotates session token and session public key before expiry, reuses the active worker identity, does not require re-consuming a bootstrap token, and refuses refresh while the worker has active accepted, materializing, or running jobs unless the old session token and key remain valid for those jobs through their envelope and lease expiry.
- Worker session refresh refuses while the worker has assigned queued jobs whose envelopes were sealed to the current public key. It must not leave a queued job sealed to a discarded key.
- Worker poll returns only jobs assigned to that worker.
- Worker accept persists accepted worker session digest, accepted session public key id, and accepted session epoch. Accept replays by idempotency key and request digest; conflicting accept calls fail closed.
- Worker accept, started, event, and terminal operations reject wrong worker, stale session token outside the accepted-job grace window, replayed nonce, terminal job, expired job, or invalid state transition.
- Envelope claim rejects wrong worker, stale session token, expired session key, replayed nonce, expired job, cancelled job, before accept, after terminal, and after envelope expiry or revocation.
- Envelope claim is single-use with same-claim replay, as defined by the envelope rules.
- Runtime-job creation must create or replay the launch lease and seal the launch token in the same repository operation.
- Runtime-job creation never returns raw launch token to the orchestrator in remote mode. It returns runtime job id, envelope id/digest, selected worker id, lease id, expiry, and public-safe scheduling evidence.
- Runtime-job materialization validates the claimed envelope, worker session, launch token, action claim or RunWorkerLease fence, runtime job state, absence of `cancel_requested_at`, and launch lease fence, then atomically materializes the lease and marks the job `materializing`.
- Runtime-job materialization is idempotent by `materialization_request_id`, request digest, worker id, accepted session digest, and key id. If the DB commit succeeds but the response is lost, the same worker session or accepted-job grace session can replay the same materialization request and receive the same raw config/auth until the job terminalizes or the lease expires. Conflicting replays are denied.
- Poll responses include only public-safe input, workspace acquisition metadata, envelope metadata, and heartbeat/control intervals. They do not include raw prompts, raw generation context, raw launch token, raw auth, or raw archive content.
- Workload responses are internal worker-only responses. They may contain raw prompt/context material needed for execution, but they require worker session authentication, accepted-job ownership, active action or run-worker fence, absence of `cancel_requested_at`, and strict redaction from logs.
- Started endpoint rejects jobs with `cancel_requested_at`; a worker that observes cancel after materialization must terminalize cancelled or let recovery terminalize unavailable, never move the job to running.
- Heartbeat and the job control endpoint return cancel, drain, session-refresh, and shutdown directives. Long-running workers must check control directives between app-server turns and at a fixed interval during streaming output.
- Artifact intake endpoint accepts worker-uploaded artifacts only for the owning runtime job, content type allowlist, declared digest, size limit, and target kind. It returns a control-plane-issued artifact ref bound to runtime job id, project id, repo id, digest, content type, size, and path-policy metadata.
- Terminal endpoint is idempotent by terminal idempotency key. A second terminal call with the same key and identical digest replays; a conflicting terminal call is rejected.
- Terminal endpoint terminalizes the runtime job and associated launch lease in one repository transaction. Recovery must also repair any legacy or interrupted `terminal lease + nonterminal job` inconsistency by terminalizing the job with the lease terminal reason.
- Event endpoint enforces per-job sequence numbers or idempotency keys so retries do not duplicate user-visible progress.
- Claim, cancel, materialize, start, and terminal operations lock the runtime job row and relevant envelope and lease rows in a single DB transaction before deciding. They use DB server commit time or a monotonic DB transaction sequence for cancel/terminal ordering, not worker timestamps.

Minimum DTO fields:

- Every worker mutation includes `worker_session_token`, `nonce`, `nonce_timestamp`, `body_digest`, and an operation idempotency key where the operation is not naturally sequence-numbered.
- Poll request includes worker session token, nonce fields, max jobs, supported target kinds, and current active job ids.
- Accept request includes `accept_idempotency_key`, accepted session digest, accepted public key id, accepted session epoch, and request digest.
- Envelope claim request includes `claim_request_id`, accepted session digest, accepted public key id, accepted session epoch, and request digest.
- Materialize request includes `materialization_request_id`, launch token, accepted session digest, accepted key id, action or RunWorkerLease fence digest, and request digest.
- Start request includes `start_idempotency_key`, app-server runtime evidence digest, launch materialization digest, and request digest.
- Event request includes monotonic sequence number, event idempotency key, public-safe event payload, and payload digest.
- Artifact intake request includes artifact idempotency key, content type, declared digest, byte size, optional path-policy metadata, and upload body or upload ref.
- Terminal request includes terminal idempotency key, terminal status, reason code, terminal result digest, referenced artifact refs, and request digest.
- Cancel request includes cancel idempotency key, requester actor or orchestrator identity, reason code, and request digest.

## State Machine

Primary state transitions:

```text
queued -> accepted -> materializing -> running -> terminal
queued -> terminal
accepted -> terminal
materializing -> terminal
running -> terminal
```

Transition semantics:

- `queued`: job and envelope exist; worker has not accepted.
- `accepted`: worker has accepted with a current worker session; envelope can be claimed by that session.
- `materializing`: worker has claimed the envelope and materialized the launch lease; raw config/auth may exist only in worker temp roots, and recovery must treat this like a worker-owned resource even if app-server has not started.
- `running`: worker has started runtime work. The runtime job stores a public-safe launch-materialization digest and app-server runtime evidence digest.
- `terminal`: no further worker events or terminal updates are accepted.

Cancel semantics:

- Cancel can be requested for queued, accepted, materializing, or running jobs.
- Queued cancel terminalizes job and revokes lease.
- Accepted cancel terminalizes the job and revokes the lease when no envelope has been claimed. If the envelope has already been claimed, cancel marks `cancel_requested_at`, rejects subsequent workload/materialize/start attempts, requests worker cleanup, and recovery terminalizes the job if the worker disappears.
- Materializing cancel revokes control-plane authorization, requests worker cleanup, and relies on worker scavenger to remove any already-written config/auth temp roots.
- Running cancel instructs worker to interrupt app-server turn and clean up.
- Cancel requests are durable and monotonic. A terminal success that races after `cancel_requested_at` is accepted only when the control plane proves cancellation was requested after the terminal result was committed; otherwise it is normalized to cancelled or rejected for product-state consumption.
- Repeated cancel requests are idempotent by cancel idempotency key and never clear an existing cancel request.

Recovery semantics:

- Queued timeout terminalizes job and revokes or expires lease.
- Accepted timeout terminalizes job and revokes or expires lease; unclaimed envelopes are revoked, and claimed envelopes remain claimed but unusable because materialization requires the active lease and worker session.
- Materializing timeout or heartbeat loss terminalizes job with `codex_worker_unavailable`, terminalizes or expires the materialized lease, revokes any unclaimed envelope, and leaves worker-side cleanup to scavenger after lease-status observation.
- Running heartbeat loss terminalizes job with `codex_worker_unavailable`, terminalizes or expires lease, and lets worker scavenger clean host resources later.
- Recovery is idempotent and must not duplicate automation action or run-session transitions.
- Startup failures after materialization report public-safe startup evidence.
- Recovery never writes Spec, Plan, Package, RunSession, or ReviewPacket state directly from worker output. It only terminalizes runtime resources and emits blocker evidence for the existing orchestrator/writer path to consume idempotently.
- Remote runtime-job recovery is separate from the existing stale launch-lease recovery path that can directly transition automation actions or run sessions. Existing local Docker recovery may remain for local mode, but remote mode uses runtime-job recovery first and lets automation daemon or run-worker consume terminal runtime-job evidence through their normal writer boundaries.
- If a worker comes back after recovery, its terminal call is rejected when the runtime job is already terminal. The worker then scavenges local resources after observing launch lease status.
- Automation daemon and run-worker call `recover-stale` on startup and on a fixed control-plane-configured interval. Tests use injected DB clock and explicit stale thresholds.
- Staleness decisions use DB server time, runtime-job expiry, envelope expiry, lease expiry, and heartbeat grace. They do not use worker wall-clock time.
- Drain requests stop new assignment and poll delivery for new jobs, allow already accepted/materializing/running jobs to reach terminal or cancel, and let the worker shut down only after no active jobs remain or after forced recovery.

## Public-Safe Events

Remote worker channel adds these event types:

```text
runtime_job_queued
runtime_job_accepted
runtime_job_started
runtime_job_progress
runtime_job_cancel_requested
runtime_job_terminal
runtime_job_recovered
```

There are two projection tiers:

- Internal public-safe telemetry can include stable internal ids and digests for operators and tests.
- Product/public API projections expose only user-facing state, blocker codes, messages, safe next-step links, artifact names, and high-level runtime mode. They must not pass through runtime job ids, launch lease ids, worker ids, profile ids, credential binding ids, lease timing, local paths, raw config, or raw runtime metadata unless a separate product design explicitly allows it.

Allowed internal public-safe telemetry fields:

- runtime job id;
- launch lease id;
- worker id;
- target kind, type, and id;
- profile id, profile revision id, and profile digest;
- credential binding id, credential version id, and credential payload digest;
- Docker image digest;
- app-server selected mode;
- effective config digest;
- network policy digest;
- workspace bundle digest;
- blocker code;
- artifact digests and refs.

Internal public-safe telemetry with profile, credential, worker, or digest identifiers stays in runtime operator logs and tests. It must not be copied into broad product analytics, user-facing summaries, or public query projections.

Allowed product/public projection fields:

- target kind and user-facing target label;
- runtime mode;
- user-facing state;
- blocker code and message;
- safe next-step link;
- artifact names, content types, digests, and product-safe refs;
- high-level timing buckets, not raw lease or worker session timing.

Forbidden public event fields:

- raw auth;
- raw launch token;
- raw bootstrap token;
- raw worker session token;
- raw prompt;
- raw generation context;
- raw app-server notifications;
- raw logs;
- local absolute paths;
- socket paths;
- raw app-server endpoints;
- raw container id;
- Docker socket path;
- raw workspace archive content.

## Worker Configuration

Add worker modes:

```ts
type CodexWorkerMode = 'disabled' | 'local_docker' | 'remote_outbound';
```

Generation mode:

```text
FORGELOOP_CODEX_WORKER_MODE=remote_outbound
```

Run-execution mode:

```text
FORGELOOP_CODEX_RUN_WORKER_MODE=remote_outbound
```

Remote worker process config:

```text
FORGELOOP_CONTROL_PLANE_URL
FORGELOOP_WORKER_ID
FORGELOOP_WORKER_IDENTITY
FORGELOOP_WORKER_BOOTSTRAP_TOKEN
FORGELOOP_WORKER_BOOTSTRAP_TOKEN_VERSION
FORGELOOP_WORKER_TEMP_ROOT
FORGELOOP_DOCKER_BIN
FORGELOOP_CODEX_DOCKER_IMAGE_DIGEST
FORGELOOP_CODEX_NETWORK_POLICY_DIGEST
FORGELOOP_CODEX_WORKER_SCOPES_JSON
FORGELOOP_CODEX_WORKER_CAPABILITIES
FORGELOOP_WORKER_MAX_CONCURRENCY
```

The worker must not require a preconfigured `~/.codex`. The only Codex auth/config used for runtime tasks comes from launch lease materialization into per-task `CODEX_HOME`.

Worker identity and restart rules:

- `FORGELOOP_WORKER_ID` is a stable operator-provided id for the worker installation. `FORGELOOP_WORKER_IDENTITY` is the bootstrap identity used to authorize registration and scope/capability ceilings.
- A worker persists only non-secret installation metadata by default. Session tokens and private keys are process memory by default and are rotated through session refresh.
- If a worker process crashes, it restarts with the same worker id and bootstrap identity, runs scavenger before going online, and registers or refreshes according to control-plane session state.
- Re-registration with the same worker id is allowed only when the previous session is expired, explicitly replaced by a refresh/recover operation, or marked offline by stale-worker recovery. It must not create concurrent active sessions for the same worker id.
- Bootstrap token reuse after initial registration is accepted only through a defined replacement/recovery path that invalidates the prior session and requires scavenger completion before online heartbeat.

Centralized Codex config and auth rules:

- Runtime profile revisions own `codex_config_toml`, expected effective config digest, Docker image, resource limits, and network policy.
- Credential binding versions own the unsafe DB `auth.json` payload and payload digest for this slice.
- Each runtime task receives exactly one materialized config/auth pair through its launch lease and writes them under a fresh per-task `CODEX_HOME`.
- Worker host `~/.codex`, environment variables, and globally installed Codex config are not read by the task container except for the configured Docker image and worker process dependencies.
- Tests may bootstrap runtime profile/config/auth from the developer machine's protected local `~/.codex` files, but the worker execution path must still consume them only after they are stored centrally and materialized through the lease.

## Error Handling

Public blocker codes should reuse existing codes when possible:

- `codex_worker_unavailable`;
- `codex_worker_capability_mismatch`;
- `codex_launch_lease_denied`;
- `codex_launch_materialization_denied`;
- `codex_runtime_workspace_isolation_unavailable`;
- `codex_app_server_unavailable`;
- `codex_app_server_effective_config_mismatch`;
- `codex_worker_docker_policy_unavailable`;
- `codex_docker_runtime_evidence_unsafe`;
- `codex_generation_timeout`;
- `codex_generation_cancelled`;
- `generated_output_invalid_json`;
- `generated_output_schema_invalid`;
- `generated_output_too_large`.

New public blocker codes:

- `codex_runtime_job_unavailable`;
- `codex_runtime_job_expired`;
- `codex_runtime_job_cancelled`;
- `codex_workspace_bundle_invalid`;

New internal telemetry code:

- `codex_launch_token_envelope_denied`.

`codex_launch_token_envelope_denied` is internal/public-safe telemetry only unless a product surface explicitly needs it later. Worker-facing claim and decrypt responses map it to `codex_launch_materialization_denied` or `codex_worker_unavailable` to avoid creating an oracle.

Private errors may include more detail in internal logs only after redaction. No public error may include secrets, host paths, endpoints, container ids, raw logs, raw prompts, or raw auth/config payloads.

Existing code integration points:

- Control plane API work is under `apps/control-plane-api/src/modules/codex-runtime` for runtime-job endpoints and `apps/control-plane-api/src/modules/run-control` for run-session consumption.
- Worker runtime work is under `packages/codex-worker-runtime`; the remote client must not reuse the local worker's placeholder key behavior.
- Remote worker launcher integration must provide a close strategy that does not independently terminalize the launch lease before the runtime-job terminal endpoint. The remote path either disables automatic lease terminalization in `DockerizedCodexAppServerLauncher.close()` or routes close through the runtime-job terminal operation that atomically terminalizes job and lease.
- Run-worker orchestration work is under `packages/run-worker` and must replace local `repo.local_path` assumptions with workspace bundle acquisition in remote mode.
- Generation runtime work is under `packages/codex-runtime` and `apps/automation-daemon`; remote mode must preserve the app-server schema adapter and real schema smoke path.

## Implementation Slices

### Slice 1A: Runtime Job Persistence Core

Build:

- domain contracts;
- DB schema, migration, Drizzle repository methods, and InMemory repository methods for `codex_runtime_jobs` and `codex_launch_token_envelopes`;
- runtime-job state machine;
- create/replay repository method that checks existing rows before minting launch tokens or envelopes;
- persisted accepted session/key fields, materialization idempotency fields, cancel idempotency fields, and terminal idempotency fields;

Acceptance:

- Runtime jobs are idempotent.
- Repository tests prove create-lease/job/envelope is atomic and replays without minting a new launch token.
- Repository tests prove conflicting `job_request_id`, target attempt, accept, materialize, start, cancel, and terminal replays fail closed.
- Repository tests prove active-job filters use `status != terminal` and terminal outcomes use `status = terminal` plus `terminal_status`.

### Slice 1B: Envelope Crypto And Claim

Build:

- envelope contracts and crypto adapter;
- Node WebCrypto X25519/HKDF-SHA256/AES-256-GCM capability probe and deterministic test vectors;
- AAD canonicalization, key id derivation, envelope digest, and same-claim replay;
- claim/cancel/materialize single-transaction CAS over job, envelope, and lease rows;

Acceptance:

- Envelope claim is single-use with same-claim replay.
- Worker cannot claim another worker's job.
- Wrong worker, stale session outside accepted-job grace, expired key, cancelled job, and replayed nonce are denied without oracle details.
- Claim/cancel race tests cannot produce terminal job plus newly claimed envelope inconsistency.

### Slice 1C: Worker Runtime APIs And Recovery

Build:

- control-plane create/poll/accept/claim/materialize/start/event/artifact/terminal/cancel/recover endpoints;
- worker session refresh endpoint;
- launch lease status endpoint and client support;
- worker selection helper over active profiles, credentials, worker scope, capabilities, durable concurrency, and runtime policy digests;
- result/artifact size caps and sanitizer shared by runtime-job terminalization and product projections;
- remote materialization path that atomically materializes launch lease and marks the runtime job `materializing`;
- terminal path that atomically terminalizes runtime job and associated launch lease;
- job-scoped artifact intake and terminal artifact-ref validation;
- nonce replay store bound to method, path, body digest, worker id, and session epoch;
- stale recovery scheduler contract, deterministic DB-clock thresholds, drain semantics, and launch lease status API;
- redaction tests;

Acceptance:

- Recovery is idempotent for queued, accepted, materializing, and running jobs.
- Public projections do not leak forbidden values.
- Repository tests prove accepted/materializing/running recovery and `terminal lease + nonterminal job` repair.
- Worker selection rejects draining, saturated, wrong-scope, wrong-image, wrong-network-policy, wrong-provider-config, and wrong-target-kind workers.
- Materialization response loss can be safely replayed by the same accepted session and request digest until lease expiry or terminalization.
- Terminalization rejects worker-supplied artifact refs that were not issued by job-scoped artifact intake.

### Slice 2: Remote Generation Worker

Build:

- `remote-worker-client.ts`;
- `remote_outbound` generation mode in automation daemon;
- daemon wait-for-terminal-job behavior;
- generation workload artifact/endpoint acquisition;
- action-claim renewal and pre-write fence revalidation while waiting for a remote job;
- Dockerized app-server generation through remote worker;
- generation artifact refs for prompt digest, raw notification internal artifact, parsed output digest, and validation report digest.

Acceptance:

- Remote generation returns valid Spec, Plan, and Package payloads.
- Automation commands still write drafts.
- Cancel and recovery work for generation jobs.
- Real opt-in Docker app-server generation smoke passes.

### Slice 3: Remote Run Execution Bundle

Build:

- `workspace-bundle.ts`;
- workspace bundle API or internal artifact storage contract;
- run-worker runtime-job delegation;
- RunWorkerLease renewal and pre-terminal RunSession/package fence revalidation;
- remote worker bundle download/verify/unpack;
- remote run-execution result handoff;
- already-materialized app-server run-session driver entrypoint;
- path-policy revalidation.

Acceptance:

- Remote run execution can complete a local Codex RunSession.
- Unsafe bundle entries are rejected.
- Out-of-policy changes are rejected.
- RunSession terminalization and ReviewPacket creation remain in existing writer path.

### Slice 4: Dogfood and Operations Closure

Build:

- bootstrap support for remote worker setup;
- strict dogfood reporting for local and remote modes;
- scavenger integration with launch lease status;
- worker drain and session refresh;
- docs/runbook for starting a remote worker.

Acceptance:

- Same-machine remote worker dogfood passes using outbound protocol.
- Real Dockerized app-server path is required for strict success.
- Worker restart cleans stale containers and temp roots.
- No public summary or event leaks forbidden values.

## Test Strategy

Unit tests:

- runtime-job state transitions;
- envelope digest, encryption AAD, single-use claim, and redaction;
- materialization idempotency and same-request raw materialization replay;
- public event sanitizer;
- worker polling and lease-slot concurrency;
- worker temp-root no-follow, owner-only permission, and symlink-safe cleanup helpers;
- workspace bundle manifest validation and path safety;
- app-server terminal failure mapping.

API tests:

- runtime-job create/replay;
- poll authorization;
- accept/start/event/terminal state validation;
- cancel before and after accept;
- recovery for queued, accepted, materializing, and running jobs;
- wrong-worker envelope claim denial;
- nonce replay denial across method, path, body digest, worker id, and session epoch;
- job-scoped artifact intake and terminal ref validation;
- terminal idempotency;
- launch lease and runtime job terminal consistency.

Integration tests:

- remote generation fake worker;
- remote generation Docker app-server worker;
- automation daemon remote generation closure;
- remote run-execution fake worker;
- remote run-execution workspace bundle rejection;
- run-worker remote execution terminal result consumption.

Real dogfood opt-in tests:

- start control plane;
- bootstrap runtime profile and unsafe DB auth from protected local `auth.json`;
- start remote worker process using outbound channel;
- run generation through Dockerized Codex app-server;
- run one bounded run-execution package through workspace bundle;
- verify runtime evidence includes Dockerized app-server fields;
- verify no host `CODEX_HOME` use.

## Rollout

1. Keep `local_docker` as the default dogfood path while building remote channel.
2. Add `remote_outbound` behind explicit env flags.
3. Run remote generation dogfood on same host.
4. Run remote run-execution dogfood on same host with workspace bundle.
5. Move worker process to another host only after same-host remote dogfood passes.
6. Keep direct endpoint mode and local Docker mode available for development, but strict success requires Dockerized app-server runtime evidence.

## Implementation Decisions

1. Envelope crypto uses a `CodexLaunchTokenEnvelopeCrypto` adapter backed by Node WebCrypto X25519, HKDF-SHA256, and AES-256-GCM in the supported Node 22 runtime. Startup and tests fail closed if X25519 support is unavailable.
2. Workspace bundle storage initially uses internal artifact storage with durable refs and digests for same-host dogfood. A durable object store can replace only the storage adapter later.
3. Runtime job control uses long-poll for the first remote worker. WebSocket control channels can be added later without changing runtime-job semantics.
4. Remote run-execution patch application remains a review artifact in this slice. Automatically applying the patch to the canonical repo is out of scope.
5. If the existing repository abstraction cannot express a single atomic create-lease/job/envelope operation cleanly, Slice 1 introduces a dedicated repository method rather than coordinating three independently committed writes from the service layer.
6. If app-server schema compatibility changes again, remote mode follows the local Docker schema adapter and smoke tests instead of adding a remote-only protocol fork.

## Acceptance Summary

This wave is done when:

- Remote worker channel exists and is outbound-only.
- Generation can run through remote worker Dockerized Codex app-server.
- Run execution can run through remote worker using a verified workspace bundle.
- Launch tokens are transferred only through sealed single-use envelopes.
- Raw auth is returned only by launch lease materialization.
- Runtime jobs, launch leases, and RunSessions recover idempotently after worker loss.
- Action claims and RunWorkerLeases are renewed or revalidated while waiting for remote jobs, so stale remote results cannot write current product state.
- Strict dogfood success requires Dockerized app-server evidence.
- Existing PRD-first human gates remain intact.
