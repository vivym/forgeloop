# Codex Runtime Distribution and Docker Worker Design

## Overview

This spec extends the Codex automation closed-loop foundation with a production-shaped runtime distribution layer. The goal is to let Forgeloop centrally configure Codex runtime behavior, centrally store the current dogfood auth material, and run every Codex task in an isolated Docker container with a per-task `CODEX_HOME`.

The design intentionally keeps the product workflow PRD-first:

- Codex may draft Spec, Plan, and Package artifacts through explicit automation actions.
- Package execution still starts through an explicit ready Package and a queued RunSession.
- Source-changing work remains behind run-worker runtime safety and package policy gates.
- Review, merge, release, and approval remain outside automation.

The new runtime layer replaces worker-local Codex setup with a centrally issued launch lease. A worker should not need a preconfigured `~/.codex` directory. For each task, the worker pulls the approved runtime profile and auth payload, renders a disposable `CODEX_HOME`, starts `codex app-server` in Docker, executes the task, records public-safe evidence, and destroys the container and task-local files.

## Current State

Existing code already provides several useful boundaries:

- `packages/codex-runtime` owns app-server generation runtime primitives.
- `packages/executor` owns local Codex preflight, runtime safety, app-server execution driver, path policy, artifact capture, and evidence redaction.
- `packages/run-worker` owns durable RunSession execution, leases, command inbox, watchdog, app-server recovery/fallback handling, and ReviewPacket finalization.
- The automation daemon can plan and execute generation actions, but app-server runtime config is currently supplied by environment variables such as `FORGELOOP_CODEX_APP_SERVER_ENDPOINT`.
- `apps/control-plane-api` owns authoritative automation commands, runtime snapshot projections, package enqueue, and object state transitions.
- Domain runtime safety already models enforcing attestations with host secret isolation, filesystem containment, network policy, process tree kill, and external sandbox provenance.

Missing pieces:

- No centrally managed Codex runtime profile model.
- No central Codex auth/config distribution model.
- No worker registration model for Codex-capable remote workers.
- No per-task launch lease binding profile, credential, worker, Docker image, and task scope.
- No Dockerized per-task Codex app-server launcher shared by generation and run execution.
- No strict rule preventing workers from using host-level `CODEX_HOME`.

## Goals

1. Centrally configure Codex runtime behavior.
2. Centrally store dogfood auth material in the database for v0.
3. Start every Codex task in an isolated Docker container.
4. Generate a per-task `CODEX_HOME` containing only that task's `config.toml` and `auth.json`.
5. Support remote workers that connect outbound to the control plane.
6. Use Codex app-server as the strict execution path for dogfood acceptance.
7. Keep raw auth, raw prompts, raw logs, local paths, and lease tokens out of public projections.
8. Reuse the same launch model for generation tasks and package execution tasks.
9. Keep production review, merge, release, and approval out of scope.

## Non-Goals

- No UI for editing runtime profiles or credentials in this slice.
- No KMS, Vault, or external secret manager in this slice.
- No Kubernetes scheduler, autoscaler, or fleet manager.
- No server-to-worker SSH or inbound worker control port.
- No cross-machine lossless Codex app-server session migration.
- No CLI/exec fallback as strict dogfood success.
- No automatic Spec approval, Plan approval, Package readiness, ReviewPacket approval, merge, release, or deployment.

## Design Summary

Add a runtime distribution layer with four core resources:

1. `CodexRuntimeProfile`
   Non-sensitive runtime configuration. It describes Docker image digest, Codex config template, app-server requirement, resource limits, network policy, allowed scopes, and expected effective config digest.

2. `CodexCredentialBinding`
   Dogfood credential configuration. In v0 it stores raw auth material directly in the database behind an explicit unsafe provider flag. It is scoped to project, repo, environment, and allowed profiles.

3. `CodexWorkerRegistration`
   Remote worker capability and heartbeat record. A worker connects outbound to the control plane, registers labels and Docker capabilities, and receives runtime-job/wake/cancel/refresh messages over the established channel.

4. `CodexLaunchLease`
   A short-lived per-task authorization to materialize runtime config and auth. It binds a worker, target task, runtime profile revision, credential binding version, Docker image digest, and expiry.

Workers must not read host-level `CODEX_HOME`. The only valid Codex runtime for real dogfood is a per-task Docker container started from a launch lease.

## Core Object Model

All profile and credential scope matching uses explicit scope tuples:

```ts
interface CodexRuntimeScope {
  project_id: string;
  repo_id?: string;
}

interface CodexNetworkAllowlistRule {
  id: string;
  protocol: 'https' | 'http' | 'tcp';
  host: string;
  port?: number;
  path_prefix?: string;
  purpose: 'model_provider' | 'package_registry' | 'git_remote' | 'other';
}
```

Rules:

- `{ project_id }` applies to all repos in that project.
- `{ project_id, repo_id }` applies only to that project/repo pair.
- Independent project and repo allowlists are not allowed because they create ambiguous cross-products.
- A launch target is eligible only when the profile revision and credential version each contain a matching scope tuple.

### CodexRuntimeProfile

Represents centrally managed non-sensitive runtime config.

Fields:

```ts
interface CodexRuntimeProfile {
  id: string;
  project_id?: string;
  repo_id?: string;
  name: string;
  status: 'active' | 'paused' | 'archived';
  current_revision_id: string;
  created_by_actor_id: string;
  created_at: string;
  updated_at: string;
}

interface CodexRuntimeProfileRevision {
  id: string;
  profile_id: string;
  revision_number: number;
  status: 'active' | 'superseded';
  docker_image: string;
  docker_image_digest: string;
  target_kind: 'generation' | 'run_execution';
  source_access_mode: 'artifact_only' | 'path_policy_scoped';
  codex_config_toml: string;
  codex_config_digest: string;
  expected_effective_config_digest: string;
  effective_config_assertions:
    | {
        target_kind: 'generation';
        approval_policy: 'never';
        source_write_policy: 'artifact_only';
        forbidden_writable_roots: ['workspace'];
      }
    | {
        target_kind: 'run_execution';
        approval_policy: 'never';
        sandbox_type: 'danger-full-access' | 'dangerFullAccess';
        writable_roots_policy: 'task_workspace_only';
      };
  app_server_required: boolean;
  allowed_driver_kind: 'app_server';
  network_policy:
    | { mode: 'disabled' }
    | {
        mode: 'egress_allowlist';
        provider: 'host_firewall' | 'docker_network_proxy';
        allowlist_rules: CodexNetworkAllowlistRule[];
        egress_allowlist_digest: string;
        self_test_digest: string;
      };
  resource_limits: {
    max_task_timeout_ms: number;
    max_turn_timeout_ms: number;
    max_output_bytes: number;
    max_raw_log_bytes: number;
    memory_mb: number;
    cpus: number;
    pids: number;
  };
  docker_policy: {
    read_only_rootfs: boolean;
    run_as_non_root: boolean;
    privileged: false;
    no_new_privileges: true;
    drop_capabilities: string[];
    seccomp_profile_digest?: string;
  };
  allowed_scopes: CodexRuntimeScope[];
  profile_digest: string;
  created_by_actor_id: string;
  created_at: string;
}
```

Rules:

- Revisions are immutable.
- `docker_image_digest` is required. Tags alone are not sufficient.
- `allowed_driver_kind` is always `app_server` for strict dogfood.
- Generation and run execution use separate profile revisions. Generation profiles must use `target_kind: 'generation'` and `source_access_mode: 'artifact_only'`; run execution profiles must use `target_kind: 'run_execution'` and `source_access_mode: 'path_policy_scoped'`.
- `codex_config_toml` may contain only non-sensitive config.
- Environment variable config must be explicit and non-secret by default.
- Profile digest covers the normalized revision payload, not database timestamps.
- `expected_effective_config_digest` is computed from the normalized effective config shape Forgeloop expects Codex app-server to report after startup. It is distinct from `codex_config_digest` because Codex may normalize defaults.
- `effective_config_assertions` are mandatory fail-closed checks. If the full effective digest changes because Codex adds unrelated fields, the assertions still provide a precise reason for blocking or accepting after the digest comparison policy is updated.
- v0 strict real Codex dogfood must use `network_policy.mode: 'egress_allowlist'` with a concrete provider and passing pre-prompt self-test, because in-container Codex app-server needs model-provider egress. `network_policy.mode: 'disabled'` is only valid for fake/offline tests that do not call the model provider.
- `network_policy.allowlist_rules` is the executable policy sent to the worker. `egress_allowlist_digest` is computed from the normalized rule list plus provider. A digest without materialized rules is invalid.
- Strict real Codex dogfood requires at least one `purpose: 'model_provider'` allowlist rule.

### CodexCredentialBinding

Represents centrally stored auth material.

In v0, credentials are stored in the database because the current auth material is effectively API-key based and the goal is fast dogfood closure. This is intentionally named and gated as unsafe.

Fields:

```ts
interface CodexCredentialBinding {
  id: string;
  environment: 'local_dogfood' | 'test';
  provider: 'unsafe_db';
  status: 'active' | 'paused' | 'revoked';
  current_version_id: string;
  created_by_actor_id: string;
  created_at: string;
  updated_at: string;
}

interface CodexCredentialBindingVersion {
  id: string;
  credential_binding_id: string;
  version_number: number;
  status: 'active' | 'superseded' | 'revoked';
  secret_payload_kind: 'codex_auth_json';
  secret_payload_json: Record<string, unknown>;
  secret_payload_digest: string;
  allowed_profile_ids: string[];
  allowed_scopes: CodexRuntimeScope[];
  created_by_actor_id: string;
  created_at: string;
}
```

Rules:

- Raw secret payload may exist in the DB only when `FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE=1`.
- The unsafe DB provider is limited to `local_dogfood` and `test`. It must not be enabled for `production`.
- Public API responses must never include `secret_payload_json`.
- Logs, events, action results, runtime metadata, dogfood summaries, and validation errors must never include raw auth.
- Runtime metadata may record `credential_binding_id`, credential version, and `secret_payload_digest`.
- The credential binding must match the launch target's project, repo, environment, and profile.
- v0 supports only `secret_payload_kind: 'codex_auth_json'`. The worker writes `secret_payload_json` verbatim to `/codex-home/auth.json` with `0600` permissions. API-key bundle transforms are out of scope until a concrete auth schema is needed.
- Future secure storage replaces only the credential store implementation. It must not change worker launch flow.

### CodexWorkerRegistration

Represents a worker process connected to the control plane.

Fields:

```ts
interface CodexWorkerRegistration {
  id: string;
  worker_identity: string;
  status: 'online' | 'offline' | 'draining' | 'disabled';
  control_channel_status: 'connected' | 'disconnected';
  version: string;
  bootstrap_token_hash: string;
  bootstrap_token_version: number;
  session_token_hash?: string;
  session_expires_at?: string;
  revoked_at?: string;
  capabilities: {
    supports_docker: boolean;
    supports_app_server: boolean;
    supports_host_secret_isolation: boolean;
    supports_network_policy: boolean;
    supports_process_tree_kill: boolean;
    max_concurrency: number;
    supported_image_digests: string[];
    authorized_scopes: CodexRuntimeScope[];
    host_worker_uid: number;
    host_worker_gid: number;
    labels: Record<string, string>;
  };
  last_heartbeat_at: string;
  lease_count: number;
  created_at: string;
  updated_at: string;
}
```

Rules:

- Worker registration uses a minimal bootstrap credential. It does not include Codex auth.
- `worker_identity` is unique.
- Bootstrap tokens are stored only as hashes and may be rotated by incrementing `bootstrap_token_version`.
- After registration, the worker receives a short-lived session token. Subsequent heartbeat and materialization requests use the session token plus nonce/timestamp replay protection. Launch lease creation is orchestrator-only and does not use worker session authority.
- The control plane stores recent nonce hashes per worker session until they expire. Reused nonce, stale timestamp, disabled worker, revoked bootstrap token, or expired session token rejects the request.
- Workers establish outbound connectivity to the control plane.
- The first implementation can use signed long-poll or WebSocket. The domain contract should not depend on one transport.
- A worker may accept only runtime jobs whose profile image digest and scope match its registered capabilities and `authorized_scopes`.
- Launch grant and materialization must match target scope against worker `authorized_scopes`, profile `allowed_scopes`, and credential `allowed_scopes`.
- Missing heartbeat makes the worker unavailable for new leases.

### CodexLaunchLease

Represents a single task's authorization to start Dockerized Codex.

Fields:

```ts
type CodexLaunchTarget =
  | {
      target_type: 'automation_action_run';
      target_id: string;
      action_type: string;
      action_attempt: number;
      action_claim_token_hash: string;
      precondition_fingerprint: string;
    }
  | {
      target_type: 'run_session';
      target_id: string;
      execution_package_id: string;
      run_worker_lease_id: string;
      run_worker_lease_token_hash: string;
      run_session_status: 'queued' | 'running' | 'resuming';
      run_session_updated_at: string;
      execution_package_version: number;
    };

interface CodexLaunchLease {
  id: string;
  lease_request_id: string;
  launch_attempt: number;
  lease_token_hash: string;
  worker_id: string;
  target: CodexLaunchTarget;
  project_id: string;
  repo_id?: string;
  environment: 'local_dogfood' | 'test';
  runtime_profile_id: string;
  runtime_profile_revision_id: string;
  runtime_profile_digest: string;
  runtime_target_kind: 'generation' | 'run_execution';
  credential_binding_id: string;
  credential_binding_version_id: string;
  credential_payload_digest: string;
  docker_image_digest: string;
  status: 'active' | 'materialized' | 'expired' | 'revoked' | 'terminal';
  materialization_request_hash?: string;
  expires_at: string;
  created_at: string;
  materialized_at?: string;
  terminal_at?: string;
  revoked_at?: string;
}
```

Rules:

- Launch leases are short-lived. The default TTL should be minutes, not hours.
- A lease is bound to exactly one worker and one target.
- `lease_request_id` is supplied by the orchestrator for a specific launch attempt. A retry after uncertain materialization must use a new `lease_request_id` and increment `launch_attempt`.
- The raw lease token is never persisted. Store only a hash.
- Materialization is atomic and single-use. `POST .../materialize` transitions `active` to `materialized` and returns raw auth exactly once.
- If the materialization response is lost, the orchestrator must revoke or let the lease expire and request a new lease. The API must not return raw auth again for an already materialized lease.
- `materialization_request_hash` records the request nonce/timestamp/session tuple used for the one successful materialization.
- RunSession lease and Codex launch lease are distinct. RunSession lease owns package execution; Codex launch lease owns runtime materialization.
- A launch lease must be fenced by the current product-state owner: an active `AutomationActionRun.claim_token` for generation, or an active `RunWorkerLease.lease_token` for package execution. Materialization must re-check that ownership before returning auth.
- A task that loses its launch lease before Docker start must fail or gate-pend with a public-safe reason.

## Worker Control Channel

Workers connect outbound to the control plane and maintain a bidirectional command channel.

Message classes:

- `worker.register`
- `worker.heartbeat`
- `worker.runtime_job.available`
- `worker.runtime_job.accepted`
- `worker.launch_lease.granted`
- `worker.launch_lease.denied`
- `worker.launch_lease.materialize`
- `worker.task.event`
- `worker.task.terminal`
- `worker.cancel`
- `worker.refresh_config`
- `worker.drain`

Transport:

- v1 can use WebSocket or signed long-poll.
- The control plane must not require inbound access to the worker.
- Messages must carry worker identity, nonce, timestamp, and signature or a channel-bound session token.
- Payloads must be public-safe unless the endpoint is explicitly the lease materialization endpoint.

The channel is a control path, not a secret broadcast bus. Auth payloads are fetched through a separate launch lease materialization endpoint that requires the active worker identity and lease token.

Codex workers do not own product-state claims in v1. The automation daemon still owns `AutomationActionRun` claims for generation actions, and `run-worker` still owns `RunSession` leases for package execution. A Codex worker accepts only a runtime job delegated by one of those orchestrators, then returns generated output, execution events, terminal status, and internal artifact refs to that orchestrator.

Launch lease creation is orchestrator-only. The automation daemon creates launch leases for generation actions while holding the active action claim. `run-worker` creates launch leases for package execution while holding the active RunSession lease. A Codex worker may materialize only an already-created lease delegated to its worker id.

## Launch Materialization API

Add orchestrator-owned internal endpoints for lease creation and revocation. These endpoints require the active automation action claim or active RunSession worker lease; worker session auth alone is never sufficient to mint a launch lease:

```text
POST /internal/codex-launch-leases
POST /internal/codex-launch-leases/:leaseId/revoke
```

Add worker-scoped endpoints for registration, heartbeat, materialization, and terminal reporting:

```text
POST /internal/codex-workers/register
POST /internal/codex-workers/:workerId/heartbeat
POST /internal/codex-workers/:workerId/launch-leases/:leaseId/materialize
POST /internal/codex-workers/:workerId/launch-leases/:leaseId/terminal
```

Materialization response:

```ts
interface CodexLaunchMaterialization {
  lease_id: string;
  expires_at: string;
  runtime_profile: {
    profile_id: string;
    revision_id: string;
    profile_digest: string;
    target_kind: 'generation' | 'run_execution';
    source_access_mode: 'artifact_only' | 'path_policy_scoped';
    docker_image: string;
    docker_image_digest: string;
    codex_config_toml: string;
    codex_config_digest: string;
    expected_effective_config_digest: string;
    effective_config_assertions:
      | {
          target_kind: 'generation';
          approval_policy: 'never';
          source_write_policy: 'artifact_only';
          forbidden_writable_roots: ['workspace'];
        }
      | {
          target_kind: 'run_execution';
          approval_policy: 'never';
          sandbox_type: 'danger-full-access' | 'dangerFullAccess';
          writable_roots_policy: 'task_workspace_only';
        };
    app_server_required: true;
    resource_limits: Record<string, unknown>;
    docker_policy: Record<string, unknown>;
    network_policy:
      | { mode: 'disabled' }
      | {
          mode: 'egress_allowlist';
          provider: 'host_firewall' | 'docker_network_proxy';
          allowlist_rules: CodexNetworkAllowlistRule[];
          egress_allowlist_digest: string;
          self_test_digest: string;
        };
  };
  credential: {
    binding_id: string;
    version_id: string;
    secret_payload_kind: 'codex_auth_json';
    secret_payload_json: Record<string, unknown>;
    secret_payload_digest: string;
  };
}
```

Rules:

- This response is internal-only and never reused as a public API DTO.
- Request and response logging must redact `credential.secret_payload_json`.
- The endpoint must reject if the unsafe DB credential store flag is not enabled for `provider: 'unsafe_db'`.
- The endpoint must reject if worker capability, profile scope, credential scope, or target state no longer matches.
- The endpoint must re-check the active orchestrator fence before returning auth: `AutomationActionRun.claim_token` and attempt for generation targets, or `RunWorkerLease.lease_token` and active lease expiry for run targets.
- The endpoint atomically transitions the lease from `active` to `materialized` and returns material only once. It must reject repeated materialization for `materialized`, `expired`, `revoked`, or `terminal` leases.
- The `terminal` endpoint records public-safe terminal status and cleanup evidence; it must not accept raw secrets.

## Dockerized Codex Runtime

The worker launches one container per Codex task.

Container layout:

```text
/workspace              mounted task workspace
/artifacts              mounted task artifact output
/codex-home             worker-created per-task host temp dir mounted as CODEX_HOME
/run/forgeloop          bind-mounted per-task socket directory
```

v0 uses a worker-created per-task host directory under `FORGELOOP_WORKER_TEMP_ROOT` for `/codex-home`. It must be unique to the launch lease, permission-restricted, mounted only into this container, excluded from public metadata, and destroyed after the task terminal state. It must never be the worker user's real home directory or a shared host `CODEX_HOME`.

Docker tmpfs-backed `CODEX_HOME` is a future option only after a safe init/materialization mechanism exists. v0 must not pass auth through environment variables, argv, Docker labels, container names, image args, build args, or loggable metadata to populate a tmpfs.

The worker runs the Codex app-server client on the host side. The app-server process runs inside the container. The socket directory is a per-task host directory bind-mounted into the container at `/run/forgeloop`, for example:

```text
host:      <worker-temp-root>/<launch-lease-id>/run/codex.sock
container: /run/forgeloop/codex.sock
```

The worker connects to the host-side Unix socket path. Public metadata may record only a digest or public-safe statement that a per-task socket was used; it must not expose the host path.

Socket isolation rules:

- The worker must remove any pre-existing per-lease socket directory before startup.
- v0 runs the container process as the host worker UID/GID recorded in `CodexWorkerRegistration.capabilities.host_worker_uid` and `host_worker_gid`. The Docker command must use that UID/GID, not image default root.
- The worker must create the per-lease temp root, `codex-home`, and socket directory owned by the host worker UID/GID with `0700` permissions or stricter.
- Secret files under `codex-home` must be written with `0600` permissions.
- Because the host worker and container process use the same UID/GID in v0, the host can write `auth.json` and connect to the socket while the container can read config/auth and create the socket without weakening directory permissions.
- Images whose Codex runtime cannot run as the supplied non-root host UID/GID are not compatible with strict dogfood.
- The worker must reject symlinks, hard-link surprises, or paths outside `FORGELOOP_WORKER_TEMP_ROOT`.
- After app-server startup, the worker must verify that the socket path is a Unix socket inside the expected directory before connecting.
- Cleanup must remove the socket path and directory on terminal state.

The worker writes:

```text
/codex-home/config.toml
/codex-home/auth.json
```

The worker starts:

```text
codex app-server --socket /run/forgeloop/codex.sock
```

The worker connects to:

```text
unix:<worker-temp-root>/<launch-lease-id>/run/codex.sock
```

Minimum Docker policy:

- image must match the launch lease image digest;
- `--privileged` is forbidden;
- run as non-root;
- no host `HOME` mount;
- no host `CODEX_HOME` mount;
- no host SSH agent mount;
- no host git credential helper mount;
- no global npm, pnpm, or package manager auth mount;
- the only control socket mount is the per-task `/run/forgeloop` bind mount;
- task workspace mount is scoped to allowed repo paths;
- artifact mount is scoped to the task artifact root;
- `CODEX_HOME` is per-task and destroyed after terminal state;
- root filesystem is read-only when compatible with the image;
- network is disabled or egress allowlisted according to profile;
- CPU, memory, pids, timeout, and output limits are applied.
- raw secrets are never passed through environment variables, command-line arguments, Docker labels, container names, image args, build args, or metadata.

If Docker cannot enforce a required profile constraint, the task blocks with a public-safe reason such as `codex_worker_docker_policy_unavailable`.

Network enforcement rules:

- `network_policy.mode: 'disabled'` maps to Docker `--network=none` or an equivalent isolation verified by worker self-check. It is valid only for fake/offline tasks that do not call the model provider.
- `network_policy.mode: 'egress_allowlist'` is required for strict real Codex dogfood. It is not accepted by declaration alone. The worker receives structured `allowlist_rules`, configures the named provider from those rules, runs a pre-prompt self-test from inside the container, proves blocked default egress and allowed endpoint access, verifies model-provider egress required by Codex app-server, and records a self-test digest in runtime evidence.
- If the worker cannot prove the requested network policy before prompt delivery, it must block with `codex_worker_docker_policy_unavailable`.

Crash cleanup rules:

- Every container, temp root, `codex-home`, socket directory, and artifact staging directory created by the worker must carry internal labels or path metadata containing worker id, launch lease id, target type, target id, and creation time. Labels must not contain secrets.
- Worker startup must scan `FORGELOOP_WORKER_TEMP_ROOT` and Docker containers for its own stale launch-lease resources, kill stale containers, and remove stale temp directories whose leases are expired, revoked, terminal, or no longer owned by an active worker session.
- If the control plane misses worker heartbeat past the lease timeout, it marks active/materialized launch leases as expired or revoked and marks the owning action/run as gate-pending, failed, or stalled according to the orchestrator policy.
- On reconnect, the worker must run scavenging before accepting new runtime jobs.
- Tests must cover worker crash after materialization and worker crash after app-server container start.

## Workspace Isolation

Each task receives a task-local workspace.

Rules:

- Package execution uses the existing RunSession worktree or clone preparation path, but the container may only see that task workspace.
- Generation tasks may use artifact-only context and do not require source mutation access.
- The container must not see the host repo root unless that root is the task workspace and the path policy allows it.
- `.git` handling must be explicit. If a worktree `.git` file points outside the workspace, the worker must either mount the referenced git dir read/write according to policy or prepare a self-contained clone.
- The worker must record a public-safe workspace isolation summary without exposing local absolute paths.

## Runtime Attestation

Dockerized Codex tasks must produce runtime evidence that can feed existing safety checks.

Extend runtime metadata and attestations with:

```ts
interface CodexDockerRuntimeEvidence {
  runtime_profile_id: string;
  runtime_profile_revision_id: string;
  runtime_profile_digest: string;
  runtime_target_kind: 'generation' | 'run_execution';
  source_access_mode: 'artifact_only' | 'path_policy_scoped';
  environment: 'local_dogfood' | 'test';
  credential_binding_id: string;
  credential_binding_version_id: string;
  credential_payload_digest: string;
  launch_lease_id: string;
  worker_id: string;
  docker_image_digest: string;
  container_id_digest: string;
  app_server_effective_config_digest: string;
  network_policy_digest?: string;
  network_policy_self_test_digest?: string;
  docker_policy_self_check_digest: string;
  app_server_attempted: true;
  selected_execution_mode: 'app_server';
}
```

Rules:

- `container_id_digest` is safe to publish; raw container id remains internal.
- Runtime metadata must not include raw app-server endpoint when it exposes local paths.
- Effective app-server config must be captured before prompt delivery.
- The normalized effective config digest must be compared to `expected_effective_config_digest`.
- The effective config must also satisfy `effective_config_assertions`.
- Generation runtime evidence must prove artifact-only access. Run-execution evidence must prove path-policy-scoped source mutation.
- If the effective config digest or assertions are incompatible with the profile, the task blocks before prompt delivery.
- Strict dogfood success requires `selected_execution_mode: 'app_server'`.
- Exec fallback may remain for older local flows but cannot satisfy this spec's strict acceptance.

For package run enqueue, the preflight attestation must show:

- `hard_limit_mode: 'enforcing'`;
- `governor_provenance: 'external_sandbox'`;
- host secret isolation support;
- filesystem containment support;
- wrapper environment isolation support;
- network policy support;
- process tree kill support;
- sandbox config digest derived from Docker launch policy and profile digest.

## Automation Integration

### Generation Actions

Generation actions remain planned by the automation planner:

- `ensure_spec_draft`
- `ensure_plan_draft`
- `ensure_package_drafts`

Execution changes from "daemon has an app-server endpoint in env" to "the product-state orchestrator obtains a launch lease and delegates Dockerized app-server runtime work to a local or remote Codex worker".

For v1, two deployment shapes are valid:

1. Automation daemon hosts the worker capability locally and launches Docker itself.
2. Automation daemon owns the action claim but delegates runtime execution to a remote Codex worker over the worker channel.

Both shapes must use the same `CodexLaunchLease` and Docker launcher library. The control-plane command boundaries do not change.

The first implementation should use shape 1: daemon-owned generation action with an in-process local Codex worker registration shim. Remote worker delegation uses the same runtime-job contract after the local path is stable.

### Package Run Execution

Package execution still flows through RunSession and `packages/run-worker`.

Flow:

1. `enqueue_package_run` creates queued RunSession.
2. run-worker acquires RunSession lease.
3. run-worker requests Codex launch lease for the RunSession.
4. run-worker materializes profile and auth.
5. run-worker starts Dockerized Codex app-server.
6. app-server executes the package prompt under path policy.
7. run-worker captures evidence and finalizes the RunSession.

The run-worker must not execute production/dogfood `local_codex` by reading process-level `CODEX_HOME`.

Run execution must select a `target_kind: 'run_execution'` profile. Generation must select a `target_kind: 'generation'` profile. A launch lease request that mixes target kind and product target type must be rejected.

## Configuration Bootstrap

The only long-lived worker config should be bootstrap connectivity:

```text
FORGELOOP_CONTROL_PLANE_URL
FORGELOOP_WORKER_IDENTITY
FORGELOOP_WORKER_BOOTSTRAP_TOKEN
FORGELOOP_WORKER_LABELS
FORGELOOP_WORKER_MAX_CONCURRENCY
```

Optional local Docker settings:

```text
FORGELOOP_DOCKER_BIN=docker
FORGELOOP_DOCKER_SOCKET=/var/run/docker.sock
FORGELOOP_WORKER_TEMP_ROOT=/var/tmp/forgeloop-worker
```

Not allowed for strict dogfood:

```text
CODEX_HOME
FORGELOOP_CODEX_HOME
FORGELOOP_CODEX_APP_SERVER_ENDPOINT
```

Those legacy environment variables may exist for older local development modes, but strict dogfood must report failure if it uses them for Codex execution.

## Credential Store v0

The v0 credential store is intentionally simple.

Implementation contract:

```ts
interface CodexCredentialStore {
  createVersion(input: CreateCodexCredentialVersionInput): Promise<CodexCredentialBindingVersion>;
  resolveForLaunch(input: ResolveCodexCredentialForLaunchInput): Promise<ResolvedCodexCredential>;
}

interface ResolvedCodexCredential {
  bindingId: string;
  versionId: string;
  provider: 'unsafe_db';
  secretPayloadKind: 'codex_auth_json';
  secretPayloadJson: Record<string, unknown>;
  secretPayloadDigest: string;
}
```

Safety rules for v0:

- `unsafe_db` provider must be rejected unless the explicit unsafe store flag is enabled.
- The implementation must centralize redaction of `secretPayloadJson`.
- `secretPayloadKind` is `codex_auth_json` in v0. The payload is serialized directly to `auth.json`; no environment variable export or config-template interpolation is allowed.
- Tests must prove raw auth does not appear in public JSON, logs captured by action results, runtime metadata, dogfood summary, or thrown public errors.
- The API may expose credential binding metadata and digest, but not payload.

Migration rule:

- A future secure provider can implement the same `CodexCredentialStore` interface using KMS, Vault, or encrypted blob storage.
- Launch leases and workers should not know whether the provider is `unsafe_db` or secure, except for audit metadata and explicit startup validation.

## Error Handling

Public-safe blocker codes:

- `codex_runtime_profile_missing`
- `codex_runtime_profile_paused`
- `codex_runtime_profile_scope_mismatch`
- `codex_credential_missing`
- `codex_credential_paused`
- `codex_credential_scope_mismatch`
- `codex_unsafe_db_credential_store_disabled`
- `codex_worker_unavailable`
- `codex_worker_capability_mismatch`
- `codex_launch_lease_denied`
- `codex_launch_lease_expired`
- `codex_launch_materialization_denied`
- `codex_worker_docker_unavailable`
- `codex_worker_docker_policy_unavailable`
- `codex_docker_container_start_failed`
- `codex_app_server_unavailable`
- `codex_app_server_effective_config_mismatch`
- `codex_runtime_secret_isolation_unavailable`
- `codex_runtime_workspace_isolation_unavailable`

Mapping:

- Missing or paused profile: blocked, non-retryable until config changes.
- Missing or paused credential: blocked, non-retryable until config changes.
- Worker unavailable: gate-pending or retryable failed, depending on action type and retry policy.
- Launch lease expired before materialization: retryable failed.
- Docker policy unavailable: blocked, non-retryable for that worker/profile pairing.
- App-server start failed: retryable failed unless caused by deterministic profile mismatch.
- Effective config mismatch: blocked, non-retryable until profile or image is fixed.

No public error may include raw auth, raw config with secrets, raw prompt, raw app-server logs, local absolute paths, Docker socket path, raw container id, or launch lease token.

## Idempotency

Runtime profile and credential revisions are immutable.

Launch lease idempotency keys must include:

- lease request id;
- launch attempt;
- target type and id;
- worker id;
- runtime profile revision id;
- runtime profile digest;
- runtime target kind;
- credential binding version id;
- credential payload digest;
- Docker image digest;
- environment;
- action run attempt and precondition fingerprint for generation targets;
- active action claim token hash for generation targets;
- run worker lease id, run worker lease token hash, run session updated timestamp, and execution package version for run targets.

Automation action idempotency should continue to include prompt version, schema version, capability fingerprint, and precondition fingerprint.

RunSession command idempotency remains authoritative for package execution.

If a retry uses a new credential version or runtime profile revision, it must produce a new launch lease and runtime evidence. It must not overwrite the evidence of a previous attempt.

Launch lease materialization is not idempotent with respect to raw auth return. A retry after an uncertain materialization outcome must create a new lease with a new `lease_request_id` and higher `launch_attempt` after revoking or expiring the old one. Lease creation may return an existing lease only when it is still `active`, has not been materialized, and the incoming `lease_request_id` exactly matches.

## Observability

Internal observability should record:

- worker registration and heartbeat;
- launch lease lifecycle;
- profile revision and credential version ids;
- Docker start/stop lifecycle;
- app-server startup and terminal state;
- runtime profile digest;
- credential payload digest;
- effective config digest;
- public-safe failure codes;
- internal artifact refs for raw logs.

Public projections may show:

- worker status summarized as available/unavailable;
- profile id and revision id;
- credential binding id and version id;
- credential digest;
- whether strict Dockerized app-server was used;
- public-safe blocker code and summary.

Public projections must not show:

- raw `auth.json`;
- API keys;
- raw `config.toml` if it contains sensitive-looking fields;
- launch lease token;
- bootstrap token;
- raw app-server endpoint path;
- raw container id;
- local absolute paths;
- raw prompts or raw Codex logs.

## Data Flow

### Profile and Credential Setup

1. Operator creates a Codex runtime profile revision through internal API or seed script.
2. Operator creates a credential binding version using `provider: 'unsafe_db'`.
3. Control plane stores profile revision and credential version.
4. Runtime snapshot or config projection can report whether a project has an active profile and credential binding.

### Generation Task

1. Runtime snapshot projects a draft-generation target.
2. Planner emits generation action.
3. Automation daemon claims action.
4. Daemon chooses a compatible local worker capability or remote Codex worker.
5. Daemon requests a launch lease bound to the action run, active action claim token, selected worker, generation profile, credential, and target scope.
6. Selected worker materializes profile and credential with the launch lease.
7. Selected worker creates per-task `CODEX_HOME`.
8. Selected worker starts Dockerized `codex app-server`.
9. Selected worker runs generation task, validates JSON output, and returns normalized output plus artifact refs to the daemon.
10. Daemon calls authoritative internal command with generated payload.
11. Action completes with public-safe result.
12. Container and task-local `CODEX_HOME` are destroyed.

### Package Execution Task

1. Ready Package is enqueued through the dogfood autorun bridge.
2. Control plane creates queued RunSession.
3. run-worker acquires RunSession lease.
4. run-worker requests launch lease bound to the active RunSession lease token, run-execution profile, credential, and target scope.
5. run-worker materializes profile and credential.
6. run-worker prepares task workspace.
7. run-worker starts Dockerized `codex app-server`.
8. app-server executes the package prompt.
9. run-worker captures changed files, checks, logs, artifacts, and runtime evidence.
10. workflow finalization creates or updates ReviewPacket.
11. Container and task-local `CODEX_HOME` are destroyed.

## Testing Strategy

Unit tests:

- profile digest is stable and changes when config changes;
- credential payload digest is stable and payload is redacted from serializers;
- unsafe DB credential store rejects startup without explicit flag;
- scope matching uses explicit `{ project_id, repo_id? }` tuples and rejects ambiguous independent project/repo allowlists;
- launch lease rejects scope mismatch;
- launch lease rejects worker capability mismatch;
- launch lease rejects mismatched target kind and product target type;
- materialization rejects when the bound action claim token or run-worker lease token is no longer active;
- materialization rejects expired, materialized, revoked, terminal, or wrong-worker leases;
- materialization returns raw auth only once and requires a new lease after uncertain delivery;
- Docker launch command builder rejects privileged, host `CODEX_HOME`, host SSH agent, and unpinned images;
- Docker launch command builder rejects secrets in env, argv, labels, container names, image args, build args, and metadata;
- Docker launch command builder runs the container as the registered host worker UID/GID and rejects images that cannot run under that non-root identity;
- socket directory setup enforces per-task paths, no symlinks, and restrictive permissions;
- network policy self-check blocks strict real Codex dogfood unless a concrete egress allowlist provider passes self-test and verifies model-provider egress;
- network policy materialization rejects egress allowlist profiles without structured allowlist rules and at least one model-provider rule for strict real Codex dogfood;
- app-server effective config mismatch blocks before prompt delivery.

Control-plane tests:

- create profile revision and credential binding version;
- materialization returns auth only to active lease owner;
- public profile/credential projections omit secret payload;
- launch lease lifecycle is idempotent and token hashes are not reversible;
- worker heartbeat controls availability;
- profile/credential blockers appear in automation action results without leaking secrets.

Worker tests:

- worker registers capabilities and heartbeats;
- worker writes `config.toml` and `auth.json` only under per-task `CODEX_HOME`;
- worker starts Docker with expected image digest and isolation flags;
- worker does not read process-level `CODEX_HOME`;
- worker destroys per-task runtime directory after terminal state;
- worker scavenges stale containers, socket dirs, and `CODEX_HOME` dirs after crash-after-materialization and crash-after-container-start scenarios;
- worker records public-safe runtime evidence.

Integration tests:

- fake Docker runner proves generation task launch flow without real Docker;
- fake app-server proves Spec and Plan generation use launch lease materialization;
- fake package execution proves run-worker requests launch lease before app-server execution;
- strict local dogfood with real Docker reports pass only when app-server path is used;
- strict local dogfood reports blocked/skipped when Docker or profile/credential setup is missing.

Regression tests:

- existing app-server generation safety tests continue to pass;
- existing runtime attestation tests continue to enforce host secret isolation;
- existing `run_enqueue` default-disabled tests continue to pass;
- existing public evidence serialization tests continue to reject secret-like fields;
- automation still cannot approve Spec, approve Plan, mark Package ready, approve ReviewPacket, merge, release, or deploy.

## Schema and Index Notes

Implementation should keep the schema boring and explicit.

Recommended constraints:

- `codex_runtime_profiles`: primary key `id`; unique `(project_id, repo_id, name)` for non-archived profiles where practical.
- `codex_runtime_profile_revisions`: primary key `id`; unique `(profile_id, revision_number)`; at most one active revision per profile; `profile_digest` indexed.
- `codex_credential_bindings`: primary key `id`; `environment` limited to `local_dogfood | test`; `provider` limited to `unsafe_db` in v0.
- `codex_credential_binding_versions`: primary key `id`; unique `(credential_binding_id, version_number)`; at most one active version per binding; `secret_payload_digest` indexed; raw `secret_payload_json` never selected by public query helpers.
- `codex_worker_registrations`: primary key `id`; unique `worker_identity`; indexes on status and heartbeat time; token fields store hashes only.
- `codex_worker_session_nonces`: unique `(worker_id, session_token_hash, nonce_hash)` with TTL cleanup.
- `codex_launch_leases`: primary key `id`; `lease_token_hash` unique; `lease_request_id` unique per target type/id and launch attempt; indexes on worker id, target type/id, status, expiry, runtime profile revision id, credential version id, and environment. At most one non-terminal lease should exist for the same target and launch attempt.

Launch target fields should be stored as typed nullable columns, not only as opaque JSON, for the fields used in fencing:

- target type and id;
- action type, action attempt, action claim token hash, and precondition fingerprint;
- run worker lease id, run worker lease token hash, run session updated timestamp, and execution package version.

The implementation may keep a JSON mirror for diagnostics, but authoritative filtering and stale-owner checks should use typed columns.

## Rollout Plan

Recommended implementation slices:

1. Add domain and DB schema for runtime profiles, credential bindings, worker registrations, and launch leases.
2. Add worker bootstrap/session auth, local in-process worker registration shim, heartbeat, and capability checks. Remote transport can still be disabled.
3. Add control-plane services and internal APIs for profile/credential setup and launch lease materialization. Also add seed scripts that call the same internal services for dogfood bootstrap.
4. Add shared Dockerized Codex launcher package with fake runner tests, socket isolation, network self-checks, and crash scavenging.
5. Wire automation generation runtime to request launch leases instead of direct app-server endpoint env config.
6. Wire run-worker local Codex execution to request launch leases and use Dockerized app-server.
7. Add remote worker outbound registration and control channel using the same runtime-job contract.
8. Add dogfood setup script for unsafe DB credential store and runtime profile seed.
9. Add strict Dockerized app-server dogfood summary.

Each slice should be independently testable. Slices 1-4 can ship without enabling real Dogfood autorun. Slices 5-6 must keep feature flags default-off until dogfood scripts prove the path.

## Acceptance Criteria

- A worker node can run without manually configured Codex `config.toml` or `auth.json`.
- Control plane can centrally store a Codex runtime profile revision.
- Control plane can centrally store dogfood auth material in DB when the unsafe credential-store flag is enabled.
- Each Codex task receives a per-task launch lease.
- Each Codex task starts a Docker container with a per-task `CODEX_HOME`.
- `config.toml` and `auth.json` are materialized only inside the task runtime.
- Public APIs and summaries do not leak raw auth.
- Generation actions can run through Dockerized app-server.
- Package execution can run through Dockerized app-server.
- Strict dogfood success requires app-server execution, not CLI fallback.
- Missing profile, credential, worker, Docker, or effective config compatibility produces public-safe blockers instead of unsafe fallback.

## Residual Risks

- DB-stored auth is intentionally unsafe. The implementation must keep it gated and visibly named so it can be replaced without changing worker launch flow.
- Per-task Docker containers make lossless app-server recovery harder. v0 accepts stalled/retry behavior after worker or container loss.
- Docker policy enforcement varies by host. The worker must report capability mismatch rather than silently weakening isolation.
- Codex app-server protocol or config shape may change. Effective config digest and runtime validation should fail closed.
- Running source work inside containers adds git worktree complexity. The implementation must make `.git` handling explicit.

## Decisions Locked By This Spec

- Central config is required.
- Worker-local Codex config is not accepted for strict dogfood.
- DB-backed raw auth is allowed only as an explicitly unsafe v0 provider.
- Every strict Codex task uses a per-task Docker container.
- Every strict Codex task uses per-task `CODEX_HOME`.
- App-server is the strict path.
- CLI/exec fallback does not count as strict dogfood success.
- Worker connectivity is outbound from worker to control plane.
- Review, merge, release, and approvals remain human-gated.
