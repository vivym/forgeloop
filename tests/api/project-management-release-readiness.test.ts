import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import type { InMemoryDeliveryRepository } from '../../packages/db/src';
import type { ObjectRef } from '../../packages/contracts/src';
import type { Release, ReleaseEvidence } from '../../packages/domain/src';

const now = '2026-05-23T00:00:00.000Z';
const defaultScopeRefs: ObjectRef[] = [
  { type: 'requirement', id: 'req-1' },
  { type: 'task', id: 'task-1' },
  { type: 'bug', id: 'bug-1' },
];

describe('project management release readiness API', () => {
  let app: INestApplication;
  let repository: InMemoryDeliveryRepository;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    repository = app.get(DELIVERY_REPOSITORY) as InMemoryDeliveryRepository;
  });

  afterEach(async () => {
    await app.close();
  });

  it('blocks release readiness when required review or test acceptance evidence is missing', async () => {
    await seedReleaseScope(repository, {
      release_id: 'release-1',
      scope_refs: defaultScopeRefs,
    });

    const response = await request(app.getHttpServer()).get('/query/releases/release-1/readiness').expect(200);

    expect(response.body.ready).toBe(false);
    expect(response.body.disabled_reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'missing_required_review' }),
        expect.objectContaining({ code: 'missing_required_test_acceptance' }),
      ]),
    );
  });

  it('rejects non-authoritative review evidence and bare attachments', async () => {
    await seedReleaseScopeWithEvidence(repository, {
      release_id: 'release-1',
      review_evidence: [
        { authority_type: 'ai_self_review_approval', scope_ref: { type: 'requirement', id: 'req-1' } },
        { authority_type: 'attachment_only', scope_ref: { type: 'task', id: 'task-1' }, attachment_id: 'att-1' },
      ],
    });

    const response = await request(app.getHttpServer()).get('/query/releases/release-1/readiness').expect(200);

    expect(response.body.ready).toBe(false);
    expect(response.body.disabled_reasons.map((reason: { code: string }) => reason.code)).toEqual(
      expect.arrayContaining(['evidence_unauthorized', 'missing_required_review']),
    );
  });

  it('blocks stale, wrong-scope, unauthorized, and tombstoned evidence', async () => {
    await seedReleaseScopeWithEvidence(repository, {
      release_id: 'release-1',
      review_evidence: [
        { status: 'approved', scope_ref: { type: 'requirement', id: 'req-other' }, freshness: 'current' },
        { status: 'approved', scope_ref: { type: 'requirement', id: 'req-1' }, freshness: 'stale' },
      ],
      test_evidence: [
        { status: 'passed', scope_ref: { type: 'requirement', id: 'req-1' }, freshness: 'stale' },
        { status: 'passed', scope_ref: { type: 'task', id: 'task-1' }, authorization: 'unauthorized' },
        { status: 'passed', scope_ref: { type: 'bug', id: 'bug-1' }, reference_status: 'tombstoned' },
      ],
    });

    const response = await request(app.getHttpServer()).get('/query/releases/release-1/readiness').expect(200);

    expect(response.body.ready).toBe(false);
    expect(response.body.disabled_reasons.map((reason: { code: string }) => reason.code)).toEqual(
      expect.arrayContaining(['evidence_scope_mismatch', 'evidence_stale', 'evidence_unauthorized', 'evidence_tombstoned']),
    );
    expect(response.body.required_test_acceptance_evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          scope_ref: { type: 'requirement', id: 'req-1' },
          kind: 'qa_acceptance',
          status: 'stale',
          disabled_reason: expect.objectContaining({ code: 'evidence_stale' }),
        }),
        expect.objectContaining({
          scope_ref: { type: 'task', id: 'task-1' },
          kind: 'qa_acceptance',
          status: 'unauthorized',
          disabled_reason: expect.objectContaining({ code: 'evidence_unauthorized' }),
        }),
        expect.objectContaining({
          scope_ref: { type: 'bug', id: 'bug-1' },
          kind: 'qa_acceptance',
          status: 'tombstoned',
          disabled_reason: expect.objectContaining({ code: 'evidence_tombstoned' }),
        }),
      ]),
    );
  });

  it('unblocks release readiness when all required evidence is scoped, current, authorized, and passing', async () => {
    await seedReadyReleaseEvidence(repository, {
      release_id: 'release-1',
      scope_refs: defaultScopeRefs,
    });

    const response = await request(app.getHttpServer()).get('/query/releases/release-1/readiness').expect(200);

    expect(response.body).toMatchObject({
      release_id: 'release-1',
      ready: true,
      disabled_reasons: [],
    });
  });

  it('fails closed when otherwise passing evidence targets stale Spec or Plan revisions', async () => {
    await seedReadyReleaseEvidence(repository, {
      release_id: 'release-1',
      scope_refs: defaultScopeRefs,
      current_spec_revision_id: 'spec-rev-2',
      current_plan_revision_id: 'plan-rev-2',
      evidence_spec_revision_id: 'spec-rev-1',
      evidence_plan_revision_id: 'plan-rev-1',
    });

    const response = await request(app.getHttpServer()).get('/query/releases/release-1/readiness').expect(200);

    expect(response.body.ready).toBe(false);
    expect(response.body.disabled_reasons).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'evidence_revision_mismatch' })]),
    );
    expect(response.body.required_review_evidence[0]).toMatchObject({
      status: 'blocked',
      disabled_reason: expect.objectContaining({ code: 'evidence_revision_mismatch' }),
    });
    expect(response.body.required_test_acceptance_evidence[0]).toMatchObject({
      status: 'blocked',
      disabled_reason: expect.objectContaining({ code: 'evidence_revision_mismatch' }),
    });
  });
});

async function seedReleaseScope(
  repository: InMemoryDeliveryRepository,
  input: { release_id: string; scope_refs: ObjectRef[]; current_spec_revision_id?: string; current_plan_revision_id?: string },
): Promise<void> {
  await repository.saveRelease(releaseFixture(input.release_id, input.scope_refs, input));
}

async function seedReleaseScopeWithEvidence(
  repository: InMemoryDeliveryRepository,
  input: {
    release_id: string;
    review_evidence?: Record<string, unknown>[];
    test_evidence?: Record<string, unknown>[];
  },
): Promise<void> {
  await seedReleaseScope(repository, { release_id: input.release_id, scope_refs: defaultScopeRefs });
  let index = 0;
  for (const evidence of input.review_evidence ?? []) {
    await repository.saveReleaseEvidence(evidenceFixture(input.release_id, `review-${++index}`, 'review_authority', evidence));
  }
  for (const evidence of input.test_evidence ?? []) {
    await repository.saveReleaseEvidence(evidenceFixture(input.release_id, `test-${++index}`, 'test_acceptance', evidence));
  }
}

async function seedReadyReleaseEvidence(
  repository: InMemoryDeliveryRepository,
  input: {
    release_id: string;
    scope_refs: ObjectRef[];
    current_spec_revision_id?: string;
    current_plan_revision_id?: string;
    evidence_spec_revision_id?: string;
    evidence_plan_revision_id?: string;
  },
): Promise<void> {
  await seedReleaseScope(repository, input);
  let index = 0;
  for (const scopeRef of input.scope_refs) {
    await repository.saveReleaseEvidence(
      evidenceFixture(input.release_id, `review-${++index}`, 'review_authority', {
        authority_type: 'human_review_decision',
        status: 'approved',
        scope_ref: scopeRef,
        freshness: 'current',
        authorization: 'authorized',
        reference_status: 'active',
        spec_revision_id: input.evidence_spec_revision_id ?? input.current_spec_revision_id ?? 'spec-rev-1',
        plan_revision_id: input.evidence_plan_revision_id ?? input.current_plan_revision_id ?? 'plan-rev-1',
      }),
    );
    await repository.saveReleaseEvidence(
      evidenceFixture(input.release_id, `test-${++index}`, 'test_acceptance', {
        evidence_type: 'qa_acceptance',
        status: 'passed',
        scope_ref: scopeRef,
        freshness: 'current',
        authorization: 'authorized',
        reference_status: 'active',
        spec_revision_id: input.evidence_spec_revision_id ?? input.current_spec_revision_id ?? 'spec-rev-1',
        plan_revision_id: input.evidence_plan_revision_id ?? input.current_plan_revision_id ?? 'plan-rev-1',
      }),
    );
  }
}

function releaseFixture(
  id: string,
  scopeRefs: ObjectRef[],
  options: { current_spec_revision_id?: string; current_plan_revision_id?: string } = {},
): Release {
  return {
    id,
    org_id: 'org-1',
    project_id: 'project-1',
    title: 'Checkout release',
    phase: 'planning',
    activity_state: 'idle',
    gate_state: 'none',
    resolution: 'none',
    work_item_ids: ['req-1', 'bug-1'],
    execution_package_ids: [],
    extra: {
      project_management_scope_refs: scopeRefs,
      current_spec_revision_id: options.current_spec_revision_id ?? 'spec-rev-1',
      current_plan_revision_id: options.current_plan_revision_id ?? 'plan-rev-1',
    },
    created_by_actor_id: 'actor-release',
    created_at: now,
    updated_at: now,
  };
}

function evidenceFixture(
  releaseId: string,
  id: string,
  evidenceType: ReleaseEvidence['evidence_type'],
  extra: Record<string, unknown>,
): ReleaseEvidence {
  return {
    id: `${releaseId}-${id}`,
    release_id: releaseId,
    project_id: 'project-1',
    evidence_type: evidenceType,
    summary: `${evidenceType} evidence`,
    extra,
    redacted: false,
    status: 'current',
    visibility: 'internal',
    created_at: now,
    created_by_actor_id: 'actor-release',
  };
}
