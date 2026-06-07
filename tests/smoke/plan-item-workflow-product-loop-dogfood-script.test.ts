import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { startBrainstormingWorkflowSchema } from '../../apps/control-plane-api/src/modules/plan-item-workflows/plan-item-workflow.dto';
import {
  loadPlanItemWorkflowRealDogfoodConfig,
  planItemWorkflowRealDogfoodStartBody,
} from '../../scripts/plan-item-workflow-product-loop-real-dogfood';

const execFileAsync = promisify(execFile);
const reportMarker = 'DOGFOOD_REPORT_JSON:';

type DogfoodReport = {
  status: string;
  source: string;
  workflow_id: string;
  session_continuity: {
    same_private_codex_session: boolean;
    turn_count: number;
    codex_thread_id_digest?: string;
  };
  route_calls: { route: string; runtime_call: boolean; queued_action_id?: string; status: string }[];
  queued_actions: {
    id: string;
    kind: string;
    status: string;
    expected_input_capsule_digest?: string;
    output_capsule_digest?: string;
    output_capsule_sequence?: number;
    codex_thread_id_digest?: string;
  }[];
  turns: {
    intent: string;
    sequence: number;
    workflow_id: string;
    status: string;
    expected_input_capsule_digest?: string;
    output_capsule_digest?: string;
  }[];
  artifacts: {
    boundary_summary_revision_id: string;
    spec_revision_id: string;
    implementation_plan_revision_id: string;
    workflow_id: string;
    development_plan_item_id: string;
  };
  readiness: {
    state: string;
    workflow_status: string;
    blocker_codes: string[];
  };
  no_execution_runtime_state_created: Record<string, number>;
  execution_package_boundary: {
    execution_package_count: number;
    phase: string;
    activity_state: string;
    gate_state: string;
    resolution: string;
    run_session_count: number;
  };
};

const parseReport = (stdout: string): DogfoodReport => {
  const reportLine = stdout
    .split(/\r?\n/)
    .find((line) => line.startsWith(reportMarker));

  if (reportLine === undefined) {
    throw new Error(`Dogfood output did not contain ${reportMarker}`);
  }

  return JSON.parse(reportLine.slice(reportMarker.length)) as DogfoodReport;
};

const dogfoodChildEnv = (): NodeJS.ProcessEnv => {
  const keysToKeep = [
    'PATH',
    'HOME',
    'USER',
    'SHELL',
    'TMPDIR',
    'TEMP',
    'TMP',
    'LANG',
    'LC_ALL',
    'PNPM_HOME',
    'COREPACK_HOME',
    'NPM_CONFIG_USERCONFIG',
    'npm_config_userconfig',
  ];
  const env: NodeJS.ProcessEnv = {
    FORGELOOP_DOGFOOD_FAKE_RUNTIME: '1',
    NO_PROXY: '127.0.0.1,localhost',
    no_proxy: '127.0.0.1,localhost',
  };
  for (const key of keysToKeep) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
};

describe('Plan Item workflow product-loop dogfood scripts', () => {
  it('package.json exposes Wave 5 dogfood scripts', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> };

    expect(packageJson.scripts['dogfood:plan-item-workflow-product-loop']).toContain('plan-item-workflow-product-loop-dogfood.ts');
    expect(packageJson.scripts['dogfood:plan-item-workflow-product-loop:real']).toContain('plan-item-workflow-product-loop-real-dogfood.ts');
    for (const retiredScript of [
      'dogfood:delivery',
      'dogfood:delivery:durable',
      'dogfood:delivery:local-codex',
      'dogfood:delivery:work-items',
      'dogfood:release-flow',
      'dogfood:release-flow:strict',
    ]) {
      expect(packageJson.scripts).not.toHaveProperty(retiredScript);
    }
  });

  it('fake dogfood drives real workflow API and repository evidence for the full Wave 5 loop', async () => {
    const result = await execFileAsync('pnpm', ['dogfood:plan-item-workflow-product-loop'], {
      env: dogfoodChildEnv(),
      maxBuffer: 1024 * 1024 * 8,
    });
    const report = parseReport(result.stdout);

    expect(result.stdout).toContain('start Brainstorming');
    expect(result.stdout).toContain('answer Boundary question');
    expect(result.stdout).toContain('run Spec Doc generation');
    expect(result.stdout).toContain('request Spec Doc changes');
    expect(result.stdout).toContain('run Spec Doc revision');
    expect(result.stdout).toContain('run Implementation Plan Doc generation');
    expect(result.stdout).toContain('request Implementation Plan Doc changes');
    expect(result.stdout).toContain('run Implementation Plan Doc revision');
    expect(result.stdout).toContain('evaluate Execution Ready');
    expect(report).toMatchObject({
      status: 'PASS',
      source: 'real_service_api_repository',
      readiness: { state: 'ready', workflow_status: 'execution_ready', blocker_codes: [] },
    });
    expect(report.workflow_id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(report.workflow_id).not.toBe('workflow-dogfood-plan-item-product-loop');
    expect(report.session_continuity).toMatchObject({
      same_private_codex_session: true,
      turn_count: 7,
    });
    expect(report.route_calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ route: 'POST /development-plans/:developmentPlanId/items/:itemId/workflow/start-brainstorming', runtime_call: false }),
        expect.objectContaining({ route: 'POST /plan-item-workflows/:workflowId/messages', runtime_call: false }),
        expect.objectContaining({ route: 'POST /plan-item-workflows/:workflowId/actions/:actionId/run', runtime_call: true }),
        expect.objectContaining({ route: 'POST /plan-item-workflows/:workflowId/execution-readiness/evaluate', runtime_call: false }),
      ]),
    );
    expect(report.queued_actions.map((action) => action.kind)).toEqual([
      'continue_brainstorming',
      'continue_brainstorming',
      'generate_boundary_summary',
      'generate_spec_doc',
      'revise_spec_doc',
      'generate_implementation_plan_doc',
      'revise_implementation_plan_doc',
    ]);
    expect(report.queued_actions.every((action) => action.status === 'succeeded')).toBe(true);
    expect(report.turns).toHaveLength(report.queued_actions.length);
    expect(report.turns.every((turn) => turn.workflow_id === report.workflow_id)).toBe(true);
    expect(report.turns.map((turn) => turn.sequence)).toEqual(report.turns.map((_, index) => index + 1));
    for (let index = 1; index < report.turns.length; index += 1) {
      expect(report.turns[index]?.expected_input_capsule_digest).toBe(report.turns[index - 1]?.output_capsule_digest);
    }
    expect(new Set(report.queued_actions.map((action) => action.output_capsule_digest)).size).toBe(report.queued_actions.length);
    expect(new Set(report.queued_actions.map((action) => action.codex_thread_id_digest)).size).toBe(1);
    expect(report.artifacts).toMatchObject({
      workflow_id: report.workflow_id,
    });
    expect(Object.values(report.no_execution_runtime_state_created).every((count) => count === 0)).toBe(true);
    expect(report.execution_package_boundary).toMatchObject({
      execution_package_count: 1,
      phase: 'draft',
      activity_state: 'idle',
      gate_state: 'not_submitted',
      resolution: 'none',
      run_session_count: 0,
    });
    expect(JSON.stringify(report)).not.toMatch(/workflow-dogfood-plan-item-product-loop|codex-session-dogfood-plan-item-product-loop|String\(index\)|padStart/);
    expect(JSON.stringify(report)).not.toMatch(/active_codex_session_id|codex_session_id|codex_session_turn_id|codex_thread_id"|artifact:\/\/|\/Users\/|prompt transcript/i);
    expect(report.turns.every((turn) => !('id' in turn))).toBe(true);
  });

  it('real dogfood skips locally unless acceptance mode is explicit', async () => {
    const result = await execFileAsync('pnpm', ['dogfood:plan-item-workflow-product-loop:real']);

    expect(result.stdout).toContain('SKIPPED_NON_ACCEPTANCE');
  });

	  it('real dogfood derives no-execution proof from public projections instead of hard-coded zero counts', () => {
	    const source = readFileSync('scripts/plan-item-workflow-product-loop-real-dogfood.ts', 'utf8');

    expect(source).toContain('assertNoExecutionRuntimeState');
    expect(source).toContain('projection.runtime_boundary');
    expect(source).toContain('/execution-packages/${encodeURIComponent(boundary.id)}');
    expect(source).not.toMatch(
      /no_execution_runtime_state_created:\s*{\s*run_session_count:\s*0,\s*execution_worker_job_count:\s*0,\s*workspace_bundle_count:\s*0,\s*pr_count:\s*0,\s*review_loop_count:\s*0,\s*}/s,
	    );
	  });

	  it('fake dogfood derives no-execution proof from public projections instead of internal runtime tables', () => {
	    const source = readFileSync('scripts/plan-item-workflow-product-loop-dogfood.ts', 'utf8');

	    expect(source).toContain('getDevelopmentPlanItemProjection');
	    expect(source).toContain('projection.runtime_boundary');
	    expect(source).toContain('publicExecutionPackageProof');
	    expect(source).not.toMatch(/listRunSessions|listReviewPackets|listCodeReviewHandoffs|listQaHandoffs/);
	    expect(source).not.toMatch(/run_session_count:\s*0/);
	  });

	  it('real dogfood acceptance start request keeps runtime and credential revisions out of the public DTO', () => {
	    const config = loadPlanItemWorkflowRealDogfoodConfig({
	      FORGELOOP_REAL_RUNTIME_ACCEPTANCE: '1',
	      FORGELOOP_CONTROL_PLANE_URL: 'http://control-plane.local',
	      FORGELOOP_CODEX_RUNTIME_SETUP_ACTOR_ID: 'actor-tech-lead',
	      FORGELOOP_CODEX_DOGFOOD_PROJECT_ID: 'project-1',
	      FORGELOOP_CODEX_DOGFOOD_PLANNING_INPUT_ID: 'requirement-1',
	      FORGELOOP_CODEX_DOGFOOD_SKIP_BOOTSTRAP: '1',
	      FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_ID: 'runtime-profile-1',
	      FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_REVISION_ID: 'runtime-profile-revision-1',
	      FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID: 'credential-binding-1',
	      FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_VERSION_ID: 'credential-binding-version-1',
	    });

	    expect(config).toBeDefined();
	    const body = planItemWorkflowRealDogfoodStartBody(config!);

	    expect(config!.generationRuntimeProfileId).toBe('runtime-profile-1');
	    expect(config!.generationRuntimeProfileRevisionId).toBe('runtime-profile-revision-1');
	    expect(config!.generationCredentialBindingId).toBe('credential-binding-1');
	    expect(config!.generationCredentialBindingVersionId).toBe('credential-binding-version-1');
	    expect(startBrainstormingWorkflowSchema.parse(body)).toEqual({
	      actor_id: 'actor-tech-lead',
	      reason: 'Start Wave 5 real runtime dogfood.',
	    });
	    expect(body).not.toHaveProperty('runtime_profile_id');
	    expect(body).not.toHaveProperty('credential_binding_id');
	  });
});
