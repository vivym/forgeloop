# Codex Remote Worker Runtime Runbook

This runbook covers the same-host remote worker closure path for Codex generation and run execution. It assumes the control plane is already running and that a worker can reach it over the outbound control channel.

## Config Bootstrap

Use central runtime profile/auth bootstrap before starting workers. The developer machine may read protected local `~/.codex/config.toml` and `~/.codex/auth.json` during setup, but those files are only inputs to the bootstrap step. Runtime tasks must consume config and auth from the database through launch lease materialization.

Required setup inputs:

- `FORGELOOP_CONTROL_PLANE_URL`
- `FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET`
- `FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID`
- `FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_CLASS`
- `FORGELOOP_CODEX_RUNTIME_SETUP_DAEMON_IDENTITY`
- `FORGELOOP_CODEX_DOCKER_IMAGE`
- `FORGELOOP_CODEX_DOCKER_IMAGE_DIGEST`
- `FORGELOOP_CODEX_GENERATION_EXPECTED_EFFECTIVE_CONFIG_DIGEST`
- `FORGELOOP_CODEX_RUN_EXECUTION_EXPECTED_EFFECTIVE_CONFIG_DIGEST`
- `FORGELOOP_CODEX_ALLOWED_SCOPE_PROJECT_ID`
- `FORGELOOP_CODEX_CONFIG_TOML_PATH`
- `FORGELOOP_CODEX_AUTH_JSON_PATH`

Optional setup inputs:

- `FORGELOOP_CODEX_ALLOWED_SCOPE_REPO_ID`

The operator can import profile/auth separately or run the bootstrap wrapper. Both read local Codex files as setup inputs only; workers do not read those files at runtime.

```bash
pnpm codex:runtime:import -- --from-local-codex-home --unsafe-db-acknowledgement
```

Run the bootstrap script after verifying the config and auth files are mode `0600`:

```bash
pnpm codex:runtime:bootstrap
```

Record the returned generation and run-execution runtime profile ids, credential binding ids, Docker image digest, network policy digest, and network provider config digest in the operator environment or deployment secret store.

## Worker Start

Start a same-host remote worker with outbound-only control-plane access:

```bash
FORGELOOP_CODEX_WORKER_MODE=remote_outbound \
FORGELOOP_CODEX_RUN_WORKER_MODE=remote_outbound \
FORGELOOP_CONTROL_PLANE_URL=http://127.0.0.1:3000 \
FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET=... \
FORGELOOP_AUTOMATION_ACTOR_ID=codex-worker-operator \
FORGELOOP_AUTOMATION_DAEMON_IDENTITY=codex-remote-worker-dogfood \
FORGELOOP_CODEX_WORKER_ID=codex-worker-local-1 \
FORGELOOP_WORKER_IDENTITY=codex-worker-local \
FORGELOOP_WORKER_BOOTSTRAP_TOKEN=... \
FORGELOOP_WORKER_BOOTSTRAP_TOKEN_VERSION=1 \
FORGELOOP_WORKER_TEMP_ROOT=/tmp/forgeloop-codex-worker \
FORGELOOP_DOCKER_BIN=docker \
FORGELOOP_CODEX_NO_SHARED_FILESYSTEM=1 \
FORGELOOP_CODEX_DOCKER_IMAGE_DIGEST=sha256:... \
FORGELOOP_CODEX_NETWORK_POLICY_DIGEST=sha256:... \
FORGELOOP_CODEX_ALLOWED_SCOPE_PROJECT_ID=project-1 \
FORGELOOP_CODEX_ALLOWED_SCOPE_REPO_ID=repo-1 \
FORGELOOP_CODEX_WORKER_CAPABILITIES=generation,run_execution \
FORGELOOP_WORKER_MAX_CONCURRENCY=1 \
pnpm codex:remote-worker
```

Each task gets a fresh per-task CODEX_HOME created under the worker temp root. In no-shared-filesystem mode, the task container must not mount or read the worker host `~/.codex` directory, the control-plane repo path, or direct config/auth paths. Config, auth, workspace bundle, network policy, and effective-config checks are all bound to the accepted launch lease.

## Generation Dogfood

Run generation dogfood after the worker heartbeat is online:

```bash
FORGELOOP_CODEX_GENERATION_DRIVER=app_server \
FORGELOOP_CODEX_WORKER_MODE=remote_outbound \
FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_ID=... \
FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID=... \
FORGELOOP_CODEX_REMOTE_RUNTIME_JOB_WAIT_TIMEOUT_MS=600000 \
FORGELOOP_CODEX_REMOTE_RUNTIME_JOB_POLL_INTERVAL_MS=1000 \
pnpm automation:dogfood
```

Strict success requires Dockerized app-server evidence: Docker image digest, network policy digest, effective config digest, container id digest, public-safe artifact names and digests, and high-level timing buckets.

## Superpowers Product Loop Dogfood

The strict Superpowers product loop validates centralized config/auth distribution, same-host generation worker startup, no-shared-filesystem run-worker startup, multi-round Boundary Brainstorming, stale-boundary blocking, Spec generation, Execution Plan generation, and Execution from the approved plan.

Keep the Worker Start environment above available to this command because the strict driver invokes one-shot worker polling for the generation and run-execution legs. If the current operator host has the local Codex files, leave bootstrap enabled and provide the Config Bootstrap inputs. If this host does not have local Codex files, import config/auth on a setup host first, copy only the returned profile and binding ids into the deployment secret store, and set `FORGELOOP_CODEX_DOGFOOD_SKIP_BOOTSTRAP=1`.

Use:

```bash
FORGELOOP_CONTROL_PLANE_URL=http://127.0.0.1:3000 \
FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID=codex-runtime-setup \
FORGELOOP_CODEX_DOGFOOD_PROJECT_ID=project-1 \
FORGELOOP_CODEX_DOGFOOD_SOURCE_OBJECT_ID=requirement-1 \
FORGELOOP_CODEX_DOGFOOD_ISOLATED_WORKTREE=1 \
FORGELOOP_CODEX_DOGFOOD_REPO_BASE_BRANCH=main \
FORGELOOP_CODEX_DOGFOOD_REPO_PATH=/path/to/clean-detached-main-worktree \
FORGELOOP_CODEX_GENERATION_DRIVER=app_server \
FORGELOOP_CODEX_WORKER_MODE=remote_outbound \
FORGELOOP_CODEX_RUN_WORKER_MODE=remote_outbound \
FORGELOOP_CODEX_NO_SHARED_FILESYSTEM=1 \
FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_ID=... \
FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID=... \
FORGELOOP_CODEX_RUN_EXECUTION_RUNTIME_PROFILE_ID=... \
FORGELOOP_CODEX_RUN_EXECUTION_CREDENTIAL_BINDING_ID=... \
FORGELOOP_CODEX_REMOTE_RUNTIME_JOB_WAIT_TIMEOUT_MS=600000 \
FORGELOOP_CODEX_REMOTE_RUNTIME_JOB_POLL_INTERVAL_MS=1000 \
# Set only when profile/auth were imported earlier on another setup host:
# FORGELOOP_CODEX_DOGFOOD_SKIP_BOOTSTRAP=1 \
pnpm dogfood:codex-runtime:superpowers
```

This command is the canonical real dogfood pass. It drives Boundary Brainstorming from persisted session state, not fixed round numbers. The expected report path is `docs/superpowers/reports/codex-runtime-real-dogfood-pass.md`.

The report must include the Boundary AI turn count, follow-up-path coverage, summary request-change coverage, stale-boundary negative result, runtime profile/credential digests, app-server runtime job digests, workspace bundle digest, mounted task workspace digest, changed files, and cleanup status.

## Run Execution Dogfood

The run execution dogfood path uses a pending workspace bundle created by the run-worker after it holds an active run-worker lease. The remote worker downloads the accepted bundle, materializes the launch lease, starts Codex app-server in Docker, uploads patch/check/review artifacts, and terminalizes the runtime job. Existing run-worker finalization remains the only writer for RunSession and ReviewPacket state.

Use:

```bash
FORGELOOP_CODEX_RUN_WORKER_MODE=remote_outbound \
FORGELOOP_CODEX_RUN_EXECUTION_RUNTIME_PROFILE_ID=... \
FORGELOOP_CODEX_RUN_EXECUTION_CREDENTIAL_BINDING_ID=... \
FORGELOOP_CODEX_REMOTE_RUNTIME_JOB_WAIT_TIMEOUT_MS=600000 \
FORGELOOP_CODEX_REMOTE_RUNTIME_JOB_POLL_INTERVAL_MS=1000 \
FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD=1 \
pnpm dogfood:delivery:local-codex
```

Direct host config/auth, raw app-server endpoints, raw container ids, local refs, and absolute paths do not count as strict remote success.

## Drain And Restart

The worker drain procedure is:

1. Stop accepting new process supervision restarts.
2. Let active runtime jobs reach terminal status.
3. Stop the worker after active lease count reaches zero.
4. Run stale runtime-job recovery from the control plane if the process exits while jobs are active.

For worker restart:

1. Run the temp-root scavenger before the first online heartbeat.
2. Remove only owner-tagged task directories under `FORGELOOP_WORKER_TEMP_ROOT`.
3. Re-register with the same `FORGELOOP_CODEX_WORKER_ID` only after the previous worker session is expired, recovered, or explicitly replaced.
4. Resume polling accepted runtime jobs and consume terminal evidence through normal writer boundaries.

## Public-Safe Blocker Codes

Common public-safe blocker codes and next checks:

- `codex_worker_unavailable`: check worker heartbeat, scope, capability, Docker image digest, and network policy digest.
- `codex_worker_capability_mismatch`: verify `FORGELOOP_CODEX_WORKER_CAPABILITIES` includes `generation` or `run_execution`.
- `codex_launch_lease_denied`: verify runtime profile, credential binding, target fence, and active action or run-worker lease.
- `codex_launch_materialization_denied`: verify worker session token, accepted job ownership, and launch lease status.
- `codex_runtime_workspace_isolation_unavailable`: inspect workspace bundle validation and per-task temp-root permissions.
- `codex_app_server_unavailable`: inspect Docker daemon access, image availability, and effective-config probe.
- `codex_docker_runtime_evidence_unsafe`: inspect summary redaction and ensure only digests/artifact names are public.
