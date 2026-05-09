import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { ArtifactKind } from '@forgeloop/contracts';
import type { ExecutionPackage, ReviewPacket, RunSession, WorkItem } from '@forgeloop/domain';
import { describe, expect, it, vi } from 'vitest';

import { InMemoryP0Repository } from '../../packages/db/src';
import * as dogfoodWorkItemsScript from '../../scripts/p0-dogfood-work-items';

const execFile = promisify(execFileCallback);

const defaultDogfoodEnv = (reportPath: string): NodeJS.ProcessEnv => {
  const {
    FORGELOOP_DATABASE_URL: _databaseUrl,
    FORGELOOP_ENABLE_REAL_CODEX_DOGFOOD: _strictEnabled,
    FORGELOOP_LOCAL_CODEX_DOGFOOD_CONFIRM_DANGEROUS_MODE: _dangerousMode,
    FORGELOOP_REPO_PATH: _repoPath,
    ...env
  } = process.env;
  void _databaseUrl;
  void _strictEnabled;
  void _dangerousMode;
  void _repoPath;

  return {
    ...env,
    FORGELOOP_WORK_ITEM_DOGFOOD_REPORT_PATH: reportPath,
  };
};

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
          env: defaultDogfoodEnv(reportPath),
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

  it('waits longer than the old five-second window for a persisted Review Packet', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(at));
    let packets: ReviewPacket[] = [];
    try {
      const candidate = (dogfoodWorkItemsScript as Record<string, unknown>).waitForReviewPacketFromRepository;
      expect(candidate).toEqual(expect.any(Function));
      const waitForReviewPacketFromRepository = candidate as (
        repository: {
          getRunSession(runSessionId: string): Promise<RunSession | undefined>;
          listReviewPacketsForPackage(executionPackageId: string): Promise<ReviewPacket[]>;
        },
        runSessionId: string,
        options: { timeoutMs: number; pollIntervalMs: number },
      ) => Promise<ReviewPacket>;
      const run = runSession({ id: 'run-1', packageId: 'package-1', workItemId: 'work-item-1' });
      const repository = {
        getRunSession: vi.fn(async () => run),
        listReviewPacketsForPackage: vi.fn(async () => packets),
      };
      const promise = waitForReviewPacketFromRepository(repository, 'run-1', {
        timeoutMs: 10_000,
        pollIntervalMs: 500,
      });
      let settled = false;
      void promise.then(() => {
        settled = true;
      });

      await vi.advanceTimersByTimeAsync(5_500);
      expect(settled).toBe(false);

      packets = [reviewPacket({ id: 'review-packet-1', packageId: 'package-1', runSessionId: 'run-1' })];
      await vi.advanceTimersByTimeAsync(500);

      await expect(promise).resolves.toMatchObject({ id: 'review-packet-1' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails fast when a RunSession stalls before a Review Packet exists', async () => {
    const candidate = (dogfoodWorkItemsScript as Record<string, unknown>).waitForReviewPacketFromRepository;
    expect(candidate).toEqual(expect.any(Function));
    const waitForReviewPacketFromRepository = candidate as (
      repository: {
        getRunSession(runSessionId: string): Promise<RunSession | undefined>;
        listReviewPacketsForPackage(executionPackageId: string): Promise<ReviewPacket[]>;
      },
      runSessionId: string,
      options: { timeoutMs: number; pollIntervalMs: number },
    ) => Promise<ReviewPacket>;
    const run = runSession({
      id: 'run-stalled',
      packageId: 'package-1',
      workItemId: 'work-item-1',
      status: 'stalled',
    });
    const repository = {
      getRunSession: vi.fn(async () => run),
      listReviewPacketsForPackage: vi.fn(async () => []),
    };

    await expect(
      waitForReviewPacketFromRepository(repository, 'run-stalled', {
        timeoutMs: 10_000,
        pollIntervalMs: 500,
      }),
    ).rejects.toThrow('RunSession run-stalled ended with status stalled before ReviewPacket was created');
  });

  it('bootstraps worktree dependencies before running the strict dogfood smoke check', () => {
    const candidate = (dogfoodWorkItemsScript as Record<string, unknown>).dogfoodRequiredChecks;
    expect(candidate).toEqual(expect.any(Array));
    expect(candidate).toEqual([
      expect.objectContaining({
        check_id: 'dogfood-work-item',
        command: 'pnpm install --frozen-lockfile && pnpm smoke:p0',
        timeout_seconds: 300,
        blocks_review: true,
      }),
    ]);
  });

  it('keeps strict local Codex work item objectives bounded and delegates checks to ForgeLoop', () => {
    const items = (dogfoodWorkItemsScript as Record<string, unknown>).dogfoodWorkItems as Array<{
      objective: string;
      strictRunMode: { executorType: string; workflowOnly: boolean };
    }>;
    const strictLocalCodexItems = items.filter(
      (item) => item.strictRunMode.executorType === 'local_codex' && item.strictRunMode.workflowOnly === false,
    );

    expect(strictLocalCodexItems).toHaveLength(2);
    for (const item of strictLocalCodexItems) {
      expect(item.objective).toContain('docs/dogfood/p0-dogfood-work-items.md');
      expect(item.objective).toContain('Do not run `pnpm dogfood:p0:work-items`');
      expect(item.objective).toContain('Do not run `pnpm test`');
      expect(item.objective).toContain('Do not run `pnpm build`');
      expect(item.objective).toContain('ForgeLoop will run the required checks after your turn');
    }
  });

  it('loads strict evaluation records from the repository with run metadata and artifacts intact', async () => {
    const candidate = (dogfoodWorkItemsScript as Record<string, unknown>).loadCompletedDogfoodRecordsFromRepository;
    expect(candidate).toEqual(expect.any(Function));
    const loadCompletedDogfoodRecordsFromRepository = candidate as (
      repository: InMemoryP0Repository,
      workItemId: string,
    ) => Promise<{
      workItem: WorkItem;
      executionPackages: ExecutionPackage[];
      runSessions: RunSession[];
      reviewPackets: ReviewPacket[];
    }>;
    const repository = new InMemoryP0Repository();
    const bundle = qualifyingBundle(1);
    await repository.saveWorkItem(bundle.item);
    await repository.saveExecutionPackage(bundle.pkg);
    await repository.saveRunSession(bundle.run);
    await repository.saveReviewPacket(bundle.packet);

    const records = await loadCompletedDogfoodRecordsFromRepository(repository, bundle.item.id);

    expect(records.runSessions[0]?.run_spec?.workflow_only).toBe(false);
    expect(records.runSessions[0]?.artifacts.map((artifact) => artifact.kind)).toEqual(requiredArtifactKinds);
    expect(records.reviewPackets[0]).toMatchObject({ id: bundle.packet.id, decision: 'approved' });
  });

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

  it('does not count a Work Item when another package on it completed through mock or workflow_only evidence', () => {
    const evaluate = evaluateStrictLocalCodexAcceptance();
    const first = qualifyingBundle(1);
    const second = qualifyingBundle(2);
    const extraPackage = executionPackage({
      id: 'package-1-extra',
      workItemId: first.item.id,
      lastRunSessionId: 'run-1-extra',
    });
    const extraRun = runSession({
      id: 'run-1-extra',
      packageId: extraPackage.id,
      workItemId: first.item.id,
      executorType: 'mock',
      workflowOnly: true,
    });
    const extraPacket = reviewPacket({
      id: 'review-packet-1-extra',
      packageId: extraPackage.id,
      runSessionId: extraRun.id,
    });
    const result = evaluate({
      ...strictInput(first, second),
      executionPackages: [first.pkg, extraPackage, second.pkg],
      runSessions: [first.run, extraRun, second.run],
      reviewPackets: [first.packet, extraPacket, second.packet],
    });

    expect(result.status).toBe('failed');
    expect(result.qualifyingWorkItems).toHaveLength(1);
    expect(result.qualifyingWorkItems[0]?.workItemId).toBe(second.item.id);
    expect(result.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'run_session_not_local_codex' })]));
    expect(result.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'run_session_workflow_only' })]));
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

  it('renders strict preflight blockers as blocked without claiming Work Items completed or leaking raw details', () => {
    const rendered = dogfoodWorkItemsScript.renderDogfoodCompletionReport({
      generatedAt: at,
      durabilityMode: 'volatile_demo',
      projectId: 'project-1',
      repoId: 'forgeloop',
      commitSha: 'abc123',
      strictAcceptance: {
        status: 'blocked',
        qualifyingWorkItems: [],
        blockers: [
          {
            code: 'source_dirty_blocked',
            message: 'Source checkout is dirty',
            details: {
              allowed_dirty_entries: ['docs/superpowers/reports/p0-dogfood-work-items-completion.md'],
              blocked_dirty_entries: ['README.md'],
              dirty_allowlist_source: 'STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST',
              error: 'secret failure from /Users/viv/projs/forgeloop/.worktrees/run-1',
            },
          },
        ],
        dirtySource: {
          allowed_dirty_entries: ['docs/superpowers/reports/p0-dogfood-work-items-completion.md'],
          blocked_dirty_entries: ['README.md'],
          dirty_allowlist_source: 'STRICT_LOCAL_CODEX_DOGFOOD_DIRTY_ALLOWLIST',
        },
      },
      items: [],
    });

    expect(rendered).toContain('Strict local_codex acceptance: blocked');
    expect(rendered).toContain('source_dirty_blocked');
    expect(rendered).toContain('Strict preflight blockers prevented batch execution');
    expect(rendered).toContain('\n- Strict preflight blockers prevented batch execution.\n');
    expect(rendered).not.toContain('All three Work Items have approved SpecRevision');
    expect(rendered).not.toContain('secret failure');
    expect(rendered).not.toContain('/Users/viv/projs/forgeloop');
    expect(rendered).toContain('redacted_detail_keys');
  });

  it('prints status-specific strict acceptance exit messages', () => {
    expect(dogfoodWorkItemsScript.strictAcceptanceExitMessage('blocked')).toContain('strict acceptance blocked');
    expect(dogfoodWorkItemsScript.strictAcceptanceExitMessage('failed')).toContain('strict acceptance failed');
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
