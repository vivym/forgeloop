# Codex Runtime Distribution and Docker Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Codex runtime distribution layer that centrally stores runtime profiles and unsafe DB auth, issues per-task launch leases, and runs generation plus package execution through Dockerized Codex app-server with isolated per-task `CODEX_HOME`.

**Architecture:** Add domain contracts and DB-backed resources for profiles, credentials, worker registrations, launch leases, and worker-session nonces. Add a control-plane internal API and a shared worker runtime package that materializes one launch lease into one Dockerized Codex app-server. Wire the first working path through a local in-process worker shim for automation generation and run-worker package execution; keep remote outbound worker transport contract-ready but not required for the first strict dogfood loop.

**Tech Stack:** TypeScript, NestJS, Drizzle ORM, Vitest, Node `fs/promises`, Docker CLI runner abstraction, existing `@forgeloop/codex-runtime`, `@forgeloop/executor`, `@forgeloop/run-worker`, and `@forgeloop/automation`.

---

## Source Material

- Spec: `docs/superpowers/specs/2026-05-20-codex-runtime-distribution-and-docker-worker-design.md`
- Existing generation runtime: `packages/codex-runtime/src/runtime.ts`
- Existing automation executor: `packages/automation/src/executor.ts`
- Existing run worker: `packages/run-worker/src/run-worker.ts`
- Existing app-server driver: `packages/executor/src/codex-app-server-driver.ts`
- Existing repository boundary: `packages/db/src/repositories/delivery-repository.ts`
- Existing API module pattern: `apps/control-plane-api/src/modules/automation`

## Non-Negotiable Constraints

- Do not depend on worker-local `~/.codex`, process-level `CODEX_HOME`, `FORGELOOP_CODEX_HOME`, or `FORGELOOP_CODEX_APP_SERVER_ENDPOINT` for strict dogfood success.
- Do not pass auth through env vars, argv, Docker labels, container names, image args, build args, or loggable metadata.
- Materialization returns raw auth exactly once.
- Launch lease creation is orchestrator-only: automation daemon while holding `AutomationActionRun.claim_token`, run-worker while holding `RunWorkerLease.lease_token`.
- Workers only materialize delegated leases and report terminal state.
- Generation uses `target_kind: 'generation'` and `source_access_mode: 'artifact_only'`.
- Package execution uses `target_kind: 'run_execution'` and `source_access_mode: 'path_policy_scoped'`.
- Strict real dogfood requires `network_policy.mode: 'egress_allowlist'` with executable allowlist rules and at least one `purpose: 'model_provider'` rule.
- No automatic Spec approval, Plan approval, Package readiness, ReviewPacket approval, merge, release, or deploy.
- Keep legacy exec fallback available for older non-strict local flows, but it cannot satisfy this spec's strict acceptance.
- Start from updated `main` in a dedicated implementation worktree before executing this plan. The current spec branch is documentation-only and may be behind `origin/main`; do not touch unrelated dirty docs in the main worktree.

## File Structure

### Domain

- Create `packages/domain/src/codex-runtime.ts`
  - Owns Codex runtime profile, credential binding, worker registration, launch lease, materialization, network allowlist, Docker evidence, scope matching, canonical digest helpers, public blocker codes, and redaction helpers.
- Modify `packages/domain/src/index.ts`
  - Exports `./codex-runtime.js`.
- Modify `packages/domain/src/types.ts`
  - Extends `RunRuntimeMetadata` with public-safe Dockerized Codex evidence fields.
- Add tests in `tests/domain/codex-runtime.test.ts`
  - Covers digest stability, explicit scope tuple matching, profile validation, credential redaction, materialization redaction, and runtime evidence public-safety.

### Database

- Create `packages/db/src/schema/codex-runtime.ts`
  - Drizzle schema for runtime profiles, profile revisions, credential bindings, credential versions, worker registrations, worker session nonces, and launch leases.
- Modify `packages/db/src/schema/index.ts`
  - Exports the new schema file.
- Modify `packages/db/src/repositories/delivery-repository.ts`
  - Adds typed repository inputs and methods for profiles, credentials, workers, nonces, launch leases, materialization, terminalization, revocation, and public projection helpers.
- Modify `packages/db/src/repositories/in-memory-delivery-repository.ts`
  - Adds in-memory maps and method implementations with the same atomic behavior expected from Drizzle.
- Modify `packages/db/src/repositories/drizzle-delivery-repository.ts`
  - Adds Drizzle-backed implementations with typed columns used for fencing and idempotency.
- Add tests in `tests/db/codex-runtime-repository.test.ts`
  - Runs against in-memory repository; Drizzle code is covered by build and by repository parity assertions where existing test harness allows.

### Control Plane

- Create `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.dto.ts`
  - Zod schemas for internal profile/credential setup, worker register/heartbeat, launch lease create/revoke/materialize/terminal.
- Create `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts`
  - Orchestrates profile/credential validation, credential-store flag checks, worker capability selection, lease creation, materialization fencing, terminalization, and public-safe errors.
- Create `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.controller.ts`
  - Internal endpoints:
    - `POST /internal/codex-runtime/profiles`
    - `POST /internal/codex-runtime/credentials`
    - `GET /internal/codex-runtime/status`
    - `POST /internal/codex-workers/register`
    - `POST /internal/codex-workers/:workerId/heartbeat`
    - `POST /internal/codex-launch-leases`
    - `POST /internal/codex-launch-leases/:leaseId/revoke`
    - `POST /internal/codex-workers/:workerId/launch-leases/:leaseId/materialize`
    - `POST /internal/codex-workers/:workerId/launch-leases/:leaseId/terminal`
- Create `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.module.ts`
  - Provides and exports `CodexRuntimeService`.
- Modify `apps/control-plane-api/src/app.module.ts`
  - Imports `CodexRuntimeModule`.
- Add tests in `tests/api/codex-runtime-control-plane.test.ts`
  - Covers endpoint validation, unsafe credential gate, secret redaction, single-use materialization, target-kind mismatch, worker mismatch, stale orchestrator fence, and worker heartbeat availability.

### Shared Worker Runtime

- Create package `packages/codex-worker-runtime`
  - Add `package.json`, `tsconfig.json`, and `src/index.ts`.
- Modify `tsconfig.base.json`
  - Adds path alias `@forgeloop/codex-worker-runtime`.
- Modify `apps/automation-daemon/package.json`, `packages/run-worker/package.json`, and `apps/control-plane-api/package.json`
  - Add workspace dependency where needed.
- Create `packages/codex-worker-runtime/src/control-plane-client.ts`
  - Internal HTTP client for registration, heartbeat, launch lease create/revoke/materialize/terminal.
- Create `packages/codex-worker-runtime/src/local-worker.ts`
  - Local in-process worker registration shim, session-token holder, heartbeat loop, capability selector, and concurrency guard. This is the first implementation shape.
- Create `packages/codex-worker-runtime/src/docker-runner.ts`
  - Docker runner interface plus CLI implementation.
- Create `packages/codex-worker-runtime/src/docker-command.ts`
  - Builds Docker command arguments and validates image digest, UID/GID, mounts, labels, capabilities, env, network, resource limits, and forbidden secret channels.
- Create `packages/codex-worker-runtime/src/task-filesystem.ts`
  - Creates and cleans per-lease temp root, `codex-home`, `auth.json`, `config.toml`, socket directory, and artifact directory with permission and path-safety checks.
- Create `packages/codex-worker-runtime/src/workspace-isolation.ts`
  - Prepares the container-visible task workspace, handles `.git` directory versus `.git` file indirection, and records a public-safe workspace isolation summary.
- Create `packages/codex-worker-runtime/src/network-policy.ts`
  - Materializes network policy with concrete provider implementations. Strict real dogfood uses `docker_network_proxy` and must prove blocked default egress plus allowed model-provider egress before prompt delivery.
- Create `packages/codex-worker-runtime/src/app-server-launcher.ts`
  - Materializes a launch lease, writes task files, starts Dockerized `codex app-server --socket /run/forgeloop/codex.sock`, verifies Unix socket location, checks effective config, translates host workspace paths to container paths, returns a host-side endpoint plus public-safe evidence, and cleans up.
- Create `packages/codex-worker-runtime/src/scavenger.ts`
  - Startup cleanup for stale containers, temp roots, socket dirs, and launch leases.
- Create `packages/codex-worker-runtime/src/fake-docker-runner.ts`
  - Test fake that records command args and simulates app-server socket/effective-config behavior without real Docker.
- Add tests under `tests/codex-worker-runtime/`
  - `docker-command.test.ts`, `task-filesystem.test.ts`, `workspace-isolation.test.ts`, `network-policy.test.ts`, `local-worker.test.ts`, `app-server-launcher.test.ts`, `scavenger.test.ts`.

### Remote Worker Control Channel

- Modify `packages/domain/src/codex-runtime.ts`
  - Adds public-safe remote worker runtime-job and control-channel message contracts.
- Modify `packages/db/src/schema/codex-runtime.ts`
  - Adds `codex_worker_runtime_jobs` for signed long-poll delivery and terminal result handoff.
- Modify `packages/db/src/repositories/delivery-repository.ts`
  - Adds runtime-job queue, accept, event, terminal, cancel, drain, and refresh methods.
- Modify `packages/db/src/repositories/in-memory-delivery-repository.ts`
  - Implements runtime-job queue state transitions for tests.
- Modify `packages/db/src/repositories/drizzle-delivery-repository.ts`
  - Implements runtime-job queue with typed worker/lease/status columns.
- Modify `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.dto.ts`
  - Adds signed long-poll, accept, event, and terminal DTOs.
- Modify `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts`
  - Adds remote runtime-job enqueue, worker poll, accepted, event, terminal, cancel, refresh, and drain handling.
- Modify `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.controller.ts`
  - Adds worker-scoped outbound channel endpoints.
- Create `packages/codex-worker-runtime/src/remote-worker-client.ts`
  - Long-poll remote worker loop that registers, heartbeats, accepts delegated jobs, materializes leases, runs Dockerized app-server, reports events/terminal, and handles cancel/refresh/drain.
- Modify `apps/automation-daemon/src/generation-runtime.ts`
  - Supports `FORGELOOP_CODEX_WORKER_MODE=remote_outbound` by delegating generation jobs through the runtime-job queue and waiting for terminal generated output.
- Modify run-worker composition in `apps/control-plane-api/src/modules/run-control/run-control.module.ts`
  - Supports remote outbound runtime jobs for `local_codex` package execution when configured and when the selected worker supports the centrally served workspace bundle acquisition mode for the target scope.
- Add tests:
  - `tests/api/codex-worker-channel.test.ts`
  - `tests/codex-worker-runtime/remote-worker-client.test.ts`
  - remote-mode additions to `tests/automation/daemon.test.ts` and `tests/run-worker/run-worker.test.ts`

### Generation Integration

- Modify `packages/codex-runtime/src/types.ts`
  - Add optional orchestration context to `CodexGenerationRuntimeTaskInput` for claimed automation actions.
- Modify `packages/automation/src/executor.ts`
  - Pass action type, attempt, claim token, precondition fingerprint, automation scope, target ids, and idempotency key to generation runtime. Do not persist the claim token in public results.
- Modify `apps/automation-daemon/src/config.ts`
  - Add Docker worker runtime config:
    - `FORGELOOP_CODEX_WORKER_MODE=disabled|local_docker`
    - `FORGELOOP_WORKER_IDENTITY`
    - `FORGELOOP_WORKER_BOOTSTRAP_TOKEN`
    - `FORGELOOP_WORKER_LABELS`
    - `FORGELOOP_WORKER_MAX_CONCURRENCY`
    - `FORGELOOP_DOCKER_BIN`
    - `FORGELOOP_DOCKER_SOCKET`
    - `FORGELOOP_WORKER_TEMP_ROOT`
  - For strict `app_server` mode, stop requiring `FORGELOOP_CODEX_APP_SERVER_ENDPOINT` when `FORGELOOP_CODEX_WORKER_MODE=local_docker`.
- Modify `apps/automation-daemon/src/generation-runtime.ts`
  - Build a leased Docker generation runtime using `@forgeloop/codex-worker-runtime` when local Docker mode is enabled; preserve fake mode unchanged.
- Add tests in `tests/automation/daemon-config.test.ts`, `tests/automation/daemon.test.ts`, and `tests/automation/executor.test.ts`
  - Covers strict app-server config without endpoint, launch lease context propagation, generation result redaction, and fake mode compatibility.

### Run-Worker Integration

- Modify `packages/domain/src/automation.ts`
  - Ensures Dockerized Codex enqueue preflight attestations require enforcing external sandbox evidence, Docker policy/profile-derived sandbox config digest, host secret isolation, filesystem containment, network policy, wrapper env isolation, and process-tree kill support.
- Modify `packages/executor/src/resource-limits.ts`
  - Mirrors the domain validation for run-execution safety and keeps error codes public-safe.
- Modify `packages/run-worker/src/run-worker.ts`
  - Extend `driverFactory` input with active run-worker lease context:
    - `workerId`
    - `runSessionId`
    - `leaseToken`
  - Ensure `local_codex` non-workflow runs request a launch lease before app-server prompt delivery.
  - Mark strict success only when runtime metadata has Dockerized app-server evidence and `selected_execution_mode: 'app_server'`.
- Create `packages/codex-worker-runtime/src/run-session-driver.ts`
  - Implements a `CodexSessionDriver` wrapper that requests a run-execution launch lease, materializes it, starts Dockerized app-server, delegates to the existing `CodexAppServerDriver`, then terminalizes and cleans up.
- Modify API/run-worker composition where the driver factory is built:
  - `apps/control-plane-api/src/modules/run-control/run-control.module.ts`
  - Any local adapter/test wiring in `tests/api/local-codex-routing.test.ts`
- Add tests in `tests/run-worker/run-worker.test.ts` and `tests/api/local-codex-routing.test.ts`
  - Covers run-worker lease fencing, launch lease request before driver start, stale RunWorkerLease materialization denial, no process-level `CODEX_HOME` use, runtime metadata evidence, and legacy fallback not counting as strict success.
- Add tests in `tests/domain/automation.test.ts` and `tests/executor/resource-limits.test.ts`
  - Covers Dockerized Codex enqueue/run attestation requirements and digest mismatch failures.

### Dogfood Bootstrap and Summaries

- Modify `apps/control-plane-api/src/modules/query/public-run-session-projection.ts`
  - Whitelists only public-safe Dockerized Codex runtime evidence fields needed by dogfood summaries and product API consumers.
- Create `scripts/codex-runtime-dogfood-bootstrap.ts`
  - Seeds a generation profile, run-execution profile, unsafe DB credential binding, and local worker registration through the same internal service/API path used at runtime.
  - Accepts auth as either `FORGELOOP_CODEX_AUTH_JSON_PATH` or `FORGELOOP_CODEX_AUTH_JSON_INLINE` for bootstrap only, then stores it in DB. It must also require pinned image digests, strict profile digests, allowed scope, executable egress allowlist rules, local worker UID/GID capability registration, and must not print auth.
- Modify `scripts/automation-dogfood.ts`
  - Reports Dockerized app-server generation status and blockers using public-safe runtime codes.
- Modify `scripts/automation-dogfood-summary.ts`
  - Summarizes profile id/revision, credential binding/version/digest, worker availability, and strict Dockerized app-server status without raw paths or secrets.
- Modify `scripts/dogfood/strict-local-codex.ts`
  - Requires Dockerized Codex evidence for strict pass.
- Modify `scripts/delivery-local-codex-dogfood.ts`
  - Treats `exec_fallback` as blocked for strict success and reports launch lease/profile/credential evidence when present.
- Add/update tests:
  - `tests/api/run-session-serialization.test.ts`
  - `tests/smoke/automation-dogfood-script.test.ts`
  - `tests/smoke/delivery-local-codex-dogfood-script.test.ts`
  - `tests/smoke/dogfood-strict-local-codex.test.ts`

## Implementation Order and Parallelism

- Task 1 blocks Tasks 2-8.
- Task 2 blocks Task 3.
- Task 3 blocks generation and run-worker integration.
- Task 4 can start after Task 1 and can run partly in parallel with Task 2/3 if write ownership is disjoint.
- Tasks 5 and 6 can run in parallel after Tasks 3 and 4 are merged.
- Task 7 depends on Tasks 3-6 and adds the remote outbound worker transport path.
- Task 8 depends on Tasks 5-7 and updates dogfood bootstrap/summary.
- Task 9 is final verification only.

Use separate subagents only for disjoint ownership:

- Domain/DB owner: `packages/domain`, `packages/db`, `tests/domain`, `tests/db`
- Control-plane owner: `apps/control-plane-api/src/modules/codex-runtime`, `tests/api/codex-runtime-control-plane.test.ts`
- Worker runtime owner: `packages/codex-worker-runtime`, `tests/codex-worker-runtime`
- Generation owner: `packages/automation`, `apps/automation-daemon`, automation tests
- Run-worker owner: `packages/run-worker`, run-worker/API routing tests
- Remote worker owner: `packages/codex-worker-runtime/src/remote-worker-client.ts`, control-plane channel APIs, remote-mode tests
- Dogfood owner: `scripts`, smoke tests

---

### Task 1: Domain Contracts and Validators

**Files:**
- Create: `packages/domain/src/codex-runtime.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/src/types.ts`
- Test: `tests/domain/codex-runtime.test.ts`

- [ ] **Step 1: Write failing domain tests**

Create `tests/domain/codex-runtime.test.ts` with focused cases:

```ts
import { describe, expect, it } from 'vitest';
import {
  codexRuntimeScopeMatches,
  codexRuntimeProfileRevisionDigest,
  codexCredentialPayloadDigest,
  redactCodexLaunchMaterialization,
  validateCodexRuntimeProfileRevision,
  validateCodexDockerRuntimeEvidence,
  type CodexRuntimeProfileRevision,
} from '../../packages/domain/src/index';

const generationProfile = (): CodexRuntimeProfileRevision => ({
  id: 'rev-generation-1',
  profile_id: 'profile-generation',
  revision_number: 1,
  status: 'active',
  docker_image: 'ghcr.io/openai/codex@sha256:abc',
  docker_image_digest: 'sha256:abc',
  target_kind: 'generation',
  source_access_mode: 'artifact_only',
  codex_config_toml: 'approval_policy = "never"',
  codex_config_digest: 'sha256:config',
  expected_effective_config_digest: 'sha256:effective',
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
    max_task_timeout_ms: 600000,
    max_turn_timeout_ms: 300000,
    max_output_bytes: 1000000,
    max_raw_log_bytes: 2000000,
    memory_mb: 2048,
    cpus: 2,
    pids: 256,
  },
  docker_policy: {
    read_only_rootfs: true,
    run_as_non_root: true,
    privileged: false,
    no_new_privileges: true,
    drop_capabilities: ['ALL'],
  },
  allowed_scopes: [{ project_id: 'project-1', repo_id: 'repo-1' }],
  profile_digest: 'sha256:placeholder',
  created_by_actor_id: 'actor-system',
  created_at: '2026-05-20T00:00:00.000Z',
});

describe('codex runtime domain contracts', () => {
  it('matches only explicit project/repo scope tuples', () => {
    expect(codexRuntimeScopeMatches([{ project_id: 'p1' }], { project_id: 'p1', repo_id: 'r1' })).toBe(true);
    expect(codexRuntimeScopeMatches([{ project_id: 'p1', repo_id: 'r1' }], { project_id: 'p1', repo_id: 'r2' })).toBe(false);
    expect(codexRuntimeScopeMatches([{ project_id: 'p2' }], { project_id: 'p1' })).toBe(false);
  });

  it('produces stable digests independent of object key order', () => {
    const left = generationProfile();
    const right = { ...generationProfile(), docker_policy: { ...generationProfile().docker_policy } };
    expect(codexRuntimeProfileRevisionDigest(left)).toBe(codexRuntimeProfileRevisionDigest(right));
  });

  it('profile digests exclude database timestamps but change when runtime config changes', () => {
    const left = generationProfile();
    const timestampOnly = { ...generationProfile(), created_at: '2026-05-20T01:00:00.000Z' };
    const configChanged = { ...generationProfile(), codex_config_toml: 'approval_policy = "never"\nmodel = "new"' };
    expect(codexRuntimeProfileRevisionDigest(left)).toBe(codexRuntimeProfileRevisionDigest(timestampOnly));
    expect(codexRuntimeProfileRevisionDigest(left)).not.toBe(codexRuntimeProfileRevisionDigest(configChanged));
  });

  it('rejects strict real egress allowlist profiles without a model provider rule', () => {
    const profile = {
      ...generationProfile(),
      network_policy: {
        mode: 'egress_allowlist',
        provider: 'host_firewall',
        allowlist_rules: [
          { id: 'npm', protocol: 'https', host: 'registry.npmjs.org', purpose: 'package_registry' },
        ],
        egress_allowlist_digest: 'sha256:egress',
        self_test_digest: 'sha256:self-test',
      },
    } satisfies CodexRuntimeProfileRevision;
    expect(() => validateCodexRuntimeProfileRevision(profile, { strictRealDogfood: true })).toThrow(
      /codex_worker_docker_policy_unavailable/,
    );
  });

  it('redacts materialized auth payloads', () => {
    const materialization = {
      lease_id: 'lease-1',
      expires_at: '2026-05-20T00:05:00.000Z',
      runtime_profile: { profile_id: 'profile-1' },
      credential: {
        binding_id: 'credential-1',
        version_id: 'credential-version-1',
        secret_payload_kind: 'codex_auth_json',
        secret_payload_json: { OPENAI_API_KEY: 'sk-test-secret' },
        secret_payload_digest: codexCredentialPayloadDigest({ OPENAI_API_KEY: 'sk-test-secret' }),
      },
    };
    expect(JSON.stringify(redactCodexLaunchMaterialization(materialization))).not.toContain('sk-test-secret');
  });

  it('accepts only public-safe Docker runtime evidence', () => {
    expect(() =>
      validateCodexDockerRuntimeEvidence({
        runtime_profile_id: 'profile-1',
        runtime_profile_revision_id: 'revision-1',
        runtime_profile_digest: 'sha256:profile',
        runtime_target_kind: 'run_execution',
        source_access_mode: 'path_policy_scoped',
        environment: 'local_dogfood',
        credential_binding_id: 'credential-1',
        credential_binding_version_id: 'credential-version-1',
        credential_payload_digest: 'sha256:credential',
        launch_lease_id: 'lease-1',
        worker_id: 'worker-1',
        docker_image_digest: 'sha256:image',
        container_id_digest: 'sha256:container',
        app_server_effective_config_digest: 'sha256:effective',
        docker_policy_self_check_digest: 'sha256:docker-policy',
        app_server_attempted: true,
        selected_execution_mode: 'app_server',
      }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run domain tests and verify they fail**

Run:

```bash
pnpm vitest run tests/domain/codex-runtime.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because `packages/domain/src/codex-runtime.ts` and exports do not exist.

- [ ] **Step 3: Implement domain types and helpers**

Create `packages/domain/src/codex-runtime.ts` with:

```ts
import { createHash } from 'node:crypto';

export type CodexRuntimeEnvironment = 'local_dogfood' | 'test';
export type CodexRuntimeTargetKind = 'generation' | 'run_execution';
export type CodexSourceAccessMode = 'artifact_only' | 'path_policy_scoped';

export interface CodexRuntimeScope {
  project_id: string;
  repo_id?: string;
}

export interface CodexNetworkAllowlistRule {
  id: string;
  protocol: 'https' | 'http' | 'tcp';
  host: string;
  port?: number;
  path_prefix?: string;
  purpose: 'model_provider' | 'package_registry' | 'git_remote' | 'other';
}

export interface CodexDockerNetworkProxyConfig {
  proxy_image: string;
  proxy_image_digest: string;
  self_test_image: string;
  self_test_image_digest: string;
  provider_config_digest: string;
}

export type CodexRuntimeNetworkPolicy =
  | { mode: 'disabled' }
  | {
      mode: 'egress_allowlist';
      provider: 'host_firewall';
      allowlist_rules: CodexNetworkAllowlistRule[];
      egress_allowlist_digest: string;
      self_test_digest: string;
    }
  | {
      mode: 'egress_allowlist';
      provider: 'docker_network_proxy';
      allowlist_rules: CodexNetworkAllowlistRule[];
      provider_config: CodexDockerNetworkProxyConfig;
      egress_allowlist_digest: string;
      self_test_digest: string;
    };

export interface CodexRuntimeProfileRevision {
  id: string;
  profile_id: string;
  revision_number: number;
  status: 'active' | 'superseded';
  docker_image: string;
  docker_image_digest: string;
  target_kind: CodexRuntimeTargetKind;
  source_access_mode: CodexSourceAccessMode;
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
  network_policy: CodexRuntimeNetworkPolicy;
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

export interface CodexDockerRuntimeEvidence {
  runtime_profile_id: string;
  runtime_profile_revision_id: string;
  runtime_profile_digest: string;
  runtime_target_kind: CodexRuntimeTargetKind;
  source_access_mode: CodexSourceAccessMode;
  environment: CodexRuntimeEnvironment;
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

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

const canonicalize = (value: unknown): CanonicalJsonValue => {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .reduce<Record<string, CanonicalJsonValue>>((accumulator, [key, entry]) => {
        accumulator[key] = canonicalize(entry);
        return accumulator;
      }, {});
  }
  return null;
};

export const codexCanonicalDigest = (value: unknown): string =>
  `sha256:${createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')}`;

export const codexRuntimeScopeMatches = (
  allowed: readonly CodexRuntimeScope[],
  target: CodexRuntimeScope,
): boolean =>
  allowed.some((scope) => scope.project_id === target.project_id && (scope.repo_id === undefined || scope.repo_id === target.repo_id));
```

Also implement:

- `codexRuntimeProfileRevisionDigest(revision)`
- `codexCredentialPayloadDigest(payload)`
- `validateCodexRuntimeProfileRevision(revision, { strictRealDogfood })`
- `validateCodexLaunchTargetKind(targetType, targetKind)`
- `validateCodexDockerRuntimeEvidence(evidence)`
- `validateCodexDockerNetworkProxyConfig(config)`
- `redactCodexLaunchMaterialization(value)`
- `codexPublicBlockerCodes` constant covering the spec's public-safe blocker codes.

Validation rules must reject strict `docker_network_proxy` profiles unless `provider_config.proxy_image_digest` and `provider_config.self_test_image_digest` are pinned SHA-256 digests and `provider_config.provider_config_digest` matches the normalized provider config. The profile digest must cover the provider config so launch leases bind the proxy/self-test images through the immutable profile revision.

Modify `packages/domain/src/types.ts`:

```ts
import type { CodexDockerRuntimeEvidence } from './codex-runtime.js';

export interface RunRuntimeMetadata extends Partial<CodexDockerRuntimeEvidence> {
  // existing fields remain unchanged
}
```

If importing creates a cycle concern, add the Docker evidence fields directly to `RunRuntimeMetadata` and keep a comment pointing to `CodexDockerRuntimeEvidence`.

Modify `packages/domain/src/index.ts`:

```ts
export * from './codex-runtime.js';
```

- [ ] **Step 4: Run domain tests and typecheck the domain package**

Run:

```bash
pnpm vitest run tests/domain/codex-runtime.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm --filter @forgeloop/domain build
```

Expected: PASS for the focused test and clean TypeScript build.

- [ ] **Step 5: Commit domain contracts**

Run:

```bash
git add packages/domain/src/codex-runtime.ts packages/domain/src/index.ts packages/domain/src/types.ts tests/domain/codex-runtime.test.ts
git commit -m "feat: add codex runtime domain contracts"
```

Expected: commit succeeds.

---

### Task 2: DB Schema and Repository Persistence

**Files:**
- Create: `packages/db/src/schema/codex-runtime.ts`
- Modify: `packages/db/src/schema/index.ts`
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Test: `tests/db/codex-runtime-repository.test.ts`

- [ ] **Step 1: Write failing repository tests**

Create `tests/db/codex-runtime-repository.test.ts` with cases for:

- profile revision create/read by target kind and scope;
- credential version create/read with public metadata redaction;
- unsafe DB payload stored only in credential-version private path;
- worker registration and heartbeat availability;
- nonce replay rejection;
- launch lease idempotency for the same `lease_request_id`;
- target kind mismatch rejection;
- materialization returns raw auth only once;
- materialization rejects wrong worker;
- materialization rejects stale automation action claim fence;
- materialization rejects stale run-worker lease fence.

Use `InMemoryDeliveryRepository` first:

```ts
import { describe, expect, it } from 'vitest';
import { InMemoryDeliveryRepository } from '../../packages/db/src/index';

describe('codex runtime repository', () => {
  it('materializes a launch lease exactly once', async () => {
    const repository = new InMemoryDeliveryRepository();
    const now = '2026-05-20T00:00:00.000Z';
    await repository.createCodexRuntimeProfileWithRevision(/* fixture */);
    await repository.createCodexCredentialBindingWithVersion(/* fixture with secret_payload_json */);
    await repository.upsertCodexWorkerRegistration(/* fixture with matching authorized_scopes */);
    const lease = await repository.createOrReplayCodexLaunchLease(/* fixture */);

    const first = await repository.materializeCodexLaunchLease({
      lease_id: lease.id,
      worker_id: 'worker-1',
      lease_token: 'raw-launch-token',
      worker_session_token: 'raw-session-token',
      nonce: 'nonce-1',
      timestamp: now,
      now,
    });
    expect(first.credential.secret_payload_json).toMatchObject({ OPENAI_API_KEY: 'sk-test' });

    await expect(
      repository.materializeCodexLaunchLease({
        lease_id: lease.id,
        worker_id: 'worker-1',
        lease_token: 'raw-launch-token',
        worker_session_token: 'raw-session-token',
        nonce: 'nonce-2',
        timestamp: now,
        now,
      }),
    ).rejects.toThrow(/codex_launch_materialization_denied/);
  });
});
```

- [ ] **Step 2: Run repository tests and verify they fail**

Run:

```bash
pnpm vitest run tests/db/codex-runtime-repository.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because repository methods and schema do not exist.

- [ ] **Step 3: Add Drizzle schema**

Create `packages/db/src/schema/codex-runtime.ts` following existing schema style:

- `codex_runtime_profiles`
- `codex_runtime_profile_revisions`
  - stores the full immutable `network_policy` JSON, including `docker_network_proxy.provider_config.proxy_image`, `proxy_image_digest`, `self_test_image`, `self_test_image_digest`, and `provider_config_digest`
- `codex_credential_bindings`
- `codex_credential_binding_versions`
- `codex_worker_registrations`
- `codex_worker_session_nonces`
- `codex_launch_leases`

Use typed nullable columns for launch target fencing fields:

- `target_type`
- `target_id`
- `action_type`
- `action_attempt`
- `action_claim_token_hash`
- `precondition_fingerprint`
- `execution_package_id`
- `run_worker_lease_id`
- `run_worker_lease_token_hash`
- `run_session_status`
- `run_session_updated_at`
- `execution_package_version`
- `network_policy_digest`
- `network_provider_config_digest`

Do not store raw launch token or worker session token. Store hashes only.

Modify `packages/db/src/schema/index.ts`:

```ts
export * from './codex-runtime';
```

- [ ] **Step 4: Add repository contracts**

In `packages/db/src/repositories/delivery-repository.ts`, import the new domain types and add input interfaces:

- `CreateCodexRuntimeProfileWithRevisionInput`
- `CreateCodexCredentialBindingWithVersionInput`
- `UpsertCodexWorkerRegistrationInput`
- `HeartbeatCodexWorkerInput`
- `CreateOrReplayCodexLaunchLeaseInput`
- `MaterializeCodexLaunchLeaseInput`
- `TerminalizeCodexLaunchLeaseInput`
- `RevokeCodexLaunchLeaseInput`
- `ResolveCodexRuntimeForLaunchInput`

Add methods to `DeliveryRepository`:

```ts
createCodexRuntimeProfileWithRevision(input: CreateCodexRuntimeProfileWithRevisionInput): Promise<CodexRuntimeProfileRevision>;
getActiveCodexRuntimeProfileRevision(input: ResolveCodexRuntimeForLaunchInput): Promise<CodexRuntimeProfileRevision | undefined>;
createCodexCredentialBindingWithVersion(input: CreateCodexCredentialBindingWithVersionInput): Promise<CodexCredentialBindingVersion>;
getCodexCredentialBindingPublic(id: string): Promise<CodexCredentialBindingPublic | undefined>;
resolveCodexCredentialForLaunch(input: ResolveCodexCredentialForLaunchInput): Promise<ResolvedCodexCredential | undefined>;
getCodexRuntimeStatus(input: GetCodexRuntimeStatusInput): Promise<CodexRuntimeStatusProjection>;
upsertCodexWorkerRegistration(input: UpsertCodexWorkerRegistrationInput): Promise<CodexWorkerRegistration>;
heartbeatCodexWorker(input: HeartbeatCodexWorkerInput): Promise<CodexWorkerRegistration>;
findAvailableCodexWorker(input: FindAvailableCodexWorkerInput): Promise<CodexWorkerRegistration | undefined>;
createOrReplayCodexLaunchLease(input: CreateOrReplayCodexLaunchLeaseInput): Promise<CodexLaunchLeaseWithToken>;
materializeCodexLaunchLease(input: MaterializeCodexLaunchLeaseInput): Promise<CodexLaunchMaterialization>;
terminalizeCodexLaunchLease(input: TerminalizeCodexLaunchLeaseInput): Promise<CodexLaunchLease>;
revokeCodexLaunchLease(input: RevokeCodexLaunchLeaseInput): Promise<CodexLaunchLease>;
expireCodexLaunchLeases(now: string): Promise<number>;
```

- [ ] **Step 5: Implement in-memory repository**

In `packages/db/src/repositories/in-memory-delivery-repository.ts`:

- add maps for each new table;
- clone outputs;
- hash raw tokens with the same canonical helper used by Drizzle;
- enforce scope, target-kind, worker capability, selected image digest, selected network policy digest, `docker_network_proxy` provider config digest, and status checks;
- implement materialization as single-use transition `active -> materialized`;
- record `materialization_request_hash`;
- never return `secret_payload_json` from public metadata helpers;
- include new maps in `withDeliveryTransaction` copy/commit methods.

- [ ] **Step 6: Implement Drizzle repository**

In `packages/db/src/repositories/drizzle-delivery-repository.ts`:

- import new tables;
- implement the same methods using transactions for launch lease creation and materialization;
- use typed where clauses for fencing fields instead of opaque JSON matching;
- select `secret_payload_json` only in `resolveCodexCredentialForLaunch` and `materializeCodexLaunchLease`;
- use row locks where existing transaction helper allows, otherwise guard with atomic status update and affected-row checks.

- [ ] **Step 7: Run repository tests and DB build**

Run:

```bash
pnpm vitest run tests/db/codex-runtime-repository.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm --filter @forgeloop/db build
```

Expected: PASS and clean TypeScript build.

- [ ] **Step 8: Commit DB persistence**

Run:

```bash
git add packages/db/src/schema/codex-runtime.ts packages/db/src/schema/index.ts packages/db/src/repositories/delivery-repository.ts packages/db/src/repositories/in-memory-delivery-repository.ts packages/db/src/repositories/drizzle-delivery-repository.ts tests/db/codex-runtime-repository.test.ts
git commit -m "feat: persist codex runtime leases"
```

Expected: commit succeeds.

---

### Task 3: Control-Plane Runtime APIs

**Files:**
- Create: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.dto.ts`
- Create: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts`
- Create: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.controller.ts`
- Create: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.module.ts`
- Modify: `apps/control-plane-api/src/app.module.ts`
- Test: `tests/api/codex-runtime-control-plane.test.ts`

- [ ] **Step 1: Write failing API tests**

Create `tests/api/codex-runtime-control-plane.test.ts` using existing Nest test helpers from nearby API tests. Cover:

- `POST /internal/codex-runtime/credentials` rejects `provider: unsafe_db` unless `FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE=1`;
- credential create response omits `secret_payload_json`;
- profile creation rejects unpinned Docker image digest;
- `GET /internal/codex-runtime/status` reports profile, credential, worker availability, and blockers without secret payloads;
- worker registration returns session token once and stores only hashes;
- heartbeat updates availability;
- `POST /internal/codex-launch-leases` rejects worker-session-only authority;
- generation lease creation requires active action claim token;
- run-execution lease creation requires active run-worker lease token;
- materialization returns auth once to the bound worker only;
- terminal endpoint rejects raw secret fields in payload.

- [ ] **Step 2: Run API tests and verify they fail**

Run:

```bash
pnpm vitest run tests/api/codex-runtime-control-plane.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Add DTO schemas**

In `codex-runtime.dto.ts`, define strict Zod schemas for:

- `createCodexRuntimeProfileSchema`
- `createCodexCredentialBindingSchema`
- `registerCodexWorkerSchema`
- `heartbeatCodexWorkerSchema`
- `createCodexLaunchLeaseSchema`
- `revokeCodexLaunchLeaseSchema`
- `materializeCodexLaunchLeaseSchema`
- `terminalCodexLaunchLeaseSchema`

Make `secret_payload_json` valid only on the credential-create request and materialization response. Do not reuse the materialization DTO for public responses.

- [ ] **Step 4: Implement service**

In `codex-runtime.service.ts`, inject `DELIVERY_REPOSITORY` and implement:

- profile creation with `validateCodexRuntimeProfileRevision`;
- profile creation persists and returns `network_policy.provider_config` for `docker_network_proxy` as part of the immutable revision, while public status projections expose only image names/digests and provider config digest;
- credential creation with unsafe DB flag enforcement;
- worker registration with bootstrap token hash and short-lived session token;
- heartbeat with nonce/timestamp replay protection;
- launch lease creation with orchestrator fence checks:
  - action target: active `AutomationActionRun.claim_token`, action attempt, and precondition fingerprint;
  - run target: active `RunWorkerLease.lease_token`, active expiry, RunSession status/version;
- materialization re-checking the same fence immediately before returning raw auth;
- terminalization with public-safe cleanup evidence only;
- error mapping to public-safe blocker codes.

Use `TrustedAutomationActorGuard` for orchestrator endpoints and worker session validation for worker endpoints. If worker session auth does not fit the existing guard, implement it locally in this module without changing public auth behavior.

- [ ] **Step 5: Add controller and module wiring**

In `codex-runtime.controller.ts`, expose exactly the internal routes from the spec. Use `ZodValidationPipe` and return public-safe DTOs.

In `codex-runtime.module.ts`, import `ControlPlaneCoreModule`, provide `CodexRuntimeService`, and export it.

Modify `apps/control-plane-api/src/app.module.ts`:

```ts
import { CodexRuntimeModule } from './modules/codex-runtime/codex-runtime.module';

@Module({
  imports: [HttpSupportModule, DeliveryModule, QueryModule, ReleaseModule, AutomationModule, CodexRuntimeModule],
})
export class AppModule {}
```

- [ ] **Step 6: Run focused API tests and API build**

Run:

```bash
pnpm vitest run tests/api/codex-runtime-control-plane.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm --filter @forgeloop/control-plane-api build
```

Expected: PASS and clean TypeScript build.

- [ ] **Step 7: Commit control-plane APIs**

Run:

```bash
git add apps/control-plane-api/src/modules/codex-runtime apps/control-plane-api/src/app.module.ts tests/api/codex-runtime-control-plane.test.ts
git commit -m "feat: add codex runtime control plane APIs"
```

Expected: commit succeeds.

---

### Task 4: Shared Dockerized Codex Worker Runtime

**Files:**
- Create: `packages/codex-worker-runtime/package.json`
- Create: `packages/codex-worker-runtime/tsconfig.json`
- Create: `packages/codex-worker-runtime/src/index.ts`
- Create: `packages/codex-worker-runtime/src/control-plane-client.ts`
- Create: `packages/codex-worker-runtime/src/local-worker.ts`
- Create: `packages/codex-worker-runtime/src/docker-runner.ts`
- Create: `packages/codex-worker-runtime/src/docker-command.ts`
- Create: `packages/codex-worker-runtime/src/task-filesystem.ts`
- Create: `packages/codex-worker-runtime/src/workspace-isolation.ts`
- Create: `packages/codex-worker-runtime/src/network-policy.ts`
- Create: `packages/codex-worker-runtime/src/app-server-launcher.ts`
- Create: `packages/codex-worker-runtime/src/scavenger.ts`
- Create: `packages/codex-worker-runtime/src/fake-docker-runner.ts`
- Modify: `tsconfig.base.json`
- Modify: `apps/automation-daemon/package.json`
- Modify: `packages/run-worker/package.json`
- Modify: `apps/control-plane-api/package.json`
- Test: `tests/codex-worker-runtime/docker-command.test.ts`
- Test: `tests/codex-worker-runtime/task-filesystem.test.ts`
- Test: `tests/codex-worker-runtime/workspace-isolation.test.ts`
- Test: `tests/codex-worker-runtime/network-policy.test.ts`
- Test: `tests/codex-worker-runtime/local-worker.test.ts`
- Test: `tests/codex-worker-runtime/app-server-launcher.test.ts`
- Test: `tests/codex-worker-runtime/scavenger.test.ts`

- [ ] **Step 1: Add package skeleton**

Create package files:

```json
{
  "name": "@forgeloop/codex-worker-runtime",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@forgeloop/codex-runtime": "workspace:*",
    "@forgeloop/domain": "workspace:*",
    "@forgeloop/executor": "workspace:*"
  }
}
```

Add path alias in `tsconfig.base.json`:

```json
"@forgeloop/codex-worker-runtime": ["packages/codex-worker-runtime/src/index.ts"]
```

- [ ] **Step 2: Write failing Docker command tests**

In `tests/codex-worker-runtime/docker-command.test.ts`, cover:

- command uses `docker run --rm` with pinned digest image;
- command includes `--user <host_uid>:<host_gid>`;
- command forbids `--privileged`;
- command includes `--security-opt no-new-privileges`;
- command drops capabilities;
- command mounts only workspace, artifacts, codex-home, and per-task socket directory;
- command never includes raw auth or secret-looking values in env/argv/labels/container name;
- strict egress allowlist without model-provider rule is rejected;
- unpinned image tag is rejected.

- [ ] **Step 3: Implement Docker command builder**

In `docker-command.ts`, implement:

```ts
export interface DockerCommandInput {
  dockerBin: string;
  workerId: string;
  launchLeaseId: string;
  targetType: string;
  targetId: string;
  image: string;
  imageDigest: string;
  hostUid: number;
  hostGid: number;
  workspaceHostPath?: string;
  workspaceContainerPath: '/workspace';
  artifactHostPath: string;
  codexHomeHostPath: string;
  socketHostDir: string;
  socketContainerPath: '/run/forgeloop/codex.sock';
  networkPolicy: CodexRuntimeNetworkPolicy;
  resourceLimits: CodexRuntimeProfileRevision['resource_limits'];
  dockerPolicy: CodexRuntimeProfileRevision['docker_policy'];
}

export interface DockerCommand {
  executable: string;
  args: string[];
  publicSummary: Record<string, unknown>;
}

export const buildCodexAppServerDockerCommand = (input: DockerCommandInput): DockerCommand => {
  // validate first, then return executable + args
};
```

The command must run:

```text
codex app-server --socket /run/forgeloop/codex.sock
```

Inside the container, with `CODEX_HOME=/codex-home` set only as a non-secret path.

- [ ] **Step 4: Write failing filesystem tests**

In `tests/codex-worker-runtime/task-filesystem.test.ts`, cover:

- creates `<tempRoot>/<leaseId>/codex-home/config.toml`;
- creates `<tempRoot>/<leaseId>/codex-home/auth.json`;
- file permissions are `0600`;
- directories are `0700`;
- rejects symlinked lease root;
- rejects paths outside `FORGELOOP_WORKER_TEMP_ROOT`;
- cleanup removes temp root after terminal state.

- [ ] **Step 5: Implement task filesystem**

In `task-filesystem.ts`, implement:

- `prepareCodexTaskFilesystem(input)`
- `assertInsideWorkerTempRoot(root, child)`
- `writeCodexHomeConfigAndAuth(input)`
- `cleanupCodexTaskFilesystem(input)`

Use `lstat` to reject symlinks. Use `mkdir(..., { recursive: false, mode: 0o700 })` for per-lease directories and `writeFile` followed by `chmod(0o600)` for secret files.

- [ ] **Step 6: Write failing workspace isolation tests**

In `tests/codex-worker-runtime/workspace-isolation.test.ts`, cover:

- generation profiles with `source_access_mode: 'artifact_only'` do not mount a host source workspace;
- run-execution profiles with a real `.git` directory can mount the task workspace at `/workspace`;
- run-execution worktrees whose `.git` file points outside the workspace are not mounted directly;
- `.git` file worktrees are converted into a self-contained task workspace under the per-lease temp root before Docker start;
- the copied/self-contained workspace preserves checked-out files needed for Codex edits and git status checks;
- symlinks or gitdir paths outside the allowed repo/worktree roots are rejected with `codex_runtime_workspace_isolation_unavailable`;
- public evidence records only a workspace isolation mode and digest, not local absolute paths.

- [ ] **Step 7: Implement workspace isolation helper**

Create `workspace-isolation.ts` with:

```ts
export type ContainerWorkspaceMode = 'artifact_only' | 'direct_mount' | 'self_contained_clone';

export interface PreparedContainerWorkspace {
  mode: ContainerWorkspaceMode;
  hostWorkspacePath?: string;
  containerWorkspacePath?: '/workspace';
  publicWorkspaceDigest?: string;
  publicSummary: Record<string, unknown>;
  cleanup(): Promise<void>;
}

export const prepareContainerWorkspace = async (input: {
  sourceAccessMode: 'artifact_only' | 'path_policy_scoped';
  originalWorkspacePath?: string;
  leaseTempRoot: string;
  allowedRepoRoots: readonly string[];
  runCommand?: (command: string, args: readonly string[], options: { cwd?: string }) => Promise<{ stdout: string; stderr: string }>;
}): Promise<PreparedContainerWorkspace> => {
  // inspect .git, reject unsafe indirection, and prepare direct mount or self-contained clone
};
```

Implementation rules:

- v0 must prefer a self-contained clone/copy for `.git` file worktrees rather than bind-mounting an external host git dir;
- self-contained clone/copy lives under the per-lease temp root, inherits the same cleanup lifecycle as `codex-home`, and is the only source mount visible to Docker;
- if preserving uncommitted changes is required, copy the working tree contents after clone and verify `git status --porcelain` inside the self-contained workspace;
- if a safe self-contained workspace cannot be prepared, block before prompt delivery with `codex_runtime_workspace_isolation_unavailable`;
- host absolute paths can appear only in internal variables or internal-only artifacts, never in runtime metadata or public summaries.

- [ ] **Step 8: Write failing network policy tests**

In `tests/codex-worker-runtime/network-policy.test.ts`, cover:

- disabled mode maps to `network=none`;
- strict egress allowlist requires executable rules;
- strict egress allowlist requires at least one `model_provider` rule;
- `docker_network_proxy` command plan creates an internal Docker network for the Codex container;
- `docker_network_proxy` command plan starts an allowlist proxy sidecar with an external network and the same internal network;
- the Codex container receives only proxy env (`HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`) and has no direct external Docker network;
- self-test proves blocked default egress and allowed model-provider egress before app-server prompt delivery;
- fake runner self-test records digest and blocked-default-egress evidence;
- strict real dogfood cannot pass if provider setup or self-test returns `codex_worker_docker_policy_unavailable`.

- [ ] **Step 9: Implement network policy materialization**

In `network-policy.ts`, implement:

- `validateMaterializedNetworkPolicy(policy, { strictRealDogfood })`
- `networkArgsForDocker(policy)`
- `runNetworkPolicySelfTest(input)`
- `DockerNetworkProxyProvider`

The v0 strict provider is `docker_network_proxy`:

- read the proxy sidecar image/digest and self-test image/digest from the materialized profile's `network_policy.provider_config`;
- reject startup when the launch lease's `network_provider_config_digest` does not match the materialized provider config digest;
- create a per-launch Docker network with `--internal`;
- start a pinned allowlist proxy sidecar attached to the default external network and the per-launch internal network;
- start the Codex app-server container attached only to the per-launch internal network;
- set non-secret proxy env vars in the Codex container so model-provider traffic flows through the sidecar;
- enforce `allowlist_rules` in the proxy sidecar;
- run a pre-prompt self-test from a pinned self-test image attached to the same internal network and proxy env, or from the Codex image if it declares a compatible probe command;
- verify one blocked endpoint and every `purpose: 'model_provider'` allowed endpoint;
- record `egress_allowlist_digest` and `network_policy_self_test_digest`.

For fake/offline tests, the self-test can call a fake Docker runner hook. For strict real dogfood, returning `codex_worker_docker_policy_unavailable` is a blocker, not an accepted success path.

- [ ] **Step 10: Write failing local worker shim tests**

In `tests/codex-worker-runtime/local-worker.test.ts`, cover:

- local worker registers once with worker identity, bootstrap token, supported image digests, authorized scope tuples, host worker UID/GID, Docker capabilities, labels, and max concurrency;
- raw bootstrap token is sent only to registration and is not included in logs or public summaries;
- session token is held only in memory and is used for heartbeat/materialization;
- heartbeat includes nonce/timestamp and rejects nonce replay through the fake control-plane client;
- worker availability is false before registration, false after missed heartbeat, and true after a fresh heartbeat;
- capability selection rejects mismatched scope, image digest, target kind, or concurrency saturation;
- `withLeaseSlot()` releases the concurrency slot on success and failure.

- [ ] **Step 11: Implement local worker shim**

In `local-worker.ts`, implement:

```ts
export interface LocalCodexWorkerRuntime {
  register(): Promise<void>;
  heartbeat(): Promise<void>;
  startHeartbeatLoop(): { stop(): void };
  selectForLaunch(input: {
    projectId: string;
    repoId?: string;
    dockerImageDigest: string;
    targetKind: 'generation' | 'run_execution';
  }): Promise<{ workerId: string; sessionToken: string }>;
  withLeaseSlot<T>(operation: () => Promise<T>): Promise<T>;
}
```

The shim must be shared by automation generation and run-worker launch paths. Do not duplicate worker registration, heartbeat, or capability logic inside daemon/run-worker integrations.

- [ ] **Step 12: Write failing app-server launcher tests**

In `tests/codex-worker-runtime/app-server-launcher.test.ts`, cover:

- materializes a lease through fake control-plane client;
- writes auth/config only under per-task `CODEX_HOME`;
- starts Docker through fake runner;
- verifies host socket path is inside per-task socket dir;
- uses `prepareContainerWorkspace` for artifact-only, direct mount, and self-contained clone cases;
- mounts host workspace at container path `/workspace` when source access is allowed;
- returns `containerWorkspacePath: '/workspace'` and keeps host workspace path internal;
- rejects effective config digest mismatch before prompt delivery;
- returns public-safe evidence without raw container id, auth, token, socket path, or local absolute path;
- cleanup runs on terminal and on startup failure.

- [ ] **Step 13: Implement launcher, fake runner, and control-plane client**

Implement:

- `DockerRunner` in `docker-runner.ts`:

```ts
export interface StartedDockerContainer {
  containerId: string;
  containerIdDigest: string;
  socketHostPath: string;
  stop(): Promise<void>;
}

export interface DockerRunner {
  start(input: DockerCommand): Promise<StartedDockerContainer>;
  listByLabel(labels: Record<string, string>): Promise<StartedDockerContainer[]>;
}
```

- CLI Docker runner using `child_process.spawn`.
- `FakeDockerRunner` that records commands and simulates socket readiness.
- `CodexRuntimeControlPlaneClient` with fetch-based calls. It must support both trusted actor headers for orchestrator-owned calls such as launch lease creation and worker session nonce/timestamp headers for worker-owned calls such as heartbeat, poll, materialize, event, and terminal.
- workspace preparation through `prepareContainerWorkspace` before Docker command creation.
- `DockerizedCodexAppServerLauncher` that returns:

```ts
export interface DockerizedCodexAppServerSession {
  endpoint: `unix:${string}`;
  containerWorkspacePath: '/workspace';
  hostWorkspacePathDigest?: string;
  publicEvidence: CodexDockerRuntimeEvidence;
  close(status: 'succeeded' | 'failed' | 'cancelled', summary: string): Promise<void>;
}
```

The `endpoint` and host workspace path are internal only. Do not store either value in runtime metadata or public summaries. Run-generation and run-execution callers must pass `containerWorkspacePath` to `CodexAppServerDriver` as the app-server `cwd`; changed-file and artifact evidence that needs host paths must keep those paths in local variables or internal-only artifacts.

- [ ] **Step 14: Write and implement scavenger tests**

In `tests/codex-worker-runtime/scavenger.test.ts`, cover:

- stale temp root after materialization is removed;
- stale container after container start is stopped;
- active current lease is not removed;
- labels/path metadata contain worker id, launch lease id, target type/id, and created time but no secrets.

Implement `scavengeCodexWorkerResources(input)` in `scavenger.ts`.

- [ ] **Step 15: Run worker runtime tests and build**

Run:

```bash
pnpm vitest run tests/codex-worker-runtime --pool=forks --no-file-parallelism --maxWorkers=1
pnpm --filter @forgeloop/codex-worker-runtime build
```

Expected: PASS and clean TypeScript build.

- [ ] **Step 16: Commit shared worker runtime**

Run:

```bash
git add packages/codex-worker-runtime tsconfig.base.json apps/automation-daemon/package.json packages/run-worker/package.json apps/control-plane-api/package.json tests/codex-worker-runtime
git commit -m "feat: add dockerized codex worker runtime"
```

Expected: commit succeeds.

---

### Task 5: Automation Generation Uses Launch Leases

**Files:**
- Modify: `packages/codex-runtime/src/types.ts`
- Modify: `packages/automation/src/executor.ts`
- Modify: `apps/automation-daemon/src/config.ts`
- Modify: `apps/automation-daemon/src/generation-runtime.ts`
- Test: `tests/automation/executor.test.ts`
- Test: `tests/automation/daemon-config.test.ts`
- Test: `tests/automation/daemon.test.ts`

- [ ] **Step 1: Write failing automation executor tests**

In `tests/automation/executor.test.ts`, add tests that assert:

- `executeActionRun` passes a `target_type: 'automation_action_run'` orchestration context to generation runtime;
- the context includes `action_run_id`, `action_type`, `action_attempt`, `claim_token`, `precondition_fingerprint`, `automation_scope`, and `idempotency_key`;
- claim token is not included in action completion result JSON;
- public error mapping includes new Codex runtime blocker codes.

- [ ] **Step 2: Extend generation runtime task input**

Modify `packages/codex-runtime/src/types.ts`:

```ts
export type CodexGenerationOrchestrationContext = {
  targetType: 'automation_action_run';
  actionRunId: string;
  actionType: 'ensure_spec_draft' | 'ensure_plan_draft' | 'ensure_package_drafts';
  actionAttempt: number;
  claimToken: string;
  preconditionFingerprint: string;
  automationScope: string;
  idempotencyKey: string;
};

export interface CodexGenerationRuntimeTaskInput<TContext extends Record<string, unknown>> {
  // existing fields
  orchestration?: CodexGenerationOrchestrationContext;
}
```

- [ ] **Step 3: Pass orchestration context from automation executor**

Modify each `runtime.generate*` path in `packages/automation/src/executor.ts` to require an active claim token before calling the generation runtime:

```ts
const requireActionClaimToken = (action: AutomationActionRunRecord): string => {
  if (action.claimToken === undefined || action.claimToken.length === 0) {
    throw new AutomationHttpError(
      409,
      { code: 'automation_action_claim_required' },
      'Codex launch lease generation requires an active automation action claim.',
    );
  }
  return action.claimToken;
};
```

Then pass the real claim token:

```ts
const claimToken = requireActionClaimToken(action);
orchestration: {
  targetType: 'automation_action_run',
  actionRunId: action.id,
  actionType: action.actionType,
  actionAttempt: action.attempt,
  claimToken,
  preconditionFingerprint: action.preconditionFingerprint,
  automationScope: action.automationScope,
  idempotencyKey: action.idempotencyKey,
}
```

Add `automation_action_claim_required` and Codex runtime blocker codes to `errorCode`, `isBlockedByGate`, and `resultJsonForError` only as public-safe codes.

- [ ] **Step 4: Run executor tests**

Run:

```bash
pnpm vitest run tests/automation/executor.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 5: Write failing daemon config tests**

In `tests/automation/daemon-config.test.ts`, add cases:

- `FORGELOOP_CODEX_GENERATION_DRIVER=app_server` plus `FORGELOOP_CODEX_WORKER_MODE=local_docker` does not require `FORGELOOP_CODEX_APP_SERVER_ENDPOINT`;
- strict app-server mode with no endpoint and no local Docker worker mode still fails;
- forbidden legacy strict env vars are flagged when strict dogfood mode is requested;
- fake generation mode remains unchanged.

- [ ] **Step 6: Implement daemon config**

Modify `apps/automation-daemon/src/config.ts`:

```ts
export type CodexWorkerMode = 'disabled' | 'local_docker';

export interface AutomationDaemonConfig {
  // existing fields
  codexWorkerMode: CodexWorkerMode;
  workerIdentity?: string;
  workerBootstrapToken?: string;
  workerLabels?: Record<string, string>;
  workerMaxConcurrency?: number;
  dockerBin?: string;
  dockerSocket?: string;
  workerTempRoot?: string;
}
```

When `generationPlanning.mode === 'app_server'`:

- require endpoint only if `codexWorkerMode !== 'local_docker'`;
- require worker identity, bootstrap token, temp root, and artifact root when `codexWorkerMode === 'local_docker'`;
- keep `FORGELOOP_CODEX_APP_SERVER_ENDPOINT` valid for non-strict legacy app-server tests until Task 8 updates strict dogfood summary.

- [ ] **Step 7: Write failing daemon runtime tests**

In `tests/automation/daemon.test.ts`, add a fake local Docker runtime path:

- local worker shim registers, heartbeats, and is selected before lease creation;
- claimed generation action requests a launch lease;
- fake launcher materializes auth exactly once;
- generation passes `containerWorkspacePath` rather than any host workspace path to app-server calls;
- fake app-server generation returns valid draft;
- action completes without leaking raw auth in result JSON.

- [ ] **Step 8: Implement leased generation runtime**

Modify `apps/automation-daemon/src/generation-runtime.ts`:

- keep fake mode using `createCodexGenerationRuntime`;
- keep legacy endpoint mode for existing non-strict tests;
- add `createLeasedDockerCodexGenerationRuntime(config)` using `@forgeloop/codex-worker-runtime`;
- for each generation call:
  - require `input.orchestration`;
  - select local registered worker through `LocalCodexWorkerRuntime.selectForLaunch`;
  - reserve a local worker concurrency slot with `withLeaseSlot`;
  - call control-plane lease create with target kind `generation`;
  - launch Dockerized app-server through the shared launcher;
  - delegate to existing `AppServerGenerationDriver` using the returned Unix endpoint and `containerWorkspacePath`;
  - close session and terminalize lease;
  - return generated artifacts plus public-safe Docker evidence artifact if the existing artifact model supports it.

- [ ] **Step 9: Run automation tests**

Run:

```bash
pnpm vitest run tests/automation/executor.test.ts tests/automation/daemon-config.test.ts tests/automation/daemon.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm --filter @forgeloop/automation-daemon build
pnpm --filter @forgeloop/automation build
pnpm --filter @forgeloop/codex-runtime build
```

Expected: PASS and clean builds.

- [ ] **Step 10: Commit generation integration**

Run:

```bash
git add packages/codex-runtime/src/types.ts packages/automation/src/executor.ts apps/automation-daemon/src/config.ts apps/automation-daemon/src/generation-runtime.ts tests/automation/executor.test.ts tests/automation/daemon-config.test.ts tests/automation/daemon.test.ts
git commit -m "feat: run codex generation through launch leases"
```

Expected: commit succeeds.

---

### Task 6: Run-Worker Uses Dockerized App-Server Launch Leases

**Files:**
- Create: `packages/codex-worker-runtime/src/run-session-driver.ts`
- Modify: `packages/codex-worker-runtime/src/index.ts`
- Modify: `packages/domain/src/automation.ts`
- Modify: `packages/executor/src/resource-limits.ts`
- Modify: `packages/run-worker/src/run-worker.ts`
- Modify: `apps/control-plane-api/src/modules/run-control/run-control.module.ts`
- Modify: `tests/domain/automation.test.ts`
- Modify: `tests/executor/resource-limits.test.ts`
- Modify: `tests/run-worker/run-worker.test.ts`
- Modify: `tests/api/local-codex-routing.test.ts`

- [ ] **Step 1: Write failing run-worker tests**

In `tests/run-worker/run-worker.test.ts`, add tests:

- `driverFactory` receives `workerId`, `runSessionId`, and active `leaseToken`;
- `local_codex` non-workflow run requests a run-execution launch lease before `startRun`;
- stale RunWorkerLease token causes materialization denial and terminal failure with public-safe blocker;
- runtime metadata includes profile id/revision, credential binding/version/digest, launch lease id, worker id, image digest, container id digest, effective config digest, Docker policy self-check digest, `app_server_attempted: true`, `selected_execution_mode: 'app_server'`;
- runtime metadata does not include raw app-server endpoint, raw socket path, raw container id, or auth.

- [ ] **Step 2: Write failing runtime safety attestation tests**

In `tests/domain/automation.test.ts` and `tests/executor/resource-limits.test.ts`, add cases for `local_codex` package enqueue and run-execution attestations:

- `hard_limit_mode` must be `enforcing`;
- `governor_provenance` must be `external_sandbox`;
- `supports_host_secret_isolation`, `supports_filesystem_containment`, `supports_network_policy`, `supports_wrapper_env_isolation`, and `supports_process_tree_kill` must be true;
- `sandbox_config_digest` must equal a digest derived from Docker launch policy, runtime profile digest, Docker image digest, network policy digest, and resource limit digest;
- missing or mismatched `runtime_profile_digest`, `docker_image_digest`, `network_policy_self_test_digest`, or Docker policy self-check evidence fails with public-safe runtime safety codes;
- `test_only_mock` remains valid only for mock workflow-only local/test runs.

- [ ] **Step 3: Implement Dockerized Codex attestation validation**

Modify `packages/domain/src/automation.ts`:

- extend `RuntimeSafetyAttestation` with optional Codex Docker evidence fields already added to `RunRuntimeMetadata`;
- add `codexDockerSandboxConfigDigest(input)` helper;
- in `validateEnqueuePreflightAttestation`, require the full enforcing external sandbox evidence for `executorType === 'local_codex'`;
- require `sandbox_config_digest` to match Docker policy/profile-derived digest for `local_codex`;
- keep existing mock workflow-only behavior unchanged.

Modify `packages/executor/src/resource-limits.ts`:

- mirror the same digest helper or re-export the domain helper;
- ensure `validateRunExecutionAttestation` rejects Dockerized Codex evidence gaps before execution.

- [ ] **Step 4: Extend run-worker driver factory input**

Modify `packages/run-worker/src/run-worker.ts`:

```ts
export interface RunWorkerDriverFactoryInput {
  runSession: RunSession;
  runtimeMetadata: RunRuntimeMetadata;
  workerLease: {
    workerId: string;
    runSessionId: string;
    leaseToken: string;
  };
}

export interface RunWorkerInput {
  driverFactory: (input: RunWorkerDriverFactoryInput) => CodexSessionDriver;
  execFallbackDriverFactory?: (input: RunWorkerDriverFactoryInput) => CodexSessionDriver;
  // existing fields
}
```

Update all call sites and tests. This is an internal package API, so make the break explicit and mechanical.

Also add the structurally identical lower-level contract in `packages/codex-worker-runtime/src/run-session-driver.ts` so the shared runtime package does not import `@forgeloop/run-worker`:

```ts
export interface CodexRunSessionDriverLaunchInput {
  runSession: RunSession;
  runtimeMetadata: RunRuntimeMetadata;
  workerLease: {
    workerId: string;
    runSessionId: string;
    leaseToken: string;
  };
}
```

`RunWorkerDriverFactoryInput` may import this type from `@forgeloop/codex-worker-runtime` or remain structural in `packages/run-worker`; `@forgeloop/codex-worker-runtime` must never import `@forgeloop/run-worker`.

- [ ] **Step 5: Write failing `run-session-driver` tests**

Add tests under `tests/codex-worker-runtime/app-server-launcher.test.ts` or a new `tests/codex-worker-runtime/run-session-driver.test.ts`:

- `startRun` creates a `target_type: 'run_session'` launch lease;
- lease payload includes execution package id, active run worker lease token hash/fence inputs, run session status/update timestamp, and package version;
- delegates to `CodexAppServerDriver` using a host-side Unix endpoint and `workspacePath: '/workspace'`;
- changed-file and source snapshot logic continues to inspect the host task workspace outside the container, but persisted runtime metadata stores only a digest/public-safe workspace isolation summary;
- `.git` file worktrees are passed through `prepareContainerWorkspace` and become self-contained workspaces before Docker start;
- terminalizes lease and cleans up on success/failure/cancel;
- rejects if launch materialization returns a generation profile for run execution.

- [ ] **Step 6: Implement run-session driver**

Create `packages/codex-worker-runtime/src/run-session-driver.ts`:

```ts
export interface LeasedRunSessionDriverOptions {
  controlPlaneClient: CodexRuntimeControlPlaneClient;
  launcher: DockerizedCodexAppServerLauncher;
  rawLogStore?: CodexRawLogStore;
  runtimeSafety?: LocalCodexRuntimeSafety;
  workerIdentity: string;
}

export const createLeasedRunSessionCodexDriver = (
  options: LeasedRunSessionDriverOptions,
  input: CodexRunSessionDriverLaunchInput,
): CodexSessionDriver => {
  // returns kind: 'app_server', launches on startRun/resumeRun, delegates stream to CodexAppServerDriver
};
```

The driver must not read `process.env.CODEX_HOME` or `process.env.FORGELOOP_CODEX_HOME`.

When delegating to the inner `CodexAppServerDriver`, translate:

```ts
const innerStartInput = {
  ...startInput,
  workspacePath: dockerSession.containerWorkspacePath,
};
```

Keep the host workspace path available only in local variables for source status, changed-file detection, and artifact collection.

- [ ] **Step 7: Wire run-control composition**

Modify `apps/control-plane-api/src/modules/run-control/run-control.module.ts` so the local Codex adapter can choose:

- legacy test driver for existing mock tests;
- leased Dockerized app-server driver when strict local Codex runtime distribution config is enabled.

Keep existing `local_codex` routing tests passing by injecting fake driver factories in tests.

- [ ] **Step 8: Preserve fallback behavior without strict acceptance**

In `packages/run-worker/src/run-worker.ts`, keep `execFallbackDriverFactory` for existing non-strict recovery behavior, but add runtime evidence semantics:

- if fallback is used, `selected_execution_mode: 'exec_fallback'`;
- strict dogfood summary must block on fallback in Task 8;
- do not mark fallback as Dockerized app-server success.

- [ ] **Step 9: Run run-worker tests**

Run:

```bash
pnpm vitest run tests/domain/automation.test.ts tests/executor/resource-limits.test.ts tests/run-worker/run-worker.test.ts tests/api/local-codex-routing.test.ts tests/codex-worker-runtime/run-session-driver.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm --filter @forgeloop/run-worker build
pnpm --filter @forgeloop/control-plane-api build
```

Expected: PASS and clean builds.

- [ ] **Step 10: Commit run-worker integration**

Run:

```bash
git add packages/codex-worker-runtime/src/run-session-driver.ts packages/codex-worker-runtime/src/index.ts packages/domain/src/automation.ts packages/executor/src/resource-limits.ts packages/run-worker/src/run-worker.ts apps/control-plane-api/src/modules/run-control/run-control.module.ts tests/domain/automation.test.ts tests/executor/resource-limits.test.ts tests/run-worker/run-worker.test.ts tests/api/local-codex-routing.test.ts tests/codex-worker-runtime/run-session-driver.test.ts
git commit -m "feat: run local codex packages through launch leases"
```

Expected: commit succeeds.

---

### Task 7: Remote Worker Outbound Control Channel

**Files:**
- Modify: `packages/domain/src/codex-runtime.ts`
- Modify: `packages/db/src/schema/codex-runtime.ts`
- Modify: `packages/db/src/repositories/delivery-repository.ts`
- Modify: `packages/db/src/repositories/in-memory-delivery-repository.ts`
- Modify: `packages/db/src/repositories/drizzle-delivery-repository.ts`
- Create: `packages/codex-worker-runtime/src/workspace-bundle.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.dto.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts`
- Modify: `apps/control-plane-api/src/modules/codex-runtime/codex-runtime.controller.ts`
- Create: `packages/codex-worker-runtime/src/remote-worker-client.ts`
- Modify: `packages/codex-worker-runtime/src/index.ts`
- Modify: `apps/automation-daemon/src/config.ts`
- Modify: `apps/automation-daemon/src/generation-runtime.ts`
- Modify: `apps/control-plane-api/src/modules/run-control/run-control.module.ts`
- Test: `tests/api/codex-worker-channel.test.ts`
- Test: `tests/codex-worker-runtime/remote-worker-client.test.ts`
- Test: `tests/automation/daemon.test.ts`
- Test: `tests/run-worker/run-worker.test.ts`

- [ ] **Step 1: Write failing channel API tests**

Create `tests/api/codex-worker-channel.test.ts` covering signed long-poll behavior:

- remote worker registers and heartbeats with nonce/timestamp/session token;
- orchestrator enqueues a runtime job only after creating a launch lease for that worker;
- worker poll returns `worker.runtime_job.available` with public-safe target/profile/lease metadata and no auth;
- worker accepts the job with `worker.runtime_job.accepted`;
- materialization still happens only through the existing materialization endpoint and returns raw auth once;
- worker reports public-safe events with `worker.task.event`;
- worker reports terminal output with `worker.task.terminal`;
- trusted control-plane/orchestrator endpoints create `worker.cancel`, `worker.refresh_config`, and `worker.drain` commands;
- worker-session auth cannot create cancel/refresh/drain commands;
- `worker.cancel`, `worker.refresh_config`, and `worker.drain` messages are delivered to the worker over the same poll endpoint;
- wrong worker, expired session token, replayed nonce, stale timestamp, and disabled worker are rejected.

- [ ] **Step 2: Add runtime-job domain and repository contracts**

In `packages/domain/src/codex-runtime.ts`, add:

```ts
export type CodexRuntimeJobStatus =
  | 'queued'
  | 'available'
  | 'accepted'
  | 'running'
  | 'cancel_requested'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type CodexWorkerControlMessage =
  | { type: 'worker.runtime_job.available'; job_id: string; launch_lease_id: string; target_type: 'automation_action_run' | 'run_session' }
  | { type: 'worker.cancel'; job_id: string; reason: string }
  | { type: 'worker.refresh_config'; reason: string }
  | { type: 'worker.drain'; reason: string };

export type CodexWorkspaceAcquisition =
  | { mode: 'artifact_only' }
  | {
      mode: 'workspace_bundle';
      bundle_ref: string;
      bundle_digest: string;
      base_commit_sha: string;
      repo_id: string;
      unpack_container_path: '/workspace';
    };
```

In `packages/db/src/schema/codex-runtime.ts`, add `codex_worker_runtime_jobs` with typed columns:

- `id`
- `worker_id`
- `launch_lease_id`
- `target_type`
- `target_id`
- `status`
- `job_kind`: `generation | run_execution`
- `task_kind`: `spec_draft | plan_draft | package_drafts | package_run`
- `input_json`
- `workspace_acquisition_json`
- `public_context_digest`
- `result_json`
- `error_code`
- `error_message`
- `created_at`
- `accepted_at`
- `started_at`
- `terminal_at`
- `expires_at`

In `DeliveryRepository`, add:

```ts
enqueueCodexRuntimeJob(input: EnqueueCodexRuntimeJobInput): Promise<CodexRuntimeJob>;
pollCodexWorkerMessages(input: PollCodexWorkerMessagesInput): Promise<CodexWorkerControlMessage[]>;
acceptCodexRuntimeJob(input: AcceptCodexRuntimeJobInput): Promise<CodexRuntimeJob>;
appendCodexRuntimeJobEvent(input: AppendCodexRuntimeJobEventInput): Promise<void>;
terminalizeCodexRuntimeJob(input: TerminalizeCodexRuntimeJobInput): Promise<CodexRuntimeJob>;
requestCodexRuntimeJobCancel(input: RequestCodexRuntimeJobCancelInput): Promise<CodexRuntimeJob>;
requestCodexWorkerDrain(input: RequestCodexWorkerDrainInput): Promise<void>;
requestCodexWorkerRefresh(input: RequestCodexWorkerRefreshInput): Promise<void>;
```

The runtime-job table must store only public-safe input/result payloads. Raw auth remains available only from launch lease materialization.

Worker registration capabilities must include:

```ts
workspace_access: {
  modes: ('artifact_only' | 'local_path' | 'workspace_bundle')[];
  max_bundle_bytes?: number;
}
```

Remote workers are eligible for generation with `artifact_only`. Remote run execution is eligible only with `workspace_bundle`; `local_path` is valid only for the in-process local worker shim on the same machine as the run-worker workspace.

- [ ] **Step 3: Implement repository runtime-job queue**

Implement in-memory and Drizzle methods:

- `enqueueCodexRuntimeJob` is orchestrator-only and requires an active launch lease bound to the same worker/target;
- `pollCodexWorkerMessages` returns only jobs for the polling worker and marks queued jobs `available`;
- `acceptCodexRuntimeJob` transitions `available -> accepted` and rejects wrong worker or terminal jobs;
- `enqueueCodexRuntimeJob` for remote run execution requires `workspace_acquisition_json.mode === 'workspace_bundle'`, a verified bundle digest, and worker capability `workspace_access.modes` containing `workspace_bundle`;
- `terminalizeCodexRuntimeJob` transitions accepted/running jobs to terminal status and stores generated output/executor result public-safe JSON;
- cancel/drain/refresh are durable messages until acknowledged or terminal.

- [ ] **Step 4: Add channel DTOs and control-plane endpoints**

In `codex-runtime.dto.ts`, add schemas for:

- `pollCodexWorkerMessagesSchema`
- `acceptCodexRuntimeJobSchema`
- `appendCodexRuntimeJobEventSchema`
- `terminalizeCodexRuntimeJobSchema`
- `requestCodexRuntimeJobCancelSchema`
- `requestCodexWorkerDrainSchema`
- `requestCodexWorkerRefreshSchema`

In `codex-runtime.controller.ts`, add:

```text
POST /internal/codex-workers/:workerId/channel/poll
POST /internal/codex-workers/:workerId/runtime-jobs/:jobId/accepted
POST /internal/codex-workers/:workerId/runtime-jobs/:jobId/events
POST /internal/codex-workers/:workerId/runtime-jobs/:jobId/terminal
POST /internal/codex-worker-control/:workerId/runtime-jobs/:jobId/cancel
POST /internal/codex-worker-control/:workerId/drain
POST /internal/codex-worker-control/:workerId/refresh-config
```

Auth split:

- worker-owned endpoints under `/internal/codex-workers/:workerId/...` use worker session nonce/timestamp protection and may only poll, accept assigned jobs, report public-safe events, and report terminal state;
- control endpoints under `/internal/codex-worker-control/:workerId/...` use `TrustedAutomationActorGuard` or an equivalent internal admin/orchestrator guard and create cancel/drain/refresh messages for delivery over the next outbound poll;
- workers must not be allowed to mint cancel, drain, or refresh commands for themselves or other workers.

- [ ] **Step 5: Write and implement workspace bundle helpers**

Create `packages/codex-worker-runtime/src/workspace-bundle.ts` and tests in `tests/codex-worker-runtime/remote-worker-client.test.ts` or a dedicated section covering:

- run-worker/control-plane creates a deterministic workspace bundle from the prepared task workspace;
- bundle excludes `codex-home`, Docker socket dirs, raw auth, raw logs, host `.git` indirection outside the workspace, and ignored temp roots;
- bundle includes enough Git metadata or patch base information to compute changed files and produce a patch artifact after remote execution;
- bundle digest is SHA-256 over normalized bytes and is stored in `workspace_acquisition_json.bundle_digest`;
- remote worker verifies digest before unpacking;
- remote worker unpacks only under its per-lease temp root and exposes it to the container at `/workspace`;
- terminal result includes changed files, check results, and patch/artifact refs, but not host paths.

Implementation may use a tar/zip format available in the repo toolchain, but must go through structured path filtering rather than shelling out with untrusted file names.

- [ ] **Step 6: Run channel API tests**

Run:

```bash
pnpm vitest run tests/api/codex-worker-channel.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 7: Write failing remote worker client tests**

Create `tests/codex-worker-runtime/remote-worker-client.test.ts` covering:

- client registers and heartbeats outbound, then long-polls;
- client accepts only jobs assigned to its worker id;
- client materializes the launch lease only after accepting the job;
- generation jobs run Dockerized app-server and terminalize with generated output;
- run-execution jobs download, verify, unpack, and run against a `workspace_bundle`, then terminalize with executor result metadata and patch/artifact refs;
- remote run-execution jobs without `workspace_bundle` capability or without a bundle are blocked with `codex_runtime_workspace_isolation_unavailable`;
- cancel interrupts the active stream and terminalizes as cancelled;
- refresh updates local capability/profile cache before next job;
- drain stops accepting new jobs while allowing the current job to finish;
- no raw auth, session token, bootstrap token, launch token, socket path, container id, or host path appears in public events.

- [ ] **Step 8: Implement remote worker client**

Create `packages/codex-worker-runtime/src/remote-worker-client.ts`:

```ts
export interface RemoteCodexWorkerClientOptions {
  controlPlaneClient: CodexRuntimeControlPlaneClient;
  launcher: DockerizedCodexAppServerLauncher;
  worker: LocalCodexWorkerRuntime;
  pollIntervalMs?: number;
  longPollTimeoutMs?: number;
}

export class RemoteCodexWorkerClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  drain(reason: string): Promise<void>;
}
```

Implementation rules:

- outbound only; no inbound worker port;
- signed long-poll with nonce/timestamp/session token;
- materialize through launch lease endpoint, not the channel poll response;
- route generation tasks to existing `AppServerGenerationDriver`;
- route package runs through workspace bundle acquisition, then to the leased run-session driver path using container cwd `/workspace`;
- report events/terminal through runtime-job endpoints;
- terminalize launch lease and cleanup Docker/session files in `finally`.

- [ ] **Step 9: Add remote delegation to generation runtime**

Modify `apps/automation-daemon/src/config.ts`:

```ts
export type CodexWorkerMode = 'disabled' | 'local_docker' | 'remote_outbound';
```

Modify `apps/automation-daemon/src/generation-runtime.ts`:

- in `remote_outbound` mode, select an online remote worker through control-plane status/capability projection;
- create launch lease for that remote worker while holding action claim;
- enqueue a `generation` runtime job;
- wait for terminal job result with timeout bounded by profile `max_task_timeout_ms`;
- validate generated output with the same validators used by local generation;
- surface public-safe blocker codes on timeout/cancel/failure.

Add remote-mode tests to `tests/automation/daemon.test.ts`.

- [ ] **Step 10: Add remote delegation to run-worker composition**

Modify `apps/control-plane-api/src/modules/run-control/run-control.module.ts` or the configured run-worker driver factory:

- in `remote_outbound` mode, select an online remote worker with matching scope, image digest, target kind, and `workspace_bundle` capability;
- prepare a workspace bundle from the task workspace after RunSession lease acquisition and before runtime-job enqueue;
- create launch lease while holding the active RunWorkerLease token;
- enqueue a `run_execution` runtime job with `workspace_acquisition_json.mode === 'workspace_bundle'`;
- wait for terminal job result with timeout bounded by profile `max_task_timeout_ms`;
- preserve existing RunSession finalization path using the returned executor result;
- block with public-safe `codex_worker_unavailable` or `codex_runtime_workspace_isolation_unavailable` if no compatible remote workspace capability or bundle source exists.

Add remote-mode tests to `tests/run-worker/run-worker.test.ts`.

- [ ] **Step 11: Run remote worker test matrix**

Run:

```bash
pnpm vitest run tests/api/codex-worker-channel.test.ts tests/codex-worker-runtime/remote-worker-client.test.ts tests/automation/daemon.test.ts tests/run-worker/run-worker.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
pnpm --filter @forgeloop/codex-worker-runtime build
pnpm --filter @forgeloop/control-plane-api build
pnpm --filter @forgeloop/automation-daemon build
pnpm --filter @forgeloop/run-worker build
```

Expected: PASS and clean builds.

- [ ] **Step 12: Commit remote worker channel**

Run:

```bash
git add packages/domain/src/codex-runtime.ts packages/db/src/schema/codex-runtime.ts packages/db/src/repositories/delivery-repository.ts packages/db/src/repositories/in-memory-delivery-repository.ts packages/db/src/repositories/drizzle-delivery-repository.ts apps/control-plane-api/src/modules/codex-runtime packages/codex-worker-runtime/src/workspace-bundle.ts packages/codex-worker-runtime/src/remote-worker-client.ts packages/codex-worker-runtime/src/index.ts apps/automation-daemon/src/config.ts apps/automation-daemon/src/generation-runtime.ts apps/control-plane-api/src/modules/run-control/run-control.module.ts tests/api/codex-worker-channel.test.ts tests/codex-worker-runtime/remote-worker-client.test.ts tests/automation/daemon.test.ts tests/run-worker/run-worker.test.ts
git commit -m "feat: add remote codex worker channel"
```

Expected: commit succeeds.

---

### Task 8: Dogfood Bootstrap and Strict Runtime Summaries

**Files:**
- Modify: `apps/control-plane-api/src/modules/query/public-run-session-projection.ts`
- Create: `scripts/codex-runtime-dogfood-bootstrap.ts`
- Modify: `scripts/automation-dogfood.ts`
- Modify: `scripts/automation-dogfood-summary.ts`
- Modify: `scripts/dogfood/strict-local-codex.ts`
- Modify: `scripts/delivery-local-codex-dogfood.ts`
- Test: `tests/api/run-session-serialization.test.ts`
- Test: `tests/smoke/automation-dogfood-script.test.ts`
- Test: `tests/smoke/delivery-local-codex-dogfood-script.test.ts`
- Test: `tests/smoke/dogfood-strict-local-codex.test.ts`

- [ ] **Step 1: Write failing bootstrap script tests**

In `tests/smoke/automation-dogfood-script.test.ts`, add tests for bootstrap helpers:

- reads auth from path or inline bootstrap env;
- refuses to run unless `FORGELOOP_UNSAFE_DB_CODEX_CREDENTIAL_STORE=1`;
- creates separate generation and run-execution profiles;
- requires a pinned Codex runtime image digest;
- requires generation and run-execution expected effective config digests;
- requires explicit allowed scope tuple `{ project_id, repo_id? }`;
- requires `network_policy.mode: 'egress_allowlist'` with executable allowlist JSON and at least one `purpose: 'model_provider'` rule;
- requires a pinned allowlist proxy sidecar image digest and self-test image digest when `FORGELOOP_CODEX_NETWORK_PROVIDER=docker_network_proxy`;
- registers local worker capabilities with host worker UID/GID, supported image digests, authorized scopes, Docker support, app-server support, network policy support, and process-tree kill support;
- stores credential in DB without printing raw auth;
- status output includes profile revision, credential digest, and worker availability.

- [ ] **Step 2: Implement bootstrap script**

Create `scripts/codex-runtime-dogfood-bootstrap.ts`:

- load control-plane URL and trusted actor headers;
- parse auth JSON from `FORGELOOP_CODEX_AUTH_JSON_PATH` or `FORGELOOP_CODEX_AUTH_JSON_INLINE`;
- require these strict runtime inputs:
  - `FORGELOOP_CODEX_DOCKER_IMAGE`
  - `FORGELOOP_CODEX_DOCKER_IMAGE_DIGEST`
  - `FORGELOOP_CODEX_GENERATION_EXPECTED_EFFECTIVE_CONFIG_DIGEST`
  - `FORGELOOP_CODEX_RUN_EXECUTION_EXPECTED_EFFECTIVE_CONFIG_DIGEST`
  - `FORGELOOP_CODEX_ALLOWED_SCOPE_PROJECT_ID`
  - optional `FORGELOOP_CODEX_ALLOWED_SCOPE_REPO_ID`
  - `FORGELOOP_CODEX_EGRESS_ALLOWLIST_JSON`
  - `FORGELOOP_CODEX_NETWORK_PROVIDER=docker_network_proxy`
  - `FORGELOOP_CODEX_NETWORK_PROXY_IMAGE`
  - `FORGELOOP_CODEX_NETWORK_PROXY_IMAGE_DIGEST`
  - `FORGELOOP_CODEX_NETWORK_SELF_TEST_IMAGE`
  - `FORGELOOP_CODEX_NETWORK_SELF_TEST_IMAGE_DIGEST`
  - `FORGELOOP_WORKER_IDENTITY`
  - `FORGELOOP_WORKER_BOOTSTRAP_TOKEN`
  - optional `FORGELOOP_WORKER_HOST_UID` and `FORGELOOP_WORKER_HOST_GID`, defaulting to `process.getuid()` and `process.getgid()` when available;
- parse `FORGELOOP_CODEX_EGRESS_ALLOWLIST_JSON` as `CodexNetworkAllowlistRule[]` and reject it unless it has at least one `model_provider` rule;
- reject any `config.toml` template that contains secret-looking keys such as `api_key`, `token`, `secret`, or `auth`;
- call `POST /internal/codex-runtime/profiles` twice:
  - generation profile: artifact-only;
  - run execution profile: path-policy-scoped;
- call `POST /internal/codex-runtime/credentials`;
- call `POST /internal/codex-workers/register` for local worker bootstrap with host UID/GID, supported image digests, authorized scopes, labels, and Docker/network capabilities;
- print only public-safe ids and digests.

- [ ] **Step 3: Write failing strict dogfood summary tests**

Update smoke tests so strict pass requires:

- `runtime_metadata.app_server_attempted === true`;
- `runtime_metadata.selected_execution_mode === 'app_server'`;
- `runtime_metadata.launch_lease_id` exists;
- `runtime_metadata.runtime_profile_revision_id` exists;
- `runtime_metadata.credential_binding_version_id` exists;
- `runtime_metadata.container_id_digest` exists;
- no raw endpoint/path/auth appears in rendered summary.

Add a regression that `exec_fallback` renders blocked, not passed.

- [ ] **Step 4: Expose public-safe Docker runtime evidence**

Update `apps/control-plane-api/src/modules/query/public-run-session-projection.ts` and `tests/api/run-session-serialization.test.ts` so public run-session serialization includes these fields when present:

- `runtime_profile_id`
- `runtime_profile_revision_id`
- `runtime_profile_digest`
- `runtime_target_kind`
- `source_access_mode`
- `environment`
- `credential_binding_id`
- `credential_binding_version_id`
- `credential_payload_digest`
- `launch_lease_id`
- `worker_id`
- `docker_image_digest`
- `container_id_digest`
- `app_server_effective_config_digest`
- `network_policy_digest`
- `network_policy_self_test_digest`
- `docker_policy_self_check_digest`
- `app_server_attempted`
- `selected_execution_mode`

The same tests must assert the projection still drops:

- `app_server_endpoint`
- raw socket paths;
- `workspace_path`;
- `source_repo_path`;
- `source_repo_before_status`;
- `source_repo_before_dirty_fingerprint`;
- raw container id;
- raw auth/config payloads;
- launch lease token;
- bootstrap token.

- [ ] **Step 5: Update dogfood scripts**

Modify:

- `scripts/automation-dogfood.ts`
- `scripts/automation-dogfood-summary.ts`
- `scripts/dogfood/strict-local-codex.ts`
- `scripts/delivery-local-codex-dogfood.ts`

Use the existing summary style, but update status vocabulary:

- `PASSED`: Dockerized app-server evidence present.
- `BLOCKED with reason`: profile/credential/worker/Docker/network/effective-config blocker.
- `SKIPPED`: strict mode disabled by explicit config.
- `FAILED`: unexpected runtime failure or terminal timeout.

Never include raw auth, raw config, launch token, bootstrap token, raw app-server endpoint, raw socket path, raw container id, local absolute paths, raw prompts, or raw Codex logs.

- [ ] **Step 6: Run smoke script tests**

Run:

```bash
pnpm vitest run tests/api/run-session-serialization.test.ts tests/smoke/automation-dogfood-script.test.ts tests/smoke/delivery-local-codex-dogfood-script.test.ts tests/smoke/dogfood-strict-local-codex.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 7: Commit dogfood bootstrap and summaries**

Run:

```bash
git add apps/control-plane-api/src/modules/query/public-run-session-projection.ts scripts/codex-runtime-dogfood-bootstrap.ts scripts/automation-dogfood.ts scripts/automation-dogfood-summary.ts scripts/dogfood/strict-local-codex.ts scripts/delivery-local-codex-dogfood.ts tests/api/run-session-serialization.test.ts tests/smoke/automation-dogfood-script.test.ts tests/smoke/delivery-local-codex-dogfood-script.test.ts tests/smoke/dogfood-strict-local-codex.test.ts
git commit -m "feat: add codex runtime dogfood bootstrap"
```

Expected: commit succeeds.

---

### Task 9: Regression Matrix and Final Verification

**Files:**
- Modify only if a regression reveals a real issue in files from Tasks 1-7.

- [ ] **Step 1: Run focused Codex runtime test matrix**

Run:

```bash
pnpm vitest run tests/domain/codex-runtime.test.ts tests/db/codex-runtime-repository.test.ts tests/api/codex-runtime-control-plane.test.ts tests/api/codex-worker-channel.test.ts tests/codex-worker-runtime tests/automation/executor.test.ts tests/automation/daemon-config.test.ts tests/automation/daemon.test.ts tests/run-worker/run-worker.test.ts tests/api/local-codex-routing.test.ts tests/smoke/automation-dogfood-script.test.ts tests/smoke/delivery-local-codex-dogfood-script.test.ts tests/smoke/dogfood-strict-local-codex.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 2: Run existing regression set from the previous Codex runtime baseline**

Run:

```bash
pnpm vitest run tests/codex-runtime tests/automation/planner.test.ts tests/automation/executor.test.ts tests/automation/daemon-config.test.ts --pool=forks --no-file-parallelism --maxWorkers=1
```

Expected: PASS.

- [ ] **Step 3: Run package builds**

Run:

```bash
pnpm --filter @forgeloop/domain build
pnpm --filter @forgeloop/db build
pnpm --filter @forgeloop/codex-runtime build
pnpm --filter @forgeloop/codex-worker-runtime build
pnpm --filter @forgeloop/automation build
pnpm --filter @forgeloop/automation-daemon build
pnpm --filter @forgeloop/executor build
pnpm --filter @forgeloop/run-worker build
pnpm --filter @forgeloop/control-plane-api build
```

Expected: all builds pass.

- [ ] **Step 4: Run full test suite if runtime allows**

Run:

```bash
pnpm test
```

Expected: PASS. If this is too slow or blocked by environment, record the exact focused tests that passed and the reason full suite was not run.

- [ ] **Step 5: Inspect for secret/path leaks**

Run:

```bash
rg -n "OPENAI_API_KEY|sk-|auth\\.json|launch_token|bootstrap_token|codex\\.sock|app_server_endpoint|/tmp/|/var/tmp/" packages apps scripts tests
```

Expected:

- fixture-only hits are allowed when they assert redaction or bootstrap input;
- no public response, runtime metadata projection, dogfood summary, action result, or log fixture leaks raw auth, raw launch token, raw bootstrap token, raw socket path, raw app-server endpoint, or local absolute path.

- [ ] **Step 6: Commit any regression fixes**

If fixes were required:

```bash
git add <changed files>
git commit -m "fix: close codex runtime regression gaps"
```

Expected: commit succeeds.

- [ ] **Step 7: Prepare PR summary**

Summarize:

- runtime profile/credential/worker/launch lease data model;
- Dockerized app-server launcher and local worker shim;
- generation and run-worker integration;
- dogfood bootstrap and strict evidence changes;
- tests run and any skipped verification.

Do not claim real Docker dogfood success unless a real Docker run was executed and passed.
