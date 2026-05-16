import { describe, expect, it } from 'vitest';
import { releaseCockpitResponseSchema } from '@forgeloop/contracts';
import type {
  Artifact,
  Decision,
  ExecutionPackage,
  Project,
  Release,
  ReleaseEvidence,
  ReviewPacket,
  RunSession,
  WorkItem,
} from '@forgeloop/domain';

import { getReleaseCockpit, InMemoryDeliveryRepository, type DeliveryRepository } from '../../packages/db/src/index';

const now = '2026-05-11T00:00:00.000Z';
const later = '2026-05-11T00:01:00.000Z';
const latest = '2026-05-11T00:02:00.000Z';

const publicArtifactRef = {
  kind: 'execution_summary',
  name: 'Release summary',
  content_type: 'text/markdown',
  storage_uri: 'https://evidence.example.test/release-summary.md',
} as const;

const project = (overrides: Partial<Project> = {}): Project => ({
  id: 'project-1',
  org_id: 'org-1',
  key: 'P1',
  name: 'P1 Product Surface',
  repo_ids: ['repo-1'],
  owner_actor_id: 'actor-owner',
  created_at: now,
  updated_at: now,
  ...overrides,
});

const workItem = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: 'work-item-1',
  project_id: 'project-1',
  kind: 'requirement',
  title: 'Ship release radar',
  goal: 'Expose release readiness.',
  success_criteria: ['Release cockpit is public-safe.'],
  priority: 'p1',
  risk: 'medium',
  owner_actor_id: 'actor-owner',
  phase: 'done',
  activity_state: 'idle',
  gate_state: 'none',
  resolution: 'completed',
  current_release_id: 'release-1',
  created_at: now,
  updated_at: later,
  ...overrides,
});

const executionPackage = (overrides: Partial<ExecutionPackage> = {}): ExecutionPackage => ({
  id: 'package-1',
  work_item_id: 'work-item-1',
  spec_id: 'spec-1',
  spec_revision_id: 'spec-revision-1',
  plan_id: 'plan-1',
  plan_revision_id: 'plan-revision-1',
  project_id: 'project-1',
  repo_id: 'repo-1',
  objective: 'Implement release cockpit helper.',
  owner_actor_id: 'actor-owner',
  reviewer_actor_id: 'actor-reviewer',
  qa_owner_actor_id: 'actor-qa',
  phase: 'release',
  activity_state: 'idle',
  gate_state: 'release_ready',
  resolution: 'completed',
  required_checks: [
    {
      check_id: 'unit',
      display_name: 'Unit tests',
      command: 'pnpm vitest run tests/db/release-cockpit-queries.test.ts',
      timeout_seconds: 120,
      blocks_review: true,
    },
  ],
  required_artifact_kinds: ['execution_summary'],
  allowed_paths: ['/Users/viv/projs/forgeloop/private'],
  forbidden_paths: ['secrets/**'],
  last_run_session_id: 'run-1',
  current_run_session_id: 'run-1',
  current_review_packet_id: 'review-1',
  current_release_id: 'release-1',
  integration_readiness: {
    summary: 'Ready for release.',
    raw_metadata: { local_path: '/Users/viv/private' },
  },
  created_at: now,
  updated_at: later,
  ...overrides,
});

const runSession = (overrides: Partial<RunSession> = {}): RunSession => ({
  id: 'run-1',
  execution_package_id: 'package-1',
  requested_by_actor_id: 'actor-owner',
  status: 'succeeded',
  executor_type: 'codex',
  changed_files: [{ path: 'packages/db/src/queries/release-cockpit-queries.ts', status: 'modified' }],
  check_results: [
    {
      check_id: 'unit',
      status: 'succeeded',
      blocks_review: true,
      summary: 'Tests passed.',
    },
  ],
  artifacts: [publicArtifactRef],
  log_refs: [],
  summary: 'Run succeeded.',
  runtime_metadata: {
    durability_mode: 'durable',
    recovery_attempt_count: 0,
    effective_dangerous_mode: 'not_requested',
    workspace_path: '/Users/viv/projs/forgeloop',
    client_secret: 'do-not-leak',
  } as RunSession['runtime_metadata'] & { client_secret: string },
  created_at: now,
  updated_at: later,
  started_at: now,
  finished_at: later,
  ...overrides,
});

const reviewPacket = (overrides: Partial<ReviewPacket> = {}): ReviewPacket => ({
  id: 'review-1',
  run_session_id: 'run-1',
  execution_package_id: 'package-1',
  reviewer_actor_id: 'actor-reviewer',
  spec_revision_id: 'spec-revision-1',
  plan_revision_id: 'plan-revision-1',
  status: 'completed',
  decision: 'approved',
  summary: 'Approved for release.',
  changed_files: [{ path: 'packages/db/src/queries/release-cockpit-queries.ts', status: 'modified' }],
  check_result_summary: 'All required checks succeeded.',
  self_review: { summary: 'Ready.', raw_payload: { local_path: '/Users/viv/private' } } as ReviewPacket['self_review'] & {
    raw_payload: Record<string, unknown>;
  },
  risk_notes: [],
  requested_changes: [],
  reviewed_by_actor_id: 'actor-reviewer',
  reviewed_at: later,
  created_at: now,
  updated_at: later,
  completed_at: later,
  ...overrides,
});

const release = (overrides: Partial<Release> = {}): Release => ({
  id: 'release-1',
  org_id: 'org-1',
  project_id: 'project-1',
  key: 'REL-1',
  title: 'P1 Release Radar',
  scope_summary: 'Ship release risk radar.',
  phase: 'rollout',
  activity_state: 'idle',
  gate_state: 'approved',
  resolution: 'none',
  work_item_ids: ['work-item-1'],
  execution_package_ids: ['package-1'],
  current_review_packet_ids: ['review-1'],
  current_run_session_ids: ['run-1'],
  rollout_strategy: 'Roll out to the release owner cohort first.',
  rollback_plan: 'Revert the release owner surface flag.',
  observation_plan: 'Watch release evidence and owner feedback for one hour.',
  release_owner_actor_id: 'actor-owner',
  release_type: 'normal',
  extra: {
    raw_extra: { local_path: '/Users/viv/private' },
  },
  created_by_actor_id: 'actor-owner',
  updated_by_actor_id: 'actor-owner',
  created_at: now,
  updated_at: later,
  ...overrides,
});

const observationEvidence = (overrides: Partial<ReleaseEvidence> = {}): ReleaseEvidence => ({
  id: 'evidence-1',
  org_id: 'org-1',
  project_id: 'project-1',
  release_id: 'release-1',
  evidence_type: 'observation_note',
  summary: 'No regressions observed.',
  object_ref: { object_type: 'release', object_id: 'release-1', relationship: 'observed' },
  artifact_id: 'artifact-1',
  extra: {
    observation: {
      source: 'human',
      severity: 'info',
      summary: 'Release looks healthy.',
      observed_at: later,
      links: [
        { object_type: 'release', object_id: 'release-1', relationship: 'observed' },
        { object_type: 'execution_package', object_id: 'package-1', relationship: 'observed' },
      ],
      metrics: { errors: 0 },
      notes: 'Public observation note.',
      raw_payload: { local_path: '/Users/viv/private' },
    },
  },
  redacted: false,
  status: 'current',
  created_at: later,
  created_by_actor_id: 'actor-owner',
  ...overrides,
});

const artifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'artifact-1',
  object_type: 'release_evidence',
  object_id: 'evidence-1',
  artifact_type: 'execution_summary',
  ref: publicArtifactRef,
  created_at: later,
  ...overrides,
});

const decision = (overrides: Partial<Decision> = {}): Decision => ({
  id: 'decision-1',
  object_type: 'release',
  object_id: 'release-1',
  actor_id: 'actor-owner',
  decided_by_actor_id: 'actor-reviewer',
  decision_type: 'release_approval',
  outcome: 'approved',
  decision: 'approved',
  summary: 'Release approved.',
  rationale: 'Ready to observe.',
  evidence_refs: [{ artifact_id: 'artifact-secret' }],
  created_at: later,
  ...overrides,
});

const seedReadyRelease = async (repo: DeliveryRepository, overrides: {
  project?: Partial<Project>;
  work_item?: Partial<WorkItem>;
  execution_package?: Partial<ExecutionPackage>;
  run_session?: Partial<RunSession>;
  review_packet?: Partial<ReviewPacket>;
  release?: Partial<Release>;
  evidence?: Partial<ReleaseEvidence>;
  artifact?: Partial<Artifact>;
  decision?: Partial<Decision>;
  save_evidence?: boolean;
  } = {}) => {
  await repo.saveProject(project(overrides.project));
  await repo.saveWorkItem(workItem(overrides.work_item));
  await repo.saveExecutionPackage(executionPackage(overrides.execution_package));
  await repo.saveRunSession(runSession(overrides.run_session));
  await repo.saveReviewPacket(reviewPacket(overrides.review_packet));
  await repo.saveRelease(release(overrides.release));
  if (overrides.save_evidence !== false) {
    await repo.saveReleaseEvidence(observationEvidence(overrides.evidence));
    await repo.saveArtifact(artifact(overrides.artifact));
  }
  await repo.saveDecision(decision(overrides.decision));
};

const unsafeJson = (value: unknown): string => JSON.stringify(value);

describe('getReleaseCockpit', () => {
  it('returns a public-safe release cockpit for a release-ready scope', async () => {
    const repo = new InMemoryDeliveryRepository();
    await seedReadyRelease(repo);

    const cockpit = await getReleaseCockpit(repo, 'release-1');

    expect(cockpit).toBeDefined();
    expect(releaseCockpitResponseSchema.parse(cockpit)).toMatchObject({
      release: {
        id: 'release-1',
        project_id: 'project-1',
        scope_summary: 'Ship release risk radar.',
        work_item_ids: ['work-item-1'],
        execution_package_ids: ['package-1'],
      },
    });
    expect(cockpit?.work_items).toHaveLength(1);
    expect(cockpit?.execution_packages).toHaveLength(1);
    expect(cockpit?.latest_run_sessions).toHaveLength(1);
    expect(cockpit?.current_review_packets).toHaveLength(1);
    expect(cockpit?.evidences).toHaveLength(1);
    expect(cockpit?.observations).toHaveLength(1);
    expect(Array.isArray(cockpit?.decisions)).toBe(true);
    expect(cockpit?.blockers).toEqual([]);
    expect(cockpit?.overridden_blockers).toEqual([]);
    expect(cockpit?.risk_summary.release_can_proceed_without_override).toBe(true);
    expect(cockpit?.next_actions).toContain('start_observing');
    expect(cockpit?.observations[0]?.extra.observation?.links).toContainEqual({
      object_type: 'release',
      object_id: 'release-1',
      relationship: 'observed',
    });

    const serialized = unsafeJson(cockpit);
    for (const unsafeField of [
      'allowed_paths',
      'forbidden_paths',
      'raw_payload',
      'raw_metadata',
      'runtime_metadata',
      'review_payload',
      'raw_extra',
      'client_secret',
      '/Users/',
    ]) {
      expect(serialized).not.toContain(unsafeField);
    }
  });

  it('summarizes readiness from the selected review packet run and honors log refs', async () => {
    const repo = new InMemoryDeliveryRepository();
    await seedReadyRelease(repo, {
      execution_package: {
        required_artifact_kinds: ['execution_summary', 'logs'],
        current_run_session_id: 'run-new',
        last_run_session_id: 'run-new',
        current_review_packet_id: 'review-old',
      },
      run_session: {
        id: 'run-new',
        check_results: [
          {
            check_id: 'unit',
            status: 'failed',
            blocks_review: true,
            summary: 'Current run failed after review packet selection.',
          },
        ],
        artifacts: [{ ...publicArtifactRef, kind: 'logs', name: 'Logs uploaded as a regular artifact' }],
        log_refs: [],
      },
      review_packet: {
        id: 'review-old',
        run_session_id: 'run-old',
      },
      release: {
        current_review_packet_ids: ['review-old'],
        current_run_session_ids: ['run-new'],
      },
    });
    await repo.saveRunSession(
      runSession({
        id: 'run-old',
        artifacts: [publicArtifactRef],
        log_refs: [{ ...publicArtifactRef, kind: 'logs', name: 'Release logs' }],
        created_at: '2026-05-10T00:00:00.000Z',
        updated_at: '2026-05-10T00:01:00.000Z',
        finished_at: '2026-05-10T00:01:00.000Z',
      }),
    );

    const cockpit = await getReleaseCockpit(repo, 'release-1');

    expect(cockpit?.latest_run_sessions.map((item) => item.id)).toEqual(['run-new']);
    expect(cockpit?.current_review_packets.map((item) => item.id)).toEqual(['review-old']);
    expect(cockpit?.execution_packages[0]?.required_check_summary).toMatchObject({
      passed: 1,
      failed: 0,
      missing: 0,
    });
    expect(cockpit?.execution_packages[0]?.required_artifact_summary).toEqual({
      required: ['execution_summary', 'logs'],
      present: ['execution_summary', 'logs'],
      missing: [],
    });
  });

  it('reports overrideable planning and evidence blockers when plans and evidence are missing', async () => {
    const repo = new InMemoryDeliveryRepository();
    await seedReadyRelease(repo, {
      save_evidence: false,
      release: {
        phase: 'observing',
        gate_state: 'rollout_succeeded',
        rollout_strategy: undefined,
        rollback_plan: undefined,
        observation_plan: undefined,
      },
    });

    const cockpit = await getReleaseCockpit(repo, 'release-1');

    expect(cockpit?.blockers.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'missing_required_evidence_backlink',
        'missing_rollout_strategy',
        'missing_rollback_plan',
        'missing_observation_plan',
      ]),
    );
    expect(cockpit?.risk_summary.release_can_proceed_without_override).toBe(false);
    expect(cockpit?.risk_summary.release_can_proceed_with_override).toBe(true);
  });

  it('keeps unsafe observation evidence facts but omits unsafe public backlinks and reports a blocker', async () => {
    const repo = new InMemoryDeliveryRepository();
    await seedReadyRelease(repo, {
      evidence: {
        extra: {
          observation: {
            source: 'human',
            severity: 'info',
            summary: 'Release looks healthy with one private backlink.',
            observed_at: later,
            links: [
              { object_type: 'release', object_id: 'release-1', relationship: 'observed' },
              { object_type: 'execution_package', object_id: 'package-1', relationship: 'observed' },
              { object_type: 'artifact', object_id: 'missing-artifact', relationship: 'generated_by' },
              { object_type: 'decision', object_id: 'missing-decision', relationship: 'supports' },
              { object_type: 'run_session', object_id: 'run-old', relationship: 'generated_by' },
              { object_type: 'review_packet', object_id: 'review-old', relationship: 'supports' },
            ],
          },
        },
      },
    });
    await repo.saveRunSession(
      runSession({
        id: 'run-old',
        created_at: '2026-05-10T00:00:00.000Z',
        updated_at: '2026-05-10T00:01:00.000Z',
      }),
    );
    await repo.saveReviewPacket(
      reviewPacket({
        id: 'review-old',
        run_session_id: 'run-old',
        created_at: '2026-05-10T00:00:00.000Z',
        updated_at: '2026-05-10T00:01:00.000Z',
        completed_at: '2026-05-10T00:01:00.000Z',
      }),
    );

    const cockpit = await getReleaseCockpit(repo, 'release-1');

    expect(cockpit?.evidences).toHaveLength(1);
    expect(cockpit?.observations).toHaveLength(1);
    expect(cockpit?.observations[0]?.extra.observation?.links).toEqual([
      { object_type: 'release', object_id: 'release-1', relationship: 'observed' },
      { object_type: 'execution_package', object_id: 'package-1', relationship: 'observed' },
    ]);
    expect(cockpit?.blockers.map((item) => item.code)).toContain('unsafe_or_redacted_evidence_backlink');
  });

  it('omits non-public exact artifact ids and unsafe top-level object refs', async () => {
    const repo = new InMemoryDeliveryRepository();
    await seedReadyRelease(repo, {
      evidence: {
        object_ref: { object_type: 'run_session', object_id: 'run-private', relationship: 'generated_by' },
        artifact_id: 'artifact-private',
        extra: {
          observation: {
            source: 'human',
            severity: 'info',
            summary: 'Private artifact ids and object refs should not leak.',
            observed_at: later,
            links: [
              { object_type: 'release', object_id: 'release-1', relationship: 'observed' },
              { object_type: 'execution_package', object_id: 'package-1', relationship: 'observed' },
            ],
          },
        },
      },
      artifact: {
        id: 'artifact-private',
        ref: {
          kind: 'raw_metadata',
          name: 'raw-metadata.json',
          content_type: 'application/json',
          storage_uri: 'https://evidence.example.test/raw.json?token=secret',
          raw_ref: 'local:///Users/viv/private/raw.json',
        } as Artifact['ref'] & { raw_ref: string },
      },
    });
    await repo.saveRunSession(runSession({ id: 'run-private', created_at: latest, updated_at: latest }));

    const cockpit = await getReleaseCockpit(repo, 'release-1');

    expect(cockpit?.evidences[0]).not.toHaveProperty('artifact');
    expect(cockpit?.evidences[0]).not.toHaveProperty('artifact_id');
    expect(cockpit?.evidences[0]).not.toHaveProperty('object_ref');
    expect(cockpit?.blockers.map((item) => item.code)).toContain('unsafe_or_redacted_evidence_backlink');
  });

  it('treats decisions on selected release graph objects as public backlinks', async () => {
    const repo = new InMemoryDeliveryRepository();
    await seedReadyRelease(repo, {
      evidence: {
        extra: {
          observation: {
            source: 'human',
            severity: 'info',
            summary: 'Selected review decision supports release readiness.',
            observed_at: later,
            links: [
              { object_type: 'release', object_id: 'release-1', relationship: 'observed' },
              { object_type: 'decision', object_id: 'decision-artifact', relationship: 'supports' },
              { object_type: 'decision', object_id: 'decision-review-packet', relationship: 'supports' },
            ],
          },
        },
      },
    });
    await repo.saveDecision(
      decision({
        id: 'decision-artifact',
        object_type: 'artifact',
        object_id: 'artifact-1',
      }),
    );
    await repo.saveDecision(
      decision({
        id: 'decision-review-packet',
        object_type: 'review_packet',
        object_id: 'review-1',
      }),
    );

    const cockpit = await getReleaseCockpit(repo, 'release-1');

    expect(cockpit?.observations[0]?.extra.observation?.links).toEqual([
      { object_type: 'release', object_id: 'release-1', relationship: 'observed' },
      { object_type: 'decision', object_id: 'decision-artifact', relationship: 'supports' },
      { object_type: 'decision', object_id: 'decision-review-packet', relationship: 'supports' },
    ]);
    expect(cockpit?.blockers.map((item) => item.code)).not.toContain('unsafe_or_redacted_evidence_backlink');
    expect(cockpit?.decisions.map((item) => item.id)).toEqual(['decision-1']);
  });

  it('selects fallback run sessions by creation time and requires exact public artifact refs', async () => {
    const repo = new InMemoryDeliveryRepository();
    const packageWithoutRunPointers = executionPackage();
    delete packageWithoutRunPointers.current_run_session_id;
    delete packageWithoutRunPointers.last_run_session_id;
    await seedReadyRelease(repo, {
      execution_package: packageWithoutRunPointers,
      run_session: {
        id: 'run-old-touch',
        created_at: now,
        updated_at: latest,
      },
      review_packet: {
        id: 'review-new-created',
        run_session_id: 'run-new-created',
      },
      release: {
        current_run_session_ids: [],
        current_review_packet_ids: [],
      },
      evidence: {
        artifact_id: 'artifact-stale',
        extra: {
          observation: {
            source: 'human',
            severity: 'info',
            summary: 'Release links to a stale artifact id.',
            observed_at: later,
            links: [
              { object_type: 'release', object_id: 'release-1', relationship: 'observed' },
              { object_type: 'execution_package', object_id: 'package-1', relationship: 'observed' },
              { object_type: 'artifact', object_id: 'artifact-1', relationship: 'generated_by' },
            ],
          },
        },
      },
      artifact: {
        id: 'artifact-1',
      },
    });
    await repo.saveRunSession(
      runSession({
        id: 'run-new-created',
        created_at: later,
        updated_at: now,
      }),
    );

    const cockpit = await getReleaseCockpit(repo, 'release-1');

    expect(cockpit?.latest_run_sessions.map((item) => item.id)).toEqual(['run-new-created']);
    expect(cockpit?.observations[0]?.extra.observation?.links).toEqual([
      { object_type: 'release', object_id: 'release-1', relationship: 'observed' },
      { object_type: 'execution_package', object_id: 'package-1', relationship: 'observed' },
    ]);
    expect(cockpit?.evidences[0]).not.toHaveProperty('artifact');
    expect(cockpit?.evidences[0]).not.toHaveProperty('artifact_id');
    expect(cockpit?.blockers.map((item) => item.code)).toContain('unsafe_or_redacted_evidence_backlink');
  });

  it('resolves stale stored scope links to valid same-project public ids and reports invalid links', async () => {
    const repo = new InMemoryDeliveryRepository();
    await repo.saveProject(project());
    await repo.saveProject(project({ id: 'project-2', key: 'P2', name: 'Other Project' }));

    await repo.saveWorkItem(workItem());
    await repo.saveWorkItem(workItem({ id: 'work-item-archived', archived_at: later }));
    await repo.saveWorkItem(workItem({ id: 'work-item-deleted', deleted_at: later }));
    await repo.saveWorkItem(workItem({ id: 'work-item-cross-project', project_id: 'project-2' }));

    await repo.saveExecutionPackage(executionPackage());
    await repo.saveExecutionPackage(executionPackage({ id: 'package-archived', archived_at: later }));
    await repo.saveExecutionPackage(executionPackage({ id: 'package-deleted', deleted_at: later }));
    await repo.saveExecutionPackage(executionPackage({ id: 'package-cross-project', project_id: 'project-2' }));

    await repo.saveRunSession(runSession());
    await repo.saveReviewPacket(reviewPacket());
    await repo.saveRelease(
      release({
        work_item_ids: [
          'work-item-1',
          'work-item-archived',
          'work-item-deleted',
          'work-item-cross-project',
          'work-item-missing',
        ],
        execution_package_ids: [
          'package-1',
          'package-archived',
          'package-deleted',
          'package-cross-project',
          'package-missing',
        ],
      }),
    );
    await repo.saveReleaseEvidence(observationEvidence());
    await repo.saveArtifact(artifact());

    const cockpit = await getReleaseCockpit(repo, 'release-1');

    expect(cockpit?.release.work_item_ids).toEqual(['work-item-1']);
    expect(cockpit?.release.execution_package_ids).toEqual(['package-1']);
    expect(cockpit?.work_items.map((item) => item.id)).toEqual(['work-item-1']);
    expect(cockpit?.execution_packages.map((item) => item.id)).toEqual(['package-1']);
    expect(cockpit?.blockers.map((item) => item.code)).toEqual(
      expect.arrayContaining(['missing_work_item', 'missing_execution_package']),
    );

    await repo.saveRelease(
      release({
        id: 'release-empty',
        work_item_ids: ['work-item-missing'],
        execution_package_ids: ['package-missing'],
      }),
    );

    const emptyCockpit = await getReleaseCockpit(repo, 'release-empty');

    expect(emptyCockpit?.release.work_item_ids).toEqual([]);
    expect(emptyCockpit?.release.execution_package_ids).toEqual([]);
    expect(emptyCockpit?.blockers.map((item) => item.code)).toEqual(
      expect.arrayContaining(['empty_work_item_scope', 'empty_execution_package_scope']),
    );
  });
});
