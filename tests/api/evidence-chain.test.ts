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
        'failed_required_check',
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
    expect(unlinkedPacket?.risk_flags).not.toContain('stale_review_packet');

    const missingArtifactItem = chain.items.find((item) => item.risk_flags.includes('missing_required_artifact'));
    expect(missingArtifactItem?.details?.missing_artifact_kinds).toContain('diff');
    expect(missingArtifactItem?.details?.missing_artifact_kinds ?? []).not.toContain('logs');

    const serialized = JSON.stringify(chain);
    expect(serialized).not.toContain('raw-codex.jsonl');
    expect(serialized).not.toContain('raw_ref');
    expect(serialized).not.toContain('secret command output');
    expect(serialized).not.toContain('local://raw-command-output.jsonl');
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

  it('returns 404 for missing work items', async () => {
    const { app } = await track(seedEvidenceChainBase());

    await request(app.getHttpServer()).get('/work-items/work-item-missing/evidence-chain').expect(404);
  });
});
