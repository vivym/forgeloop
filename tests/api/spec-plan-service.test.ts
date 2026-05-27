import { INestApplication } from '@nestjs/common';
import type { DeliveryRepository } from '@forgeloop/db';
import type { AttachmentRef } from '@forgeloop/contracts';
import type { Attachment } from '@forgeloop/domain';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';

const actorProduct = 'actor-product';
const actorTech = 'actor-tech';
const actorReviewer = 'actor-reviewer';
const now = '2026-05-23T00:00:00.000Z';

describe('SpecPlanService item-scoped delivery API', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('generates Spec only from an approved Development Plan Item boundary', async () => {
    const { plan: unapprovedPlan, item: unapprovedItem } = await seedDevelopmentPlanItem(app);
    const server = app.getHttpServer();

    await request(server)
      .post(`/development-plans/${unapprovedPlan.id}/items/${unapprovedItem.id}/spec/generate-draft`)
      .send({ actor_id: actorTech })
      .expect(400);

    const { plan, item, boundary } = await seedApprovedBoundary(app);
    const specRevision = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/spec/generate-draft`)
        .send({ actor_id: actorTech })
        .expect(201)
    ).body;

    expect(specRevision).toMatchObject({
      development_plan_item_id: item.id,
      boundary_summary_id: boundary.id,
      context_manifest_id: expect.any(String),
      author_actor_id: actorTech,
    });

    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    await expect(repository.getContextManifest(specRevision.context_manifest_id)).resolves.toMatchObject({
      development_plan_id: plan.id,
      development_plan_item_id: item.id,
      boundary_summary_id: boundary.id,
    });
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ spec_status: 'draft' });
  });

  it('rejects Execution Plan generation until Spec is approved', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    const server = app.getHttpServer();

    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/execution-plan/generate-draft`)
      .send({ actor_id: actorTech })
      .expect(400);
  });

  it('supports submit, request changes, regenerate, compare, submit, and approve for Spec reviews', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

    const firstSpecRevision = await generateItemSpecDraft(app, plan.id, item.id);
    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec/submit-for-approval`)
      .send({ actor_id: actorTech })
      .expect(201);
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ spec_status: 'in_review' });

    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec/request-changes`)
      .send({ actor_id: actorReviewer, rationale: 'Clarify acceptance criteria.' })
      .expect(201);
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ spec_status: 'changes_requested' });

    const secondSpecRevision = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/spec/regenerate-draft`)
        .send({
          actor_id: actorTech,
          feedback: 'Add explicit route and API validation.',
          preserve_prior_decisions: true,
        })
        .expect(201)
    ).body;
    expect(secondSpecRevision.revision_number).toBe(firstSpecRevision.revision_number + 1);
    expect(secondSpecRevision.context_manifest_id).not.toBe(firstSpecRevision.context_manifest_id);

    const specDiff = (
      await request(server)
        .get(`/development-plans/${plan.id}/items/${item.id}/spec/revisions/compare`)
        .query({ base_revision_id: firstSpecRevision.id, compare_revision_id: secondSpecRevision.id })
        .expect(200)
    ).body;
    expect(specDiff).toMatchObject({
      base_revision_id: firstSpecRevision.id,
      compare_revision_id: secondSpecRevision.id,
      changed_fields: expect.arrayContaining(['content', 'context_manifest_id', 'revision_number']),
    });

    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec/submit-for-approval`)
      .send({ actor_id: actorTech })
      .expect(201);
    const approvedSpec = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/spec/approve`)
        .send({ actor_id: actorReviewer, rationale: 'Spec approved.' })
        .expect(201)
    ).body;

    expect(approvedSpec).toMatchObject({
      approved_revision_id: secondSpecRevision.id,
      approved_by_actor_id: actorReviewer,
      status: 'approved',
    });
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ spec_status: 'approved' });
    await expect(repository.listDecisionsForObject('spec', approvedSpec.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ actor_id: actorReviewer, decision: 'approved', summary: 'Spec approved.' }),
      ]),
    );
  });

  it('saves item-scoped Spec Markdown drafts as new current revisions', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const firstSpecRevision = await generateItemSpecDraft(app, plan.id, item.id);
    const markdown = [
      '# Saved Spec draft',
      '',
      '## Background',
      '',
      'The edited Spec background replaces the generated context.',
      '',
      '## Goals',
      '',
      '- Preserve Markdown-authored goals',
      '- Feed automation with current structure',
      '',
      '## Scope In',
      '',
      '- Item-scoped draft saving',
      '- Structured field synchronization',
      '',
      '## Scope Out',
      '',
      '- Legacy Work Item artifact editing',
      '',
      '## Acceptance Criteria',
      '',
      '- Downstream automation reads edited acceptance criteria',
      '- Reviewers see the same draft content and structure',
      '',
      '## Risk Notes',
      '',
      '- Markdown sections can be incomplete',
      '',
      '## Test Strategy',
      '',
      'Run API draft save regression coverage.',
    ].join('\n');

    const savedRevision = (
      await request(server)
        .patch(`/development-plans/${plan.id}/items/${item.id}/spec/draft`)
        .send({
          markdown,
          object_ref: { type: 'spec_revision', id: firstSpecRevision.id, spec_id: firstSpecRevision.spec_id },
          allowed_blocks: ['paragraph', 'heading', 'list', 'link', 'image', 'table', 'code_block', 'inline_code'],
          attachment_refs: [],
          validation_version: '2026-05-23',
        })
        .expect(200)
    ).body;

    expect(savedRevision).toMatchObject({
      spec_id: firstSpecRevision.spec_id,
      revision_number: firstSpecRevision.revision_number + 1,
      content: markdown,
      background: 'The edited Spec background replaces the generated context.',
      goals: ['Preserve Markdown-authored goals', 'Feed automation with current structure'],
      scope_in: ['Item-scoped draft saving', 'Structured field synchronization'],
      scope_out: ['Legacy Work Item artifact editing'],
      acceptance_criteria: [
        'Downstream automation reads edited acceptance criteria',
        'Reviewers see the same draft content and structure',
      ],
      risk_notes: ['Markdown sections can be incomplete'],
      test_strategy_summary: 'Run API draft save regression coverage.',
      attachment_refs: [],
    });
    expect(savedRevision).not.toHaveProperty('structured_document');
    expect(savedRevision).not.toHaveProperty('artifact_refs');
    await expect(repository.getSpec(firstSpecRevision.spec_id)).resolves.toMatchObject({ current_revision_id: savedRevision.id });
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ spec_status: 'draft' });
    await expect(repository.listObjectEvents(savedRevision.id, 'spec_revision')).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actor_id: actorTech,
          event_type: 'spec_draft_saved',
          metadata: expect.objectContaining({ previous_revision_id: firstSpecRevision.id }),
        }),
      ]),
    );
  });

  it('preserves non-inline item-scoped Spec attachments across Markdown draft saves', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const firstSpecRevision = await generateItemSpecDraft(app, plan.id, item.id);
    const attachment = await seedRevisionAttachment(repository, {
      id: 'att-spec-non-inline',
      objectRef: { type: 'spec_revision', id: firstSpecRevision.id, spec_id: firstSpecRevision.spec_id },
    });

    const savedRevision = (
      await request(server)
        .patch(`/development-plans/${plan.id}/items/${item.id}/spec/draft`)
        .send({
          markdown: '# Saved Spec draft\n\nText-only edit should keep the attached diagram available.',
          object_ref: { type: 'spec_revision', id: firstSpecRevision.id, spec_id: firstSpecRevision.spec_id },
          allowed_blocks: ['paragraph', 'heading', 'link', 'image', 'table', 'code_block', 'inline_code'],
          attachment_refs: [attachment],
          validation_version: '2026-05-23',
        })
        .expect(200)
    ).body;

    expect(savedRevision.attachment_refs).toEqual([expect.objectContaining({ id: attachment.id })]);
    await expect(repository.listAttachmentsForObject('spec_revision', savedRevision.id)).resolves.toEqual([
      expect.objectContaining({ id: attachment.id }),
    ]);
  });

  it('supports generate after approved Spec, submit, reject, regenerate, and compare for Execution Plan reviews', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

    const specRevision = await generateItemSpecDraft(app, plan.id, item.id);
    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec/submit-for-approval`)
      .send({ actor_id: actorTech })
      .expect(201);
    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec/approve`)
      .send({ actor_id: actorReviewer, rationale: 'Spec approved.' })
      .expect(201);

    const firstExecutionPlanRevision = await generateItemExecutionPlanDraft(app, plan.id, item.id);
    expect(firstExecutionPlanRevision).toMatchObject({
      development_plan_item_id: item.id,
      based_on_spec_revision_id: specRevision.id,
      author_actor_id: actorTech,
    });
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ execution_plan_status: 'draft' });

    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/execution-plan/submit-for-approval`)
      .send({ actor_id: actorTech })
      .expect(201);
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ execution_plan_status: 'in_review' });

    const rejected = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/execution-plan/reject`)
        .send({ actor_id: actorReviewer, rationale: 'Plan does not include QA handoff validation.' })
        .expect(201)
    ).body;
    expect(rejected.status).toBe('changes_requested');
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ execution_plan_status: 'changes_requested' });

    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/execution-plan/submit-for-approval`)
      .send({ actor_id: actorTech })
      .expect(400);

    const secondExecutionPlanRevision = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/execution-plan/regenerate-draft`)
        .send({
          actor_id: actorTech,
          feedback: 'Add QA handoff validation and visual checks.',
          preserve_prior_decisions: true,
        })
        .expect(201)
    ).body;
    expect(secondExecutionPlanRevision.revision_number).toBe(firstExecutionPlanRevision.revision_number + 1);

    const executionPlanDiff = (
      await request(server)
        .get(`/development-plans/${plan.id}/items/${item.id}/execution-plan/revisions/compare`)
        .query({
          base_revision_id: firstExecutionPlanRevision.id,
          compare_revision_id: secondExecutionPlanRevision.id,
        })
        .expect(200)
    ).body;
    expect(executionPlanDiff).toMatchObject({
      base_revision_id: firstExecutionPlanRevision.id,
      compare_revision_id: secondExecutionPlanRevision.id,
      changed_fields: expect.arrayContaining(['content', 'revision_number']),
    });
    await expect(repository.listDecisionsForObject('execution_plan', rejected.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actor_id: actorReviewer,
          decision: 'changes_requested',
          summary: 'Plan does not include QA handoff validation.',
        }),
      ]),
    );
  });

  it('saves item-scoped Execution Plan Markdown drafts as new current revisions', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

    await generateItemSpecDraft(app, plan.id, item.id);
    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec/submit-for-approval`)
      .send({ actor_id: actorTech })
      .expect(201);
    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec/approve`)
      .send({ actor_id: actorReviewer, rationale: 'Spec approved.' })
      .expect(201);
    const firstExecutionPlanRevision = await generateItemExecutionPlanDraft(app, plan.id, item.id);

    const savedRevision = (
      await request(server)
        .patch(`/development-plans/${plan.id}/items/${item.id}/execution-plan/draft`)
        .send({
          markdown: '# Saved Execution Plan draft\n\nPersisted through the item-scoped draft endpoint.',
          object_ref: {
            type: 'execution_plan_revision',
            id: firstExecutionPlanRevision.id,
            execution_plan_id: firstExecutionPlanRevision.execution_plan_id,
          },
          allowed_blocks: ['paragraph', 'heading', 'link', 'image', 'table', 'code_block', 'inline_code'],
          attachment_refs: [],
          validation_version: '2026-05-23',
        })
        .expect(200)
    ).body;

    expect(savedRevision).toMatchObject({
      execution_plan_id: firstExecutionPlanRevision.execution_plan_id,
      revision_number: firstExecutionPlanRevision.revision_number + 1,
      content: '# Saved Execution Plan draft\n\nPersisted through the item-scoped draft endpoint.',
      attachment_refs: [],
    });
    expect(savedRevision).not.toHaveProperty('structured_document');
    await expect(repository.getExecutionPlan(firstExecutionPlanRevision.execution_plan_id)).resolves.toMatchObject({
      current_revision_id: savedRevision.id,
    });
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ execution_plan_status: 'draft' });
    await expect(repository.listObjectEvents(savedRevision.id, 'execution_plan_revision')).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actor_id: actorTech,
          event_type: 'execution_plan_draft_saved',
          metadata: expect.objectContaining({ previous_revision_id: firstExecutionPlanRevision.id }),
        }),
      ]),
    );
  });

  it('preserves non-inline item-scoped Execution Plan attachments across Markdown draft saves', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

    await generateItemSpecDraft(app, plan.id, item.id);
    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec/submit-for-approval`)
      .send({ actor_id: actorTech })
      .expect(201);
    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec/approve`)
      .send({ actor_id: actorReviewer, rationale: 'Spec approved.' })
      .expect(201);
    const firstExecutionPlanRevision = await generateItemExecutionPlanDraft(app, plan.id, item.id);
    const attachment = await seedRevisionAttachment(repository, {
      id: 'att-execution-plan-non-inline',
      objectRef: {
        type: 'execution_plan_revision',
        id: firstExecutionPlanRevision.id,
        execution_plan_id: firstExecutionPlanRevision.execution_plan_id,
      },
    });

    const savedRevision = (
      await request(server)
        .patch(`/development-plans/${plan.id}/items/${item.id}/execution-plan/draft`)
        .send({
          markdown: '# Saved Execution Plan draft\n\nText-only edit should keep the attached checklist available.',
          object_ref: {
            type: 'execution_plan_revision',
            id: firstExecutionPlanRevision.id,
            execution_plan_id: firstExecutionPlanRevision.execution_plan_id,
          },
          allowed_blocks: ['paragraph', 'heading', 'link', 'image', 'table', 'code_block', 'inline_code'],
          attachment_refs: [attachment],
          validation_version: '2026-05-23',
        })
        .expect(200)
    ).body;

    expect(savedRevision.attachment_refs).toEqual([expect.objectContaining({ id: attachment.id })]);
    await expect(repository.listAttachmentsForObject('execution_plan_revision', savedRevision.id)).resolves.toEqual([
      expect.objectContaining({ id: attachment.id }),
    ]);
  });
});

async function seedRevisionAttachment(
  repository: DeliveryRepository,
  input: {
    id: string;
    objectRef:
      | { type: 'spec_revision'; id: string; spec_id: string }
      | { type: 'execution_plan_revision'; id: string; execution_plan_id: string };
  },
): Promise<AttachmentRef> {
  const attachment: Attachment = {
    id: input.id,
    owner_object_type: input.objectRef.type,
    owner_object_id: input.objectRef.id,
    linked_object_refs: [],
    filename: `${input.id}.png`,
    content_type: 'image/png',
    size_bytes: 9,
    storage_uri: `memory://attachments/${input.id}`,
    checksum_sha256: 'c'.repeat(64),
    uploaded_by_actor_id: actorTech,
    created_at: now,
    evidence_category: 'image',
    alt_text: 'Non-inline review attachment',
    visibility: 'object',
    safety_status: 'passed',
    reference_status: 'active',
  };
  await repository.saveAttachment(attachment);
  const { storage_uri: _storageUri, ...publicAttachment } = attachment;
  return publicAttachment;
}

async function generateItemSpecDraft(app: INestApplication, developmentPlanId: string, itemId: string) {
  return (
    await request(app.getHttpServer())
      .post(`/development-plans/${developmentPlanId}/items/${itemId}/spec/generate-draft`)
      .send({ actor_id: actorTech })
      .expect(201)
  ).body;
}

async function generateItemExecutionPlanDraft(app: INestApplication, developmentPlanId: string, itemId: string) {
  return (
    await request(app.getHttpServer())
      .post(`/development-plans/${developmentPlanId}/items/${itemId}/execution-plan/generate-draft`)
      .send({ actor_id: actorTech })
      .expect(201)
  ).body;
}

async function seedApprovedBoundary(app: INestApplication) {
  const seeded = await seedDevelopmentPlanItem(app);
  const server = app.getHttpServer();
  const session = (
    await request(server)
      .post(`/development-plans/${seeded.plan.id}/items/${seeded.item.id}/brainstorming-sessions`)
      .send({ actor_id: actorTech })
      .expect(201)
  ).body;

  for (const question of session.questions) {
    await request(server)
      .post(`/brainstorming-sessions/${session.id}/answers`)
      .send({
        question_id: question.id,
        text: `Answered boundary question: ${question.text}`,
        actor_id: actorTech,
      })
      .expect(201);
  }

  await request(server)
    .post(`/brainstorming-sessions/${session.id}/decisions`)
    .send({
      text: 'Keep implementation scoped to item-level spec and execution plan gates.',
      rationale: 'The Development Plan Item is the product boundary.',
      actor_id: actorTech,
    })
    .expect(201);

  const approved = (
    await request(server)
      .post(`/brainstorming-sessions/${session.id}/approve-boundary`)
      .send({
        confirmed_scope: ['Item-scoped Spec and Execution Plan APIs'],
        confirmed_out_of_scope: ['Direct Work Item creation compatibility'],
        accepted_assumptions: ['Mock draft generation is sufficient for service tests'],
        open_risks: ['Reviewers need structured revision comparison'],
        validation_expectations: ['API and contract tests pass'],
        actor_id: actorTech,
        final_decision: 'Approve this Development Plan Item boundary.',
      })
      .expect(201)
  ).body;

  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const boundary = await repository.getBoundarySummary(approved.boundary_summary_id);
  expect(boundary).toBeDefined();

  return { ...seeded, session: approved, boundary: boundary! };
}

async function seedDevelopmentPlanItem(app: INestApplication) {
  const { project, workItem } = await createProjectRepoWorkItem(app);
  const server = app.getHttpServer();
  const plan = (
    await request(server)
      .post('/development-plans')
      .send({
        project_id: project.id,
        source_ref: { type: 'requirement', id: workItem.id },
        title: 'Spec and execution plan gate development plan',
        actor_id: actorProduct,
      })
      .expect(201)
  ).body;
  const item = (
    await request(server)
      .post(`/development-plans/${plan.id}/items`)
      .send({
        title: 'Gate specs and execution plans by item',
        summary: 'Generate and review artifacts only from approved Development Plan Item boundaries.',
        responsible_role: 'tech_lead',
        driver_actor_id: actorTech,
        reviewer_actor_id: actorReviewer,
        risk: 'medium',
        dependency_hints: [],
        affected_surfaces: ['apps/control-plane-api', 'apps/web'],
        release_impact: 'release_scoped',
      })
      .expect(201)
  ).body;

  return { project, workItem, plan, item };
}

const createProjectRepoWorkItem = async (app: INestApplication) => {
  const server = app.getHttpServer();
  const project = (
    await request(server).post('/projects').send({ name: 'Forgeloop', owner_actor_id: actorProduct }).expect(201)
  ).body;
  await request(server)
    .post(`/projects/${project.id}/repos`)
    .send({
      repo_id: 'repo-1',
      name: 'forgeloop',
      local_path: '/workspace/forgeloop',
      default_branch: 'main',
      base_commit_sha: 'abc123',
    })
    .expect(201);
  const workItem = (
    await request(server)
      .post('/work-items')
      .send({
        project_id: project.id,
        kind: 'requirement',
        title: 'Extract SpecPlanService',
        goal: 'Move spec and execution plan commands to the item boundary.',
        success_criteria: ['Spec and execution plan routes are item-scoped.'],
        priority: 'P0',
        risk: 'medium',
        driver_actor_id: actorProduct,
        intake_context: {
          type: 'requirement',
          stakeholder_problem: 'Direct source-object spec and plan routing bypasses item boundaries.',
          desired_outcome: 'Artifacts are generated from approved Development Plan Items.',
          acceptance_criteria: ['Spec and execution plan commands require item gates.'],
          in_scope: ['SpecPlanService API tests'],
        },
      })
      .expect(201)
  ).body;

  return { project, workItem };
};
