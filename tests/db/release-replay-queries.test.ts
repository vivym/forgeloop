import { describe, expect, it } from 'vitest';
import type {
  Artifact,
  Decision,
  ExecutionPackage,
  ObjectEvent,
  Project,
  Release,
  ReleaseEvidence,
  ReviewPacket,
  RunSession,
  StatusHistory,
  WorkItem,
} from '@forgeloop/domain';

import { getObjectReplayTimeline, InMemoryDeliveryRepository, type DeliveryRepository } from '../../packages/db/src/index';

const now = '2026-05-11T00:00:00.000Z';
const later = '2026-05-11T00:01:00.000Z';
const latest = '2026-05-11T00:02:00.000Z';

const publicArtifactRef = {
  kind: 'execution_summary',
  name: 'Release summary',
  content_type: 'text/markdown',
  storage_uri: 'https://evidence.example.test/release-summary.md',
  local_ref: '/Users/viv/private/release-summary.md',
  digest: 'sha256:1234',
} as const;

const project = (): Project => ({
  id: 'project-1',
  org_id: 'org-1',
  key: 'P1',
  name: 'P1 Release Surface',
  repo_ids: ['repo-1'],
  owner_actor_id: 'actor-owner',
  created_at: now,
  updated_at: now,
});

const workItem = (): WorkItem => ({
  id: 'work-item-1',
  project_id: 'project-1',
  kind: 'requirement',
  title: 'Ship release replay',
  goal: 'Expose public release replay.',
  success_criteria: ['Release replay is public safe.'],
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
});

const executionPackage = (): ExecutionPackage => ({
  id: 'package-1',
  work_item_id: 'work-item-1',
  spec_id: 'spec-1',
  spec_revision_id: 'spec-revision-1',
  plan_id: 'plan-1',
  plan_revision_id: 'plan-revision-1',
  project_id: 'project-1',
  repo_id: 'repo-1',
  objective: 'Add release replay query.',
  owner_actor_id: 'actor-owner',
  reviewer_actor_id: 'actor-reviewer',
  qa_owner_actor_id: 'actor-qa',
  phase: 'release',
  activity_state: 'idle',
  gate_state: 'release_ready',
  resolution: 'completed',
  required_checks: [],
  required_artifact_kinds: ['execution_summary'],
  allowed_paths: ['/Users/viv/projs/forgeloop/private'],
  forbidden_paths: ['secrets/**'],
  last_run_session_id: 'run-1',
  current_run_session_id: 'run-1',
  current_review_packet_id: 'review-1',
  current_release_id: 'release-1',
  integration_readiness: {
    summary: 'Ready.',
    raw_metadata: { token: 'do-not-leak' },
  },
  created_at: now,
  updated_at: later,
});

const runSession = (): RunSession => ({
  id: 'run-1',
  execution_package_id: 'package-1',
  requested_by_actor_id: 'actor-owner',
  status: 'succeeded',
  executor_type: 'codex',
  changed_files: [{ path: 'packages/db/src/queries/replay-queries.ts', status: 'modified' }],
  check_results: [{ check_id: 'unit', status: 'succeeded', blocks_review: true, summary: 'Passed.' }],
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
});

const reviewPacket = (): ReviewPacket => ({
  id: 'review-1',
  run_session_id: 'run-1',
  execution_package_id: 'package-1',
  reviewer_actor_id: 'actor-reviewer',
  spec_revision_id: 'spec-revision-1',
  plan_revision_id: 'plan-revision-1',
  status: 'completed',
  decision: 'approved',
  summary: 'Approved.',
  changed_files: [{ path: 'packages/db/src/queries/replay-queries.ts', status: 'modified' }],
  check_result_summary: 'All checks passed.',
  self_review: { summary: 'Ready.', raw_payload: { path: '/Users/viv/private' } } as ReviewPacket['self_review'] & {
    raw_payload: Record<string, unknown>;
  },
  risk_notes: [],
  requested_changes: [],
  reviewed_by_actor_id: 'actor-reviewer',
  reviewed_at: later,
  created_at: now,
  updated_at: later,
  completed_at: later,
});

const release = (): Release => ({
  id: 'release-1',
  org_id: 'org-1',
  project_id: 'project-1',
  key: 'REL-1',
  title: 'P1 Release Replay',
  scope_summary: 'Ship release replay safely.',
  phase: 'rollout',
  activity_state: 'idle',
  gate_state: 'approved',
  resolution: 'none',
  work_item_ids: ['work-item-1'],
  execution_package_ids: ['package-1'],
  current_review_packet_ids: ['review-1'],
  current_run_session_ids: ['run-1'],
  rollout_strategy: 'Roll out to owners first.',
  rollback_plan: 'Revert the release flag.',
  observation_plan: 'Watch replay safety.',
  release_owner_actor_id: 'actor-owner',
  release_type: 'normal',
  extra: {
    raw_extra: { local_path: '/Users/viv/private' },
  },
  created_by_actor_id: 'actor-owner',
  updated_by_actor_id: 'actor-owner',
  created_at: now,
  updated_at: later,
});

const releaseEvidence = (): ReleaseEvidence => ({
  id: 'evidence-1',
  org_id: 'org-1',
  project_id: 'project-1',
  release_id: 'release-1',
  evidence_type: 'observation_note',
  summary: 'Release looks healthy.',
  object_ref: { object_type: 'run_session', object_id: 'run-private', relationship: 'generated_by' },
  artifact_id: 'artifact-stale',
  extra: {
    observation: {
      source: 'human',
      severity: 'info',
      summary: 'Public observation.',
      observed_at: later,
      links: [
        { object_type: 'release', object_id: 'release-1', relationship: 'observed' },
        { object_type: 'execution_package', object_id: 'package-1', relationship: 'observed' },
        { object_type: 'artifact', object_id: 'artifact-1', relationship: 'generated_by' },
        { object_type: 'artifact', object_id: 'artifact-stale', relationship: 'generated_by' },
        { object_type: 'decision', object_id: 'decision-release', relationship: 'supports' },
        { object_type: 'decision', object_id: 'decision-review_packet', relationship: 'supports' },
        { object_type: 'decision', object_id: 'decision-stale-review', relationship: 'supports' },
        { object_type: 'run_session', object_id: 'run-private', relationship: 'generated_by' },
      ],
      metrics: { errors: 0, client_secret: 'do-not-leak' },
      notes: 'Public note.',
      raw_payload: { local_path: '/Users/viv/private' },
    },
  },
  redacted: false,
  status: 'current',
  created_at: later,
  created_by_actor_id: 'actor-owner',
});

const artifact = (): Artifact => ({
  id: 'artifact-1',
  object_type: 'release_evidence',
  object_id: 'evidence-1',
  artifact_type: 'execution_summary',
  ref: publicArtifactRef,
  created_at: later,
});

const exactPublicArtifact = (): Artifact => ({
  id: 'artifact-exact-public',
  object_type: 'release_evidence',
  object_id: 'evidence-artifact-decision',
  artifact_type: 'execution_summary',
  ref: {
    ...publicArtifactRef,
    name: 'exact-public-artifact.md',
    storage_uri: 'https://evidence.example.test/exact-public-artifact.md',
  },
  created_at: later,
});

const unsafeArtifact = (): Artifact => ({
  id: 'artifact-unsafe',
  object_type: 'release_evidence',
  object_id: 'evidence-private-artifact',
  artifact_type: 'raw_metadata',
  ref: {
    kind: 'raw_metadata',
    name: 'Unsafe raw metadata',
    content_type: 'application/json',
    storage_uri: 'https://evidence.example.test/raw.json?token=secret',
    raw_ref: 'local:///Users/viv/private/raw.json',
  } as Artifact['ref'] & { raw_ref: string },
  created_at: latest,
});

const decision = (object_type: string, object_id: string, id = `decision-${object_type}`): Decision => ({
  id,
  object_type,
  object_id,
  actor_id: 'actor-owner',
  decided_by_actor_id: 'actor-reviewer',
  decision_type: 'release_approval',
  outcome: 'approved',
  decision: 'approved',
  summary: `${object_type} approved`,
  rationale: 'Ready.',
  evidence_refs: { raw_ref: '/Users/viv/private/evidence.json' },
  created_at: later,
});

const objectEvent = (object_type: string, object_id: string, id = `event-${object_type}`): ObjectEvent => ({
  id,
  object_type,
  object_id,
  event_type: `${object_type}_updated`,
  actor_type: 'system',
  actor_id: 'actor-system',
  reason: 'test',
  payload: {
    release_id: 'release-1',
    work_item_id: object_type === 'work_item' ? object_id : undefined,
    execution_package_id: object_type === 'execution_package' ? object_id : undefined,
    run_session_id: object_type === 'run_session' ? object_id : undefined,
    review_packet_id: object_type === 'review_packet' ? object_id : undefined,
    status: 'updated',
    raw_payload: { token: 'do-not-leak' },
  },
  metadata: {
    allowed_paths: ['/Users/viv/private'],
  },
  created_at: now,
});

const statusHistory = (object_type: string, object_id: string, id = `status-${object_type}`): StatusHistory => ({
  id,
  object_type,
  object_id,
  field_name: 'status',
  from_status: 'pending',
  to_status: 'ready',
  actor_type: 'system',
  actor_id: 'actor-system',
  reason: 'test',
  context: {
    release_id: 'release-1',
    raw_metadata: { token: 'do-not-leak' },
  },
  created_at: later,
});

const seedReleaseReplay = async (repo: DeliveryRepository): Promise<void> => {
  await repo.saveProject(project());
  await repo.saveWorkItem(workItem());
  await repo.saveExecutionPackage(executionPackage());
  await repo.saveRunSession(runSession());
  await repo.saveRunSession({ ...runSession(), id: 'run-private', created_at: latest, updated_at: latest });
  await repo.saveReviewPacket(reviewPacket());
  await repo.saveReviewPacket({ ...reviewPacket(), id: 'review-stale', run_session_id: 'run-private' });
  await repo.saveRelease(release());
  await repo.saveReleaseEvidence(releaseEvidence());
  await repo.saveReleaseEvidence({
    ...releaseEvidence(),
    id: 'evidence-artifact-decision',
    summary: 'Public artifact decision should remain visible.',
    object_ref: { object_type: 'release', object_id: 'release-1', relationship: 'observed' },
    artifact_id: 'artifact-exact-public',
    extra: {
      observation: {
        source: 'human',
        severity: 'info',
        summary: 'The public artifact decision supports release replay.',
        observed_at: later,
        links: [
          { object_type: 'release', object_id: 'release-1', relationship: 'observed' },
          { object_type: 'artifact', object_id: 'artifact-exact-public', relationship: 'generated_by' },
          { object_type: 'decision', object_id: 'decision-artifact-exact', relationship: 'supports' },
        ],
      },
    },
  });
  await repo.saveReleaseEvidence({
    ...releaseEvidence(),
    id: 'evidence-private-artifact',
    summary: 'Private exact artifact id should not leak.',
    object_ref: { object_type: 'run_session', object_id: 'run-private', relationship: 'generated_by' },
    artifact_id: 'artifact-unsafe',
    extra: {
      observation: {
        source: 'human',
        severity: 'warning',
        summary: 'Private exact artifact id and object ref should be filtered.',
        observed_at: later,
        links: [
          { object_type: 'release', object_id: 'release-1', relationship: 'observed' },
          { object_type: 'execution_package', object_id: 'package-1', relationship: 'observed' },
        ],
      },
    },
  });
  await repo.saveArtifact(artifact());
  await repo.saveArtifact(exactPublicArtifact());
  await repo.saveArtifact(unsafeArtifact());

  for (const [object_type, object_id] of [
    ['release', 'release-1'],
    ['work_item', 'work-item-1'],
    ['execution_package', 'package-1'],
    ['run_session', 'run-1'],
    ['review_packet', 'review-1'],
  ] as const) {
    await repo.appendObjectEvent(objectEvent(object_type, object_id));
    await repo.appendStatusHistory(statusHistory(object_type, object_id));
    await repo.saveDecision(decision(object_type, object_id));
  }
  await repo.saveDecision(decision('review_packet', 'review-stale', 'decision-stale-review'));
  await repo.saveDecision(decision('artifact', 'artifact-exact-public', 'decision-artifact-exact'));
};

describe('getObjectReplayTimeline release support', () => {
  it('returns release and linked object replay entries through the public serializer', async () => {
    const repo = new InMemoryDeliveryRepository();
    await seedReleaseReplay(repo);

    const timeline = await getObjectReplayTimeline(repo, 'release', 'release-1');

    expect(timeline).toBeDefined();
    expect(timeline?.map((entry) => entry.created_at)).toEqual(
      [...(timeline ?? [])].map((entry) => entry.created_at).sort((left, right) => left.localeCompare(right)),
    );
    expect(timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'object_event', object_type: 'release', object_id: 'release-1' }),
        expect.objectContaining({ source: 'status_history', object_type: 'release', object_id: 'release-1' }),
        expect.objectContaining({ source: 'decision', object_type: 'release', object_id: 'release-1' }),
        expect.objectContaining({ source: 'release_evidence', object_type: 'release', object_id: 'release-1' }),
        expect.objectContaining({ source: 'object_event', object_type: 'work_item', object_id: 'work-item-1' }),
        expect.objectContaining({ source: 'status_history', object_type: 'execution_package', object_id: 'package-1' }),
        expect.objectContaining({ source: 'decision', object_type: 'execution_package', object_id: 'package-1' }),
        expect.objectContaining({ source: 'object_event', object_type: 'run_session', object_id: 'run-1' }),
        expect.objectContaining({ source: 'status_history', object_type: 'review_packet', object_id: 'review-1' }),
        expect.objectContaining({ source: 'decision', object_type: 'review_packet', object_id: 'review-1' }),
      ]),
    );

    const evidenceEntry = timeline?.find((entry) => entry.source === 'release_evidence');
    expect(evidenceEntry?.payload).toMatchObject({
      id: 'evidence-1',
      extra: {
        observation: {
          links: [
            { object_type: 'release', object_id: 'release-1', relationship: 'observed' },
            { object_type: 'execution_package', object_id: 'package-1', relationship: 'observed' },
            { object_type: 'decision', object_id: 'decision-release', relationship: 'supports' },
            { object_type: 'decision', object_id: 'decision-review_packet', relationship: 'supports' },
          ],
        },
      },
    });
    expect(evidenceEntry?.payload).not.toHaveProperty('object_ref');
    expect(evidenceEntry?.payload).not.toHaveProperty('artifact');
    expect(evidenceEntry?.payload).not.toHaveProperty('artifact_id');
    expect(evidenceEntry?.payload).not.toMatchObject({ artifact_id: 'artifact-stale' });
    expect(evidenceEntry?.payload.extra.observation?.links).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ object_id: 'run-private' })]),
    );
    expect(evidenceEntry?.payload.extra.observation?.links).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ object_id: 'artifact-stale' })]),
    );
    expect(evidenceEntry?.payload.extra.observation?.links).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ object_id: 'decision-stale-review' })]),
    );
    const exactArtifactEvidenceEntry = timeline?.find((entry) => entry.id === 'evidence-artifact-decision');
    expect(exactArtifactEvidenceEntry?.payload).toMatchObject({
      artifact_id: 'artifact-exact-public',
      extra: {
        observation: {
          links: [
            { object_type: 'release', object_id: 'release-1', relationship: 'observed' },
            { object_type: 'artifact', object_id: 'artifact-exact-public', relationship: 'generated_by' },
            { object_type: 'decision', object_id: 'decision-artifact-exact', relationship: 'supports' },
          ],
        },
      },
    });
    const privateArtifactEvidenceEntry = timeline?.find((entry) => entry.id === 'evidence-private-artifact');
    expect(privateArtifactEvidenceEntry?.payload).not.toHaveProperty('artifact');
    expect(privateArtifactEvidenceEntry?.payload).not.toHaveProperty('artifact_id');
    expect(privateArtifactEvidenceEntry?.payload).not.toHaveProperty('object_ref');

    const serialized = JSON.stringify(timeline);
    for (const unsafeText of [
      'allowed_paths',
      'forbidden_paths',
      'raw_payload',
      'raw_metadata',
      'runtime_metadata',
      'review_payload',
      'evidence_refs',
      'raw_ref',
      'raw_extra',
      'token=',
      '/Users/',
      'client_secret',
      'accessToken',
    ]) {
      expect(serialized).not.toContain(unsafeText);
    }
    expect(serialized).toContain('links');
    expect(serialized).toContain('unsafe_or_redacted_evidence_backlink');
    expect(timeline).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'artifact-unsafe' })]));
  });

  it('returns undefined for a missing release', async () => {
    const repo = new InMemoryDeliveryRepository();

    await expect(getObjectReplayTimeline(repo, 'release', 'missing-release')).resolves.toBeUndefined();
  });
});
