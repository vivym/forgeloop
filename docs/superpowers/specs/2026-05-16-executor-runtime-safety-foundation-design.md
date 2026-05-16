# Executor Runtime Safety Foundation Design

## Status

Draft approved for spec review.

## Context

ForgeLoop's PRD-first automation daemon can now run as an HTTP sidecar and advance approved PRD objects through draft-only automation. It can create Plan drafts, create ExecutionPackage drafts, request manual-path holds, and project repo runtime policy observations. It deliberately does not enqueue runs.

The remaining blocker for automatic execution is runtime safety. The control plane already has important command-boundary pieces: automation capabilities, idempotent command records, daemon precondition fingerprints, package policy snapshot fields, and a `RuntimeSafetyAttestation` type. The executor package, however, does not yet have a complete safety layer for workspace paths, repo-owned runtime policy, structured command execution, hard resource limits, hooks, fallback behavior, or artifact visibility.

This design implements the full Phase 1 runtime safety foundation from the PRD-first automation daemon design while preserving the PRD object model. Symphony remains useful only as an engineering reference for runtime safety patterns. ForgeLoop's control-plane gates, package snapshots, review requirements, and automation capabilities remain the source of truth.

## Decision Summary

Build a complete executor runtime safety foundation before enabling daemon run enqueue:

- Add executor-owned safety modules for path containment, path policy, runtime policy loading, structured commands, resource governance, and hooks.
- Treat frozen ExecutionPackage policy snapshots as the execution contract.
- Keep repo runtime policy scoped to execution behavior. It cannot broaden automation capabilities or approve product lifecycle gates.
- Route all executor subprocesses through structured command specs and a resource governor, including git probes, worktree commands, checks, hooks, fallback, and primary Codex execution. Pure filesystem probes may use Node filesystem APIs directly but must not spawn subprocesses.
- Require hard-limit attestation for production and local Codex execution. A test-only mock governor is allowed only for mock workflow dogfood.
- Keep daemon planner `run_enqueue` disabled in this scope.
- Public runtime projections expose blocker codes and sanitized summaries only. Raw command, hook, fallback, sandbox, and artifact diagnostics remain internal by default.

## Goals

- Provide reusable executor safety modules with clear boundaries and independent tests.
- Prevent workspace path escapes, symlink escapes, root-equivalent destructive operations, and unsafe artifact paths.
- Define normative repo-relative POSIX PathPolicy semantics for package source mutations.
- Load repo-owned runtime policy from `WORKFLOW.md` with stable digests, last-known-good behavior, and fail-closed initial load rules.
- Replace ad hoc command execution for checks, hooks, and fallback paths with structured command specs.
- Enforce timeout, process-tree kill, output caps, cwd policy, trusted executable resolution, no ambient PATH inheritance, env allowlists, and public-safe diagnostics.
- Introduce a resource governor abstraction that can prove whether CPU, memory, process-count, file-descriptor, workspace-disk, artifact-size, filesystem containment, host-secret isolation, and network policy controls are enforcing.
- Execute `before_run` and `after_run` hooks safely without letting hook failures rewrite terminal RunSession status.
- Harden package readiness so ready/run-eligible packages require captured, valid policy snapshots.
- Keep automatic run enqueue unavailable until runtime safety is complete and explicitly enabled in a later design.

## Non-Goals

- No production `run_enqueue` enablement.
- No daemon planner action that enqueues package runs.
- No source adapter work for Linear, GitHub Issues, Jira, or monitoring systems.
- No new approval shortcut for Spec, Plan, ReviewPacket, Release, rollout, or observations.
- No repo policy ability to grant automation capabilities.
- No UI redesign.
- No generalized shell runner. Shell strings remain rejected unless a future approved-template design explicitly allows them.
- No full sandbox implementation inside ForgeLoop. The first production-enforcing governor delegates to a configured external sandbox executable and fails closed when that executable or its hard-limit self-check is unavailable.

## Architecture

### Ownership Boundary

`packages/executor` owns runtime safety implementation. The control plane stores and validates safety metadata, but it must not duplicate path matching, command validation, hook execution, or resource-governor internals.

The dependency direction is:

- `runtime-policy` may depend on `path-safety`.
- `structured-command` may depend on `path-safety`.
- `artifact-writer` may depend on `path-safety`.
- `resource-governor` may depend on `structured-command`.
- `required-check-runner` may depend on `structured-command`, `resource-governor`, and `artifact-writer`.
- `hook-runner` may depend on `structured-command` and `resource-governor`.
- `local-codex-preflight`, `codex-worktree`, fallback drivers, evidence capture, and run-worker startup/completion may consume those safety modules.

No module below `resource-governor` may bypass the governor to execute checks, hooks, fallback commands, or future package commands.

`StructuredCommand` validates, normalizes, renders, and parses command specs and command results. It does not spawn child processes. `ResourceGovernor` is the only module that launches subprocesses and owns timeout handling, output streaming, process-tree kill, and sandbox wrapping. Tests may use a fake governor to exercise command specs, but production code must not call `spawn`, `execFile`, or equivalent from `StructuredCommand`.

Runtime safety configuration is injected into executor entry points as `ExecutorRuntimeSafetyConfig` from `packages/executor/src/runtime-safety-config.ts`. Production entry points parse it once from explicit deployment configuration or env vars, then pass the typed object to preflight, worktree, executor, fallback, evidence, and run-worker integration code. Tests inject the typed object directly. Missing, partial, or unsafe config selects `UnavailableResourceGovernor` and blocks production/local Codex execution.

Legacy execution entry points must not remain as bypass paths. Existing `workflow-worker -> @forgeloop/workflow activities -> executor-gateway -> local_codex` execution may remain only for mock/test-only dogfood until it is migrated to the same run-worker/executor safety boundary. In Phase 1, `executor-gateway` must reject `local_codex` unless the request is routed through the new runtime-safety modules with a valid `run_execution` attestation, `HookRunner`, authoritative changed-file evidence, `ArtifactWriter`, and split finalization contract. `workflow-worker` activities must either delegate production/local Codex runs to run-worker or fail closed with `primary_executor_governor_unavailable`; they must not call the old all-in-one executor/finalizer path for production/local Codex.

### Runtime Policy Boundary

Repo-owned runtime policy is loaded from a policy source such as `WORKFLOW.md`. The loader returns:

- normalized policy data;
- `policy_digest`;
- `policy_source_path`;
- `policy_loaded_at`;
- last-known-good state;
- structured diagnostics.

Runtime policy can define checks, hooks, path policy, command policy, env policy, fallback policy, Codex runtime mode, prompt policy, and observability preferences. It cannot change automation capability settings, grant daemon permissions, skip approval gates, or alter already frozen package execution semantics.

Invalid initial policy load blocks execution unless a caller explicitly requests safe-default observation mode. Invalid reload preserves the last-known-good policy, emits internal diagnostics, and reports a public-safe reason code.

For Phase 1 the execution policy source is fixed to repo-root `WORKFLOW.md`. Configurable policy source paths are out of scope except for tests that exercise `PathSafety`. A missing `WORKFLOW.md` produces a policy diagnostic and blocks execution-mode package readiness unless the package is explicitly reviewed into a safe default snapshot.

### Runtime Policy Schema

`WORKFLOW.md` front matter uses a strict top-level schema. The first implementation accepts only these sections:

- `codex`: Codex runtime mode, fallback eligibility, and executor-specific runtime preferences.
- `workspace`: workspace root assumptions, worktree behavior, and cleanup constraints.
- `path_policy`: allowed and forbidden source mutation policy.
- `commands`: shared command templates, executable allowlists, timeout defaults, output limits, and cwd policy.
- `environment`: env and PATH allowlists.
- `checks`: required check definitions and references to command templates.
- `hooks`: `before_run` and `after_run` hook definitions and references to command templates.
- `fallback`: exec fallback policy and fallback command templates.
- `artifacts`: artifact visibility, redaction, truncation, and public-safe rules.
- `prompt_policy`: prompt construction and prompt visibility rules.
- `observability`: public-safe summaries, diagnostics routing, and projection preferences.

The snapshot field mapping is normative:

- `path_policy` maps from `path_policy`;
- `command_policy` maps from `commands`;
- `check_policy` maps from `checks`;
- `env_policy` maps from `environment`;
- `workspace_policy` maps from `workspace`;
- `hooks` and `frozen_hook_specs` map from `hooks`;
- `fallback_policy` maps from `fallback`;
- `codex_runtime_mode` maps from `codex`;
- `artifact_visibility_policy` maps from `artifacts`;
- `prompt_policy` maps from `prompt_policy`;
- `validation_public_summary` maps from explicit policy summary data or a generated public-safe summary.

Unknown top-level sections are rejected for execution mode. Observation-only mode may report them as diagnostics, but it must not treat the policy as executable.

`policy_digest` is recomputed from a canonical payload containing the parser version, normalized accepted front matter sections, and the normalized Markdown body after front matter removal. Key ordering, array ordering, whitespace normalization, and omitted optional defaults must be stable. Digest verification never reads live policy for frozen packages; it verifies the frozen normalized payload stored with the snapshot.

Example policy shape:

```markdown
---
path_policy:
  allowed_paths: ["src/**", "tests/**"]
  forbidden_paths: ["src/secrets/**"]
commands:
  trusted_toolchain: "node"
  templates:
    node_test:
      executable: "pnpm"
      args: ["test", "tests/executor"]
      cwd: "workspace_root"
      timeout_ms: 600000
      output_limit_bytes: 1048576
environment:
  allow: []
checks:
  required:
    - check_id: "executor-tests"
      command_template: "node_test"
hooks:
  before_run: []
  after_run: []
fallback:
  mode: "disabled"
artifacts:
  default_visibility: "internal"
observability:
  public_summary: "Executor changes are limited to source and test paths."
---

Runtime instructions for humans and agents.
```

### Frozen Package Snapshot Boundary

ExecutionPackage readiness and run startup use a frozen `PackageRuntimePolicySnapshot`, not the current live repo policy. Package generation captures the normalized runtime policy into the package snapshot:

- `policy_snapshot_status: captured`;
- `policy_snapshot_version`;
- `policy_digest`;
- `policy_source_path`;
- `policy_loaded_at`;
- `policy_last_known_good`;
- `path_policy`;
- `command_policy`;
- `check_policy`;
- `env_policy`;
- `workspace_policy`;
- `hooks`;
- `fallback_policy`;
- `codex_runtime_mode`;
- `artifact_visibility_policy`;
- `prompt_policy`;
- `validation_strategy`;
- `validation_public_summary`;
- frozen hook and command specs where applicable;
- validation evidence references when a broad or custom strategy is used.

The domain `PackageRuntimePolicySnapshot` type must be extended for any accepted execution-affecting policy section that is not already represented, including `workspace_policy`, `prompt_policy`, and `artifact_visibility_policy`. Accepted execution-affecting policy must never be read only from live repo policy at run time.

Repo policy reloads do not mutate existing ready or run-eligible packages. Packages generated before this support exists remain `missing`, `stale`, or draft-only until regenerated or explicitly reviewed into a captured snapshot.

Current `RequiredCheckSpec.command` values are legacy command text. They remain in the contract for API compatibility and human display, but they must not be executed as shell strings. Snapshot capture must produce structured check specs in `frozen_command_check_policy` through one of these paths:

1. a `checks.required[*].command_template` reference to a policy-defined template;
2. a new structured check definition produced by package generation;
3. a compatibility renderer for legacy `RequiredCheckSpec.command` text that accepts only a single executable plus argv tokens with no shell metacharacters, no variable expansion, no redirection, no pipes, no command chaining, and no quoting semantics beyond simple whitespace tokenization.

If a legacy command cannot be rendered into a valid structured command spec, the package cannot become ready. The public blocker code is `required_check_command_invalid`; raw command text remains internal unless already part of an approved public package artifact.

### Execution Boundary

Run startup must read the package's frozen snapshot and then:

1. validate declared package scope with `PathPolicy`;
2. validate policy-captured checks and hooks as structured command specs;
3. construct or verify a run-bound `run_execution` `RuntimeSafetyAttestation`;
4. run internal runtime preflight probes through `ResourceGovernor.run`;
5. execute `before_run` hooks through `ResourceGovernor.run`;
6. materialize and start Codex/local/mock execution only if all gates pass.

Declared package scope validation runs before executor startup against `ExecutionPackage.allowed_paths`, `ExecutionPackage.forbidden_paths`, package metadata, and any planned source-scope data already present in the package snapshot. It prevents startup when the package is not authorized to mutate its declared scope.

Actual changed-file validation runs after executor completion and before review packet creation. The run-worker/executor side of the boundary must independently derive the authoritative changed-file set from the git/worktree state through `StructuredCommand` and the run `ResourceGovernor`; it must not trust executor-reported `changed_files`. `@forgeloop/workflow` must not import `@forgeloop/executor`; it consumes a finalization input that already contains authoritative changed-file evidence, PathPolicy validation outcome, and sanitized blocker metadata. Executor-reported changed files are advisory diagnostics only. The authoritative derivation compares the run workspace against the package base commit, includes untracked files, deletes, and rename `previous_path` values, and fails closed if the changed-file set cannot be computed. If actual changes violate PathPolicy, terminalization records the RunSession as failed with public blocker code `path_policy_actual_changes_rejected`, keeps raw diff details internal by default, and does not create or advance a ReviewPacket from that run. If authoritative changed-file computation fails, the public blocker code is `changed_files_unavailable`.

Run completion executes `after_run` hooks through the same governor after terminal RunSession status is persisted and before ReviewPacket creation. Failed `after_run` hooks record non-blocking internal diagnostics and sanitized post-run metadata where appropriate, but they do not rewrite terminal status or become runtime blockers.

Primary Codex execution is part of the runtime boundary. For production or local Codex execution, the process that runs Codex, or the app-server worker that owns the Codex session, must be launched or leased through `ResourceGovernor` with an enforcing attestation. It is not sufficient to govern only checks, hooks, and fallback. If the configured Codex driver cannot prove that the primary execution process is covered by CPU, memory, process-count, fd, workspace-disk, and artifact-size hard limits, startup is blocked with `primary_executor_governor_unavailable`. Mock executor workflow dogfood may use `TestOnlyMockResourceGovernor` only under the existing mock/workflow-only restriction.

The startup table in Normative Contracts is authoritative for ordering. Earlier sections describe the same sequence at a higher level and must not be implemented with a different order.

## Modules

### PathSafety

File: `packages/executor/src/path-safety.ts`

Responsibilities:

- canonicalize repo roots;
- validate repo-relative input paths before joining;
- reject empty, absolute, `..`, backslash, and control-byte path input;
- resolve paths segment by segment so symlink escapes can be classified separately from ordinary outside-root paths;
- reject operations that target the repo root when a child path is required;
- validate artifact roots and artifact paths as separate containment checks;
- provide operation-time helpers for destructive operations and artifact writes that revalidate containment immediately before the operation and use no-follow/openat-style APIs, or a platform-equivalent parent-handle strategy, to prevent symlink race escapes.

Representative errors:

- `workspace_path_escape`;
- `workspace_symlink_escape`;
- `workspace_equals_root`;
- `path_contains_control_character`;
- `path_not_repo_relative`.

`PathSafety` does not implement glob policy and does not read package semantics.

Validation-time checks are not enough for writes or deletion. Worktree cleanup, recursive removal, artifact directory creation, artifact file writes, and raw-log writes must use operation-time containment:

- open or resolve parent directories with no-follow semantics where the platform supports it;
- reject symlinked final path components for writes unless the operation explicitly supports safe replacement through a temp file under an already validated parent;
- revalidate canonical parent containment immediately before destructive operations;
- avoid recursive removal APIs on paths that have not been operation-time checked;
- write artifacts through temp files inside the validated artifact root, then atomically rename within the same validated parent;
- classify operation-time symlink races as `workspace_symlink_escape`.

### PathPolicy

File: `packages/executor/src/path-policy.ts`

Responsibilities:

- compile typed path policy entries from normalized policy snapshots;
- validate repo-relative POSIX glob patterns;
- reject absolute paths, empty paths, `.`/`..`, backslashes, control bytes, leading `!`, brace expansion, extglob, and root-wide patterns by default;
- allow root-wide behavior only for an explicit `allow_all_repo` validation strategy with reviewed evidence;
- use case-sensitive, globstar-enabled, explicit-dotfile, negation-disabled semantics;
- evaluate changed files with both `previous_path` and `path` for renames;
- apply forbidden-path precedence over allowed paths.

`PathPolicy` evaluates normalized repo-relative paths only. It does not access the filesystem.

Empty `allowed_paths` is deny-all. A package with empty effective allowed paths may only become ready if it declares no source mutation and all checks/hooks/fallback behavior still satisfy the frozen snapshot. Any actual changed file from such a package is rejected with `path_policy_actual_changes_rejected`. Allow-all repo behavior must be explicit through `validation_strategy: allow_all_repo`, reviewed approval evidence, and a frozen snapshot flag; it is not inferred from empty `allowed_paths`.

The effective path policy is the intersection of package scope and frozen repo policy:

- package `allowed_paths` and frozen `path_policy.allowed_paths` must both permit a source path unless one layer is explicitly reviewed as `allow_all_repo`;
- package `forbidden_paths` and frozen `path_policy.forbidden_paths` are combined as a union;
- forbidden paths from either layer win over allowed paths from either layer;
- `allow_all_repo` in one layer removes that layer's allow restriction but does not override the other layer's forbidden paths or allow restriction;
- if either layer has empty effective allowed paths and is not explicitly reviewed as `allow_all_repo`, the intersection is deny-all for source mutation;
- the same effective policy is used for pre-run declared scope validation and post-run actual changed-file validation.

Path normalization pins:

- duplicate slashes collapse before matching;
- leading and trailing whitespace in policy patterns is invalid;
- trailing slash directory patterns are normalized to an explicit subtree pattern;
- directory patterns match descendants, not the directory name alone, unless the policy entry explicitly includes both;
- dotfiles match only when the corresponding pattern segment explicitly starts with `.`;
- `previous_path` for renamed files is evaluated with the same normalization and forbidden precedence as `path`.

### RuntimePolicyLoader

File: `packages/executor/src/runtime-policy.ts`

Responsibilities:

- resolve the policy source path through `PathSafety`;
- parse Markdown with strict front matter;
- validate the allowed top-level sections defined in Runtime Policy Schema;
- normalize policy data into stable JSON-compatible data;
- compute stable `policy_digest` from normalized policy data and relevant prompt/body content;
- maintain last-known-good state across reloads;
- distinguish observation-safe diagnostics from execution-blocking diagnostics.

The first implementation may use a narrow parser for the policy fields ForgeLoop supports. Unsupported fields are rejected instead of silently ignored when execution behavior would be ambiguous.

### StructuredCommand

File: `packages/executor/src/structured-command.ts`

Responsibilities:

- define structured command specs for checks, hooks, fallback paths, and future package commands;
- reject shell strings and `shell: true` by default;
- render legacy `RequiredCheckSpec.command` text only through the constrained compatibility renderer described in the snapshot boundary;
- reject absolute executables and unapproved relative executable paths by default;
- resolve approved executables through controlled policy and PATH rules;
- validate cwd as workspace root or approved repo-relative path through `PathSafety`;
- sanitize env and construct PATH from trusted executable roots; ambient PATH is never inherited by default;
- validate command timeout and output byte limits;
- parse governor-returned stdout/stderr references and truncation metadata into a `StructuredCommandResult`.

Structured command validation produces public-safe reason codes. Raw command data is internal unless explicitly marked and scanned as public-safe.

Executable and PATH semantics are strict:

- repo policy may request an executable by logical name, but deployment/toolchain configuration resolves it to a canonical executable path;
- allowed PATH entries are absolute, canonicalized, non-writable by the runtime/untrusted principal, outside the mutable workspace and artifact roots, and not symlink escapes;
- writable workspace directories, package-controlled directories, temp directories, and artifact directories must never appear in PATH;
- the command runner constructs PATH from trusted entries only when a command requires PATH lookup;
- if PATH lookup is not needed, PATH is omitted from the child environment;
- executable resolution happens before launch and records the canonical executable path and digest or version metadata in internal diagnostics;
- the resolved executable must be a regular executable file under a trusted toolchain root, or the command is rejected with `structured_command_invalid`;
- the child environment starts empty except for explicit allowlisted variables and runner-injected safe variables.

First implementation defaults and hard maximums:

- default command timeout: 10 minutes;
- maximum command timeout: 10 minutes unless an enforcing governor exposes a lower maximum;
- default hook timeout: 2 minutes;
- maximum hook timeout: 2 minutes unless an enforcing governor exposes a lower maximum;
- default per-command output cap: 1 MiB;
- maximum per-command output cap: 1 MiB;
- default per-run captured text cap: 10 MiB;
- maximum per-run captured text cap: 10 MiB.

Policy may choose stricter limits. It may not raise limits above these maxima in this implementation.

### ResourceLimits And ResourceGovernor

Files:

- `packages/executor/src/runtime-safety-config.ts`
- `packages/executor/src/resource-limits.ts`
- `packages/executor/src/resource-governor.ts`

`runtime-safety-config` defines and validates the deployment-owned configuration needed by the governor and trusted executable resolver:

```ts
interface ExecutorRuntimeSafetyConfig {
  sandbox?: {
    executable_path: string;
    config_digest: string;
    config_path?: string;
    default_cpu_ms: number;
    default_memory_mb: number;
    default_pids: number;
    default_fds: number;
    default_workspace_bytes: number;
    default_artifact_bytes: number;
  };
  trusted_toolchains: Record<string, {
    root_paths: string[];
    executable_names: string[];
    config_digest: string;
  }>;
  artifact_root: string;
}
```

```ts
interface ResourceLimitVector {
  cpu_ms: number;
  memory_mb: number;
  pids: number;
  fds: number;
  workspace_bytes: number;
  artifact_bytes: number;
  timeout_ms: number;
  output_limit_bytes: number;
  run_output_limit_bytes: number;
}
```

The production parser reads only explicit `FORGELOOP_EXECUTOR_*` configuration keys, never ambient `PATH` discovery. `ExternalSandboxResourceGovernor` cannot be constructed without a validated sandbox executable path, sandbox config digest, trusted toolchain config, artifact root, and bounded resource-limit defaults. Config digests are recorded in attestations and leases; changing any configured sandbox, toolchain, mount, resource-limit, or artifact root value invalidates outstanding attestations.

`resource-limits` resolves whether a package enqueue or run execution can be treated as runtime-safe and produces or rejects scope-aware `RuntimeSafetyAttestation` values.

`resource-governor` is the only execution abstraction for structured runtime commands. First implementation modes:

- `UnavailableResourceGovernor`: always reports `hard_limit_mode: unavailable`.
- `ExternalSandboxResourceGovernor`: wraps structured commands with a configured sandbox executable and configured hard-limit arguments.
- `TestOnlyMockResourceGovernor`: allowed only in tests or local dogfood when `executor_type === 'mock'` and `workflow_only === true`.

There are two governor scopes:

- bootstrap governor: covers source-repo git probes and worktree preparation before the run workspace exists. It is still a `ResourceGovernor`, uses trusted executable resolution and output/time limits, and must not receive secrets or mutable workspace PATH entries. It may attest only bootstrap command isolation, not run execution safety.
- run governor: covers run workspace commands, primary Codex execution, hooks, checks, fallback, authoritative changed-file derivation, and artifact-producing commands. Production/local Codex run startup requires the run governor's enforcing attestation or lease.

Production and local Codex execution require run-bound attestations to include:

- `attestation_scope: run_execution`;
- `hard_limit_mode: enforcing`;
- `environment`;
- `executor_type`;
- `workflow_only`;
- `governor_provenance: external_sandbox`;
- support for CPU, memory, process-count, file-descriptor, workspace-disk, artifact-size limits, and process-tree kill on timeout;
- maximum command timeout, hook timeout, command output bytes, and run output bytes;
- `resource_limit_digest` covering the canonical `ResourceLimitVector` for the run;
- filesystem containment for the canonical workspace root and artifact root;
- host-secret isolation, with no ambient host home or process environment exposure;
- explicit credential delivery through an approved secret mount, credential proxy, or env allowlist entry recorded in the attestation;
- network mode recorded as `disabled` or `egress_allowlist`, with any allowlist represented by digest rather than raw secret-bearing config;
- checked attestation scope matching project, repo, package, run id, environment, executor type, workflow mode, workspace root, artifact root, `policy_digest`, env policy digest, command policy digest, mount policy digest, network policy digest, and resource-limit digest;
- sandbox binary identity, sandbox version, sandbox binary digest when available, sandbox config digest, allowed mount digest, and attestation expiry.

Missing sandbox executable, missing hard-limit argument, stale attestation, unsupported limit dimension, or self-check failure returns `runtime_hard_limits_unavailable` and blocks execution.

The primary Codex executor also uses the governor. For CLI-style execution, `ResourceGovernor.run` launches the Codex command itself. For app-server-style execution, the driver must obtain a governor lease or launch a sandboxed app-server worker whose attestation covers the run. If neither mode is available, local Codex and production execution are blocked even when checks and hooks could be sandboxed.

An attestation is invalid if any bound value differs at execution time, including run id, workspace root, artifact root, sandbox config digest, network mode, network policy digest, env policy digest, command policy digest, mount policy digest, resource-limit digest, `policy_digest`, sandbox wrapper environment digest, or process-tree kill support. Attestations must expire quickly enough that they cannot be reused across unrelated runs.

### HookRunner

File: `packages/executor/src/hook-runner.ts`

Responsibilities:

- build hook execution specs from the frozen package snapshot;
- run `before_run` hooks before Codex/local/mock startup;
- run `after_run` hooks after terminal RunSession status persistence;
- route all hook commands through `StructuredCommand` and `ResourceGovernor.run`;
- enforce hook timeout no greater than attested `max_hook_timeout_ms`;
- fail closed on `before_run` timeout, non-zero exit, policy error, or governor error;
- record `after_run` failures as internal diagnostics without changing terminal RunSession status;
- expose only public-safe reason codes and sanitized summaries outside the internal diagnostic surface.

### RequiredCheckRunner

File: `packages/executor/src/required-check-runner.ts`

Responsibilities:

- consume `FrozenStructuredCheckPolicy` from the frozen package snapshot;
- materialize each canonical required check into a complete `StructuredCommandSpec`;
- execute required checks after primary execution and before changed-file finalization;
- route all check commands through `ResourceGovernor.run`;
- map non-zero exits to `required_check_failed` and timeouts to `required_check_timed_out`;
- write check stdout/stderr references through the artifact writer import path and keep raw output internal by default.

### ArtifactWriter

File: `packages/executor/src/artifact-writer.ts`

Responsibilities:

- provide the central artifact writer used by local evidence, raw logs, required checks, hooks, fallback, diff summaries, and sandbox output imports;
- enforce artifact root containment, disjointness from source/worktree/git/package-controlled paths, no-follow operation-time containment, quotas, visibility, redaction, and atomic write rules;
- import allowed files from `sandbox-output-root` after subprocess completion without letting subprocesses write directly to `artifact-root`;
- return artifact refs and internal diagnostic refs without exposing local absolute paths.

## Integration Points

### Codex Worktree

`packages/executor/src/codex-worktree.ts` must use `PathSafety` before worktree cleanup, worktree creation, `git worktree remove`, and recursive removal. The `.worktrees` root must remain under the canonical repo root. A run workspace path must be a child of that worktree root and must match the sanitized run-session segment.

Git worktree commands are subprocesses and must use `StructuredCommand` with trusted executable resolution, bounded timeouts, output caps, sanitized env, and `ResourceGovernor` coverage. Recursive cleanup also requires operation-time containment from `PathSafety`; a path that was safe during planning must be revalidated immediately before removal.

### Local Codex Preflight

`packages/executor/src/local-codex-preflight.ts` must consume frozen package policy when available and block startup when:

- runtime policy snapshot is missing or invalid for ready/run-eligible packages;
- path policy rejects declared package scope;
- checks cannot be rendered as structured commands;
- resource hard limits are unavailable for Codex execution;
- `before_run` hooks fail closed.

Existing command checks such as Git and Codex availability are still subprocesses. They must move behind `StructuredCommand` and `ResourceGovernor` with short timeouts, trusted executable resolution, output caps, sanitized env, and internal-only raw diagnostics. Pure filesystem checks such as `stat`, `lstat`, `access`, and directory creation probes may use Node filesystem APIs directly and must not shell out.

### Fallback Driver

`packages/executor/src/codex-exec-fallback-driver.ts` must deny fallback unless the frozen snapshot explicitly permits the fallback mode. Fallback cwd, env, executable, timeout, and output caps use the same structured-command rules as checks and hooks. Public errors expose reason codes rather than raw stderr.

### Executor Gateway And Workflow Worker

`apps/executor-gateway` and `apps/workflow-worker` are legacy execution surfaces in this scope. They must not provide an alternate production/local Codex path that bypasses run-worker/executor runtime safety.

- `apps/executor-gateway/src/executor.service.ts` must reject `local_codex` when a request lacks a valid `run_execution` attestation and the runtime safety config needed to route through `ResourceGovernor`, `HookRunner`, `ArtifactWriter`, and authoritative changed-file evidence.
- `apps/workflow-worker/src/worker.ts` and `packages/workflow/src/activities.ts` may keep mock workflow dogfood and test paths, but production/local Codex activities must delegate to run-worker or fail closed.
- Any compatibility wrapper around `finalizePackageRunWithExecutorResult` is mock/test-only unless it calls the split terminalization, `after_run`, and review-finalization sequence with authoritative runtime evidence.

### Evidence And Artifacts

`packages/executor/src/local-codex-evidence.ts` and raw-log capture must apply artifact visibility policy from the frozen snapshot:

- raw stdout/stderr, hook output, check output, fallback output, sandbox diagnostics, and automation errors are internal by default;
- public-safe artifacts require explicit visibility metadata and truncation/redaction;
- artifact paths must pass artifact containment checks;
- artifact writes must use operation-time no-follow containment or equivalent parent-handle revalidation before writing or renaming files.

### Run Worker

Run startup consumes the frozen package snapshot before executor startup. The run-worker/executor side independently computes actual changed files from git/worktree state before review packet creation; it does not trust executor-reported changed files. Runtime artifact persistence is performed by the run-worker/executor side of the boundary through `ArtifactWriter`; `@forgeloop/workflow` receives artifact refs and finalization inputs but must not import `@forgeloop/executor` or perform executor-owned filesystem writes. Terminal completion runs `after_run` hooks after terminal RunSession status persistence and before ReviewPacket creation. If `after_run` hooks fail, the run remains terminal and the hook failure is recorded as non-blocking post-run diagnostics.

The finalization API must be split so the run-worker can interleave `after_run` without making hooks part of terminalization:

- `terminalizePackageRunWithRuntimeEvidence`: validates run lease, persists terminal RunSession status, stores required check results, authoritative changed-file evidence, PathPolicy outcome, and primary artifact refs, and returns whether review finalization is eligible;
- run-worker executes `after_run` through `HookRunner` and stores post-run diagnostics/artifacts separately;
- `completePackageRunReviewFinalization`: runs self-review and creates or advances ReviewPacket only from the terminalized run state and primary artifact refs.

The existing all-in-one `finalizePackageRunWithExecutorResult` must either become a compatibility wrapper for mock/test-only paths or be refactored to call the split functions in this order. Production/local Codex run-worker code must use the split contract.

### Control Plane

The control plane continues to own automation capability settings and command preconditions. `enqueueRunIfPackageStillReady` continues to require `canEnqueueRuns` and a valid enqueue-time runtime safety attestation, but that attestation is package/preflight scoped because the command validates it before creating the RunSession id. It does not satisfy production/local Codex execution safety. The run-worker must construct or acquire a separate run-bound execution attestation after RunSession id, workspace root, artifact root, and sandbox output root exist. This design may strengthen validation and tests around attestation shape, mode, scope, and reason codes, but it does not make the daemon planner enqueue runs.

### Public-Safe Blocker Projection

The projection contract for this scope is the automation runtime snapshot DTO. It may be the existing internal `/internal/automation/runtime-snapshot` response or a later public `/query/runtime` response, but both surfaces must use the same sanitized blocker shape:

- `target_object_type`;
- `target_object_id`;
- optional `target_revision_id`;
- optional `repo_id`;
- `blocked_reason_code`;
- `blocked_summary`;
- `retryable`;
- optional `policy_digest`;
- optional `policy_snapshot_version`;
- optional `diagnostic_ref` that points only to an internal diagnostic artifact.

The implementation landing is explicit:

- add `RuntimeSnapshotBlockerRow` and `RuntimeSnapshotTargetRow.blockers?: RuntimeSnapshotBlockerRow[]` in `packages/db/src/repositories/delivery-repository.ts`; each blocker row stores `blocked_reason_code`, `blocked_summary`, `retryable`, and optional `policy_digest`, `policy_snapshot_version`, and `diagnostic_ref`, while the parent target row stores target identity fields;
- add `AutomationRuntimeBlockerDto` in `apps/control-plane-api/src/modules/automation/automation.dto.ts` and map blocker rows to DTOs;
- update `RuntimeSnapshotService` and `toRuntimeSnapshotTargetDto` to compute and sort blockers, then fill singular `blocked_reason_code` and `blocked_summary` from the first blocker for compatibility;
- add `AutomationRuntimeBlocker` and `RuntimeSnapshotTarget.blockers?: AutomationRuntimeBlocker[]` to `packages/automation/src/types.ts`, and update `packages/automation/src/http-client.ts` wire parsing to preserve `blockers[]`; singular `blockedReasonCode` and `blockedSummary` remain compatibility aliases only;
- keep in-memory and Drizzle repository runtime snapshot rows storage-neutral by deriving blockers at query time from package/run policy status, action run state, manual holds, and sanitized diagnostics references.

The DTO must not expose raw command text, raw stdout/stderr, raw diff content, local absolute paths, sandbox self-check output, hook output, fallback stderr, env values, or secret-bearing diagnostics.

Required blocker codes:

| Code | Meaning | Retryable |
| --- | --- | --- |
| `policy_snapshot_missing` | ready/run-eligible package has no captured snapshot | false |
| `policy_snapshot_invalid` | captured snapshot is structurally invalid or inconsistent | false |
| `policy_digest_mismatch` | package snapshot digest does not match the frozen normalized policy payload | false |
| `runtime_policy_invalid` | repo policy cannot be used for execution | false |
| `path_policy_declared_scope_rejected` | package declared scope is outside allowed PathPolicy | false |
| `path_policy_actual_changes_rejected` | executor changed files outside allowed PathPolicy | false |
| `changed_files_unavailable` | authoritative changed-file computation failed | true |
| `required_check_command_invalid` | legacy or generated check cannot render to structured command | false |
| `required_check_failed` | required check executed and exited non-zero | true |
| `required_check_timed_out` | required check exceeded timeout | true |
| `structured_command_invalid` | hook, check, fallback, or package command spec is invalid | false |
| `runtime_hard_limits_unavailable` | enforcing hard-limit governor is unavailable | true |
| `runtime_attestation_invalid` | attestation is stale, mismatched, or insufficient | true |
| `sandbox_isolation_unavailable` | filesystem, secret, mount, or network isolation cannot be proven | true |
| `primary_executor_governor_unavailable` | primary Codex execution is not covered by an enforcing governor | true |
| `before_run_hook_failed` | `before_run` hook exited non-zero | true |
| `before_run_hook_timed_out` | `before_run` hook exceeded timeout | true |
| `fallback_denied_by_policy` | fallback was requested but frozen policy denies it | false |
| `artifact_visibility_denied` | requested public artifact is internal-only or failed redaction | false |

Package/run/review surfaces may store richer internal diagnostics, but any public or daemon-planner projection must reduce them to this contract. `after_run` diagnostics are non-blocking post-run diagnostics and are not projected as blockers unless a later design explicitly adds a post-run warning surface.

When multiple blockers apply, the runtime snapshot must expose a `blockers` array sorted by deterministic precedence, then `blocked_reason_code`, then target id. Existing singular fields such as `blocked_reason_code` and `blocked_summary` are retained as compatibility aliases for the first blocker in the sorted list. Precedence is:

1. policy snapshot missing, invalid, or digest mismatch;
2. runtime policy invalid;
3. declared scope PathPolicy rejection;
4. structured command or required-check command invalid;
5. runtime hard-limit, sandbox isolation, attestation, or primary executor governor unavailable;
6. `before_run` hook failure or timeout;
7. required check failure or timeout;
8. authoritative changed-file computation failure or actual changed-file PathPolicy rejection;
9. fallback or artifact visibility denial.

## Normative Contracts

This section defines the contracts the implementation plan must use. Fields not listed are rejected in execution mode unless explicitly marked optional here.

### Runtime Policy Contract

```ts
type Visibility = 'internal' | 'public_safe';
type CwdPolicy = 'workspace_root' | { repo_relative: string };
type NetworkMode = 'disabled' | 'egress_allowlist';
type FallbackMode = 'disabled' | 'codex_exec';
type SourceWritePolicy = 'read_only' | 'path_policy_scoped' | 'artifact_only';

interface RuntimePolicyDocument {
  codex?: {
    primary_executor?: 'cli' | 'app_server' | 'mock';
    network_mode?: NetworkMode;
    egress_allowlist_digest?: string;
  };
  workspace?: {
    worktree_dir?: '.worktrees';
    cleanup?: 'run_workspace_only' | 'disabled';
    source_snapshot?: 'required';
  };
  path_policy?: {
    allowed_paths?: string[];
    forbidden_paths?: string[];
    allow_all_repo?: boolean;
  };
  commands?: {
    trusted_toolchain: string;
    templates?: Record<string, StructuredCommandSpec>;
    default_timeout_ms?: number;
    default_output_limit_bytes?: number;
    safe_git_profile?: 'forgeloop_default';
  };
  environment?: {
    allow?: string[];
    path_toolchain?: string;
  };
  checks?: {
    required?: PolicyRequiredCheckSpec[];
  };
  hooks?: {
    before_run?: HookSpec[];
    after_run?: HookSpec[];
  };
  fallback?: {
    mode?: FallbackMode;
    command_template?: string;
    command?: StructuredCommandSpec;
    timeout_ms?: number;
    output_limit_bytes?: number;
    visibility?: Visibility;
    source_write_policy?: SourceWritePolicy;
  };
  artifacts?: {
    default_visibility?: Visibility;
    max_artifact_bytes?: number;
    max_run_artifact_bytes?: number;
    public_safe_kinds?: string[];
  };
  prompt_policy?: {
    include_workflow_body?: boolean;
    body_visibility?: Visibility;
  };
  observability?: {
    public_summary?: string;
  };
}

interface PolicyRequiredCheckSpec {
  check_id: string;
  display_name?: string;
  command_template?: string;
  command?: StructuredCommandSpec;
  timeout_ms?: number;
  output_limit_bytes?: number;
  visibility?: Visibility;
  source_write_policy?: SourceWritePolicy;
  blocks_review?: boolean;
}
```

Defaults:

- `codex.primary_executor`: package/executor default, but execution mode must freeze the resolved value.
- `fallback.mode`: `disabled`.
- `codex.network_mode`: `disabled`.
- `workspace.worktree_dir`: `.worktrees`.
- `workspace.cleanup`: `run_workspace_only`.
- `workspace.source_snapshot`: `required`.
- `path_policy.allowed_paths`: `[]`, meaning deny-all.
- `path_policy.forbidden_paths`: `[]`.
- `environment.allow`: `[]`.
- `artifacts.default_visibility`: `internal`.
- `prompt_policy.include_workflow_body`: `true`.
- `prompt_policy.body_visibility`: `internal`.
- command timeout and output defaults are the hard defaults in `StructuredCommand`.

Field rejection rules:

- unknown top-level sections are rejected;
- unknown fields inside accepted sections are rejected in execution mode;
- `codex.primary_executor` is the only primary executor selector; `runtime_mode` is not accepted in Phase 1;
- `fallback.mode` is the only fallback selector; `codex.fallback` and `fallback.codex_exec` are not accepted in Phase 1;
- `path_policy.allow_all_repo` requires `validation_strategy: allow_all_repo` plus reviewed evidence in the package snapshot;
- `environment.allow` cannot include wildcard entries and cannot allow variables matching secret-looking names such as `*_TOKEN`, `*_KEY`, `*_SECRET`, or `*_PASSWORD` unless the frozen snapshot records explicit approval evidence;
- `environment.allow` and command-local env must reject dangerous runtime variables by default, including `PATH`, `NODE_OPTIONS`, `LD_PRELOAD`, `LD_LIBRARY_PATH`, `DYLD_*`, `GIT_CONFIG_*`, `GIT_ASKPASS`, `SSH_AUTH_SOCK`, `BASH_ENV`, `ENV`, and shell startup variables. They may be enabled only through reviewed snapshot evidence and a structured allow rule that records why the variable is safe;
- `network_mode: egress_allowlist` requires a frozen allowlist digest, not raw secret-bearing network config.
- `network_mode: egress_allowlist` requires `codex.egress_allowlist_digest`; `network_mode: disabled` uses digest value `network-disabled`.
- `commands.safe_git_profile` defaults to `forgeloop_default`; no other profile is accepted in Phase 1.

### Frozen Snapshot Contract

`PackageRuntimePolicySnapshot` must include the normalized policy payload that the digest covers:

```ts
type PolicySnapshotOrigin = 'workflow_md' | 'reviewed_safe_default';
type SourceMutationPolicy = 'path_policy_scoped' | 'no_source_changes';

interface ApprovalEvidenceRef {
  evidence_type: 'decision' | 'artifact' | 'object_event';
  ref_id: string;
  approved_by_actor_id: string;
  approved_at: string;
  summary: string;
}

interface FrozenRuntimePolicyPayload {
  parser_version: string;
  policy_source_path: 'WORKFLOW.md';
  normalized_front_matter: RuntimePolicyDocument;
  normalized_markdown_body: string;
  normalized_body_digest: string;
  normalized_payload_digest: string;
}

interface FrozenStructuredCheckPolicy {
  required_checks: FrozenRequiredCheckSpec[];
}

interface FrozenRequiredCheckSpec {
  check_id: string;
  display_name: string;
  source: 'execution_package' | 'repo_policy';
  blocks_review: boolean;
  timeout_ms: number;
  command: StructuredCommandSpec;
  visibility: Visibility;
}

interface PackageRuntimePolicySnapshotExtensions {
  snapshot_origin: PolicySnapshotOrigin;
  normalized_policy_payload: FrozenRuntimePolicyPayload;
  path_policy: RuntimePolicyDocument['path_policy'];
  command_policy: RuntimePolicyDocument['commands'];
  check_policy: RuntimePolicyDocument['checks'];
  env_policy: RuntimePolicyDocument['environment'];
  workspace_policy: RuntimePolicyDocument['workspace'];
  hooks: RuntimePolicyDocument['hooks'];
  fallback_policy: RuntimePolicyDocument['fallback'];
  codex_runtime_mode: Required<NonNullable<RuntimePolicyDocument['codex']>>['primary_executor'];
  env_policy_digest: string;
  command_policy_digest: string;
  mount_policy_digest: string;
  network_policy_digest: string;
  safe_git_profile: 'forgeloop_default';
  artifact_visibility_policy: RuntimePolicyDocument['artifacts'];
  prompt_policy: RuntimePolicyDocument['prompt_policy'];
  validation_strategy: 'checks_required' | 'allow_all_repo' | 'custom';
  validation_strategy_version?: number;
  validation_public_summary: string;
  validation_evidence_refs: ArtifactRef[];
  safe_default_approval_evidence?: ApprovalEvidenceRef;
  frozen_command_check_policy: FrozenStructuredCheckPolicy;
  frozen_hook_specs: {
    before_run: HookSpec[];
    after_run: HookSpec[];
  };
  source_mutation_policy: SourceMutationPolicy;
}
```

Digest verification uses `normalized_policy_payload.normalized_payload_digest`. It must not read live `WORKFLOW.md` for a frozen package. The derived policy digests are computed from canonical normalized data after defaults are resolved: `env_policy_digest` covers `environment` plus reviewed env evidence, `command_policy_digest` covers `commands`, materialized command defaults, and trusted toolchain config digest references, `mount_policy_digest` covers workspace/artifact/source-snapshot/sandbox-output mount policy, and `network_policy_digest` covers `codex.network_mode` plus the frozen allowlist digest or `network-disabled`.

Safe default snapshots are allowed only when `WORKFLOW.md` is missing and a trusted human/admin or system bootstrap actor explicitly approves the package with `safe_default_approval_evidence`. Automation daemon, repo policy, source adapter, and external tracker actors cannot approve a safe default snapshot. A safe default snapshot must use:

- `snapshot_origin: reviewed_safe_default`;
- `policy_source_path: 'WORKFLOW.md'`;
- empty normalized front matter;
- empty normalized Markdown body;
- `path_policy.allowed_paths: []`;
- `path_policy.forbidden_paths: []`;
- `source_mutation_policy: no_source_changes`;
- `validation_strategy: checks_required`;
- a non-empty `safe_default_approval_evidence` record;
- empty `validation_evidence_refs` unless the approving actor also attaches reviewed artifact evidence;
- no hooks;
- fallback disabled;
- artifact visibility internal by default;
- environment allowlist empty;
- network disabled;
- `env_policy_digest` for the empty env policy;
- `command_policy_digest` for empty command templates and hard defaults;
- `mount_policy_digest` for source read-only/no-source-change mounts and sandbox output import policy;
- `network_policy_digest: network-disabled`;
- `safe_git_profile: forgeloop_default`.

The no-mutation predicate is true only when `source_mutation_policy: no_source_changes`, the effective allowed path set is deny-all, no hook/check/fallback spec has `source_write_policy` other than `read_only` or `artifact_only`, and final authoritative changed-file derivation returns an empty set. Otherwise the package cannot use the safe default snapshot.

`source_mutation_policy` lands on `ExecutionPackage`, `PackageRuntimePolicySnapshot`, and `RunSpec`. `CreateExecutionPackageDto` and `PatchExecutionPackageDto` accept optional `source_mutation_policy`; if omitted it defaults to `path_policy_scoped`, and `allowed_paths: []` is rejected. `packages/contracts` owns only the self-contained `RunSpec` wire schema: `RunSpec.allowed_paths` changes from unconditional `.min(1)` to a conditional schema that allows `[]` only when `RunSpec.source_mutation_policy === 'no_source_changes'`. Contracts must not import or validate `PackageRuntimePolicySnapshot` from `packages/domain`. Cross-object consistency between `RunSpec.source_mutation_policy`, `ExecutionPackage.source_mutation_policy`, and `PackageRuntimePolicySnapshot.source_mutation_policy` is validated in workflow/domain run-spec construction and executor startup. For normal source-mutating packages, existing non-empty `allowed_paths` behavior remains required. Validators must reject `allowed_paths: []` paired with `source_mutation_policy: path_policy_scoped`.

### Required Check Lifecycle

`ExecutionPackage.required_checks` remains the product-level required-check list. Repo policy checks augment it but cannot remove or weaken it.

Canonical required checks are built as follows:

1. For every `ExecutionPackage.required_checks[]` entry, create one `FrozenRequiredCheckSpec`.
2. If repo policy has a `checks.required[]` entry with the same `check_id`, it may provide the structured command template. It must not change `display_name`, set `blocks_review` from `true` to `false`, or raise timeout above the package timeout.
3. If no repo policy entry matches, the package check command is rendered through the legacy compatibility renderer.
4. Repo policy checks with new `check_id` values are appended as safety checks. They default to `blocks_review: true` and `visibility: internal`.
5. Duplicate repo policy check ids or incompatible duplicate package/policy check metadata make the snapshot invalid.

Required checks run after primary Codex execution and before review packet creation. They run against the final workspace using structured commands and the resource governor. Required checks must be read-only or artifact-only unless the frozen check explicitly uses `source_write_policy: path_policy_scoped`; any resulting source change is still caught by authoritative changed-file validation before review packet creation.

Phase 1 has no repo-defined pre-Codex check command class. Startup preflight contains internal runtime probes only: workspace existence, git availability through the safe git profile, Codex/sandbox availability, policy snapshot validity, and governor readiness. Repo policy required checks always run after primary execution as defined above.

### Structured Command Contract

```ts
interface StructuredCommandSpec {
  executable: string;
  args: string[];
  cwd: CwdPolicy;
  timeout_ms?: number;
  output_limit_bytes?: number;
  env?: Record<string, string>;
  visibility?: Visibility;
  source_write_policy?: SourceWritePolicy;
}

interface StructuredCommandResult {
  exit_code: number | null;
  timed_out: boolean;
  stdout_ref?: string;
  stderr_ref?: string;
  stdout_truncated: boolean;
  stderr_truncated: boolean;
  visibility: Visibility;
  public_summary: string;
  internal_diagnostic_ref?: string;
}

interface PrimaryExecutorCommandSpec extends StructuredCommandSpec {
  executor_type: 'local_codex';
  prompt_ref: string;
  prompt_digest: string;
  run_spec_digest: string;
}

interface HookSpec {
  hook_id: string;
  command_template?: string;
  command?: StructuredCommandSpec;
  timeout_ms?: number;
  output_limit_bytes?: number;
  visibility?: Visibility;
  source_write_policy?: SourceWritePolicy;
}

interface FallbackSpec {
  mode: FallbackMode;
  command_template?: string;
  command?: StructuredCommandSpec;
  timeout_ms?: number;
  output_limit_bytes?: number;
  visibility?: Visibility;
  source_write_policy?: SourceWritePolicy;
}
```

`artifact_only` never means direct write access to the artifact root. It means the subprocess may emit stdout/stderr and, when the sandbox supports it, write files only under the sandbox-provided ephemeral output root. The governor imports allowed files through the central artifact writer after command completion.

Legacy command rendering accepts only simple whitespace-separated executable and argv tokens. It rejects quotes, variable expansion, glob characters, redirection, pipes, command chaining, shell control operators, environment assignment prefixes, command substitution, and absolute executable paths.

Command-local `env` entries are not an escape hatch. Every env key must be allowed by the frozen env policy, must not be a rejected dangerous runtime variable, and must have a public-safe value class or internal diagnostic classification. Command-local env cannot set `PATH`; PATH is constructed only by the runner from trusted toolchain roots.

Primary Codex CLI execution materializes into `PrimaryExecutorCommandSpec`:

- `executable` is the deployment-approved logical `codex` executable resolved from a trusted toolchain root;
- `args` are generated only by the executor driver from a fixed template for non-interactive execution and may not come from repo policy;
- prompt transport uses `prompt_ref` to an internal prompt artifact or sandbox stdin channel plus `prompt_digest`; prompts are not passed as shell-interpreted argv;
- `env` starts empty and may include only reviewed credential delivery variables or proxy configuration from the frozen env policy;
- `cwd` is `workspace_root`;
- `visibility` is `internal`;
- `source_write_policy` is `path_policy_scoped`;
- timeout and output caps are bounded by the run attestation;
- `command_digest` includes `prompt_digest` and `run_spec_digest`.

App-server primary execution does not materialize a CLI command. It uses `SandboxLease` and must bind `prompt_digest`, `run_spec_digest`, workspace root, artifact root, sandbox output root, policy/config digests, network policy digest, and per-command invocation nonces to the leased worker before the worker receives prompts or credentials.

Command materialization rules:

- Exactly one of `command_template` or inline `command` must be present on `PolicyRequiredCheckSpec`, `HookSpec`, and executable `FallbackSpec`; both present or both missing is invalid.
- `command_template` must resolve to a template in `commands.templates`; missing templates make the snapshot invalid.
- Inline command specs are validated with the same rules as templates.
- Per-check/per-hook/fallback `timeout_ms`, `output_limit_bytes`, `visibility`, and `source_write_policy` override template values only to make them stricter: lower timeout, lower output cap, narrower visibility, or narrower write policy. They cannot broaden a template.
- Default `source_write_policy` is `read_only` for checks, `read_only` for `before_run` hooks, `artifact_only` for `after_run` hooks, and `read_only` for fallback. Fallback may use `artifact_only` for diagnostics. `path_policy_scoped` fallback requires explicit reviewed fallback policy and still remains subject to effective PathPolicy.
- Materialization produces a complete `StructuredCommandSpec` before digesting; command digests are computed only from materialized specs.

Safe git profile `forgeloop_default` is mandatory for git subprocesses. It must disable repo/global/system config and side-effecting integrations by using command-line config and environment controls equivalent to:

- no system/global repo config loading except an explicit trusted git binary config needed for safe operation;
- `GIT_CONFIG_NOSYSTEM=1`, empty trusted `HOME`, `GIT_TERMINAL_PROMPT=0`, no credential helpers, no askpass, no editor;
- hooks disabled through an isolated git dir/worktree command profile or config that prevents hook execution;
- fsmonitor disabled;
- external diff and textconv disabled;
- protocol file and external protocols disabled except local repository paths explicitly needed for worktree setup;
- submodule recursion disabled unless a package explicitly binds a submodule as a repo;
- all git output used for enforcement is NUL-delimited and parsed strictly.

Worktree materialization must prevent repo-controlled code execution before the run governor exists:

- bootstrap governor isolation must provide the same filesystem containment, host-secret isolation, network policy, and trusted executable guarantees as the run governor, but scoped to source repo inspection and worktree preparation;
- checkout/materialization must use a no-filter/no-hook/no-repo-config profile. A valid implementation may use `git worktree add --no-checkout` followed by a safe checkout/export path with clean/smudge/process filters and attribute-driven effects disabled, or another implementation that proves equivalent no-filter materialization;
- the primary executor, checks, hooks, and fallback must not receive write access to `.git`, the common gitdir, refs, config, index, worktree metadata, or source snapshot metadata;
- authoritative changed-file derivation uses trusted git metadata or a trusted source snapshot that untrusted execution phases cannot mutate. Executor changes to index flags such as `assume-unchanged` or `skip-worktree` must not affect PathPolicy enforcement.

### External Sandbox Protocol

The sandbox executable itself is a trusted executable. It must be resolved by the same trusted executable rules as other commands, using a canonical absolute path, non-writable parent directories, and a binary digest or immutable version identity. It must not be resolved through ambient PATH and must not live under workspace, artifact, temp, or package-controlled directories.

Trusted executable roots and every parent directory up to the root must be non-writable by the runtime/untrusted principal, not just non-world-writable. Their identity is host-verified before execution through canonical path plus digest or immutable version metadata.

The sandbox wrapper process is also a subprocess and has its own launch contract. `ExternalSandboxResourceGovernor` must start `<sandbox>` by canonical absolute path with an explicit sanitized env object, never inherited `process.env`. The wrapper env starts empty, omits `PATH` unless a reviewed sandbox config requires a trusted non-writable PATH, and rejects the same dangerous variables as child commands, including loader, shell-startup, git, credential-helper, and secret-looking names. Wrapper `cwd` must be a trusted non-writable runtime directory or `/`, not the workspace, artifact root, temp directory, or package-controlled path. The wrapper launch env and cwd are included in the sandbox wrapper environment digest bound into the attestation.

Self-check command:

```text
<sandbox> --forgeloop-self-check --json --config-digest <digest>
```

Self-check uses the same explicit sandbox wrapper launch env/cwd contract, a hardcoded short timeout, and a bounded internal-only output cap. A timed-out, non-JSON, oversized, or stderr-only self-check fails closed with `runtime_hard_limits_unavailable`.

The self-check returns JSON with:

- `sandbox_id`;
- `sandbox_version`;
- `sandbox_binary_digest`;
- `sandbox_config_digest`;
- supported hard-limit booleans;
- filesystem containment support;
- host-secret isolation support;
- mount policy digest;
- network mode support;
- wrapper env isolation support;
- process-tree kill support;
- max command timeout;
- max hook timeout;
- max command output bytes;
- max run output bytes.

Bootstrap command:

```text
<sandbox> --forgeloop-bootstrap-run --json \
  --bootstrap-id <bootstrap_id> \
  --nonce <nonce> \
  --command-id <command_id> \
  --command-digest <command_digest> \
  --repo-root <canonical_repo_root> \
  --workspace-parent <canonical_worktree_parent> \
  --artifact-root <canonical_artifact_root> \
  --cwd <canonical_cwd> \
  --safe-git-profile forgeloop_default \
  --timeout-ms <milliseconds> \
  --output-limit-bytes <bytes> \
  -- <executable> <args...>
```

Bootstrap commands may run only trusted git/toolchain operations needed to inspect the source repo and prepare the run worktree. They must not receive runtime secrets or package-controlled PATH entries and do not satisfy production/local Codex run execution attestation.

Run command:

```text
<sandbox> --forgeloop-run --json \
  --run-id <run_id> \
  --nonce <nonce> \
  --command-id <command_id> \
  --command-digest <command_digest> \
  --workspace-root <canonical_workspace_root> \
  --artifact-root <canonical_artifact_root> \
  --sandbox-output-root <ephemeral_sandbox_output_root> \
  --cwd <canonical_cwd> \
  --policy-digest <policy_digest> \
  --env-policy-digest <env_policy_digest> \
  --command-policy-digest <command_policy_digest> \
  --mount-policy-digest <mount_policy_digest> \
  --network-policy-digest <network_policy_digest> \
  --resource-limit-digest <resource_limit_digest> \
  --network-mode <disabled|egress_allowlist> \
  --visibility <internal|public_safe> \
  --source-write-policy <read_only|path_policy_scoped|artifact_only> \
  --timeout-ms <milliseconds> \
  --output-limit-bytes <bytes> \
  --cpu-ms <milliseconds> \
  --memory-mb <megabytes> \
  --pids <count> \
  --fds <count> \
  --workspace-bytes <bytes> \
  --artifact-bytes <bytes> \
  -- <executable> <args...>
```

`artifact-root` is a logical root bound into the attestation for quota and import policy. It is not mounted writable into subprocesses. Subprocesses may write only to `sandbox-output-root`, an ephemeral directory owned by the sandbox. The governor imports allowed outputs from `sandbox-output-root` through the central artifact writer after command completion.

`resource_limit_digest` covers the complete canonical `ResourceLimitVector` used for the sandbox invocation. `command_digest` covers the complete materialized `StructuredCommandSpec`, resolved executable canonical path and identity, sanitized env, constructed PATH entries, cwd, timeout, output limit, visibility, source-write policy, run id, workspace root, artifact root, sandbox output root policy, artifact quota policy, and `resource_limit_digest`. The sandbox result maps to `StructuredCommandResult`. Non-JSON sandbox output is internal diagnostic data and makes the command fail closed.

App-server execution uses a lease:

```ts
interface SandboxLease {
  lease_id: string;
  run_id: string;
  worker_identity: string;
  workspace_root: string;
  artifact_root: string;
  sandbox_output_root: string;
  policy_digest: string;
  policy_snapshot_version: number;
  env_policy_digest: string;
  command_policy_digest: string;
  mount_policy_digest: string;
  network_policy_digest: string;
  resource_limit_digest: string;
  resource_limits: ResourceLimitVector;
  sandbox_config_digest: string;
  sandbox_wrapper_environment_digest: string;
  prompt_digest: string;
  run_spec_digest: string;
  attestation: RuntimeSafetyAttestation;
  expires_at: string;
  command_invocation_nonce_required: true;
}
```

Only a trusted configured governor may produce attestations or leases. A run lease may cover multiple commands in one run, but every command invocation requires its own fresh nonce and command digest, and the governor records nonce consumption. Command invocations are single-use. A run lease is bound to a live process or sandbox session and is rejected after expiry, after run completion, or if any bound run/workspace/artifact/policy/config field changes.

### Runtime Safety Attestation Contract

`RuntimeSafetyAttestation` in `packages/domain/src/automation.ts` must become scope-aware so enqueue-time checks and run execution checks do not pretend to have the same identity data. The enqueue command validates package/preflight capability before a RunSession id exists. Executor startup and app-server lease validation require a separate run-bound execution attestation after the RunSession id and runtime roots exist.

```ts
type RuntimeSafetyAttestationScope = 'enqueue_preflight' | 'run_execution';

interface EnqueueRuntimeSafetyAttestationExtensions {
  attestation_scope: 'enqueue_preflight';
  hard_limit_mode: RuntimeHardLimitMode;
  environment: RuntimeSafetyEnvironment;
  executor_type: string;
  workflow_only: boolean;
  governor_id: string;
  governor_provenance: RuntimeGovernorProvenance;
  checked_at: string;
  max_command_timeout_ms: number;
  max_hook_timeout_ms: number;
  max_command_output_bytes: number;
  max_run_output_bytes: number;
  supports_cpu_limit: boolean;
  supports_memory_limit: boolean;
  supports_process_limit: boolean;
  supports_fd_limit: boolean;
  supports_workspace_disk_limit: boolean;
  supports_artifact_size_limit: boolean;
  network_mode: NetworkMode;
  project_id: string;
  repo_id: string;
  execution_package_id: string;
  expected_package_version: number;
  policy_digest: string;
  policy_snapshot_version: number;
  env_policy_digest: string;
  command_policy_digest: string;
  mount_policy_digest: string;
  network_policy_digest: string;
  resource_limit_digest: string;
  resource_limits: ResourceLimitVector;
  sandbox_id: string;
  sandbox_version: string;
  sandbox_binary_digest: string;
  sandbox_config_digest: string;
  sandbox_wrapper_environment_digest: string;
  supports_filesystem_containment: boolean;
  supports_host_secret_isolation: boolean;
  supports_network_policy: boolean;
  supports_wrapper_env_isolation: boolean;
  supports_process_tree_kill: boolean;
  expires_at: string;
  reason_code?: string;
}

interface RunExecutionRuntimeSafetyAttestationExtensions {
  attestation_scope: 'run_execution';
  hard_limit_mode: RuntimeHardLimitMode;
  environment: RuntimeSafetyEnvironment;
  executor_type: string;
  workflow_only: boolean;
  governor_id: string;
  governor_provenance: RuntimeGovernorProvenance;
  checked_at: string;
  max_command_timeout_ms: number;
  max_hook_timeout_ms: number;
  max_command_output_bytes: number;
  max_run_output_bytes: number;
  supports_cpu_limit: boolean;
  supports_memory_limit: boolean;
  supports_process_limit: boolean;
  supports_fd_limit: boolean;
  supports_workspace_disk_limit: boolean;
  supports_artifact_size_limit: boolean;
  network_mode: NetworkMode;
  project_id: string;
  repo_id: string;
  execution_package_id: string;
  run_id: string;
  policy_digest: string;
  policy_snapshot_version: number;
  env_policy_digest: string;
  command_policy_digest: string;
  mount_policy_digest: string;
  network_policy_digest: string;
  resource_limit_digest: string;
  resource_limits: ResourceLimitVector;
  sandbox_id: string;
  sandbox_version: string;
  sandbox_binary_digest: string;
  sandbox_config_digest: string;
  sandbox_wrapper_environment_digest: string;
  workspace_root: string;
  artifact_root: string;
  sandbox_output_root?: string;
  supports_filesystem_containment: boolean;
  supports_host_secret_isolation: boolean;
  supports_network_policy: boolean;
  supports_wrapper_env_isolation: boolean;
  supports_process_tree_kill: boolean;
  expires_at: string;
  reason_code?: string;
}
```

`enqueue_preflight` attestations validate that the package, frozen policy snapshot, runtime config, sandbox binary, and hard-limit capability are eligible to create a run, but they are not bound to a RunSession id and cannot be reused by the executor as run safety proof. `run_execution` attestations are valid for production/local Codex execution only when all run execution extension fields are present, match the frozen package snapshot plus runtime config, and report enforcing support for every required isolation and hard-limit dimension. Existing singular hard-limit booleans remain for compatibility, but they are insufficient without the scope-specific extension fields.

### Startup And Finalization Sequence

| Order | Owner | Step |
| --- | --- | --- |
| 1 | control plane/run-worker | Load RunSession, ExecutionPackage, and frozen policy snapshot. |
| 2 | domain/executor | Validate snapshot status, digest, safe-default eligibility, and effective PathPolicy. |
| 3 | executor | Resolve trusted toolchain and sandbox executable identity. |
| 4 | executor | Prepare worktree with structured git commands under bootstrap governor coverage. |
| 5 | executor | Capture base commit and source snapshot metadata. |
| 6 | executor | Construct or acquire enforcing `run_execution` attestation/lease bound to run, workspace, artifact root, policy/config digests, mounts, and network mode. |
| 7 | executor | Run internal runtime preflight probes. No repo-defined pre-Codex check commands run in Phase 1. |
| 8 | executor | Run `before_run` hooks. |
| 9 | executor | Launch primary Codex/mock execution through the governor or lease. |
| 10 | executor | Run canonical required checks. |
| 11 | run-worker/executor | Derive authoritative changed files with strict git `-z` parsing through the run governor. |
| 12 | run-worker/executor | Validate actual changed files with effective PathPolicy and pass the sanitized finalization input to workflow. |
| 13 | run-worker/executor | Persist primary execution/check artifacts through the central artifact writer and provide artifact refs to finalization. |
| 14 | workflow finalizer | `terminalizePackageRunWithRuntimeEvidence` persists terminal RunSession result, including required check results, primary artifact refs, authoritative changed-file evidence, and PathPolicy outcome. |
| 15 | run-worker | Run `after_run` hooks with source read-only and artifact-output policy enforced through sandbox output import. |
| 16 | run-worker | Persist `after_run` diagnostics and artifacts separately without changing terminal RunSession status. |
| 17 | workflow finalizer | `completePackageRunReviewFinalization` creates or advances ReviewPacket only when terminal status, required checks, primary artifact refs, and PathPolicy are valid. |

`after_run` hooks must not mutate source. They run with the source workspace mounted read-only or with an equivalent filesystem policy. If read-only source enforcement is unavailable, `after_run` hooks are skipped and recorded as internal diagnostics. Artifact output from `after_run` hooks must use stdout/stderr or `sandbox-output-root` import through the central artifact writer and artifact quota; hooks never receive direct writable access to `artifact-root`. `after_run` failures and artifacts are post-run diagnostics only. They do not block or unblock ReviewPacket creation, do not satisfy required artifact gates, and do not rewrite terminal RunSession status.

### Authoritative Changed-File Contract

Authoritative changed-file derivation uses NUL-delimited git output and strict parsing only:

- tracked changes: `git diff --name-status -z --find-renames --diff-filter=ACDMRTUXB <base_commit> --`;
- untracked and ignored files: `git status --porcelain=v2 -z --untracked-files=all --ignored=matching`;
- submodules: any changed submodule path is treated as a changed path; recursion is out of scope unless a package explicitly binds that submodule as a repo;
- mode-only changes count as modified;
- ignored file paths are included;
- if git reports an ignored directory without enumerating children, finalization must either enumerate the directory tree with `PathSafety` operation-time containment and evaluate every descendant path, or fail closed with `changed_files_unavailable`; evaluating only the directory path is not sufficient because forbidden descendants must retain precedence;
- paths containing whitespace, newlines, quotes, or unusual bytes are valid only through NUL parsing and repo-relative normalization.

If git output cannot be parsed exactly, if base commit is unavailable, or if the command fails, finalization fails closed with `changed_files_unavailable`.

### Artifact Writer Contract

All in-process artifact, raw-log, check-output, hook-output, fallback-output, diff, and summary writes go through a central artifact writer. Direct ad hoc filesystem writes for runtime artifacts are forbidden.

The artifact writer enforces:

- canonical artifact root containment;
- artifact root disjointness from source repo roots, worktree roots, `.git` directories, `.worktrees` directories, package-controlled paths, and any source path covered by PathPolicy;
- operation-time no-follow containment;
- per-artifact byte limit;
- per-run aggregate artifact/text byte limit from the attestation;
- visibility policy and redaction before public-safe exposure;
- atomic temp-file-then-rename writes under the validated artifact root.

Subprocesses may not write artifact files directly. They emit stdout/stderr or write only to sandbox-provided ephemeral output files that the governor imports through the central artifact writer after command completion. `after_run` hook artifacts follow the same import path. If artifact-size enforcement is unavailable for in-process writes or subprocess output import, production/local Codex execution is blocked with `sandbox_isolation_unavailable`.

## Error Handling

All runtime safety gates fail closed for execution. They return deterministic public-safe reason codes and keep raw diagnostics internal.

Policy errors:

- invalid initial policy load blocks execution;
- invalid reload preserves last-known-good and emits diagnostics;
- unknown or ambiguous execution-affecting sections are rejected;
- frozen snapshot digest mismatch returns `policy_digest_mismatch`;
- invalid policy cannot make a package ready.

Path errors:

- path validation rejects unsafe syntax before filesystem access;
- final outside-root paths return `workspace_path_escape`;
- symlink segment escapes return `workspace_symlink_escape`;
- operation-time symlink races return `workspace_symlink_escape`;
- root-equivalent destructive targets return `workspace_equals_root`;
- declared package scope violations return `path_policy_declared_scope_rejected`;
- actual changed-file violations return `path_policy_actual_changes_rejected` and block review packet creation;
- inability to compute authoritative changed files returns `changed_files_unavailable`;
- forbidden path matches override allowed matches.

Command errors:

- shell strings are rejected;
- legacy check command text that cannot be rendered into a structured command returns `required_check_command_invalid`;
- required check non-zero exit returns `required_check_failed`;
- required check timeout returns `required_check_timed_out`;
- unsafe executable, cwd, env, PATH, timeout, or output cap blocks execution;
- timeout kills the process tree and reports a timeout reason code;
- output truncation happens during streaming.

Resource errors:

- unavailable hard-limit capability blocks production and local Codex execution;
- unavailable filesystem containment, host-secret isolation, approved mounts, or network policy returns `sandbox_isolation_unavailable`;
- primary Codex execution not covered by an enforcing governor returns `primary_executor_governor_unavailable`;
- test-only mock attestation cannot satisfy Codex or production execution;
- stale or scope-mismatched attestation is rejected.

Hook errors:

- `before_run` failure blocks startup;
- `after_run` failure records diagnostics but does not alter terminal status;
- raw hook output is internal unless explicitly public-safe.

Fallback errors:

- fallback is denied unless the frozen snapshot allows it;
- fallback uses the same structured-command and governor path;
- raw fallback diagnostics remain internal.

## Testing Strategy

Add focused executor and integration tests before implementation code for each slice.

Required tests:

- `tests/executor/path-safety.test.ts`
  - rejects outside-root paths, root equality, control bytes, and symlink escapes;
  - preserves artifact root containment;
  - classifies symlink escape separately from ordinary path escape;
  - detects operation-time symlink race attempts for destructive operations and artifact writes.
- `tests/executor/path-policy.test.ts`
  - rejects unsafe patterns;
  - treats empty `allowed_paths` as deny-all;
  - requires explicit reviewed `allow_all_repo` for root-wide behavior;
  - enforces forbidden precedence;
  - checks both previous and new rename paths;
  - pins duplicate slash, trailing whitespace, trailing slash, directory-pattern, dotfile, globstar, negation, brace, and extglob behavior.
- `tests/executor/effective-path-policy.test.ts`
  - intersects package allowed paths with frozen repo allowed paths;
  - unions package and repo forbidden paths;
  - verifies `allow_all_repo` in one layer does not override the other layer;
  - applies the same effective policy to declared scope and actual changed files.
- `tests/executor/runtime-policy.test.ts`
  - parses strict front matter;
  - accepts the normative top-level schema and rejects unknown execution-affecting sections;
  - computes stable normalized payload, env policy, command policy, mount policy, and network policy digests;
  - rejects unsafe policy source paths;
  - preserves last-known-good on invalid reload;
  - blocks invalid initial execution policy.
- `tests/executor/runtime-safety-config.test.ts`
  - parses only explicit `FORGELOOP_EXECUTOR_*` configuration keys;
  - rejects missing sandbox executable path, sandbox config digest, trusted toolchain config, or artifact root for production/local Codex execution;
  - rejects sandbox and toolchain paths under workspace, artifact, temp, writable, or package-controlled directories.
- `tests/executor/structured-command.test.ts`
  - rejects shell strings, unsafe executables, unsafe cwd, and unsafe env;
  - rejects ambient PATH inheritance;
  - rejects PATH entries under workspace, artifact, temp, or writable directories;
  - rejects dangerous env variables unless reviewed evidence explicitly allows them;
  - rejects command-local `PATH`;
  - resolves executables to canonical trusted toolchain roots before execution;
  - rejects trusted toolchain roots writable by the runtime/untrusted principal;
  - proves `StructuredCommand` validates and parses specs/results without launching subprocesses;
  - validates command materialization exactly-one rules and strict override behavior;
  - renders simple legacy check command text into executable plus args without shell execution;
  - rejects legacy check command text with shell metacharacters, variable expansion, redirection, pipes, command chaining, or unsafe quoting;
  - validates timeout/output cap bounds and parses governor result metadata without testing process execution.
- `tests/executor/required-check-runner.test.ts`
  - maps non-zero required check exits to `required_check_failed`;
  - maps required check timeout to `required_check_timed_out`;
  - keeps raw check output internal by default.
- `tests/executor/resource-limits.test.ts`
  - maps missing hard limits to `runtime_hard_limits_unavailable`;
  - validates timeout and output hard maximums;
  - computes stable `resource_limit_digest` values from canonical resource-limit vectors;
  - requires process-tree kill support for enforcing production/local Codex attestations.
- `tests/executor/resource-governor.test.ts`
  - rejects non-enforcing production/local Codex attestations;
  - rejects attestation missing scope, hard-limit mode, environment, executor type, workflow mode, governor provenance, timeout/output caps, hard-limit booleans, project id, repo id, execution package id, run id for `run_execution`, sandbox binary identity, config digest, wrapper environment digest, workspace root, artifact root, network mode, mount digest, env policy digest, command policy digest, policy digest, policy snapshot version, resource-limit digest, resource-limit vector, wrapper env isolation support, process-tree kill support, or expiry;
  - rejects attestations without filesystem containment, host-secret isolation, or network policy;
  - launches the sandbox wrapper with explicit sanitized env and no ambient PATH/process env inheritance;
  - binds each sandbox command invocation to command digest, resource-limit digest, cwd, env policy, timeout, output limit, visibility, source-write policy, and fresh nonce;
  - rejects replayed command invocation nonces while allowing multiple distinct commands under one valid run lease;
  - implements bootstrap sandbox invocation separately from run execution;
  - allows test-only mock only for mock workflow dogfood;
  - verifies external sandbox wrapping and fail-closed configuration checks;
  - distinguishes bootstrap governor coverage from run governor attestation;
  - proves local Codex startup is blocked when the primary Codex process is not governed.
- `tests/executor/hook-runner.test.ts`
  - executes hooks through the governor;
  - fails closed for `before_run`;
  - preserves terminal status and ReviewPacket gating behavior for failed `after_run`;
  - keeps raw output internal by default.
- `tests/executor/local-codex-preflight.test.ts`
  - blocks startup when frozen policy, declared scope path policy, hard limits, or hooks fail.
- `tests/executor/codex-worktree.test.ts`
  - refuses unsafe worktree cleanup/removal paths;
  - verifies git worktree subprocesses use structured command and governor paths;
  - verifies safe git profile disables config, hooks, prompts, credential helpers, external diff/textconv, fsmonitor, unsafe protocols, and submodule recursion;
  - verifies worktree materialization disables clean/smudge/process filters and does not expose writable git metadata, index, refs, or source snapshot metadata to untrusted execution phases.
- `tests/run-worker/run-worker.test.ts`
  - verifies startup hook ordering and completion hook behavior;
  - verifies production/local Codex flow calls terminalization, then `after_run`, then review finalization.
- `tests/workflow-worker/worker.test.ts`
  - verifies workflow-worker production/local Codex paths delegate to run-worker or fail closed instead of calling the legacy executor-gateway local Codex path.
- `tests/workflow/execution-finalizer.test.ts`
  - consumes authoritative changed-file evidence from finalization input before review packet creation;
  - ignores executor-reported changed files for policy enforcement;
  - exposes split terminalization and review-finalization entry points;
  - returns `changed_files_unavailable` when authoritative changed-file computation fails;
  - records a failed RunSession and no ReviewPacket for `path_policy_actual_changes_rejected`.
- `tests/executor/artifact-writer.test.ts`
  - rejects artifact roots overlapping source, `.git`, `.worktrees`, and package-controlled paths;
  - enforces per-artifact and per-run quotas for in-process writes and subprocess output import;
  - prevents direct subprocess artifact writes from bypassing the central writer.
- `tests/executor-gateway/executor-gateway.test.ts`
  - rejects `local_codex` requests that lack a valid `run_execution` attestation and runtime-safety routing.
- `tests/api/automation-commands.test.ts`
  - verifies enqueue command rejection for missing, unavailable, mock-for-Codex, stale, and package/preflight scope-mismatched `enqueue_preflight` attestations;
  - verifies enqueue command does not require or accept a run-bound `run_execution` attestation before RunSession id creation.
- `tests/api/run-spec-validation.test.ts`
  - validates `CreateExecutionPackageDto`, `PatchExecutionPackageDto`, and `RunSpec` conditional `allowed_paths: []` behavior;
  - allows `allowed_paths: []` only with `source_mutation_policy: no_source_changes`;
  - rejects `allowed_paths: []` for missing `source_mutation_policy` or `source_mutation_policy: path_policy_scoped`;
  - verifies cross-object `source_mutation_policy` consistency is enforced outside `packages/contracts`, without a contracts-to-domain dependency.
- `tests/api/automation-runtime-snapshot.test.ts`
  - projects each required public-safe blocker code with sanitized summaries only;
  - returns deterministic `blockers[]` plus compatibility singular fields for the first blocker;
  - verifies `packages/automation` runtime snapshot parsing preserves `blockers[]`.
- `tests/automation/planner.test.ts`
  - proves the daemon planner still does not emit enqueue actions.

## Delivery Slices

The spec covers full Phase 1, but implementation should ship in reviewable slices:

1. Path and policy foundation:
   - `PathSafety`;
   - `PathPolicy`;
   - `RuntimePolicyLoader`;
   - worktree cleanup guard.
2. Structured command foundation:
   - command specs;
   - cwd/env/PATH validation;
   - timeout/output cap validation and result metadata parsing.
3. Resource governor and attestation:
   - hard-limit capability surface;
   - sandbox isolation capability surface;
   - subprocess launch, timeout handling, output streaming, and process-tree kill;
   - unavailable, external sandbox, and test-only mock governors;
   - strengthened enqueue attestation tests.
4. Hooks and runtime integration:
   - `HookRunner`;
   - local preflight integration;
   - run-worker startup/completion hooks;
   - fallback and evidence visibility hardening.
5. Package snapshot hardening and runtime projection:
   - capture real normalized runtime policy snapshots;
   - capture structured check specs while keeping legacy command text display-compatible;
   - strengthen domain validation;
   - project public-safe safety blockers;
   - keep daemon enqueue disabled.

Each slice must be independently testable, must keep `run_enqueue` disabled, and must not introduce a direct command execution path that bypasses the resource governor.

## Acceptance Criteria

- Runtime safety modules are exported from `@forgeloop/executor`.
- Ready and run-eligible ExecutionPackages require captured, valid package policy snapshots.
- `workspace_policy`, `prompt_policy`, and `artifact_visibility_policy` are frozen in the package snapshot when their top-level policy sections are accepted.
- `source_mutation_policy` is represented consistently on ExecutionPackage, PackageRuntimePolicySnapshot, and RunSpec; empty `allowed_paths` is accepted only for no-source-change packages.
- Runtime policy reload cannot change the execution contract of an already frozen package.
- Repo runtime policy cannot broaden automation capabilities or approve lifecycle gates.
- Workspace path safety rejects outside-root paths, symlink escapes, root equality, and unsafe artifact paths.
- Destructive filesystem operations and artifact writes use operation-time containment to prevent symlink race escapes.
- PathPolicy uses validated repo-relative POSIX glob semantics with forbidden precedence and rename old/new checks.
- Empty `allowed_paths` means deny-all; allow-all repo behavior requires explicit reviewed policy.
- Effective PathPolicy is the intersection of package allowed scope and frozen repo allowed scope, with forbidden paths unioned across both layers.
- Pre-run PathPolicy validates declared package scope; post-run PathPolicy validates actual changed files before review packet creation.
- Legacy `RequiredCheckSpec.command` values are never executed as shell strings and must render into frozen structured check specs before package readiness.
- All executor subprocesses use structured command specs and route through `ResourceGovernor.run`; pure filesystem probes use Node filesystem APIs and do not spawn commands.
- StructuredCommand never inherits ambient PATH and resolves executables only from canonical trusted toolchain roots.
- External sandbox wrapper processes launch by canonical path with sanitized explicit env and no ambient PATH/process env inheritance.
- Primary Codex execution also runs under, or is leased from, an enforcing `ResourceGovernor` for production/local Codex modes.
- Production and local Codex execution require enforcing hard-limit and sandbox-isolation attestation bound to run id, workspace root, artifact root, policy/config digests, mounts, network mode, resource-limit digest, process-tree kill support, and expiry.
- Enqueue-time safety uses a distinct `enqueue_preflight` attestation and never substitutes for the run-bound `run_execution` attestation.
- Legacy workflow-worker/executor-gateway local Codex execution is disabled for production/local Codex unless it routes through the same runtime safety boundary.
- Execution finalization computes authoritative changed files from git/worktree state before review packet creation and does not trust executor-reported changed files for PathPolicy enforcement.
- Authoritative changed-file derivation runs on the run-worker/executor side through the run governor; workflow finalization consumes sanitized evidence and does not import executor modules.
- Production/local finalization uses split terminalization and review-finalization functions so `after_run` runs only after terminal status persistence and cannot block or unblock ReviewPacket creation.
- Test-only mock governor satisfies only mock workflow dogfood.
- `before_run` hooks fail closed; `after_run` hook failures do not overwrite terminal RunSession status.
- Exec fallback is denied unless explicitly allowed by the frozen package snapshot.
- Raw command, hook, fallback, sandbox, and artifact diagnostics are internal by default.
- Public runtime projections expose only sanitized reason codes and summaries.
- Public-safe blocker projection includes the required blocker code set from this design.
- Daemon planner still does not emit `enqueue_package_run` or equivalent run enqueue actions.
- The implementation provides focused tests for every safety module and integration point listed in this design.
