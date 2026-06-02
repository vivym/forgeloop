# Codex Runtime Capsule Packaging And Restore Design

## Status

Approved design for implementation planning.

## Purpose

This spec defines Wave 4 of `2026-05-30-plan-item-codex-session-continuity-generation-loop-design.md`.

Wave 3 proved live same-worker app-server thread resume for generation turns. Wave 4 must make that continuity portable across workers and process lifetimes without fake continuity:

```text
one Plan Item Workflow
  -> one active ForgeLoop CodexSession
  -> one real Codex app-server Thread.id
  -> many generation turns
  -> one verified runtime capsule after each successful turn
```

The critical correction in this wave is that Codex continuity is not only a `Thread.id` and rollout JSONL file. A restored Codex worker must see the same conversation state, memory state, plugin/skill/tool environment, and compatible app-server protocol. Otherwise the product would claim continuity while Codex actually runs with a different long-term context or capability set.

## Authority

This spec extends:

- `2026-05-30-plan-item-codex-session-continuity-generation-loop-design.md`;
- `2026-05-30-internal-artifact-store-foundation-design.md`;
- `2026-05-31-codex-session-data-model-and-lease-design.md`;
- `2026-06-01-app-server-resume-protocol-support-design.md`.

It supersedes the term `CodexSessionSnapshot` for future implementation work. That name was acceptable for Wave 2 metadata scaffolding, but it is too narrow for Wave 4. The durable object is now `CodexRuntimeCapsule`.

No compatibility alias should remain in code or public contracts after this migration. Existing snapshot fields and repository methods must be renamed or replaced rather than wrapped.

## Scope

This wave includes:

- `CodexRuntimeCapsule` as the per-turn portable runtime continuity object.
- Thread state packaging and restore for the real Codex app-server `Thread.id`.
- Memory bundle and per-turn memory delta capture.
- Plugin, skill, MCP, app/tool schema, feature flag, and trusted-environment manifests.
- Restore-time materialization into a fresh isolated `CODEX_HOME`.
- Internal Artifact Store object kinds for capsule components.
- Mandatory Codex persistence discovery dogfood.
- Mandatory cross-worker restore dogfood for generation turns.
- Fail-closed behavior for all missing, unsafe, stale, or incompatible capsule state.
- Removal of legacy `CodexSessionSnapshot` naming from the domain touched by this wave.

This wave does not include:

- Execution worker handoff continuity.
- Code-writing run session workspace bundle restore.
- Automatic promotion of session memories into global memories.
- Automatic parsing of Superpowers natural language to infer product state.
- Automatic fork merge.
- Automatic hidden new-thread fallback after restore failure.
- Product UI for browsing raw capsule internals.

Execution worker continuity remains a later wave because it has additional state: workspace bundles, patch streams, review artifacts, code-writing sessions, and run supervision.

## Verified Codex Persistence Model

The current local Codex CLI was inspected with:

```text
codex --version
codex app-server generate-ts --experimental --out <tmp>
```

Observed version:

```text
codex-cli 0.133.0
```

Generated app-server protocol facts:

- `thread/resume` supports three resume modes: `threadId`, `history`, and `path`.
- The protocol comments say to prefer `threadId`.
- `history` is marked unstable and for Codex Cloud.
- `path` is marked unstable and can cause `threadId` to be ignored for non-running threads.
- `Thread.id` is the continuation handle for one linear thread.
- `Thread.sessionId` is session-tree metadata shared by forks and cannot identify the exact branch to continue.
- `thread/read` and `thread/turns/list` can read rollout history, but they are not an official export/import mechanism.

Observed local `CODEX_HOME` facts:

- `thread/start` can return a `Thread.path` before the thread is materialized.
- Before the first user message, `thread/read(includeTurns=true)` can report that the thread is not materialized yet.
- Real conversation history is materialized through rollout JSONL under `sessions/YYYY/MM/DD/rollout-*.jsonl` after turns begin.
- `state_5.sqlite` contains thread locator/index tables including `threads(id, rollout_path, ...)`, but it is not the full conversation transcript.
- `codex-dev.db` is not the primary thread history store.
- app-server initialization creates environment files such as `logs_*.sqlite`, `goals_*.sqlite`, system skill files, and temp arg wrappers. Those are not automatically session truth.

Design interpretation:

- ForgeLoop must restore native Codex thread state, not reconstruct history with the unstable `history` resume path.
- ForgeLoop must not package all of `CODEX_HOME`.
- ForgeLoop must not treat the worker's current global `~/.codex` as session truth.
- ForgeLoop must treat memory and plugin/tool state as part of runtime continuity, but as a separate runtime environment lineage rather than as thread transcript.

## Core Decision

Introduce `CodexRuntimeCapsule`.

A capsule is the private, internal, per-turn runtime state required to resume a ForgeLoop `CodexSession` on a later worker:

```text
CodexRuntimeCapsule
  thread_state_bundle
  memory_state_bundle
  environment_manifest
```

`CodexSession.latest_capsule_id` and `latest_capsule_digest` become the durable continuation pointer.

The old `latest_snapshot_*`, `expected_previous_snapshot_digest`, `output_snapshot_*`, and `codex_session_snapshots` naming must be removed by the implementation plan for this wave. The product is not live, and historical compatibility would create a permanent conceptual split.

## Runtime Capsule Structure

### CodexRuntimeCapsule

```ts
type CodexRuntimeCapsule = {
  id: string;
  codex_session_id: string;
  created_from_turn_id: string;
  sequence: number;
  artifact_ref: string;
  digest: string;
  size_bytes: string;
  manifest_digest: string;
  thread_state_digest: string;
  memory_state_digest: string;
  environment_manifest_digest: string;
  codex_thread_id_digest: string;
  codex_cli_version: string;
  app_server_protocol_digest: string;
  runtime_profile_revision_id: string;
  trusted_runtime_manifest_digest: string;
  credential_binding_lineage_digest: string;
  created_by_actor_id: string;
  created_at: string;
};
```

Rules:

- `artifact_ref` points to an Internal Artifact Store object of kind `codex_runtime_capsule`.
- `sequence` is monotonic per `CodexSession`.
- `created_from_turn_id` must belong to the same `CodexSession`.
- `codex_thread_id_digest` must match the session's bound thread digest.
- `digest` covers the full capsule archive.
- `manifest_digest` covers the canonical manifest only.
- Raw Codex thread ids are not stored in public DTOs or product logs.

### Capsule Manifest

Every capsule archive includes a canonical manifest:

```json
{
  "schema_version": "codex_runtime_capsule_manifest.v1",
  "codex_session_id": "codex-session-1",
  "created_from_turn_id": "turn-3",
  "sequence": 3,
  "codex_thread_id_digest": "sha256:...",
  "codex_cli_version": "0.133.0",
  "app_server_protocol_digest": "sha256:...",
  "thread_state": {
    "artifact_ref": "artifact://internal/codex_thread_state_bundle/codex_session/codex-session-1/capsule-3-thread",
    "digest": "sha256:..."
  },
  "memory_state": {
    "base_bundle_ref": "artifact://internal/codex_memory_bundle/codex_session/codex-session-1/memory-base",
    "base_bundle_digest": "sha256:...",
    "input_bundle_ref": "artifact://internal/codex_memory_bundle/codex_session/codex-session-1/memory-2",
    "input_bundle_digest": "sha256:...",
    "output_bundle_ref": "artifact://internal/codex_memory_bundle/codex_session/codex-session-1/memory-3",
    "output_bundle_digest": "sha256:...",
    "delta_ref": "artifact://internal/codex_memory_delta/codex_session/codex-session-1/turn-3",
    "delta_digest": "sha256:..."
  },
  "environment_manifest": {
    "artifact_ref": "artifact://internal/codex_environment_manifest/codex_session/codex-session-1/env-3",
    "digest": "sha256:..."
  },
  "included_files": [],
  "excluded_patterns": [],
  "forbidden_patterns_checked": []
}
```

No manifest field or product-safe report may contain:

- raw `codex_thread_id`;
- raw auth token;
- API key;
- OAuth refresh token;
- connector secret;
- raw memory contents in product-safe reports;
- absolute host path outside the isolated runtime root.

## Thread State Bundle

The thread state bundle contains native Codex state for the bound thread.

Candidate allowed contents:

- `sessions/**/rollout-*.jsonl` for the target `Thread.id`;
- thread locator/index repair metadata needed to make `thread/resume(threadId)` find the rollout;
- thread-scoped shell state captures when discovery proves they are needed for resume or command context continuity.

Forbidden contents:

- `auth.json`;
- `config.toml`;
- `logs_*.sqlite*`;
- `goals_*.sqlite*`;
- complete global `state_5.sqlite`;
- `codex-dev.db`;
- `memories_*.sqlite*`;
- `cache/**`;
- `plugins/**`;
- `skills/.system/**` generated by Codex initialization;
- `tmp/**`;
- sockets;
- repository worktree contents;
- Docker/container metadata beyond digests;
- any unknown unclassified path.

The implementation must not copy the complete `state_5.sqlite` across workers. It may generate a minimal locator repair operation or a capsule-local locator metadata file, then let app-server rebuild or repair its state DB from restored rollout files. If Codex cannot resume from restored rollout state without a full DB copy, discovery must fail and the session must block until the exact minimal safe DB reconstruction is specified.

Discovery must produce one explicit locator repair contract before restore implementation proceeds:

```ts
type CodexThreadLocatorRepairManifest = {
  schema_version: 'codex_thread_locator_repair_manifest.v1';
  codex_thread_id_digest: string;
  rollout_relative_path: string;
  rollout_digest: string;
  repair_strategy: 'app_server_scan' | 'minimal_state_index_upsert';
  required_state_tables?: Array<{
    table_name: string;
    allowed_columns: string[];
    row_digest: string;
  }>;
};
```

Rules:

- `rollout_relative_path` must be relative to isolated `CODEX_HOME` and must point to the verified rollout for the bound thread.
- `app_server_scan` is preferred if discovery proves app-server can rebuild its locator from restored rollout files.
- `minimal_state_index_upsert` is allowed only if discovery proves the exact minimal table and column set needed for `thread/resume(threadId)` lookup.
- Any need to copy a whole SQLite database, unknown table, unknown column, or unrelated thread row is a discovery blocker, not an implementation detail.

## Memory State Bundle

Memories are runtime context, not static config. A Codex session can create or update memories after turns. Therefore memory state must be versioned per turn.

`CodexSessionTurn` must record:

```ts
type CodexSessionTurnMemoryState = {
  base_memory_bundle_ref?: string;
  base_memory_bundle_digest?: string;
  input_memory_bundle_ref?: string;
  input_memory_bundle_digest?: string;
  output_memory_bundle_ref?: string;
  output_memory_bundle_digest?: string;
  memory_delta_artifact_ref?: string;
  memory_delta_digest?: string;
};
```

Rules:

- The first turn uses the session's selected base memory bundle.
- Later turns restore the previous successful turn's output memory bundle.
- A worker must not mount or read its current global `~/.codex/memories` as the truth for an existing session.
- After a turn, the worker compares the restored input memory bundle to the resulting memory bundle.
- If unchanged, output digest equals input digest and no delta is written.
- If changed, the worker writes a session-scoped `codex_memory_delta` artifact and a new `codex_memory_bundle` digest.
- The next turn must use the prior turn's output memory bundle digest.
- Merging session memories back to global memories is a separate human-approved promotion flow, not automatic.
- The capsule manifest must include artifact refs for every memory bundle required by restore. Digest-only memory lineage is insufficient because a later worker cannot fetch a bundle from a digest alone.
- First-turn work has no input capsule, so `CodexSession.base_memory_bundle_ref` and `base_memory_bundle_digest` are the fetchable source of truth for the selected base memory state.
- Later-turn audit replay uses `CodexSessionTurn.input_memory_bundle_ref` and `output_memory_bundle_ref`, not digest lookup.

Memory bundles may include selected user/project memory files and rollout summary references, but they must exclude unrelated global memory history. Bundle selection is part of session creation and must be recorded in the base memory manifest.

Memory bundle reports must not expose full memory text in product DTOs. Trusted internal artifacts may contain the content required to reproduce Codex behavior.

Each `codex_memory_bundle` includes a canonical manifest:

```ts
type CodexMemoryBundleManifest = {
  schema_version: 'codex_memory_bundle_manifest.v1';
  bundle_id: string;
  codex_session_id: string;
  created_from_turn_id?: string;
  source_policy_digest: string;
  entries: Array<{
    relative_path: string;
    source_kind: 'user_memory' | 'project_memory' | 'session_memory' | 'rollout_summary_reference';
    content_digest: string;
    size_bytes: string;
    operation?: 'present' | 'deleted';
  }>;
};
```

Memory source policy rules:

- `relative_path` must be relative to the materialized memory root.
- Allowed sources are selected user memories, selected project memories, session-scoped memories, and rollout summary references explicitly included in the session base memory policy.
- Unrelated global memory files, unrelated rollout summaries, and worker-local memory files are forbidden.
- Deletions and renames are represented explicitly. A rename is a `deleted` entry for the old path plus a `present` entry for the new path.
- Restore must verify the materialized memory root digest before app-server launch and dogfood must prove Codex consumed the restored memory root, not the worker's global memory root.

Each `codex_memory_delta` uses explicit operations:

```ts
type CodexMemoryDeltaManifest = {
  schema_version: 'codex_memory_delta_manifest.v1';
  codex_session_id: string;
  turn_id: string;
  input_bundle_digest: string;
  output_bundle_digest: string;
  operations: Array<
    | { op: 'add'; relative_path: string; content_digest: string }
    | { op: 'modify'; relative_path: string; before_digest: string; after_digest: string }
    | { op: 'delete'; relative_path: string; before_digest: string }
    | { op: 'rename'; from_relative_path: string; to_relative_path: string; before_digest: string; after_digest: string }
  >;
};
```

Delta replay is allowed only when `input_bundle_digest` matches the materialized input bundle. Any path outside the memory root, unexpected file mutation, or delta replay mismatch blocks restore.

## Plugin, Skill, And Tool Environment Manifest

Plugins, skills, MCP servers, app connectors, and tool schemas are runtime dependencies. They are not thread transcript, but they strongly affect Codex output.

Each capsule records:

```ts
type CodexEnvironmentManifest = {
  schema_version: 'codex_environment_manifest.v1';
  codex_cli_version: string;
  app_server_protocol_digest: string;
  feature_flag_digest: string;
  trusted_project_digest: string;
  runtime_profile_revision_id: string;
  runtime_profile_digest: string;
  plugin_manifest: CodexPluginManifest;
  plugin_manifest_digest: string;
  skill_manifest: CodexSkillManifest;
  skill_manifest_digest: string;
  tool_schema_manifest: CodexToolSchemaManifest;
  tool_schema_digest: string;
  mcp_server_manifest: CodexMcpServerManifest;
  mcp_server_manifest_digest: string;
  app_connector_manifest: CodexAppConnectorManifest;
  app_connector_manifest_digest: string;
  credential_binding_lineage: CodexCredentialBindingLineage;
  credential_binding_lineage_digest: string;
  trusted_runtime_manifest: CodexTrustedRuntimeManifest;
};
```

Rules:

- Session creation freezes the initial plugin/skill/tool manifest.
- Restore materializes the same plugin package versions and skill file digests.
- Remote or shared plugin packages must be pinned by source, version, and digest, or copied into Internal Artifact Store as `codex_plugin_package`.
- If Codex installs, upgrades, disables, or configures plugins/skills during a turn, that change becomes an environment delta and is included in the next capsule.
- Connector/app auth is never stored in the capsule. Only connector ids, connector schema digests, scope digests, credential binding ids, binding versions, and binding digests are recorded.
- Restore must fail if a required plugin package, skill digest, MCP server manifest, app connector manifest, credential binding lineage entry, or tool schema cannot be reproduced.
- Tool/app schema drift is a compatibility failure unless a migration explicitly updates the capsule manifest and records a human-approved recovery action.

The `codex_environment_manifest` artifact is the fetchable source of truth for environment restore. It embeds every canonical sub-manifest needed to reconstruct the runtime capability set. Digest-only environment lineage is forbidden.

Plugin and skill bytes are fetchable through package/bundle refs embedded in their manifests:

```ts
type CodexPluginManifest = {
  schema_version: 'codex_plugin_manifest.v1';
  plugins: Array<{
    plugin_id: string;
    source: string;
    version: string;
    package_ref: string;
    package_digest: string;
    enabled: boolean;
  }>;
};

type CodexSkillManifest = {
  schema_version: 'codex_skill_manifest.v1';
  skills: Array<{
    skill_id: string;
    source_kind: 'project' | 'user' | 'plugin' | 'system';
    bundle_ref: string;
    bundle_digest: string;
    entrypoint_relative_path: string;
    enabled: boolean;
  }>;
};
```

MCP, tool schema, and connector manifests embed canonical, non-secret schema payloads:

```ts
type CodexMcpServerManifest = {
  schema_version: 'codex_mcp_server_manifest.v1';
  servers: Array<{
    server_id: string;
    command_payload: {
      command: string;
      args: string[];
      cwd_policy_payload?: {
        mode: 'runtime_root' | 'workspace_root' | 'fixed_relative';
        relative_path?: string;
      };
      cwd_policy_digest?: string;
    };
    command_digest: string;
    env_allowlist_payload: Array<{
      name: string;
      value_payload?: string;
      value_digest?: string;
      source: 'runtime_profile' | 'credential_binding' | 'literal_non_secret';
    }>;
    env_allowlist_digest: string;
    tool_schema_payload: unknown;
    tool_schema_digest: string;
    enabled: boolean;
  }>;
};

type CodexToolSchemaManifest = {
  schema_version: 'codex_tool_schema_manifest.v1';
  schemas: Array<{
    tool_namespace: string;
    tool_name: string;
    schema_payload: unknown;
    schema_digest: string;
  }>;
};
```

Rules:

- `codex_environment_manifest` must include the embedded sub-manifest payloads and their canonical digests.
- `codex_plugin_package` and `codex_skill_bundle` artifacts carry the bytes needed to materialize plugin and skill files.
- Schema manifests embed non-secret schema payloads directly in `codex_environment_manifest`. They must not introduce extra schema artifact refs in this wave.
- Restore rejects any missing environment manifest artifact, missing package/bundle ref, cross-session environment component ref, digest mismatch, or stale discovery report.
- The packager records environment deltas by producing a new `codex_environment_manifest` artifact and linking it from the next capsule. There is no digest-only environment delta.

`app_connector_manifest_digest` covers the enabled app/connector set exposed to Codex for this session:

```ts
type CodexAppConnectorManifest = {
  schema_version: 'codex_app_connector_manifest.v1';
  connectors: Array<{
    connector_id: string;
    app_id: string;
    connector_kind: string;
    connector_schema_payload: unknown;
    connector_schema_digest: string;
    tool_schema_payload: unknown;
    tool_schema_digest: string;
    scope_payload: {
      scopes: string[];
      scope_policy_payload: {
        policy_kind: 'exact' | 'subset';
        allowed_scopes: string[];
      };
      scope_policy_digest: string;
    };
    scope_digest: string;
    enabled: boolean;
  }>;
};
```

`credential_binding_lineage_digest` covers every credential binding needed to materialize app/connector auth:

```ts
type CodexCredentialBindingLineage = {
  schema_version: 'codex_credential_binding_lineage.v1';
  bindings: Array<{
    connector_id: string;
    app_id: string;
    credential_binding_id: string;
    credential_binding_version_id: string;
    credential_binding_digest: string;
    scope_digest: string;
  }>;
};
```

Rules:

- A capsule can reference multiple credential bindings.
- Restore re-materializes auth from ForgeLoop credential bindings only after every lineage digest and scope digest matches the capsule manifest.
- Missing, disabled, rotated-without-recorded-migration, or scope-drifted credential bindings block the session.
- Connector schemas and scopes are runtime capabilities. They must be validated together with plugin, MCP, and tool schemas before app-server launch.
- Connector schema payloads, tool schema payloads, scope payloads, MCP command payloads, and MCP env allowlist payloads are embedded as canonical non-secret JSON in `codex_environment_manifest`.
- Payload digests must be recomputed during restore. A digest without the payload is invalid for this wave.
- If an MCP env entry has `source: 'literal_non_secret'`, `value_payload` is required and `value_digest` must match it. If the source is `runtime_profile` or `credential_binding`, `value_payload` must be omitted and the value is re-materialized from the corresponding trusted runtime profile or credential binding lineage.

`trusted_project_digest` and `runtime_profile_digest` cover the non-secret runtime contract:

```ts
type CodexTrustedRuntimeManifest = {
  schema_version: 'codex_trusted_runtime_manifest.v1';
  trusted_project_digest: string;
  runtime_profile_revision_id: string;
  runtime_profile_digest: string;
  feature_flag_digest: string;
  codex_cli_version: string;
  app_server_protocol_digest: string;
};
```

Trusted project state includes the approved workspace root identity, allowed mount layout, trusted-project approval state, runtime image digest, environment variable allowlist, and feature flags. It must not include secret values. Drift in any trusted runtime manifest digest blocks restore unless a human-approved migration records the new manifest and resulting capsule lineage.

## Data Model Changes

### CodexSession

Replace:

```ts
latest_snapshot_id?: string;
latest_snapshot_digest?: string;
```

with:

```ts
latest_capsule_id?: string;
latest_capsule_digest?: string;
base_memory_bundle_ref?: string;
base_memory_bundle_digest?: string;
latest_memory_bundle_ref?: string;
latest_memory_bundle_digest?: string;
latest_environment_manifest_ref?: string;
latest_environment_manifest_digest?: string;
```

Rules:

- The session latest capsule changes only through lease-fenced trusted terminalization.
- Stale terminalization must not mutate latest capsule fields.
- `base_memory_bundle_ref` and `base_memory_bundle_digest` are written at session creation and are required before the first materialized turn.
- `latest_memory_bundle_ref` and `latest_environment_manifest_ref` are trusted internal continuation pointers, not product DTO fields.
- `codex_thread_id` and `codex_thread_id_digest` remain from Wave 3 as trusted internal fields. They are immutable after successful first binding, must match every capsule's `codex_thread_id_digest`, and partial binding failure blocks the session instead of falling back.
- Public product DTOs may show continuity status and digest prefixes only if needed, never raw capsule refs by default.

### CodexSessionTurn

Replace:

```ts
expected_previous_snapshot_digest?: string;
output_snapshot_id?: string;
output_snapshot_digest?: string;
```

with:

```ts
expected_input_capsule_digest?: string;
input_capsule_id?: string;
input_capsule_digest?: string;
output_capsule_id?: string;
output_capsule_digest?: string;
base_memory_bundle_ref?: string;
base_memory_bundle_digest?: string;
input_memory_bundle_ref?: string;
input_memory_bundle_digest?: string;
output_memory_bundle_ref?: string;
output_memory_bundle_digest?: string;
memory_delta_artifact_ref?: string;
memory_delta_digest?: string;
input_environment_manifest_ref?: string;
input_environment_manifest_digest?: string;
output_environment_manifest_ref?: string;
output_environment_manifest_digest?: string;
```

Rules:

- First materialized turn uses no input capsule.
- Later turns require `expected_input_capsule_digest` to match `CodexSession.latest_capsule_digest`.
- First materialized turn requires `base_memory_bundle_ref` and `base_memory_bundle_digest` copied from `CodexSession`.
- Later turns require `input_memory_bundle_ref` and `input_environment_manifest_ref` to match the session latest continuation refs.
- Terminalization requires `output_capsule_id` and `output_capsule_digest` for successful generation turns.
- Failed, cancelled, stale, or blocked turns may omit output capsule depending on failure point, but must not advance latest capsule.

### CodexRuntimeCapsule Table

Replace `codex_session_snapshots` with `codex_runtime_capsules`.

Required constraints:

- primary key on `id`;
- foreign key to `codex_sessions(id)`;
- foreign key to `codex_session_turns(id)` for `created_from_turn_id`;
- unique `(codex_session_id, sequence)`;
- unique `artifact_ref`;
- index by `(codex_session_id, created_at)`;
- non-null actor attribution.

### Fork Fields

Replace prior fork fields:

```ts
forked_from_snapshot_id?: string;
fork_point_snapshot_id: string;
fork_point_snapshot_digest: string;
```

with:

```ts
forked_from_capsule_id?: string;
fork_point_capsule_id: string;
fork_point_capsule_digest: string;
```

Rules:

- A fork starts from a selected `CodexRuntimeCapsule`.
- Selecting an active fork keeps the same lease-free, human-approved semantics from the prior data model, but all restore inputs and audit evidence point to capsule ids and digests.
- No fork code, route, DTO, table, or repository method may retain snapshot naming after this wave.

### Trusted Route And Repository Naming

Trusted worker/internal routes and repository methods must be renamed with the data model:

- `/internal/codex-sessions/:sessionId/snapshots` becomes `/internal/codex-sessions/:sessionId/runtime-capsules`;
- `createCodexSessionSnapshot`, `getLatestSnapshot`, and similar repository/service names become capsule-named methods;
- `codex_session_snapshot_stale` and similar error codes become capsule-named codes such as `codex_runtime_capsule_stale`;
- error codes, metrics, tests, and no-baggage guards reject newly introduced `snapshot` names in this domain.

The only permitted remaining mentions of old snapshot names are historical references inside superseded design docs and migration descriptions. Runtime code, API contracts, public DTOs, test names, and operator runbooks for this wave must use capsule language.

## Internal Artifact Store Kinds

Replace the prior `codex_session_snapshot` internal artifact kind with:

```text
codex_runtime_capsule
codex_thread_state_bundle
codex_memory_bundle
codex_memory_delta
codex_environment_manifest
codex_plugin_package
codex_skill_bundle
```

Rules:

- `codex_session_snapshot` must be removed from `InternalArtifactKind`, ref parsing allowlists, upload validation, repository validation, tests, fixtures, and operator runbooks in the implementation wave.
- New writes using `artifact://internal/codex_session_snapshot/...` are rejected.
- Because the product is not live, no compatibility read adapter is allowed for `codex_session_snapshot`.
- Existing local test fixtures or seed data that use the old kind must be rewritten or dropped in the same migration.

Canonical refs:

```text
artifact://internal/codex_runtime_capsule/codex_session/{codex_session_id}/{capsule_id}
artifact://internal/codex_thread_state_bundle/codex_session/{codex_session_id}/{capsule_id}-thread
artifact://internal/codex_memory_bundle/codex_session/{codex_session_id}/{memory_bundle_id}
artifact://internal/codex_memory_delta/codex_session/{codex_session_id}/{turn_id}
artifact://internal/codex_environment_manifest/codex_session/{codex_session_id}/{environment_manifest_id}
artifact://internal/codex_plugin_package/codex_session/{codex_session_id}/{plugin_package_id}
artifact://internal/codex_skill_bundle/codex_session/{codex_session_id}/{skill_bundle_id}
```

All are internal-only objects. None are product Attachments.

## Restore Flow

Worker restore order is fixed:

```text
1. Create a fresh isolated CODEX_HOME.
2. Download and verify CodexRuntimeCapsule manifest and archive digest.
3. Restore runtime environment state:
   - memory bundle and deltas;
   - pinned plugins and skills;
   - MCP/app/tool schema manifest;
   - trusted project state.
4. Materialize current config/auth from ForgeLoop runtime profile and credential binding.
5. Restore thread state:
   - rollout JSONL;
   - locator/index repair metadata;
   - shell state captures if classified as required.
6. Start Codex app-server.
7. Call thread/resume with the bound raw Thread.id from trusted session state.
8. Verify returned Thread.id digest matches capsule/session digest.
9. Call turn/start.
10. On success, package the new capsule and terminalize the turn.
```

Normal restore must call `thread/resume` with the bound app-server `Thread.id` plus protocol-required non-identity flags:

```ts
const resumeRequest = {
  method: 'thread/resume',
  params: {
    threadId: rawCodexThreadId,
    excludeTurns: true,
    persistExtendedHistory: false
  }
};
```

Rules:

- `rawCodexThreadId` comes from trusted `CodexSession` state after digest verification.
- `excludeTurns: true` matches the current Wave 3 runtime request shape and avoids duplicating turn history through the resume response.
- `persistExtendedHistory: false` is required by the current app-server `ThreadResumeParams` schema and is not an identity selector.
- Normal restore must omit `history`.
- Normal restore must omit `path`.
- `Thread.sessionId` must never be used as the resume identity.
- A driver, worker, or retry path that attempts `thread/start`, `thread/resume(history)`, `thread/resume(path)`, or `thread/resume(Thread.sessionId)` for a bound session is a session-blocking continuity violation.

`auth.json` and `config.toml` are always written from trusted ForgeLoop materialization after capsule validation. They are never copied from the capsule.

The worker's global `~/.codex` must never be mounted as a runtime input for an existing session.

## Pack Flow

After a successful turn:

```text
1. Freeze app-server activity for the session turn.
2. Capture thread state files according to discovery allowlist.
3. Capture memory bundle output and memory delta if changed.
4. Capture plugin/skill/tool environment manifest and deltas.
5. Reject any unknown or forbidden CODEX_HOME path mutation.
6. Write canonical component manifests.
7. Upload component artifacts to Internal Artifact Store.
8. Write capsule manifest and archive.
9. Upload codex_runtime_capsule artifact.
10. Terminalize CodexSessionTurn with output capsule id/digest.
```

Packaging failure after a successful Codex turn is still a session continuity failure. The turn must not advance product state as a successful session-continuous generation unless the output capsule is durable.

## Components

### CodexRuntimeCapsuleDiscovery

Responsibilities:

- run controlled Codex app-server discovery against the installed CLI;
- observe `CODEX_HOME` before and after thread start, turn start, memory updates, plugin use, and restore;
- classify paths into allowlist, denylist, generated-environment, and unknown;
- produce a product-safe report with counts, digests, and blocker codes;
- fail when Codex CLI version or protocol digest changes without a refreshed discovery report.

Discovery is mandatory. It is not a best-effort diagnostic.

### CodexRuntimeCapsulePackager

Responsibilities:

- inspect an isolated `CODEX_HOME`;
- package only allowlisted state;
- reject path traversal, symlinks, absolute paths, forbidden files, and unknown mutations;
- compute canonical digests;
- upload component and capsule artifacts.

It must not read credential secrets or write product workflow state.

### CodexRuntimeCapsuleRestorer

Responsibilities:

- download capsule artifacts;
- verify digests and manifest;
- restore files into a fresh isolated `CODEX_HOME`;
- refuse unsafe paths and incompatible versions.

It must not write `auth.json` or `config.toml`.

### CodexRuntimeEnvironmentMaterializer

Responsibilities:

- materialize memory bundles and deltas;
- materialize pinned plugins, skills, MCP, and tool schemas;
- write config/auth from ForgeLoop runtime profile and credential binding;
- verify resulting environment digest equals the capsule manifest.

### CodexSessionRuntimeOrchestrator

Responsibilities:

- claim lease;
- restore capsule;
- materialize environment;
- launch app-server;
- resume thread;
- run turn;
- package next capsule;
- terminalize success/failure/block with lease fencing.

It owns fail-closed lifecycle behavior but not low-level file classification.

## Failure Semantics

All failure modes are fail-closed:

| Failure | Turn status | Session status | Public exposure |
| --- | --- | --- | --- |
| Missing input capsule | `failed` | `blocked` | product-safe blocker code |
| Missing first-turn base memory bundle | `failed` | `blocked` | base memory missing |
| Capsule digest mismatch | `failed` | `blocked` | digest mismatch code only |
| Unsafe archive path | `failed` | `blocked` | unsafe capsule code only |
| Missing memory bundle | `failed` | `blocked` | memory bundle missing |
| Memory digest mismatch | `failed` | `blocked` | memory digest mismatch |
| Missing environment manifest | `failed` | `blocked` | environment manifest missing |
| Environment manifest digest mismatch | `failed` | `blocked` | environment manifest mismatch |
| Plugin package missing | `failed` | `blocked` | plugin package missing |
| Skill bundle missing | `failed` | `blocked` | skill bundle missing |
| Skill manifest drift | `failed` | `blocked` | skill manifest drift |
| MCP server manifest drift | `failed` | `blocked` | mcp manifest drift |
| Tool schema drift | `failed` | `blocked` | tool schema drift |
| App connector schema drift | `failed` | `blocked` | app connector schema drift |
| Feature flag drift | `failed` | `blocked` | feature flag drift |
| Credential binding lineage mismatch | `failed` | `blocked` | credential lineage mismatch |
| Trusted runtime manifest drift | `failed` | `blocked` | runtime manifest drift |
| Stale discovery report | `failed` | `blocked` | discovery report stale |
| Codex CLI incompatible | `failed` | `blocked` | version incompatible |
| Protocol digest incompatible | `failed` | `blocked` | protocol incompatible |
| `thread/resume` failed | `failed` | `blocked` | resume failed |
| `thread/resume` thread mismatch | `failed` | `blocked` | thread mismatch |
| Packager sees unknown path | `failed` | `blocked` | unknown capsule path |

No failure mode may:

- start a replacement thread;
- ignore memory state;
- ignore plugin/tool state;
- read the worker's current global `~/.codex` as fallback;
- mark the generation turn succeeded without a durable output capsule.

## Security And Privacy

Capsules are trusted internal runtime state.

Public DTOs must not expose:

- raw Codex thread id;
- capsule artifact ref;
- thread-state bundle artifact ref;
- memory bundle artifact ref;
- memory delta artifact ref;
- environment manifest artifact ref;
- plugin package artifact ref;
- any other Internal Artifact Store component ref;
- credential binding id;
- credential binding version id;
- credential binding digest;
- credential binding lineage metadata;
- connector scope digest;
- memory content;
- plugin secret;
- connector auth;
- `auth.json`;
- `config.toml`;
- raw prompt transcript;
- raw rollout JSONL;
- host absolute paths.

Trusted internal worker protocols may carry raw thread id only because app-server needs it for `thread/resume`.

Logs and dogfood reports must use digests and blocker codes.

## Tests

### Unit And Contract Tests

Required coverage:

- canonical capsule manifest digest;
- path traversal rejection;
- symlink rejection;
- absolute path rejection;
- forbidden file rejection;
- unknown path rejection;
- memory bundle digest and delta digest;
- memory bundle deletion, rename, and replay semantics;
- app connector manifest digest;
- credential binding lineage digest;
- plugin package digest;
- skill bundle digest;
- skill manifest digest;
- MCP server manifest digest;
- MCP command/env allowlist payload round-trip from `codex_environment_manifest`;
- MCP cwd policy payload and literal non-secret env value payload round-trip from `codex_environment_manifest`;
- tool schema digest;
- tool schema payload round-trip from `codex_environment_manifest`;
- feature flag digest;
- trusted runtime manifest digest;
- app connector schema and scope payload round-trip from `codex_environment_manifest`;
- connector scope policy payload round-trip from `codex_environment_manifest`;
- Internal Artifact Store ref owner/type validation;
- cross-session component ref rejection;
- stale capsule terminalization rejection;
- request builder sends `threadId` and `persistExtendedHistory: false` for normal restore;
- request builder sends `excludeTurns: true` for normal restore unless a later protocol discovery report explicitly changes this flag;
- request builder rejects `thread/resume(history)`, `thread/resume(path)`, and `Thread.sessionId` resume identity for bound sessions;
- raw thread id redaction in public DTOs and reports.

### Integration Tests

Required flow:

```text
fresh CODEX_HOME
-> restore capsule
-> materialize environment
-> write config/auth
-> thread/resume
-> turn/start
-> package next capsule
-> update CodexSession.latest_capsule_digest
```

Required failures:

- missing capsule;
- missing component artifact;
- missing first-turn base memory bundle;
- memory digest mismatch;
- missing environment manifest artifact;
- environment manifest digest mismatch;
- plugin package digest mismatch;
- skill bundle digest mismatch;
- skill manifest drift;
- MCP server manifest drift;
- app connector schema drift;
- feature flag drift;
- credential binding lineage mismatch;
- trusted runtime manifest drift;
- stale discovery report;
- protocol digest mismatch;
- app-server resume failure;
- app-server thread mismatch;
- path/history resume attempt for a bound session;
- stale lease;
- packager unknown path.

### Dogfood

Add:

```text
pnpm dogfood:codex-runtime-capsule-discovery
pnpm dogfood:codex-runtime-capsule-restore
```

Discovery dogfood requirements:

- run against the current Codex CLI;
- generate a path classification report;
- prove the allowlist/denylist for thread state, memory state, and environment state;
- produce only product-safe output.

Restore dogfood requirements:

- use two independent isolated `CODEX_HOME` roots;
- complete a generation turn that creates a capsule;
- restore the capsule in the second root;
- resume the same `codex_thread_id_digest`;
- verify memory bundle digest continuity;
- verify memory deletion and rename deltas replay correctly;
- verify environment manifest digest continuity;
- verify app connector manifest and credential binding lineage continuity;
- package the next capsule;
- report only digests, counts, and blocker codes.

The dogfood command may skip when credentials are unavailable, but Wave 4 is not accepted until a real passing restore dogfood report exists.

## Implementation Notes

- Existing `CodexSessionSnapshot` code should be renamed, not wrapped.
- Existing `expected_previous_snapshot_digest` scheduling fields should become `expected_input_capsule_digest`.
- Existing output snapshot terminalization should become output capsule terminalization.
- Current Docker launcher uses tmpfs `/codex-home` plus `/codex-seed` for config/auth. Wave 4 must give the worker a host-visible isolated restore area or a controlled copy-out/copy-in mechanism before cleanup. If tmpfs remains the app-server runtime location, packager must run before cleanup and must be able to inspect the live container state safely.
- `writeCodexHomeConfigAndAuth` remains the only path for auth/config materialization.
- `buildCodexAppServerDockerCommand` must continue to forbid mounting host `~/.codex`.
- The no-baggage guard must be extended to reject legacy snapshot names after this wave.

## Acceptance Criteria

- Domain, DB, repository, trusted runtime DTOs, scheduler, and terminalization use capsule naming.
- No active code path or public contract still uses `CodexSessionSnapshot` or `latest_snapshot_*`.
- Internal Artifact Store supports all new capsule component kinds.
- Packager and restorer reject forbidden and unknown `CODEX_HOME` state.
- Memory bundle lineage is recorded per turn.
- Plugin/skill/tool environment manifests are pinned and restored.
- Restore never copies auth/config from capsule.
- Restore never reads worker global `~/.codex` for existing sessions.
- Cross-worker restore dogfood proves stable thread, memory, and environment digests.
- All failure modes block rather than fallback.
- Public outputs remain free of raw thread ids, raw capsule refs, raw memories, auth/config, and prompt transcripts.

## Open Questions For Implementation Planning

- Whether the migration should rename the existing physical table or create a new table and drop the old one in the same migration.
- Whether memory bundles should be stored as full bundles each turn or base-plus-delta chains with periodic compaction.
- Whether plugin packages should be stored per session or deduplicated globally by digest in Internal Artifact Store.
- Whether Codex shell state captures are required for generation-only turns after discovery.
- Whether `state_5.sqlite` locator repair can be done by app-server scan-and-repair from rollout files or needs a minimal table upsert.
