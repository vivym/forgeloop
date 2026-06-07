import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type CodexRuntimeSuperpowersBaggagePattern =
  | 'legacy_work_items_route'
  | 'legacy_tasks_route'
  | 'legacy_plan_draft_generator'
  | 'legacy_workflow_direct_spec_generation'
  | 'legacy_workflow_direct_plan_generation'
  | 'legacy_workflow_direct_execution_start'
  | 'legacy_public_execution_package_start'
  | 'legacy_public_execution_start_root'
  | 'legacy_workflow_run_session_control'
  | 'wave5_forbidden_session_mutation'
  | 'workflow_composer_generation_action'
  | 'public_owner_actor_alias'
  | 'execution_package_start_root_label'
  | 'legacy_inline_workspace_bundle_bytes'
  | 'public_raw_codex_runtime_ref'
  | 'raw_runtime_route'
  | 'host_codex_home'
  | 'exec_fallback'
  | 'codex_exec_cli'
  | 'legacy_codex_runtime_env_alias'
  | 'legacy_codex_session_snapshot';

export type AllowedMatch = {
  file: string;
  pattern: CodexRuntimeSuperpowersBaggagePattern;
  owner: 'legacy-local-executor' | 'negative-test' | 'internal-runtime-storage' | 'historical-doc';
  reason: string;
  excerpt?: string;
};

export interface CodexRuntimeSuperpowersNoBaggageViolation {
  file: string;
  line: number;
  pattern: CodexRuntimeSuperpowersBaggagePattern;
  excerpt: string;
}

export interface CodexRuntimeSuperpowersNoBaggageScanResult {
  ok: boolean;
  violations: CodexRuntimeSuperpowersNoBaggageViolation[];
}

const defaultScanFiles = [
  'package.json',
  'docs/runbooks/codex-remote-worker-runtime.md',
  'scripts/codex-runtime-superpowers-dogfood.ts',
  'scripts/codex-runtime-import.ts',
  'scripts/codex-runtime-dogfood-bootstrap.ts',
  'scripts/codex-remote-worker-dogfood.ts',
  'apps/control-plane-api/src/modules/brainstorming/brainstorming.controller.ts',
  'apps/control-plane-api/src/modules/brainstorming/brainstorming.service.ts',
  'apps/control-plane-api/src/modules/spec-plan/spec-plan.controller.ts',
  'apps/control-plane-api/src/modules/spec-plan/spec-plan.service.ts',
  'apps/control-plane-api/src/modules/executions/executions.controller.ts',
  'apps/control-plane-api/src/modules/executions/executions.service.ts',
  'apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.controller.ts',
  'apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto.ts',
  'apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts',
  'apps/control-plane-api/src/modules/codex-runtime/codex-runtime.dto.ts',
  'apps/control-plane-api/src/modules/codex-runtime/codex-runtime.controller.ts',
  'apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service.ts',
  'apps/control-plane-api/src/modules/codex-runtime/product-generation-runtime-scheduler.service.ts',
  'apps/control-plane-api/src/modules/run-control/run-control.module.ts',
  'packages/contracts/src/api.ts',
  'packages/codex-runtime/src/payloads.ts',
  'packages/codex-runtime/src/runtime.ts',
  'packages/codex-runtime/src/types.ts',
  'packages/codex-worker-runtime/src/remote-worker-client.ts',
  'packages/run-worker/src/run-worker.ts',
  'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
  'tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts',
];
const defaultScanRoots = [
  'scripts',
  'packages/codex-runtime',
  'packages/codex-worker-runtime',
  'packages/workflow',
  'packages/run-worker',
  'apps/automation-daemon/src',
  'apps/control-plane-api/src/modules',
  'apps/web/src/features/development-plans',
  'apps/web/src/shared/api',
  'docs/runbooks',
  'docs/superpowers/reports',
  'tests',
];
const legacyCodexSessionSnapshotScanRoots = [
  'packages/domain',
  'packages/contracts',
  'packages/db/src',
];
const scanExtensions = new Set(['.ts', '.tsx', '.md', '.json']);
const ignoredHistoricalPathFragments = [
  'scripts/dogfood/strict-local-codex.ts',
  'scripts/dogfood/release-flow-core.ts',
  'scripts/delivery-local-codex-dogfood.ts',
  'scripts/delivery-dogfood-work-items.ts',
  'tests/executor/',
  'tests/executor-gateway/',
  'tests/run-worker/',
  'tests/api/work-items.test.ts',
  'tests/api/delivery-flow.test.ts',
  'tests/api/automation-daemon.integration.test.ts',
  'tests/api/local-codex-routing.test.ts',
  'tests/api/task-scoped-evidence.test.ts',
  'tests/smoke/delivery-local-codex-dogfood-script.test.ts',
  'tests/smoke/release-flow-dogfood-script.test.ts',
  'tests/contracts/markdown-document.test.ts',
  'tests/web/project-management-routes.test.tsx',
  'tests/e2e/web-product-routes.e2e.test.ts',
];
const activeStrictScripts = new Set([
  'scripts/check-codex-runtime-superpowers-no-baggage.ts',
  'scripts/check-runbook-scripts.ts',
  'scripts/codex-runtime-superpowers-dogfood.ts',
  'scripts/codex-runtime-import.ts',
  'scripts/codex-runtime-dogfood-bootstrap.ts',
  'scripts/codex-remote-worker-dogfood.ts',
]);
const activeTask8Tests = new Set([
  'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
  'tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts',
  'tests/smoke/runbook-script-consistency.test.ts',
]);
const wave5WorkflowProductFiles = new Set([
  'apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.controller.ts',
  'apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto.ts',
  'apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts',
  'packages/contracts/src/plan-item-workflow.ts',
  'apps/control-plane-api/src/modules/spec-plan/spec-plan.controller.ts',
  'apps/control-plane-api/src/modules/executions/executions.controller.ts',
  'apps/web/src/features/development-plans/development-plan-item-detail-route.tsx',
  'apps/web/src/features/development-plans/plan-item-workflow-view-model.ts',
  'apps/web/src/features/development-plans/plan-item-workflow-workspace.tsx',
  'apps/web/src/shared/api/commands.ts',
  'apps/web/src/shared/api/hooks.ts',
  'apps/web/src/shared/api/query-keys.ts',
  'apps/web/src/shared/api/types.ts',
  'tests/web/fixtures/product-api-mock.ts',
]);
const planItemExecutionStartPublicFiles = new Set([
  'apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto.ts',
  'apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.controller.ts',
  'apps/web/src/features/development-plans/plan-item-workflow-workspace.tsx',
  'apps/web/src/shared/api/commands.ts',
]);

export const codexRuntimeSuperpowersNoBaggageAllowlist: AllowedMatch[] = [
  {
    file: 'docs/runbooks/codex-remote-worker-runtime.md',
    pattern: 'host_codex_home',
    owner: 'historical-doc',
    reason: 'Documents local Codex files as import sources only; strict workers must not mount host Codex state.',
    excerpt: 'only inputs to the bootstrap step',
  },
  {
    file: 'docs/runbooks/codex-remote-worker-runtime.md',
    pattern: 'host_codex_home',
    owner: 'historical-doc',
    reason: 'Documents the strict worker prohibition against mounting or reading host Codex state.',
    excerpt: 'must not mount or read the worker host',
  },
  {
    file: 'scripts/codex-runtime-import.ts',
    pattern: 'host_codex_home',
    owner: 'internal-runtime-storage',
    reason: 'Import CLI may read local Codex files as setup input before centralized distribution.',
  },
  {
    file: 'scripts/codex-remote-worker-dogfood.ts',
    pattern: 'host_codex_home',
    owner: 'internal-runtime-storage',
    reason: 'Remote worker script rejects host Codex configuration in no-shared-filesystem mode.',
  },
  {
    file: 'apps/control-plane-api/src/modules/run-control/run-control.module.ts',
    pattern: 'exec_fallback',
    owner: 'legacy-local-executor',
    reason: 'Legacy run-control fallback remains outside the strict Superpowers dogfood entry point.',
  },
  {
    file: 'packages/run-worker/src/run-worker.ts',
    pattern: 'exec_fallback',
    owner: 'legacy-local-executor',
    reason: 'Legacy run-worker fallback remains outside the strict Superpowers dogfood entry point.',
  },
  {
    file: 'packages/run-worker/src/fake-codex-session-driver.ts',
    pattern: 'exec_fallback',
    owner: 'legacy-local-executor',
    reason: 'Fake local run driver keeps legacy fallback vocabulary outside strict remote dogfood execution.',
  },
  {
    file: 'packages/codex-worker-runtime/src/docker-command.ts',
    pattern: 'host_codex_home',
    owner: 'internal-runtime-storage',
    reason: 'Docker command sets container-local CODEX_HOME, not host Codex state.',
    excerpt: 'CODEX_HOME=/codex-home',
  },
  {
    file: 'packages/codex-worker-runtime/src/codex-runtime-capsule/app-server-stdio.ts',
    pattern: 'host_codex_home',
    owner: 'internal-runtime-storage',
    reason: 'Stdio probe sets an isolated child-process CODEX_HOME, not host Codex state.',
    excerpt: 'CODEX_HOME: options.codexHomeRoot',
  },
  {
    file: 'packages/codex-runtime/src/runtime.ts',
    pattern: 'legacy_plan_draft_generator',
    owner: 'legacy-local-executor',
    reason: 'Legacy draft generation API remains for existing automation actions outside the new product closure path.',
  },
  {
    file: 'packages/codex-runtime/src/types.ts',
    pattern: 'legacy_plan_draft_generator',
    owner: 'legacy-local-executor',
    reason: 'Legacy draft generation type remains for existing automation actions outside the new product closure path.',
  },
  {
    file: 'packages/codex-worker-runtime/src/remote-worker-client.ts',
    pattern: 'legacy_plan_draft_generator',
    owner: 'legacy-local-executor',
    reason: 'Legacy generation dispatch remains explicit and separate from new product generation task kinds.',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'legacy_work_items_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches legacy Work Item route usage.',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'legacy_tasks_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches legacy task route usage.',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'legacy_tasks_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches legacy task query route usage.',
    excerpt: '/query/tasks',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'legacy_tasks_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches legacy task factory usage.',
    excerpt: 'createTask',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'legacy_tasks_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches legacy task literal usage.',
    excerpt: 'oldTask',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'legacy_work_items_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches legacy work item literal usage.',
    excerpt: 'oldWorkItem',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'raw_runtime_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches legacy plan literal usage.',
    excerpt: 'oldPlan',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'raw_runtime_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches source-specific direct spec and plan routes.',
    excerpt: '/requirements/',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'raw_runtime_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches source-specific direct spec and plan routes.',
    excerpt: '/bugs/',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'raw_runtime_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches source-specific direct spec and plan routes.',
    excerpt: '/tech-debt/',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'raw_runtime_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches source-specific direct spec and plan routes.',
    excerpt: '/initiatives/',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'host_codex_home',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches host Codex home usage.',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'exec_fallback',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches exec fallback usage.',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'codex_exec_cli',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches Codex exec CLI usage.',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'legacy_codex_runtime_env_alias',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches legacy Codex runtime env aliases.',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'legacy_codex_session_snapshot',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches legacy Codex session snapshot vocabulary.',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'legacy_inline_workspace_bundle_bytes',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches retired inline workspace bundle bytes.',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'legacy_workflow_direct_spec_generation',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches Wave 5 direct Spec Doc routes.',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'legacy_workflow_direct_plan_generation',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches Wave 5 direct Implementation Plan routes.',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'legacy_workflow_direct_execution_start',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches Wave 5 direct execution start routes.',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'legacy_public_execution_package_start',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches retired public execution package start calls.',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'legacy_workflow_run_session_control',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches Wave 5 direct run-session controls.',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'wave5_forbidden_session_mutation',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches forbidden Wave 5 public session mutations.',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'workflow_composer_generation_action',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches generation actions in the workflow composer.',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'public_raw_codex_runtime_ref',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches raw runtime refs on public UI surfaces.',
  },
  {
    file: 'tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts',
    pattern: 'host_codex_home',
    owner: 'negative-test',
    reason: 'Report redaction test asserts host Codex paths never appear in public dogfood output.',
  },
  {
    file: 'tests/smoke/codex-runtime-superpowers-dogfood-script.test.ts',
    pattern: 'legacy_tasks_route',
    owner: 'negative-test',
    reason: 'Report redaction test asserts unsafe legacy task paths are rejected from public dogfood output.',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'raw_runtime_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches raw runtime route helper shapes.',
    excerpt: 'rawPlanRoute',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'raw_runtime_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches raw runtime path helper shapes.',
    excerpt: 'rawSpecPath',
  },
  {
    file: 'tests/smoke/codex-runtime-no-baggage-gate.test.ts',
    pattern: 'raw_runtime_route',
    owner: 'negative-test',
    reason: 'Negative test fixture proves the strict gate catches raw replay browser labels.',
    excerpt: 'replayBrowser',
  },
  {
    file: 'scripts/check-codex-runtime-superpowers-no-baggage.ts',
    pattern: 'exec_fallback',
    owner: 'internal-runtime-storage',
    reason: 'The guard must name the forbidden fallback token it scans for.',
  },
  {
    file: 'scripts/check-codex-runtime-superpowers-no-baggage.ts',
    pattern: 'host_codex_home',
    owner: 'internal-runtime-storage',
    reason: 'The guard must name the forbidden host Codex token patterns it scans for.',
  },
  {
    file: 'scripts/check-codex-runtime-superpowers-no-baggage.ts',
    pattern: 'legacy_tasks_route',
    owner: 'internal-runtime-storage',
    reason: 'The guard must name the forbidden legacy task route pattern it scans for.',
  },
  {
    file: 'scripts/check-codex-runtime-superpowers-no-baggage.ts',
    pattern: 'legacy_work_items_route',
    owner: 'internal-runtime-storage',
    reason: 'The guard must name the forbidden legacy Work Item route pattern it scans for.',
  },
  {
    file: 'scripts/check-codex-runtime-superpowers-no-baggage.ts',
    pattern: 'legacy_public_execution_package_start',
    owner: 'internal-runtime-storage',
    reason: 'The guard must name the retired public execution package start patterns it scans for.',
  },
  {
    file: 'scripts/check-codex-runtime-superpowers-no-baggage.ts',
    pattern: 'legacy_inline_workspace_bundle_bytes',
    owner: 'internal-runtime-storage',
    reason: 'The guard must name the retired inline workspace bundle byte field it scans for.',
  },
  {
    file: 'scripts/codex-runtime-superpowers-dogfood.ts',
    pattern: 'host_codex_home',
    owner: 'internal-runtime-storage',
    reason: 'The strict dogfood script must name host Codex env keys so it can remove them before worker startup.',
    excerpt: "'FORGELOOP_CODEX_HOME'",
  },
  {
    file: 'scripts/codex-runtime-superpowers-dogfood.ts',
    pattern: 'host_codex_home',
    owner: 'internal-runtime-storage',
    reason: 'The strict dogfood script must name container Codex env keys so it can remove host-provided values before worker startup.',
    excerpt: "'CODEX_HOME'",
  },
];

const baggagePatterns: Record<CodexRuntimeSuperpowersBaggagePattern, RegExp[]> = {
  legacy_work_items_route: [
    /[("'`]\s*\/work-items(?:\/|\b)/,
    /\.post\(\s*["']\/work-items(?:\/|\b)/,
    /type:\s*z\.literal\(\s*['"]work_item['"]\s*\)/,
  ],
  legacy_tasks_route: [
    /\/(?:query\/)?tasks(?:\/|\b)/,
    /\bcreateTask\(/,
    /type:\s*z\.literal\(\s*['"]task['"]\s*\)/,
  ],
  legacy_plan_draft_generator: [/\bgeneratePlanDraft\b/],
  legacy_workflow_direct_spec_generation: [
    /\/?(?:plan-item-workflows\/[^"'`\s]+|development-plans\/[^"'`\s]+\/items\/[^"'`\s]+)\/spec(?:\/|-)generate-draft(?:\/|\b)/,
    /\/?(?:plan-item-workflows\/[^"'`\s]+\/)?spec-revisions(?:\/[^"'`\s]+)?\/(?:generate|submit|approve)(?:\/|\b)/,
    /\/?(?:plan-item-workflows\/[^"'`\s]+|development-plans\/[^"'`\s]+\/items\/[^"'`\s]+)\/spec(?:\/[^"'`\s]+)?\/(?:draft|regenerate-draft|submit-for-approval|submit|approve|reject|request-changes)(?:\/|\b)/,
  ],
  legacy_workflow_direct_plan_generation: [
    /\/?(?:plan-item-workflows\/[^"'`\s]+|development-plans\/[^"'`\s]+\/items\/[^"'`\s]+)\/implementation-plan(?:\/|-)generate-draft(?:\/|\b)/,
    /\/?(?:plan-item-workflows\/[^"'`\s]+\/)?implementation-plan-revisions(?:\/[^"'`\s]+)?\/(?:generate|submit|approve)(?:\/|\b)/,
    /\/?(?:plan-item-workflows\/[^"'`\s]+|development-plans\/[^"'`\s]+\/items\/[^"'`\s]+)\/implementation-plan(?:\/[^"'`\s]+)?\/(?:draft|regenerate-draft|submit-for-approval|submit|approve|reject|request-changes)(?:\/|\b)/,
  ],
  legacy_workflow_direct_execution_start: [
    /\/?(?:plan-item-workflows\/[^"'`\s]+|development-plans\/[^"'`\s]+\/items\/[^"'`\s]+)\/execution\/start(?:\/|\b)/,
  ],
  legacy_public_execution_package_start: [
    /\/?execution-packages\/[^"'`\s]+\/(?:run|rerun|force-rerun)(?:\/|\b)/,
    /\b(?:runPackage|rerunPackage|forceRerunPackage)\b/,
    /\btype:\s*z\.literal\(\s*['"](?:run_package|rerun_package|force_rerun_package)['"]/,
    /\b(?:type|command):\s*['"](?:run_package|rerun_package|force_rerun_package)['"]/,
    /["']dogfood:(?:delivery(?::(?:durable|local-codex|work-items))?|release-flow(?::strict)?)["']\s*:/,
    /['"]dogfood:(?:delivery(?::(?:durable|local-codex|work-items))?|release-flow(?::strict)?)['"]/,
    /\bscripts\/(?:delivery-(?:dogfood|durable-dogfood|local-codex-dogfood|dogfood-work-items)|release-flow(?:-strict)?-dogfood)\.ts\b/,
  ],
  legacy_public_execution_start_root: [
    /\/(?:requirements|initiatives|bugs|tech-debt|sources?|specs?|implementation-plans|work-items|development-plan-items|tasks?)\/[^"'`\s]+\/execution\/start(?:\/|\b)/,
    /\b(?:Source|Spec|Implementation Plan|generic Work Item|DevelopmentPlanItem|Task)\b.*\bexecution\/start\b/i,
    /\bstartExecutionFrom(?:Source|Spec|ImplementationPlan|WorkItem|DevelopmentPlanItem|Task)\b/,
  ],
  legacy_workflow_run_session_control: [
    /\/?(?:plan-item-workflows\/[^"'`\s]+\/)?run-sessions\/[^"'`\s]+\/(?:input|cancel|resume)(?:\/|\b)/,
  ],
  wave5_forbidden_session_mutation: [
    /\/?plan-item-workflows\/[^"'`\s]+\/(?:transitions|block|archive|recover)(?:\/|\b)/,
    /\/?plan-item-workflows\/[^"'`\s]+\/(?:request-boundary-changes|request-spec-changes|request-implementation-plan-changes)(?:\/|\b)/,
    /\/?plan-item-workflows\/[^"'`\s]+\/codex-sessions\/[^"'`\s]+\/(?:fork|select-active-fork|new-session|abandon|scavenge)(?:\/|\b)/,
  ],
  workflow_composer_generation_action: [
    /\baction:\s*['"](?:generate_spec_doc|generate_implementation_plan_doc|start_execution)['"]/,
    /<option\s+value=["'](?:generate_spec_doc|generate_implementation_plan_doc|start_execution)["']/,
    /\bWorkflowMessageAction\b.*\b(?:generate_spec_doc|generate_implementation_plan_doc|start_execution)\b/,
  ],
  public_owner_actor_alias: [
    /\bowner_actor_id\b/,
  ],
  execution_package_start_root_label: [
    /\bStart from Execution Package\b/i,
  ],
  legacy_inline_workspace_bundle_bytes: [
    /\barchive_bytes_base64\b/,
  ],
  public_raw_codex_runtime_ref: [
    /\bcodex_thread_id\b(?!_digest)/,
    /\b(?:active_)?codex_session_id\b/,
    /\bcodex_session_turn_id\b/,
    /\bselected_codex_session_id\b/,
    /\boutput_capsule_id\b/,
    /\bmemory_bundle_ref\b/,
    /\bprompt_transcript\b/,
    /artifact:\/\//,
    /\/Users\//,
  ],
  raw_runtime_route: [
    /\/(?:plans|specs|replay)(?:\/|\b)/,
    /\broute\(\s*['"](?:plans|specs|replay)['"]\s*\)/,
    /\bpath:\s*['"](?:plans|specs|replay)['"]/,
    /type:\s*z\.literal\(\s*['"]plan['"]\s*\)/,
    /\/(?:requirements|bugs|tech-debt|initiatives)\/[^"'`\s]+\/(?:spec|plan)(?:\/|\b)/,
    /(?:Execution Package|Run Session|Review Packet|Raw Replay) Browser/,
  ],
  host_codex_home: [/~\/\.codex/, /\bCODEX_HOME\b/, /\bFORGELOOP_CODEX_HOME\b/, /\bhost_config_path\b/, /\bhost_auth_path\b/],
  exec_fallback: [/\bexec_fallback\b/],
  codex_exec_cli: [/\bcodex\s+exec\b/, /\brun\(\s*["']codex["']\s*,\s*\[\s*["']exec["']/],
  legacy_codex_runtime_env_alias: [
    /\bFORGELOOP_CODEX_AUTOMATION_GENERATION\b/,
    /\bFORGELOOP_CODEX_WORKER_ID\b/,
  ],
  legacy_codex_session_snapshot: [
    /\bCodexSessionSnapshot\b/,
    /\bcodex_session_snapshot\b/,
    /\blatest_snapshot_/,
    /\bexpected_previous_snapshot_digest\b/,
    /\boutput_snapshot_/,
    /\battempted_output_snapshot_digest\b/,
    /\bforked_from_snapshot_id\b/,
    /\bfork_point_snapshot_/,
    /\bcodex_session_snapshot_stale\b/,
    /\blatestSnapshot/,
    /\bexpectedPreviousSnapshotDigest\b/,
    /\boutputSnapshot/,
    /\battemptedOutputSnapshotDigest\b/,
    /\bforkedFromSnapshotId\b/,
    /\bforkPointSnapshot/,
    /\bcodexSessionSnapshots\b/,
    /\bcreateCodexSessionSnapshot\b/,
    /\bgetCodexSessionSnapshot\b/,
    /\bgetLatestSnapshot\b/,
    /\/codex-sessions\/[^'"]+\/snapshots/,
    /:sessionId\/snapshots/,
  ],
};

const fileExtension = (file: string): string => {
  const dot = file.lastIndexOf('.');
  return dot < 0 ? '' : file.slice(dot);
};

const isIgnoredHistoricalPath = (
  file: string,
  pattern: CodexRuntimeSuperpowersBaggagePattern,
  activePackageScriptFiles: Set<string>,
): boolean => {
  if (file.includes('/node_modules/')) {
    return true;
  }
  if (pattern === 'legacy_public_execution_package_start' && activePackageScriptFiles.has(file)) {
    return false;
  }
  if (pattern === 'public_owner_actor_alias' && !planItemExecutionStartPublicFiles.has(file)) {
    return true;
  }
  const isWave5ProductPatternOutsideWave5Files =
    [
      'legacy_workflow_direct_spec_generation',
      'legacy_workflow_direct_plan_generation',
      'legacy_workflow_direct_execution_start',
      'legacy_workflow_run_session_control',
      'wave5_forbidden_session_mutation',
      'workflow_composer_generation_action',
      'public_raw_codex_runtime_ref',
    ].includes(pattern) && !wave5WorkflowProductFiles.has(file);
  const isHistoricalSupportPath =
    pattern !== 'legacy_codex_session_snapshot' &&
    (ignoredHistoricalPathFragments.some((fragment) => file === fragment || file.includes(fragment)) ||
      (file.startsWith('scripts/') && !activeStrictScripts.has(file)) ||
      (file.startsWith('tests/') && !activeTask8Tests.has(file)) ||
      (file.startsWith('docs/superpowers/reports/') && !file.includes('codex-runtime-superpowers')));
  return isWave5ProductPatternOutsideWave5Files || isHistoricalSupportPath;
};

const collectFilesUnder = (rootDir: string, relativePath: string): string[] => {
  const absolutePath = join(rootDir, relativePath);
  if (!existsSync(absolutePath)) {
    return [];
  }
  const stat = statSync(absolutePath);
  if (stat.isFile()) {
    return scanExtensions.has(fileExtension(relativePath)) && !relativePath.includes('/node_modules/') ? [relativePath] : [];
  }
  if (!stat.isDirectory()) {
    return [];
  }
  return readdirSync(absolutePath)
    .flatMap((entry) => collectFilesUnder(rootDir, join(relativePath, entry)))
    .filter((file) => !file.includes('/node_modules/'));
};

const packageScriptFilesFor = (rootDir: string): string[] => {
  const packageJsonPath = join(rootDir, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return [];
  }
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { scripts?: Record<string, unknown> };
  const scripts = packageJson.scripts ?? {};
  const files = new Set<string>();
  for (const value of Object.values(scripts)) {
    if (typeof value !== 'string') continue;
    const matches = value.matchAll(/\b((?:scripts|apps|packages|tests)\/[^"'`\s]+?\.(?:ts|tsx|js|mjs|cjs))\b/g);
    for (const match of matches) {
      files.add(relative(rootDir, resolve(rootDir, match[1])));
    }
  }
  return [...files].filter((file) => scanExtensions.has(fileExtension(file)));
};

const isAllowed = (input: {
  file: string;
  pattern: CodexRuntimeSuperpowersBaggagePattern;
  line: string;
  allowlist: AllowedMatch[];
}): boolean =>
  (input.file.startsWith('apps/web/src/shared/api/') &&
    [
      'legacy_work_items_route',
      'legacy_workflow_direct_spec_generation',
      'legacy_workflow_direct_plan_generation',
      'legacy_workflow_direct_execution_start',
      'legacy_workflow_run_session_control',
    ].includes(input.pattern)) ||
  (input.pattern === 'legacy_workflow_direct_spec_generation' &&
    input.file === 'apps/web/src/shared/api/commands.ts' &&
    input.line.includes('const itemSpecPath')) ||
  (input.pattern === 'legacy_workflow_direct_plan_generation' &&
    input.file === 'apps/web/src/shared/api/commands.ts' &&
    input.line.includes('const itemImplementationPlanPath')) ||
  (input.pattern === 'legacy_workflow_direct_execution_start' &&
    input.file === 'apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.controller.ts' &&
    /@Post\('plan-item-workflows\/:workflowId\/execution\/start'\)/.test(input.line)) ||
  (input.pattern === 'legacy_workflow_direct_execution_start' &&
    input.file === 'apps/control-plane-api/src/modules/executions/executions.service.ts' &&
    input.line.includes('workflow_legacy_entrypoint_disabled')) ||
  (input.pattern === 'legacy_workflow_direct_execution_start' &&
    input.file === 'apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts' &&
    /assertActorCanMutateWorkflow|manual_decision_kind|workflow_legacy_entrypoint_disabled/.test(input.line)) ||
  (input.pattern === 'legacy_public_execution_package_start' &&
    input.file === 'apps/control-plane-api/src/modules/run-control/execution-package-runs.controller.ts' &&
    /@Post\('execution-packages\/:packageId\/(?:run|rerun|force-rerun)'\)/.test(input.line)) ||
  (input.pattern === 'legacy_codex_session_snapshot' &&
    (input.file === 'scripts/plan-item-execution-handoff-dogfood.ts' ||
      input.file === 'tests/smoke/plan-item-execution-handoff-dogfood-script.test.ts')) ||
  (input.pattern === 'wave5_forbidden_session_mutation' &&
    input.file === 'apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.service.ts' &&
    /assertActorCanMutateWorkflow|manual_decision_kind|workflow_invalid_transition/.test(input.line)) ||
  (input.pattern === 'wave5_forbidden_session_mutation' &&
    input.file === 'apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto.ts' &&
    /forkCodexSessionBodySchema|ForkCodexSessionBodyDto|forked_from_/.test(input.line)) ||
  (input.pattern === 'workflow_composer_generation_action' &&
    input.file !== 'apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto.ts' &&
    !input.file.endsWith('plan-item-workflow-workspace.tsx') &&
    !/\baction:\s*['"](?:generate_spec_doc|generate_implementation_plan_doc|start_execution)['"]/.test(input.line) &&
    !/<option\s+value=["'](?:generate_spec_doc|generate_implementation_plan_doc|start_execution)["']/.test(input.line)) ||
  (input.pattern === 'public_raw_codex_runtime_ref' &&
    input.file.startsWith('apps/control-plane-api/src/modules/plan-item-workflows/') &&
    !input.file.endsWith('plan-item-workflow.controller.ts') &&
    !input.file.endsWith('plan-item-workflow.dto.ts')) ||
  (input.pattern === 'public_raw_codex_runtime_ref' &&
    input.file === 'packages/contracts/src/plan-item-workflow.ts' &&
    /internalPlanItemWorkflowTransitionSchema|internalWorkflowManualDecisionSchema|codex_session_id|codex_session_turn_id|selected_codex_session_id/.test(input.line)) ||
  (input.pattern === 'public_raw_codex_runtime_ref' &&
    input.file === 'apps/web/src/features/development-plans/plan-item-workflow-view-model.ts' &&
    isPlanItemWorkflowUiRuntimeSafetyAssertionLine(input.line)) ||
  (input.pattern === 'public_raw_codex_runtime_ref' &&
    input.file === 'apps/web/src/shared/api/types.ts' &&
    input.line.includes("from '@forgeloop/contracts'")) ||
  (input.pattern === 'legacy_codex_session_snapshot' &&
    input.file.split('/').slice(0, 3).join(':') === 'docs:superpowers:specs' &&
    /supersedes|superseded|legacy|old|prior|previous/.test(input.line)) ||
  input.allowlist.some(
    (entry) =>
      entry.file === input.file &&
      entry.pattern === input.pattern &&
      (entry.excerpt === undefined || input.line.includes(entry.excerpt)),
  );

const isPlanItemWorkflowUiRuntimeSafetyAssertionLine = (line: string): boolean =>
  /^\s*['"](?:active_codex_session_id|codex_session_id|codex_session_turn_id|output_capsule_id|memory_bundle_ref|prompt_transcript)['"],?\s*$/.test(line) ||
  /^\s*const forbiddenKeyPatterns = \[\/codex_thread_id\$\/i, \/capsule_ref\$\/i, \/artifact_ref\$\/i, \/credential\.\*metadata\/i\];\s*$/.test(line) ||
  /^\s*const forbiddenValuePatterns = \[\/artifact:/.test(line);

const patternsForFile = (
  file: string,
): Array<[CodexRuntimeSuperpowersBaggagePattern, RegExp[]]> => {
  const patterns = Object.entries(baggagePatterns) as Array<[CodexRuntimeSuperpowersBaggagePattern, RegExp[]]>;
  if (file === 'packages/contracts/src/api.ts') {
    return patterns;
  }
  if (legacyCodexSessionSnapshotScanRoots.some((root) => file === root || file.startsWith(`${root}/`))) {
    return patterns.filter(([pattern]) => pattern === 'legacy_codex_session_snapshot' || pattern === 'legacy_inline_workspace_bundle_bytes');
  }
  return patterns;
};

const scanFile = (input: {
  rootDir: string;
  file: string;
  allowlist: AllowedMatch[];
  activePackageScriptFiles: Set<string>;
}): CodexRuntimeSuperpowersNoBaggageViolation[] => {
  const absolutePath = join(input.rootDir, input.file);
  if (!existsSync(absolutePath)) {
    return [];
  }

  const content = readFileSync(absolutePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const violations: CodexRuntimeSuperpowersNoBaggageViolation[] = [];
  for (const [lineIndex, line] of lines.entries()) {
    const shouldUseStartRootPattern =
      baggagePatterns.legacy_public_execution_start_root.some((expression) => expression.test(line)) &&
      !baggagePatterns.legacy_public_execution_package_start.some((expression) => expression.test(line));
    for (const [pattern, expressions] of patternsForFile(input.file)) {
      if (
        shouldUseStartRootPattern &&
        (pattern === 'legacy_work_items_route' || pattern === 'raw_runtime_route')
      ) {
        continue;
      }
      if (isIgnoredHistoricalPath(input.file, pattern, input.activePackageScriptFiles)) {
        continue;
      }
      if (expressions.some((expression) => expression.test(line))) {
        if (!isAllowed({ file: input.file, pattern, line, allowlist: input.allowlist })) {
          violations.push({
            file: input.file,
            line: lineIndex + 1,
            pattern,
            excerpt: line.trim(),
          });
        }
      }
    }
  }
  return violations;
};

export const scanCodexRuntimeSuperpowersNoBaggage = (input: {
  rootDir?: string;
  files?: string[];
  allowlist?: AllowedMatch[];
}): CodexRuntimeSuperpowersNoBaggageScanResult => {
  const rootDir = resolve(input.rootDir ?? process.cwd());
  const activePackageScriptFiles = new Set(packageScriptFilesFor(rootDir));
  const defaultFiles = [
    ...defaultScanFiles,
    ...activePackageScriptFiles,
    ...defaultScanRoots.flatMap((scanRoot) => collectFilesUnder(rootDir, scanRoot)),
    ...legacyCodexSessionSnapshotScanRoots.flatMap((scanRoot) => collectFilesUnder(rootDir, scanRoot)),
  ];
  const files = Array.from(
    new Set(
      (input.files ?? defaultFiles).map((file) => relative(rootDir, resolve(rootDir, file))),
    ),
  ).sort();
  const allowlist = input.allowlist ?? codexRuntimeSuperpowersNoBaggageAllowlist;
  const violations = files.flatMap((file) => scanFile({ rootDir, file, allowlist, activePackageScriptFiles }));
  return { ok: violations.length === 0, violations };
};

const main = (): number => {
  const result = scanCodexRuntimeSuperpowersNoBaggage({});
  if (result.ok) {
    console.log('Codex runtime Superpowers strict lane has no unowned baggage matches.');
    return 0;
  }

  console.error('Codex runtime Superpowers strict lane has unowned baggage matches:');
  for (const violation of result.violations) {
    console.error(`- ${violation.file}:${violation.line} ${violation.pattern}`);
  }
  return 1;
};

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main();
}
