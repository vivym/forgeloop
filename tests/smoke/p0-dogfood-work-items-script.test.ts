import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { ArtifactKind } from '@forgeloop/contracts';
import type { ExecutionPackage, ReviewPacket, RunSession, WorkItem } from '@forgeloop/domain';
import { describe, expect, it } from 'vitest';

import * as dogfoodWorkItemsScript from '../../scripts/p0-dogfood-work-items';

const execFile = promisify(execFileCallback);

const at = '2026-05-08T00:00:00.000Z';
const requiredArtifactKinds: ArtifactKind[] = [
  'diff',
  'changed_files',
  'check_output',
  'execution_summary',
  'review_packet',
];

type StrictEvaluator = (input: {
  workItems: WorkItem[];
  executionPackages: ExecutionPackage[];
  runSessions: RunSession[];
  reviewPackets: ReviewPacket[];
}) => {
  status: 'passed' | 'failed';
  qualifyingWorkItems: Array<{
    workItemId: string;
    executionPackageId: string;
    runSessionId: string;
    reviewPacketId: string;
    executorType: string;
    workflowOnly: boolean;
  }>;
  blockers: Array<{ code: string; message: string; details?: Record<string, unknown> }>;
};

const evaluateStrictLocalCodexAcceptance = (): StrictEvaluator => {
  const candidate = (dogfoodWorkItemsScript as Record<string, unknown>).evaluateStrictLocalCodexAcceptance;
  expect(candidate).toEqual(expect.any(Function));
  return candidate as StrictEvaluator;
};

const workItem = (id: string): WorkItem => ({
  id,
  project_id: 'project-1',
  kind: 'feature',
  title: id,
  goal: `${id} goal`,
  success_criteria: [`${id} done`],
  priority: 'P0',
  risk: 'medium',
  owner_actor_id: 'actor-owner',
  phase: 'execution',
  activity_state: 'idle',
  gate_state: 'none',
  resolution: 'none',
  current_spec_id: `${id}-spec`,
  current_plan_id: `${id}-plan`,
  created_at: at,
  updated_at: at,
});

const executionPackage = (input: {
  id: string;
  workItemId: string;
  lastRunSessionId?: string;
  requiredArtifacts?: ArtifactKind[];
  resolution?: ExecutionPackage['resolution'];
}): ExecutionPackage => ({
  id: input.id,
  work_item_id: input.workItemId,
  spec_id: `${input.workItemId}-spec`,
  spec_revision_id: `${input.workItemId}-spec-revision`,
  plan_id: `${input.workItemId}-plan`,
  plan_revision_id: `${input.workItemId}-plan-revision`,
  project_id: 'project-1',
  repo_id: 'forgeloop',
  objective: `${input.workItemId} objective`,
  owner_actor_id: 'actor-owner',
  reviewer_actor_id: 'actor-reviewer',
  qa_owner_actor_id: 'actor-qa',
  phase: 'review',
  activity_state: 'awaiting_human',
  gate_state: 'review_approved',
  resolution: input.resolution ?? 'completed',
  required_checks: [],
  required_artifact_kinds: input.requiredArtifacts ?? requiredArtifactKinds,
  allowed_paths: ['docs/**'],
  forbidden_paths: ['.git/**'],
  ...(input.lastRunSessionId === undefined ? {} : { last_run_session_id: input.lastRunSessionId }),
  created_at: at,
  updated_at: at,
});

const runSession = (input: {
  id: string;
  packageId: string;
  workItemId: string;
  executorType?: 'mock' | 'local_codex';
  workflowOnly?: boolean;
  status?: RunSession['status'];
  artifacts?: ArtifactKind[];
}): RunSession =>
  ({
    id: input.id,
    execution_package_id: input.packageId,
    requested_by_actor_id: 'actor-owner',
    status: input.status ?? 'succeeded',
    executor_type: input.executorType ?? 'local_codex',
    run_spec: {
      run_session_id: input.id,
      execution_package_id: input.packageId,
      work_item_id: input.workItemId,
      executor_type: input.executorType ?? 'local_codex',
      workflow_only: input.workflowOnly ?? false,
    },
    changed_files: [{ path: 'docs/dogfood/p0-dogfood-work-items.md', status: 'modified' }],
    check_results: [{ check_id: 'dogfood-work-item', display_name: 'Dogfood', status: 'succeeded', blocks_review: true }],
    artifacts: (input.artifacts ?? requiredArtifactKinds).map((kind) => ({
      kind,
      name: `${kind}.txt`,
      local_ref: `artifacts/${input.id}/${kind}.txt`,
    })),
    log_refs: [],
    created_at: at,
    updated_at: at,
    started_at: at,
    finished_at: at,
  }) as RunSession;

const reviewPacket = (input: {
  id: string;
  packageId: string;
  runSessionId: string;
  status?: ReviewPacket['status'];
  decision?: ReviewPacket['decision'];
}): ReviewPacket =>
  ({
    id: input.id,
    run_session_id: input.runSessionId,
    execution_package_id: input.packageId,
    reviewer_actor_id: 'actor-reviewer',
    spec_revision_id: 'spec-revision',
    plan_revision_id: 'plan-revision',
    status: input.status ?? 'completed',
    decision: input.decision ?? 'approved',
    summary: 'Approved',
    changed_files: [],
    check_result_summary: 'Checks passed',
    self_review: {},
    risk_notes: [],
    requested_changes: [],
    created_at: at,
    updated_at: at,
    completed_at: at,
  }) as ReviewPacket;

const qualifyingBundle = (index: number, options: {
  executorType?: 'mock' | 'local_codex';
  workflowOnly?: boolean;
  reviewPacketRunSessionId?: string;
  reviewPacketStatus?: ReviewPacket['status'];
  reviewPacketDecision?: ReviewPacket['decision'];
  artifacts?: ArtifactKind[];
} = {}) => {
  const item = workItem(`work-item-${index}`);
  const packageId = `package-${index}`;
  const runSessionId = `run-${index}`;
  const packetId = `review-packet-${index}`;
  const pkg = executionPackage({ id: packageId, workItemId: item.id, lastRunSessionId: runSessionId });
  const run = runSession({
    id: runSessionId,
    packageId,
    workItemId: item.id,
    executorType: options.executorType,
    workflowOnly: options.workflowOnly,
    artifacts: options.artifacts,
  });
  const packet = reviewPacket({
    id: packetId,
    packageId,
    runSessionId: options.reviewPacketRunSessionId ?? runSessionId,
    status: options.reviewPacketStatus,
    decision: options.reviewPacketDecision,
  });

  return { item, pkg, run, packet };
};

const strictInput = (...bundles: ReturnType<typeof qualifyingBundle>[]) => ({
  workItems: bundles.map((bundle) => bundle.item),
  executionPackages: bundles.map((bundle) => bundle.pkg),
  runSessions: bundles.map((bundle) => bundle.run),
  reviewPackets: bundles.map((bundle) => bundle.packet),
});

describe('p0 dogfood work items script', () => {
  it(
    'creates the three P0 dogfood Work Items and writes a completion report',
    async () => {
      const outputDir = await mkdtemp(join(tmpdir(), 'forgeloop-work-item-dogfood-'));
      const reportPath = join(outputDir, 'report.md');

      try {
        await execFile('pnpm', ['dogfood:p0:work-items'], {
          cwd: process.cwd(),
          env: { ...process.env, FORGELOOP_WORK_ITEM_DOGFOOD_REPORT_PATH: reportPath },
          maxBuffer: 1024 * 1024 * 10,
          timeout: 30_000,
        });

        const report = await readFile(reportPath, 'utf8');
        expect(report).toContain('Remote CI gate');
        expect(report).toContain('Durable verification gaps');
        expect(report).toContain('Browser Run Console walkthrough');
        expect(report).toContain('changes_requested -> rerun -> approve');
        expect(report).toContain('object_event');
        expect(report).toContain('status_history');
        expect(report).toContain('Strict local_codex acceptance: disabled');
        expect(report).toContain('strict runbook acceptance is not complete in this run');
        expect(report).toContain('real local Codex acceptance is opt-in');
        expect(report).toContain('executor_type');
        expect(report).toContain('workflow_only');
      } finally {
        await rm(outputDir, { recursive: true, force: true });
      }
    },
    45_000,
  );

  it('evaluates strict mode as passed only when at least two local_codex Work Items satisfy the Work Item contract', () => {
    const evaluate = evaluateStrictLocalCodexAcceptance();
    const accepted = evaluate(strictInput(qualifyingBundle(1), qualifyingBundle(2), qualifyingBundle(3, { executorType: 'mock', workflowOnly: true })));

    expect(accepted.status).toBe('passed');
    expect(accepted.qualifyingWorkItems).toHaveLength(2);
    expect(accepted.qualifyingWorkItems[0]).toMatchObject({
      workItemId: 'work-item-1',
      executionPackageId: 'package-1',
      runSessionId: 'run-1',
      reviewPacketId: 'review-packet-1',
      executorType: 'local_codex',
      workflowOnly: false,
    });

    const failed = evaluate(strictInput(qualifyingBundle(1), qualifyingBundle(2, { executorType: 'mock', workflowOnly: true })));
    expect(failed.status).toBe('failed');
    expect(failed.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'strict_minimum_not_met' })]));
  });

  it('does not count RunSession success without an approved Review Packet for the same package and run', () => {
    const evaluate = evaluateStrictLocalCodexAcceptance();
    const result = evaluate(strictInput(qualifyingBundle(1), qualifyingBundle(2, { reviewPacketRunSessionId: 'previous-run' })));

    expect(result.status).toBe('failed');
    expect(result.qualifyingWorkItems).toHaveLength(1);
    expect(result.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'review_packet_missing_or_unapproved' })]));
  });

  it('does not count approved Review Packets for mock or workflow_only runs', () => {
    const evaluate = evaluateStrictLocalCodexAcceptance();
    const result = evaluate(
      strictInput(
        qualifyingBundle(1),
        qualifyingBundle(2, { executorType: 'mock', workflowOnly: false }),
        qualifyingBundle(3, { executorType: 'local_codex', workflowOnly: true }),
      ),
    );

    expect(result.status).toBe('failed');
    expect(result.qualifyingWorkItems).toHaveLength(1);
    expect(result.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'run_session_not_local_codex' })]));
    expect(result.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'run_session_workflow_only' })]));
  });

  it('does not count a Work Item when any Execution Package on it is incomplete', () => {
    const evaluate = evaluateStrictLocalCodexAcceptance();
    const first = qualifyingBundle(1);
    const second = qualifyingBundle(2);
    const incompleteExtraPackage = executionPackage({
      id: 'package-1-extra',
      workItemId: first.item.id,
      resolution: 'none',
    });
    const result = evaluate({
      ...strictInput(first, second),
      executionPackages: [first.pkg, incompleteExtraPackage, second.pkg],
    });

    expect(result.status).toBe('failed');
    expect(result.qualifyingWorkItems).toHaveLength(1);
    expect(result.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'work_item_completion_incomplete' })]));
  });

  it('fails when a qualifying local_codex Work Item is missing a required artifact kind', () => {
    const evaluate = evaluateStrictLocalCodexAcceptance();
    const result = evaluate(
      strictInput(
        qualifyingBundle(1),
        qualifyingBundle(2, { artifacts: requiredArtifactKinds.filter((kind) => kind !== 'review_packet') }),
      ),
    );

    expect(result.status).toBe('failed');
    expect(result.qualifyingWorkItems).toHaveLength(1);
    expect(result.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'required_artifact_missing' })]));
  });

  it('renders strict blocker details and dirty allowlist source when strict mode fails', () => {
    const rendered = dogfoodWorkItemsScript.renderDogfoodCompletionReport({
      generatedAt: at,
      durabilityMode: 'volatile_demo',
      projectId: 'project-1',
      repoId: 'forgeloop',
      commitSha: 'abc123',
      strictAcceptance: {
        status: 'failed',
        qualifyingWorkItems: [],
        blockers: [
          {
            code: 'source_dirty_blocked',
            message: 'Source checkout is dirty',
            details: {
              allowed_dirty_entries: ['docs/superpowers/reports/p0-dogfood-work-items-completion.md'],
              blocked_dirty_entries: ['README.md'],
              dirty_allowlist_source: 'STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST',
            },
          },
        ],
        dirtySource: {
          allowed_dirty_entries: ['docs/superpowers/reports/p0-dogfood-work-items-completion.md'],
          blocked_dirty_entries: ['README.md'],
          dirty_allowlist_source: 'STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST',
        },
      },
      items: [
        {
          key: 'feature-ci-gate',
          title: 'Remote CI gate',
          kind: 'feature',
          workItemId: 'work-item-1',
          packageId: 'package-1',
          executorType: 'local_codex',
          workflowOnly: false,
          runSessionIds: ['run-1'],
          reviewPacketIds: ['review-packet-1'],
          finalDecision: 'approved',
          exercisedChangesRequestedRerun: false,
          timelineSources: ['artifact', 'decision', 'object_event', 'status_history'],
        },
      ],
    });

    expect(rendered).toContain('Strict local_codex acceptance: failed');
    expect(rendered).toContain('source_dirty_blocked');
    expect(rendered).toContain('Source checkout is dirty');
    expect(rendered).toContain('allowed_dirty_entries');
    expect(rendered).toContain('blocked_dirty_entries');
    expect(rendered).toContain('STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST');
  });

  it('documents the strict dirty source allowlist and final P1 decision in the runbook', async () => {
    const runbook = await readFile('docs/dogfood/p0-dogfood-work-items.md', 'utf8');

    expect(runbook).toContain('## Strict Dirty Source Allowlist');
    expect(runbook).toContain('docs/superpowers/reports/p0-dogfood-work-items-completion.md');
    expect(runbook).toContain('.superpowers/**');
    expect(runbook).toContain('## Final P1 Decision Summary');
    expect(runbook).toContain('Trace / Evidence Plane');
  });
});
