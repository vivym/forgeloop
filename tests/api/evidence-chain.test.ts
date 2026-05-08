import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';

import { evidenceChainResponseSchema } from '@forgeloop/contracts';

import {
  seedEvidenceChainBase,
  seedEvidenceChainScenario,
  succeededSelfReview,
} from '../helpers/p0-runtime-fixtures';

describe('evidence chain API', () => {
  const apps: INestApplication[] = [];
  const track = async <T extends { app: INestApplication }>(value: Promise<T>): Promise<T> => {
    const resolved = await value;
    apps.push(resolved.app);
    return resolved;
  };

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('projects current evidence with trace supersession, redaction, gaps, and risk summary', async () => {
    const { app, workItemId, currentReviewPacketId, changesRequestedReviewPacketId, unlinkedReviewPacketId } = await track(
      seedEvidenceChainScenario(),
    );

    const response = await request(app.getHttpServer()).get(`/work-items/${workItemId}/evidence-chain`).expect(200);
    const chain = evidenceChainResponseSchema.parse(response.body);

    expect(chain.focus).toEqual({ selection: 'current', review_packet_ids: [currentReviewPacketId] });
    expect(chain.projection).toMatchObject({
      source: 'mixed',
      partial: true,
      gaps: expect.arrayContaining(['missing_supersession_links', 'missing_trace_artifact_refs']),
    });
    expect(chain.summary.total_items).toBe(chain.items.length);
    expect(chain.summary).toMatchObject({
      run_count: 3,
      review_packet_count: 3,
      decision_count: 2,
    });
    expect(chain.summary.redacted_count).toBeGreaterThanOrEqual(3);
    expect(chain.summary.artifact_count).toBeGreaterThanOrEqual(4);
    expect(chain.summary.risk_flags).toEqual(
      expect.arrayContaining([
        'missing_required_artifact',
        'redacted_evidence',
        'superseded_run',
        'stale_review_packet',
        'changes_requested',
        'unapproved_review_packet',
        'projection_partial',
      ]),
    );

    const currentRunIndex = chain.items.findIndex(
      (item) => item.subject.object_type === 'run_session' && item.subject.object_id === 'run-session-approved',
    );
    const supersededRunIndex = chain.items.findIndex(
      (item) => item.subject.object_type === 'run_session' && item.subject.object_id === 'run-session-changes-requested',
    );
    expect(currentRunIndex).toBeGreaterThanOrEqual(0);
    expect(supersededRunIndex).toBeGreaterThanOrEqual(0);
    expect(currentRunIndex).toBeLessThan(supersededRunIndex);

    const supersededPacket = chain.items.find((item) => item.subject.object_id === changesRequestedReviewPacketId);
    expect(supersededPacket?.risk_flags).toEqual(expect.arrayContaining(['changes_requested', 'stale_review_packet']));

    const unlinkedPacket = chain.items.find((item) => item.subject.object_id === unlinkedReviewPacketId);
    expect(unlinkedPacket?.risk_flags).toContain('unapproved_review_packet');
    expect(unlinkedPacket?.risk_flags).toContain('stale_review_packet');
    const unlinkedRun = chain.items.find((item) => item.id === 'evidence-item:run-session:run-session-unlinked-history');
    expect(unlinkedRun?.risk_flags).not.toContain('superseded_run');

    const missingArtifactItem = chain.items.find((item) => item.risk_flags.includes('missing_required_artifact'));
    expect(missingArtifactItem?.details?.missing_artifact_kinds).toContain('diff');
    expect(missingArtifactItem?.details?.missing_artifact_kinds ?? []).not.toContain('logs');
    expect(chain.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          redacted: true,
          details: expect.objectContaining({ redaction_reason: 'local_ref_only' }),
        }),
      ]),
    );

    const serialized = JSON.stringify(chain);
    expect(serialized).not.toContain('artifacts/run-session-approved/summary.md');
    expect(serialized).not.toContain('raw-codex.jsonl');
    expect(serialized).not.toContain('raw_ref');
    expect(serialized).not.toContain('secret command output');
    expect(serialized).not.toContain('local://raw-command-output.jsonl');

    const runSessionResponse = await request(app.getHttpServer()).get('/run-sessions/run-session-approved').expect(200);
    expect(JSON.stringify(runSessionResponse.body)).not.toContain('local_ref');
    expect(JSON.stringify(runSessionResponse.body)).not.toContain('artifacts/run-session-approved/summary.md');
  });

  it('scopes explicit review packet focus and rejects packets outside the work item', async () => {
    const { app, repo, workItemId, currentReviewPacketId, changesRequestedReviewPacketId, executionPackageId } = await track(
      seedEvidenceChainScenario(),
    );

    const explicitResponse = await request(app.getHttpServer())
      .get(`/work-items/${workItemId}/evidence-chain`)
      .query({ review_packet_id: changesRequestedReviewPacketId })
      .expect(200);
    const explicitChain = evidenceChainResponseSchema.parse(explicitResponse.body);
    expect(explicitChain.focus).toEqual({ selection: 'explicit', review_packet_ids: [changesRequestedReviewPacketId] });
    expect(explicitChain.items.some((item) => item.subject.object_id === changesRequestedReviewPacketId)).toBe(true);
    expect(explicitChain.items.some((item) => item.subject.object_id === currentReviewPacketId)).toBe(true);

    const workItem = await repo.getWorkItem(workItemId);
    const executionPackage = await repo.getExecutionPackage(executionPackageId);
    await repo.saveWorkItem({ ...workItem!, id: 'work-item-outside' });
    await repo.saveExecutionPackage({ ...executionPackage!, id: 'execution-package-outside', work_item_id: 'work-item-outside' });
    await repo.saveRunSession({
      id: 'run-session-outside',
      execution_package_id: 'execution-package-outside',
      requested_by_actor_id: 'actor-owner',
      status: 'succeeded',
      executor_type: 'mock',
      changed_files: [],
      check_results: [],
      artifacts: [],
      log_refs: [],
      created_at: '2026-05-05T00:06:00.000Z',
      updated_at: '2026-05-05T00:06:00.000Z',
      finished_at: '2026-05-05T00:06:00.000Z',
    });
    await repo.saveReviewPacket({
      id: 'review-packet-outside',
      run_session_id: 'run-session-outside',
      execution_package_id: 'execution-package-outside',
      reviewer_actor_id: 'actor-reviewer',
      spec_revision_id: executionPackage!.spec_revision_id,
      plan_revision_id: executionPackage!.plan_revision_id,
      status: 'ready',
      decision: 'none',
      changed_files: [],
      check_result_summary: 'No checks.',
      self_review: succeededSelfReview(),
      risk_notes: [],
      requested_changes: [],
      created_at: '2026-05-05T00:06:00.000Z',
      updated_at: '2026-05-05T00:06:00.000Z',
    });

    await request(app.getHttpServer())
      .get(`/work-items/${workItemId}/evidence-chain`)
      .query({ review_packet_id: 'review-packet-outside' })
      .expect(404);
  });

  it('does not treat terminal trace links as supersession coverage', async () => {
    const { app, repo, workItemId } = await track(seedEvidenceChainScenario());
    await repo.saveTraceEvent({
      id: 'trace-event-unlinked-terminal',
      event_type: 'run_terminal_evidence_recorded',
      subject_type: 'run_session',
      subject_id: 'run-session-unlinked-history',
      actor_id: 'actor-owner',
      summary: 'Terminal evidence recorded for unlinked historical run.',
      payload: { run_session_id: 'run-session-unlinked-history' },
      created_at: '2026-05-05T00:03:30.000Z',
    });
    await repo.saveTraceLink({
      id: 'trace-link-unlinked-terminal-generated-by',
      trace_event_id: 'trace-event-unlinked-terminal',
      relationship: 'generated_by',
      object_type: 'run_session',
      object_id: 'run-session-unlinked-history',
      created_at: '2026-05-05T00:03:30.000Z',
    });

    const response = await request(app.getHttpServer()).get(`/work-items/${workItemId}/evidence-chain`).expect(200);
    const chain = evidenceChainResponseSchema.parse(response.body);
    const unlinkedRun = chain.items.find((item) => item.id === 'evidence-item:run-session:run-session-unlinked-history');

    expect(chain.projection.partial).toBe(true);
    expect(chain.projection.gaps).toContain('missing_supersession_links');
    expect(unlinkedRun?.risk_flags).not.toContain('superseded_run');
  });

  it('limits explicit focus to the selected packet and persisted replacement relations', async () => {
    const {
      app,
      repo,
      workItemId,
      executionPackageId,
      currentReviewPacketId,
      changesRequestedReviewPacketId,
      unlinkedReviewPacketId,
    } = await track(seedEvidenceChainScenario());
    await repo.saveTraceEvent({
      id: 'trace-event:run-replacement:run-session-approved',
      event_type: 'run_replacement_recorded',
      subject_type: 'run_session',
      subject_id: 'run-session-approved',
      actor_id: 'actor-owner',
      summary: 'Run run-session-approved replaces run-session-changes-requested.',
      payload: {
        mode: 'rerun_package',
        execution_package_id: executionPackageId,
        work_item_id: workItemId,
        new_run_session_id: 'run-session-approved',
        previous_run_session_id: 'run-session-changes-requested',
        previous_review_packet_id: changesRequestedReviewPacketId,
        new_review_packet_id: currentReviewPacketId,
        triggering_review_packet_id: unlinkedReviewPacketId,
      },
      created_at: '2026-05-05T00:04:00.000Z',
    });

    const response = await request(app.getHttpServer())
      .get(`/work-items/${workItemId}/evidence-chain`)
      .query({ review_packet_id: currentReviewPacketId })
      .expect(200);
    const chain = evidenceChainResponseSchema.parse(response.body);
    const itemIds = chain.items.map((item) => item.id);
    const subjectIds = chain.items.map((item) => item.subject.object_id);

    expect(chain.focus).toEqual({ selection: 'explicit', review_packet_ids: [currentReviewPacketId] });
    expect(subjectIds).toContain(currentReviewPacketId);
    expect(subjectIds).toContain(changesRequestedReviewPacketId);
    expect(subjectIds).not.toContain(unlinkedReviewPacketId);
    expect(itemIds).not.toContain('evidence-item:run-session:run-session-unlinked-history');
    expect(itemIds).not.toContain('evidence-item:review-packet:review-packet-unlinked-history');
  });

  it('reports partial empty current projection for a work item with no review evidence', async () => {
    const { app, records } = await track(seedEvidenceChainBase());

    const response = await request(app.getHttpServer()).get(`/work-items/${records.workItem.id}/evidence-chain`).expect(200);
    const chain = evidenceChainResponseSchema.parse(response.body);

    expect(chain.focus).toEqual({ selection: 'current', review_packet_ids: [] });
    expect(chain.projection).toMatchObject({
      source: 'read_time',
      partial: true,
      gaps: expect.arrayContaining(['missing_last_run_session', 'missing_trace_events']),
    });
    expect(chain.summary).toMatchObject({
      total_items: 0,
      run_count: 0,
      review_packet_count: 0,
      decision_count: 0,
      artifact_count: 0,
      redacted_count: 0,
    });
    expect(chain.summary.risk_flags).toEqual(expect.arrayContaining(['no_evidence', 'projection_partial']));
  });

  it('scopes current required artifact and check risks to the selected run only', async () => {
    const { app, repo, workItemId, executionPackageId } = await track(seedEvidenceChainScenario());
    const executionPackage = await repo.getExecutionPackage(executionPackageId);
    const currentRun = await repo.getRunSession('run-session-approved');

    await repo.saveRunSession({
      ...currentRun!,
      artifacts: [
        ...currentRun!.artifacts,
        {
          kind: 'diff',
          name: 'Diff',
          content_type: 'text/x-patch',
          local_ref: 'artifacts/run-session-approved/diff.patch',
        },
      ],
    });
    await repo.saveExecutionPackage({
      ...executionPackage!,
      required_artifact_kinds: ['execution_summary', 'logs', 'diff'],
    });

    const response = await request(app.getHttpServer()).get(`/work-items/${workItemId}/evidence-chain`).expect(200);
    const chain = evidenceChainResponseSchema.parse(response.body);

    expect(chain.summary.risk_flags).not.toContain('missing_required_artifact');
    expect(chain.summary.risk_flags).not.toContain('failed_required_check');
    expect(chain.items.some((item) => item.risk_flags.includes('missing_required_artifact'))).toBe(false);
    expect(chain.items.some((item) => item.risk_flags.includes('failed_required_check'))).toBe(false);
  });

  it('scopes explicit required artifact risk to the explicit packet run', async () => {
    const { app, repo, workItemId, executionPackageId, changesRequestedReviewPacketId } = await track(seedEvidenceChainScenario());
    const executionPackage = await repo.getExecutionPackage(executionPackageId);
    const explicitRun = await repo.getRunSession('run-session-changes-requested');

    await repo.saveRunSession({
      ...explicitRun!,
      artifacts: [
        ...explicitRun!.artifacts,
        {
          kind: 'diff',
          name: 'Diff',
          content_type: 'text/x-patch',
          local_ref: 'artifacts/run-session-changes-requested/diff.patch',
        },
      ],
    });
    await repo.saveExecutionPackage({
      ...executionPackage!,
      required_artifact_kinds: ['execution_summary', 'logs', 'diff'],
    });

    const response = await request(app.getHttpServer())
      .get(`/work-items/${workItemId}/evidence-chain`)
      .query({ review_packet_id: changesRequestedReviewPacketId })
      .expect(200);
    const chain = evidenceChainResponseSchema.parse(response.body);

    expect(chain.focus).toEqual({ selection: 'explicit', review_packet_ids: [changesRequestedReviewPacketId] });
    expect(chain.summary.risk_flags).not.toContain('missing_required_artifact');
    expect(chain.items.some((item) => item.risk_flags.includes('missing_required_artifact'))).toBe(false);
  });

  it('requires logs artifact presence from log refs rather than run artifacts', async () => {
    const { app, repo, workItemId, executionPackageId } = await track(seedEvidenceChainScenario());
    const executionPackage = await repo.getExecutionPackage(executionPackageId);
    const currentRun = await repo.getRunSession('run-session-approved');

    await repo.saveExecutionPackage({
      ...executionPackage!,
      required_artifact_kinds: ['logs'],
    });
    await repo.saveRunSession({
      ...currentRun!,
      log_refs: [],
      artifacts: [
        ...currentRun!.artifacts,
        {
          kind: 'logs',
          name: 'Logs stored in the wrong collection',
          content_type: 'application/jsonl',
          storage_uri: 's3://forgeloop-test/logs.jsonl',
        },
      ],
    });

    const response = await request(app.getHttpServer()).get(`/work-items/${workItemId}/evidence-chain`).expect(200);
    const chain = evidenceChainResponseSchema.parse(response.body);
    const missingArtifactItem = chain.items.find((item) => item.id === 'evidence-item:missing-artifacts:run-session-approved');

    expect(chain.summary.risk_flags).toContain('missing_required_artifact');
    expect(missingArtifactItem?.details?.missing_artifact_kinds).toEqual(['logs']);
  });

  it('flags missing required blocking check results on the selected run', async () => {
    const { app, repo, workItemId, executionPackageId } = await track(seedEvidenceChainScenario());
    const executionPackage = await repo.getExecutionPackage(executionPackageId);
    const unlinkedRun = await repo.getRunSession('run-session-unlinked-history');

    await repo.saveExecutionPackage({
      ...executionPackage!,
      required_checks: [
        ...executionPackage!.required_checks,
        {
          check_id: 'contracts',
          display_name: 'Contracts',
          command: 'pnpm test tests/contracts',
          timeout_seconds: 120,
          blocks_review: true,
        },
      ],
    });
    await repo.saveRunSession({
      ...unlinkedRun!,
      check_results: [],
    });

    const response = await request(app.getHttpServer()).get(`/work-items/${workItemId}/evidence-chain`).expect(200);
    const chain = evidenceChainResponseSchema.parse(response.body);
    const currentRunItem = chain.items.find((item) => item.id === 'evidence-item:run-session:run-session-approved');

    expect(chain.summary.risk_flags).toContain('failed_required_check');
    expect(currentRunItem?.risk_flags).toContain('failed_required_check');
    expect(currentRunItem?.details?.failed_check_ids).toContain('contracts');
  });

  it('includes public lifecycle status history and object events', async () => {
    const { app, repo, workItemId, executionPackageId } = await track(seedEvidenceChainScenario());
    await repo.appendStatusHistory({
      id: 'status-history-evidence-test',
      object_type: 'execution_package',
      object_id: executionPackageId,
      from_status: 'execution/ai_running/none',
      to_status: 'review/awaiting_human/review_approved',
      actor_id: 'actor-owner',
      created_at: '2026-05-05T00:05:45.000Z',
    });
    await repo.appendObjectEvent({
      id: 'object-event-evidence-test',
      object_type: 'execution_package',
      object_id: executionPackageId,
      event_type: 'package_review_completed',
      actor_id: 'actor-reviewer',
      metadata: { internal_payload: 'not public' },
      created_at: '2026-05-05T00:05:46.000Z',
    });

    const response = await request(app.getHttpServer()).get(`/work-items/${workItemId}/evidence-chain`).expect(200);
    const chain = evidenceChainResponseSchema.parse(response.body);

    expect(chain.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'status_history',
          summary: 'execution/ai_running/none -> review/awaiting_human/review_approved',
        }),
        expect.objectContaining({
          source: 'object_event',
          summary: 'package_review_completed',
        }),
      ]),
    );
    expect(JSON.stringify(chain)).not.toContain('internal_payload');
  });

  it('reconstructs public persisted artifact rows without local refs', async () => {
    const { app, repo, workItemId } = await track(seedEvidenceChainScenario());
    await repo.saveArtifact({
      id: 'artifact-public-persisted-diff',
      object_type: 'run_session',
      object_id: 'run-session-approved',
      ref: {
        kind: 'diff',
        name: 'Persisted public diff',
        content_type: 'text/x-patch',
        storage_uri: 's3://forgeloop-test/persisted-diff.patch',
        local_ref: 'artifacts/run-session-approved/persisted-diff.patch',
      },
      created_at: '2026-05-05T00:05:02.000Z',
    });

    const response = await request(app.getHttpServer()).get(`/work-items/${workItemId}/evidence-chain`).expect(200);
    const chain = evidenceChainResponseSchema.parse(response.body);

    expect(chain.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'evidence-item:artifact-record:artifact-public-persisted-diff',
          source: 'artifact',
          subject: expect.objectContaining({
            object_type: 'artifact',
            object_id: 'artifact-public-persisted-diff',
          }),
          summary: 'Artifact diff: Persisted public diff.',
        }),
      ]),
    );
    expect(JSON.stringify(chain)).not.toContain('persisted-diff.patch');
    expect(JSON.stringify(chain)).not.toContain('"local_ref":');
  });

  it('reports mixed projection when trace events are overlaid on read-time records', async () => {
    const { app, repo, records, executionPackage } = await track(seedEvidenceChainBase());
    const runSession = {
      id: 'run-session-traced-current',
      execution_package_id: executionPackage.id,
      requested_by_actor_id: 'actor-owner',
      status: 'succeeded' as const,
      executor_type: 'mock' as const,
      changed_files: [],
      check_results: [],
      artifacts: [],
      log_refs: [],
      summary: 'Trace-backed run completed.',
      created_at: '2026-05-05T00:06:00.000Z',
      updated_at: '2026-05-05T00:06:00.000Z',
      finished_at: '2026-05-05T00:06:00.000Z',
    };
    await repo.saveExecutionPackage({
      ...executionPackage,
      last_run_session_id: runSession.id,
      required_artifact_kinds: [],
      required_checks: [],
    });
    await repo.saveRunSession(runSession);
    await repo.saveReviewPacket({
      id: 'review-packet-traced-current',
      run_session_id: runSession.id,
      execution_package_id: executionPackage.id,
      reviewer_actor_id: executionPackage.reviewer_actor_id,
      spec_revision_id: executionPackage.spec_revision_id,
      plan_revision_id: executionPackage.plan_revision_id,
      status: 'ready',
      decision: 'none',
      changed_files: [],
      check_result_summary: 'No checks.',
      self_review: succeededSelfReview(),
      risk_notes: [],
      requested_changes: [],
      created_at: '2026-05-05T00:06:00.000Z',
      updated_at: '2026-05-05T00:06:00.000Z',
    });
    await repo.saveTraceEvent({
      id: 'trace-event-traced-current',
      event_type: 'run_terminal_evidence_recorded',
      subject_type: 'run_session',
      subject_id: runSession.id,
      actor_id: 'actor-owner',
      summary: 'Trace event for current run.',
      payload: { internal_payload: 'not public' },
      created_at: '2026-05-05T00:06:00.000Z',
    });
    await repo.saveTraceLink({
      id: 'trace-link-traced-current-run',
      trace_event_id: 'trace-event-traced-current',
      relationship: 'generated_by',
      object_type: 'run_session',
      object_id: runSession.id,
      created_at: '2026-05-05T00:06:00.000Z',
    });

    const response = await request(app.getHttpServer()).get(`/work-items/${records.workItem.id}/evidence-chain`).expect(200);
    const chain = evidenceChainResponseSchema.parse(response.body);

    expect(chain.projection.source).toBe('mixed');
    expect(chain.projection.partial).toBe(false);
  });

  it('returns 404 for missing work items', async () => {
    const { app } = await track(seedEvidenceChainBase());

    await request(app.getHttpServer()).get('/work-items/work-item-missing/evidence-chain').expect(404);
  });
});
