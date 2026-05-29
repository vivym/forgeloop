import { INestApplication } from '@nestjs/common';
import type { DeliveryRepository } from '@forgeloop/db';
import type { AttachmentRef } from '@forgeloop/contracts';
import type { Attachment, ExecutionPackage } from '@forgeloop/domain';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { ProductGenerationResultService } from '../../apps/control-plane-api/src/modules/automation/product-generation-result.service';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { CodexRuntimeService } from '../../apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service';
import { DEFAULT_SOURCE_MUTATION_POLICY, defaultPackagePolicyFields } from '../../apps/control-plane-api/src/modules/execution-packages/package-policy-fields';
import { SpecPlanService } from '../../apps/control-plane-api/src/modules/spec-plan/spec-plan.service';
import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  codexRuntimeNetworkPolicyDigest,
  codexRuntimeProfileRevisionDigest,
  type CodexGenerationRuntimeJobResult,
  type CodexLaunchMaterialization,
  type CodexRuntimeJob,
  type CodexRuntimeProfileRevision,
} from '../../packages/domain/src';
import { createWorkflowPolicyRepoRoot } from '../helpers/runtime-policy-repo';

const actorProduct = 'actor-product';
const actorTech = 'actor-tech';
const actorReviewer = 'actor-reviewer';
type RuntimeJobRef = Pick<CodexRuntimeJob, 'id' | 'worker_id' | 'launch_lease_id' | 'project_id' | 'repo_id'>;
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
    vi.unstubAllEnvs();
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

  it('rejects Implementation Plan Doc generation until Spec is approved', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    const server = app.getHttpServer();

    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/implementation-plan/generate-draft`)
      .send({ actor_id: actorTech })
      .expect(400);
  });

  it('uses the source driver as QA owner fallback when Plan Item actors are omitted', async () => {
    const { plan, item } = await seedApprovedBoundary(app, {
      driver_actor_id: undefined,
      reviewer_actor_id: undefined,
    });
    const server = app.getHttpServer();

    const specRevision = await generateItemSpecDraft(app, plan.id, item.id);
    expect(specRevision.qa_owner_actor_id).toBe(actorProduct);

    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec/submit-for-approval`)
      .send({ actor_id: actorTech })
      .expect(201);
    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec/approve`)
      .send({ actor_id: actorReviewer, rationale: 'Spec approved with source driver QA fallback.' })
      .expect(201);
    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/implementation-plan/generate-draft`)
      .send({ actor_id: actorTech })
      .expect(201);
  });

  it('rejects legacy direct Boundary approval before Spec generation', async () => {
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
          text: `Answered legacy boundary question: ${question.text}`,
          actor_id: actorTech,
        })
        .expect(201);
    }
    await request(server)
      .post(`/brainstorming-sessions/${session.id}/decisions`)
      .send({ text: 'Legacy direct approval decision.', actor_id: actorTech })
      .expect(201);
    await request(server)
      .post(`/brainstorming-sessions/${session.id}/approve-boundary`)
      .send({
        confirmed_scope: ['Legacy approved scope'],
        confirmed_out_of_scope: ['Runtime evidence'],
        accepted_assumptions: ['Legacy path is compatibility only'],
        open_risks: ['No round-backed summary evidence'],
        validation_expectations: ['Spec generation remains blocked'],
        actor_id: actorTech,
      })
      .expect(409);

    await request(server)
      .post(`/development-plans/${seeded.plan.id}/items/${seeded.item.id}/spec/generate-draft`)
      .send({ actor_id: actorTech })
      .expect(400)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('boundary_not_approved');
      });
  });

  it('rejects Implementation Plan Doc generation when required QA and test strategy evidence is missing from approved Spec', async () => {
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
      .send({ actor_id: actorReviewer, rationale: 'Spec approved without QA evidence.' })
      .expect(201);
    await repository.saveSpecRevision({
      ...specRevision,
      qa_owner_actor_id: undefined,
      testability_note: '',
      acceptance_criteria: [],
      test_strategy_summary: '',
    });

    const response = await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/implementation-plan/generate-draft`)
      .send({ actor_id: actorTech })
      .expect(400);

    expect(response.body.message).toContain('qa_test_owner_missing');
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ implementation_plan_status: 'missing' });
  });

  it('requires QA and test strategy evidence for release-blocking Plan Items even when risk and surface count are low', async () => {
    const { plan, item } = await seedApprovedBoundary(app, {
      affected_surfaces: ['apps/web'],
      release_impact: 'release_blocking',
      risk: 'low',
    });
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

    const specRevision = await generateItemSpecDraft(app, plan.id, item.id);
    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec/submit-for-approval`)
      .send({ actor_id: actorTech })
      .expect(201);
    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec/approve`)
      .send({ actor_id: actorReviewer, rationale: 'Spec approved without QA evidence.' })
      .expect(201);
    await repository.saveSpecRevision({
      ...specRevision,
      qa_owner_actor_id: undefined,
      test_owner_actor_id: undefined,
      testability_note: '',
      acceptance_criteria: [],
      test_strategy_summary: '',
    });

    const response = await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/implementation-plan/generate-draft`)
      .send({ actor_id: actorTech })
      .expect(400);

    expect(response.body.message).toContain('qa_test_owner_missing');
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

  it('supports generate after approved Spec, submit, reject, regenerate, and compare for Implementation Plan Doc reviews', async () => {
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

    const firstExecutionPlanRevision = await generateItemImplementationPlanDraft(app, plan.id, item.id);
    expect(firstExecutionPlanRevision).toMatchObject({
      implementation_plan_id: expect.any(String),
      development_plan_item_id: item.id,
      based_on_spec_revision_id: specRevision.id,
      author_actor_id: actorTech,
    });
    expect(firstExecutionPlanRevision).not.toHaveProperty('execution_plan_id');
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ implementation_plan_status: 'draft' });

    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/implementation-plan/submit-for-approval`)
      .send({ actor_id: actorTech })
      .expect(201);
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ implementation_plan_status: 'in_review' });

    const rejected = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/implementation-plan/reject`)
        .send({ actor_id: actorReviewer, rationale: 'Plan does not include QA handoff validation.' })
        .expect(201)
    ).body;
    expect(rejected.status).toBe('changes_requested');
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ implementation_plan_status: 'changes_requested' });

    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/implementation-plan/submit-for-approval`)
      .send({ actor_id: actorTech })
      .expect(400);

    const secondExecutionPlanRevision = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/implementation-plan/regenerate-draft`)
        .send({
          actor_id: actorTech,
          feedback: 'Add QA handoff validation and visual checks.',
          preserve_prior_decisions: true,
        })
        .expect(201)
    ).body;
    expect(secondExecutionPlanRevision.revision_number).toBe(firstExecutionPlanRevision.revision_number + 1);
    expect(secondExecutionPlanRevision).toMatchObject({ implementation_plan_id: firstExecutionPlanRevision.implementation_plan_id });
    expect(secondExecutionPlanRevision).not.toHaveProperty('execution_plan_id');

    const executionPlanDiff = (
      await request(server)
        .get(`/development-plans/${plan.id}/items/${item.id}/implementation-plan/revisions/compare`)
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
    await expect(repository.listDecisionsForObject('implementation_plan_doc', rejected.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actor_id: actorReviewer,
          decision: 'changes_requested',
          summary: 'Plan does not include QA handoff validation.',
        }),
      ]),
    );
  });

  it('creates a runnable internal execution boundary when approving an item Implementation Plan Doc', async () => {
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

    const executionPlanRevision = await generateItemImplementationPlanDraft(app, plan.id, item.id);
    const requiredChecks = [
      {
        check_id: 'unit',
        display_name: 'Unit tests',
        command: 'pnpm test',
        timeout_seconds: 120,
        blocks_review: true,
      },
    ];
    const packagePolicyFields = await defaultPackagePolicyFields(repository, {
      projectId: plan.project_id,
      repoId: 'repo-1',
      loadedAt: now,
      requiredChecks,
      allowedPaths: ['apps/control-plane-api/**'],
      forbiddenPaths: ['packages/db/**'],
      sourceMutationPolicy: DEFAULT_SOURCE_MUTATION_POLICY,
    });
    const draftPackage: ExecutionPackage = {
      id: 'existing-draft-item-execution-package',
      work_item_id: item.source_ref.id,
      development_plan_item_id: item.id,
      spec_id: specRevision.spec_id,
      spec_revision_id: specRevision.id,
      execution_plan_id: executionPlanRevision.execution_plan_id,
      execution_plan_revision_id: executionPlanRevision.id,
      plan_id: executionPlanRevision.execution_plan_id,
      plan_revision_id: executionPlanRevision.id,
      project_id: plan.project_id,
      repo_id: 'repo-1',
      objective: 'Existing draft package for approval reuse.',
      owner_actor_id: actorTech,
      reviewer_actor_id: actorReviewer,
      qa_owner_actor_id: actorProduct,
      phase: 'draft',
      activity_state: 'idle',
      gate_state: 'not_submitted',
      resolution: 'none',
      required_checks: requiredChecks,
      required_test_gates: [],
      required_artifact_kinds: ['execution_summary'],
      allowed_paths: ['apps/control-plane-api/**'],
      forbidden_paths: ['packages/db/**'],
      source_mutation_policy: DEFAULT_SOURCE_MUTATION_POLICY,
      version: 0,
      execution_package_set_id: `item-execution:${item.id}:${executionPlanRevision.id}`,
      generation_key: 'item-execution',
      package_key: 'default-runtime-package',
      sequence: 0,
      manifest_digest: `execution-plan-revision:${executionPlanRevision.id}`,
      created_at: now,
      updated_at: now,
      ...packagePolicyFields,
    };
    await repository.saveExecutionPackage(draftPackage);

    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/implementation-plan/submit-for-approval`)
      .send({ actor_id: actorTech })
      .expect(201);
    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/implementation-plan/approve`)
      .send({ actor_id: actorReviewer, rationale: 'Implementation Plan Doc approved.' })
      .expect(201);

    await expect(repository.listExecutionPackagesForWorkItem(item.source_ref.id)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: draftPackage.id,
          development_plan_item_id: item.id,
          execution_plan_id: executionPlanRevision.execution_plan_id,
          execution_plan_revision_id: executionPlanRevision.id,
          generation_key: 'item-execution',
          phase: 'ready',
          activity_state: 'idle',
          gate_state: 'not_submitted',
          spec_revision_id: specRevision.id,
        }),
      ]),
    );
    const executionPackages = await repository.listExecutionPackagesForWorkItem(item.source_ref.id);
    const runtimeBoundary = executionPackages.find((executionPackage) => executionPackage.development_plan_item_id === item.id);
    expect(runtimeBoundary).toBeDefined();
    expect(runtimeBoundary).not.toHaveProperty('execution_id');
  });

  it('saves item-scoped Implementation Plan Doc Markdown drafts as new current revisions', async () => {
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
    const firstExecutionPlanRevision = await generateItemImplementationPlanDraft(app, plan.id, item.id);

    const savedRevision = (
      await request(server)
        .patch(`/development-plans/${plan.id}/items/${item.id}/implementation-plan/draft`)
        .send({
          markdown: '# Saved Implementation Plan Doc draft\n\nPersisted through the item-scoped draft endpoint.',
          object_ref: {
            type: 'implementation_plan_revision',
            id: firstExecutionPlanRevision.id,
            implementation_plan_id: firstExecutionPlanRevision.implementation_plan_id,
          },
          allowed_blocks: ['paragraph', 'heading', 'link', 'image', 'table', 'code_block', 'inline_code'],
          attachment_refs: [],
          validation_version: '2026-05-23',
        })
        .expect(200)
    ).body;

    expect(savedRevision).toMatchObject({
      implementation_plan_id: firstExecutionPlanRevision.implementation_plan_id,
      revision_number: firstExecutionPlanRevision.revision_number + 1,
      content: '# Saved Implementation Plan Doc draft\n\nPersisted through the item-scoped draft endpoint.',
      attachment_refs: [],
    });
    expect(savedRevision).not.toHaveProperty('execution_plan_id');
    expect(savedRevision).not.toHaveProperty('structured_document');
    await expect(repository.getExecutionPlan(firstExecutionPlanRevision.implementation_plan_id)).resolves.toMatchObject({
      current_revision_id: savedRevision.id,
    });
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ implementation_plan_status: 'draft' });
    await expect(repository.listObjectEvents(savedRevision.id, 'implementation_plan_revision')).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actor_id: actorTech,
          event_type: 'implementation_plan_draft_saved',
          metadata: expect.objectContaining({ previous_revision_id: firstExecutionPlanRevision.id }),
        }),
      ]),
    );
  });

  it('preserves non-inline item-scoped Implementation Plan Doc attachments across Markdown draft saves', async () => {
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
    const firstExecutionPlanRevision = await generateItemImplementationPlanDraft(app, plan.id, item.id);
    const attachment = await seedRevisionAttachment(repository, {
      id: 'att-execution-plan-non-inline',
      objectRef: {
        type: 'implementation_plan_revision',
        id: firstExecutionPlanRevision.id,
        implementation_plan_id: firstExecutionPlanRevision.implementation_plan_id,
      },
    });

    const savedRevision = (
      await request(server)
        .patch(`/development-plans/${plan.id}/items/${item.id}/implementation-plan/draft`)
        .send({
          markdown: '# Saved Implementation Plan Doc draft\n\nText-only edit should keep the attached checklist available.',
          object_ref: {
            type: 'implementation_plan_revision',
            id: firstExecutionPlanRevision.id,
            implementation_plan_id: firstExecutionPlanRevision.implementation_plan_id,
          },
          allowed_blocks: ['paragraph', 'heading', 'link', 'image', 'table', 'code_block', 'inline_code'],
          attachment_refs: [attachment],
          validation_version: '2026-05-23',
        })
        .expect(200)
    ).body;

    expect(savedRevision.attachment_refs).toEqual([expect.objectContaining({ id: attachment.id })]);
    await expect(repository.listAttachmentsForObject('implementation_plan_revision', savedRevision.id)).resolves.toEqual([
      expect.objectContaining({ id: attachment.id }),
    ]);
  });

  it('schedules runtime-backed Spec generation and writes a draft revision from the approved Boundary Summary only', async () => {
    const { plan, item, boundary } = await seedApprovedBoundary(app);
    await seedGenerationRuntimeForProject(app, plan.project_id, 'repo-1');
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const codexRuntimeService = app.get(CodexRuntimeService);
    const resultWriter = app.get(ProductGenerationResultService);

    const generateResponse = await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec-revisions/generate`)
      .send({ actor_id: actorTech });
    expect(generateResponse.status, JSON.stringify(generateResponse.body)).toBe(201);
    const actionResponse = generateResponse.body;

    expect(actionResponse.action_run).toMatchObject({
      action_type: 'generate_development_plan_item_spec_revision',
      target_object_type: 'development_plan_item',
      target_object_id: item.id,
      target_revision_id: boundary.development_plan_item_revision_id,
      action_input_json: expect.objectContaining({
        development_plan_id: plan.id,
        development_plan_item_id: item.id,
        approved_boundary_summary_revision_id: boundary.revision_id,
        precondition_fingerprint_json: expect.objectContaining({
          development_plan_id: plan.id,
          development_plan_item_id: item.id,
          approved_boundary_summary_revision_id: boundary.revision_id,
        }),
      }),
    });
    expect(actionResponse.action_run.precondition_fingerprint).toBe(
      codexCanonicalDigest(actionResponse.action_run.action_input_json.precondition_fingerprint_json),
    );
    expect(actionResponse.action_run.claim_token).toBeUndefined();
    expect(actionResponse.runtime_job).toMatchObject({
      target_type: 'automation_action_run',
      target_id: actionResponse.action_run.id,
      target_kind: 'generation',
      project_id: plan.project_id,
      repo_id: 'repo-1',
      status: 'queued',
      input: { schema_version: 'codex_generation_workload.v1', input_digest: expect.any(String) },
    });
    expect(actionResponse.runtime_job.input_json).toBeUndefined();
    expect(actionResponse.runtime_job.workspace_acquisition_json).toBeUndefined();
    const rawRuntimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: actionResponse.runtime_job.id }))!;
    expect(rawRuntimeJob.input_json).toMatchObject({
      schema_version: 'codex_generation_workload.v1',
      task_kind: 'development_plan_item_spec_revision',
      action_run_id: actionResponse.action_run.id,
    });

    const terminalResult = generationTerminalResult('development_plan_item_spec_revision', generatedSpecRevision(item.id, boundary.revision_id));
    await terminalizeGenerationRuntimeJob(repository, actionResponse.runtime_job, terminalResult, 'spec-success');
    await expect(
      resultWriter.handleGenerationRuntimeTerminal({
        runtimeJobId: actionResponse.runtime_job.id,
        actionRunId: actionResponse.action_run.id,
        terminalResult,
      }),
    ).resolves.toEqual({ applied: true });
    const completedAction = await repository.getAutomationActionRun(actionResponse.action_run.id);
    expect(completedAction).toMatchObject({
      status: 'succeeded',
      result_json: { product_generation_result: 'applied' },
    });
    const replayedCompletedAction = await repository.claimAutomationActionRun({
      ...completedAction!,
      id: 'replay-completed-spec-generation',
      claim_token: 'replay-completed-spec-generation-claim',
      locked_until: '2026-05-05T00:15:00.000Z',
      now: '2026-05-05T00:10:00.000Z',
    });
    expect(replayedCompletedAction.status).toBe('succeeded');
    expect(replayedCompletedAction.claim_token).toBeUndefined();

    const [spec] = await repository.listSpecs();
    expect(spec).toMatchObject({
      development_plan_item_id: item.id,
      boundary_summary_id: boundary.id,
      status: 'draft',
    });
    expect(spec.approved_revision_id).toBeUndefined();
    const specRevisions = await repository.listSpecRevisions(spec.id);
    expect(specRevisions).toEqual([
      expect.objectContaining({
        development_plan_item_id: item.id,
        boundary_summary_id: boundary.id,
        summary: 'Generated Spec revision',
        content: 'Implement the approved boundary.',
        author_actor_id: actorTech,
      }),
    ]);
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ spec_status: 'draft' });
  });

  it('uses deterministic sorted repo scope for runtime-backed Spec generation', async () => {
    const { project, plan, item } = await seedApprovedBoundary(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    await request(server)
      .post(`/projects/${project.id}/repos`)
      .send({
        repo_id: 'repo-0',
        name: 'forgeloop-tools',
        local_path: '/workspace/forgeloop-tools',
        default_branch: 'main',
        base_commit_sha: 'def456',
      })
      .expect(201);
    await seedGenerationRuntimeForProject(app, plan.project_id, 'repo-0');

    const actionResponse = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/spec-revisions/generate`)
        .send({ actor_id: actorTech })
        .expect(201)
    ).body;

    expect(actionResponse.runtime_job.repo_id).toBe('repo-0');
    const rawRuntimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: actionResponse.runtime_job.id }))!;
    expect(rawRuntimeJob.workspace_acquisition_json?.repo_ids).toEqual(['repo-0', 'repo-1']);
  });

  it('uses current centralized generation config when stale env pins point at another scope', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    await seedGenerationRuntimeForProject(app, plan.project_id, 'repo-1');
    vi.stubEnv('FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_ID', 'stale-profile-from-another-control-plane');
    vi.stubEnv('FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID', 'stale-credential-from-another-control-plane');

    const actionResponse = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/spec-revisions/generate`)
        .send({ actor_id: actorTech })
        .expect(201)
    ).body;

    const rawRuntimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: actionResponse.runtime_job.id }))!;
    expect(rawRuntimeJob.repo_id).toBe('repo-1');
    const { materialization } = await startGenerationRuntimeJob(repository, actionResponse.runtime_job, 'stale-env-fallback');
    expect(materialization.launch_target).toMatchObject({ project_id: plan.project_id, repo_id: 'repo-1' });
    expect(materialization.profile_revision.allowed_scopes).toContainEqual(
      expect.objectContaining({ project_id: plan.project_id }),
    );
    expect(materialization.resolved_credentials).toHaveLength(1);
    const materializedCredential = await repository.getCodexCredentialBindingPublic(materialization.resolved_credentials[0]!.binding_id);
    expect(materializedCredential).toMatchObject({
      project_id: plan.project_id,
      profile_id: materialization.profile_revision.profile_id,
      purpose: 'model_provider',
    });
    expect(materialization.resolved_credentials[0]?.binding_id).not.toBe('stale-credential-from-another-control-plane');
  });

  it('fails product generation without a retryable claim when the terminal result prompt contract mismatches the workload', async () => {
    const { plan, item, boundary } = await seedApprovedBoundary(app);
    await seedGenerationRuntimeForProject(app, plan.project_id, 'repo-1');
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const resultWriter = app.get(ProductGenerationResultService);

    const actionResponse = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/spec-revisions/generate`)
        .send({ actor_id: actorTech })
        .expect(201)
    ).body;

    const terminalResult = {
      ...generationTerminalResult('development_plan_item_spec_revision', generatedSpecRevision(item.id, boundary.revision_id)),
      prompt_version: 'development-plan-item-spec-revision:v2',
    };
    await terminalizeGenerationRuntimeJob(repository, actionResponse.runtime_job, terminalResult, 'spec-prompt-mismatch');
    await expect(
      resultWriter.handleGenerationRuntimeTerminal({
        runtimeJobId: actionResponse.runtime_job.id,
        actionRunId: actionResponse.action_run.id,
        terminalResult,
      }),
    ).resolves.toEqual({ applied: false, reason: 'invalid_precondition' });

    await expect(repository.listSpecs()).resolves.toEqual([]);
    const completedAction = await repository.getAutomationActionRun(actionResponse.action_run.id);
    expect(completedAction).toMatchObject({
      status: 'failed',
      retryable: false,
      result_json: { product_generation_result: 'invalid_precondition' },
    });
    const replayedCompletedAction = await repository.claimAutomationActionRun({
      ...completedAction!,
      id: 'replay-failed-spec-generation',
      claim_token: 'replay-failed-spec-generation-claim',
      locked_until: '2026-05-05T00:15:00.000Z',
      now: '2026-05-05T00:10:00.000Z',
    });
    expect(replayedCompletedAction.status).toBe('failed');
    expect(replayedCompletedAction.claim_token).toBeUndefined();
  });

  it('fails product generation without creating a revision when the terminal result output schema mismatches the workload', async () => {
    const { plan, item, boundary } = await seedApprovedBoundary(app);
    await seedGenerationRuntimeForProject(app, plan.project_id, 'repo-1');
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const resultWriter = app.get(ProductGenerationResultService);

    const actionResponse = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/spec-revisions/generate`)
        .send({ actor_id: actorTech })
        .expect(201)
    ).body;

    const terminalResult = {
      ...generationTerminalResult('development_plan_item_spec_revision', generatedSpecRevision(item.id, boundary.revision_id)),
      output_schema_version: 'spec_revision.v2',
    };
    await terminalizeGenerationRuntimeJob(repository, actionResponse.runtime_job, terminalResult, 'spec-schema-mismatch');
    await expect(
      resultWriter.handleGenerationRuntimeTerminal({
        runtimeJobId: actionResponse.runtime_job.id,
        actionRunId: actionResponse.action_run.id,
        terminalResult,
      }),
    ).resolves.toEqual({ applied: false, reason: 'invalid_precondition' });

    await expect(repository.listSpecs()).resolves.toEqual([]);
    await expect(repository.getAutomationActionRun(actionResponse.action_run.id)).resolves.toMatchObject({
      status: 'failed',
      retryable: false,
      result_json: { product_generation_result: 'invalid_precondition' },
    });
  });

  it('does not apply a product generation result before the runtime job has been worker-terminalized', async () => {
    const { plan, item, boundary } = await seedApprovedBoundary(app);
    await seedGenerationRuntimeForProject(app, plan.project_id, 'repo-1');
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const resultWriter = app.get(ProductGenerationResultService);

    const actionResponse = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/spec-revisions/generate`)
        .send({ actor_id: actorTech })
        .expect(201)
    ).body;

    await expect(
      resultWriter.handleGenerationRuntimeTerminal({
        runtimeJobId: actionResponse.runtime_job.id,
        actionRunId: actionResponse.action_run.id,
        terminalResult: generationTerminalResult('development_plan_item_spec_revision', generatedSpecRevision(item.id, boundary.revision_id)),
      }),
    ).resolves.toEqual({ applied: false, reason: 'invalid_precondition' });

    await expect(repository.listSpecs()).resolves.toEqual([]);
    await expect(repository.getAutomationActionRun(actionResponse.action_run.id)).resolves.toMatchObject({
      status: 'running',
    });
  });

  it('rejects a supplied product generation result that differs from the stored terminal result', async () => {
    const { plan, item, boundary } = await seedApprovedBoundary(app);
    await seedGenerationRuntimeForProject(app, plan.project_id, 'repo-1');
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const resultWriter = app.get(ProductGenerationResultService);

    const actionResponse = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/spec-revisions/generate`)
        .send({ actor_id: actorTech })
        .expect(201)
    ).body;
    const storedTerminalResult = generationTerminalResult(
      'development_plan_item_spec_revision',
      generatedSpecRevision(item.id, boundary.revision_id),
    );
    await terminalizeGenerationRuntimeJob(repository, actionResponse.runtime_job, storedTerminalResult, 'stored-supplied-mismatch');

    const suppliedTerminalResult = {
      ...storedTerminalResult,
      public_summary: 'Different terminal result.',
    };
    await expect(
      resultWriter.handleGenerationRuntimeTerminal({
        runtimeJobId: actionResponse.runtime_job.id,
        actionRunId: actionResponse.action_run.id,
        terminalResult: suppliedTerminalResult,
      }),
    ).resolves.toEqual({ applied: false, reason: 'invalid_precondition' });

    await expect(repository.listSpecs()).resolves.toEqual([]);
    await expect(repository.getAutomationActionRun(actionResponse.action_run.id)).resolves.toMatchObject({
      status: 'failed',
      retryable: false,
      result_json: { product_generation_result: 'invalid_precondition' },
    });
  });

  it('fails product generation explicitly when the generated payload artifact ref has no stored payload', async () => {
    const { plan, item, boundary } = await seedApprovedBoundary(app);
    await seedGenerationRuntimeForProject(app, plan.project_id, 'repo-1');
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const resultWriter = app.get(ProductGenerationResultService);

    const actionResponse = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/spec-revisions/generate`)
        .send({ actor_id: actorTech })
        .expect(201)
    ).body;
    const runtimeJob = actionResponse.runtime_job;
    const { sessionToken, terminalAt } = await startGenerationRuntimeJob(repository, runtimeJob, 'unsupported-payload-ref');
    const generated = generatedSpecRevision(item.id, boundary.revision_id);
    const generatedPayloadDigest = codexCanonicalDigest(generated);
    const artifactId = 'generated-payload-ref';
    const internalRef = `artifact://codex-runtime-jobs/${runtimeJob.id}/artifacts/${artifactId}`;
    const artifact = {
      kind: 'generated_payload',
      name: 'generated-spec.json',
      content_type: 'application/json',
      digest: generatedPayloadDigest,
      internal_ref: internalRef,
    };
    await repository.createCodexRuntimeJobArtifact({
      runtime_job_id: runtimeJob.id,
      worker_id: runtimeJob.worker_id,
      worker_session_token: sessionToken,
      nonce: 'unsupported-payload-ref-artifact',
      nonce_timestamp: terminalAt,
      artifact_id: artifactId,
      artifact_idempotency_key: artifactId,
      ...artifact,
      size_bytes: 70_000,
      metadata_json: {},
      request_digest: digest('unsupported-payload-ref-artifact'),
      replay_protection: {
        method: 'POST',
        path: `/test/product-generation-runtime/${runtimeJob.id}/unsupported-payload-ref/artifact`,
        body_digest: digest('unsupported-payload-ref-artifact-body'),
      },
      now: terminalAt,
    });
    const terminalResult = {
      ...generationTerminalResult('development_plan_item_spec_revision', generated),
      generated_payload: {
        schema_version: 'generated_payload_ref.v1',
        artifact,
      },
      generated_payload_digest: generatedPayloadDigest,
      generation_artifacts: [artifact],
    };
    await repository.terminalizeCodexRuntimeJob({
      runtime_job_id: runtimeJob.id,
      launch_lease_id: runtimeJob.launch_lease_id,
      worker_id: runtimeJob.worker_id,
      worker_session_token: sessionToken,
      nonce: 'unsupported-payload-ref-terminal',
      nonce_timestamp: terminalAt,
      terminal_status: 'succeeded',
      reason_code: 'completed',
      terminal_result_json: terminalResult as unknown as Record<string, unknown>,
      idempotency_key: 'unsupported-payload-ref-terminal',
      request_digest: digest('unsupported-payload-ref-terminal'),
      replay_protection: {
        method: 'POST',
        path: `/test/product-generation-runtime/${runtimeJob.id}/unsupported-payload-ref/terminal`,
        body_digest: digest('unsupported-payload-ref-terminal-body'),
      },
      now: terminalAt,
    });

    await expect(
      resultWriter.handleGenerationRuntimeTerminal({
        runtimeJobId: runtimeJob.id,
        actionRunId: actionResponse.action_run.id,
        terminalResult,
      }),
    ).resolves.toEqual({ applied: false, reason: 'unsupported_generated_payload_ref' });
    await expect(repository.listSpecs()).resolves.toEqual([]);
    await expect(repository.getAutomationActionRun(actionResponse.action_run.id)).resolves.toMatchObject({
      status: 'failed',
      retryable: false,
      result_json: { product_generation_result: 'unsupported_generated_payload_ref' },
    });
  });

  it('applies product generation from an uploaded generated payload artifact ref', async () => {
    const { plan, item, boundary } = await seedApprovedBoundary(app);
    await seedGenerationRuntimeForProject(app, plan.project_id, 'repo-1');
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const resultWriter = app.get(ProductGenerationResultService);

    const actionResponse = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/spec-revisions/generate`)
        .send({ actor_id: actorTech })
        .expect(201)
    ).body;
    const runtimeJob = actionResponse.runtime_job;
    const { sessionToken, terminalAt } = await startGenerationRuntimeJob(repository, runtimeJob, 'payload-ref-success');
    const generated = generatedSpecRevision(item.id, boundary.revision_id);
    const generatedPayloadDigest = codexCanonicalDigest(generated);
    const artifactId = 'generated-payload-ref-success';
    const internalRef = `artifact://codex-runtime-jobs/${runtimeJob.id}/artifacts/${artifactId}`;
    const artifact = {
      kind: 'generated_payload',
      name: 'generated-spec.json',
      content_type: 'application/json',
      digest: generatedPayloadDigest,
      internal_ref: internalRef,
    };
    await repository.createCodexRuntimeJobArtifact({
      runtime_job_id: runtimeJob.id,
      worker_id: runtimeJob.worker_id,
      worker_session_token: sessionToken,
      nonce: 'payload-ref-success-artifact',
      nonce_timestamp: terminalAt,
      artifact_id: artifactId,
      artifact_idempotency_key: artifactId,
      ...artifact,
      size_bytes: 70_000,
      metadata_json: { generated_payload: generated },
      request_digest: digest('payload-ref-success-artifact'),
      replay_protection: {
        method: 'POST',
        path: `/test/product-generation-runtime/${runtimeJob.id}/payload-ref-success/artifact`,
        body_digest: digest('payload-ref-success-artifact-body'),
      },
      now: terminalAt,
    });
    const terminalResult = {
      ...generationTerminalResult('development_plan_item_spec_revision', generated),
      generated_payload: {
        schema_version: 'generated_payload_ref.v1',
        artifact,
      },
      generated_payload_digest: generatedPayloadDigest,
      generation_artifacts: [artifact],
    };
    await repository.terminalizeCodexRuntimeJob({
      runtime_job_id: runtimeJob.id,
      launch_lease_id: runtimeJob.launch_lease_id,
      worker_id: runtimeJob.worker_id,
      worker_session_token: sessionToken,
      nonce: 'payload-ref-success-terminal',
      nonce_timestamp: terminalAt,
      terminal_status: 'succeeded',
      reason_code: 'completed',
      terminal_result_json: terminalResult as unknown as Record<string, unknown>,
      idempotency_key: 'payload-ref-success-terminal',
      request_digest: digest('payload-ref-success-terminal'),
      replay_protection: {
        method: 'POST',
        path: `/test/product-generation-runtime/${runtimeJob.id}/payload-ref-success/terminal`,
        body_digest: digest('payload-ref-success-terminal-body'),
      },
      now: terminalAt,
    });

    await expect(
      resultWriter.handleGenerationRuntimeTerminal({
        runtimeJobId: runtimeJob.id,
        actionRunId: actionResponse.action_run.id,
        terminalResult,
      }),
    ).resolves.toEqual({ applied: true });
    const [spec] = await repository.listSpecs();
    expect(spec).toMatchObject({ development_plan_item_id: item.id, status: 'draft' });
    await expect(repository.getAutomationActionRun(actionResponse.action_run.id)).resolves.toMatchObject({
      status: 'succeeded',
      result_json: { product_generation_result: 'applied' },
    });
  });

  it('applies a Spec generation result through the Codex runtime terminalization service path', async () => {
    const { plan, item, boundary } = await seedApprovedBoundary(app);
    await seedGenerationRuntimeForProject(app, plan.project_id, 'repo-1');
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const codexRuntimeService = app.get(CodexRuntimeService);
    const resultWriter = app.get(ProductGenerationResultService);

    const actionResponse = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/spec-revisions/generate`)
        .send({ actor_id: actorTech })
        .expect(201)
    ).body;
    const terminalResult = generationTerminalResult('development_plan_item_spec_revision', generatedSpecRevision(item.id, boundary.revision_id));
    const { sessionToken, terminalAt } = await startGenerationRuntimeJob(repository, actionResponse.runtime_job, 'spec-service-terminal');

    await codexRuntimeService.terminalizeRuntimeJob(
      actionResponse.runtime_job.worker_id,
      actionResponse.runtime_job.id,
      withBodyDigest({
        worker_session_token: sessionToken,
        nonce: 'spec-service-terminal',
        nonce_timestamp: terminalAt,
        launch_lease_id: actionResponse.runtime_job.launch_lease_id,
        terminal_status: 'succeeded',
        reason_code: 'completed',
        terminal_idempotency_key: 'spec-service-terminal',
        terminal_result_json: terminalResult,
      }),
    );

    const [spec] = await repository.listSpecs();
    expect(spec).toMatchObject({ development_plan_item_id: item.id, status: 'draft' });
    await expect(repository.listSpecRevisions(spec.id)).resolves.toHaveLength(1);
    await expect(repository.getAutomationActionRun(actionResponse.action_run.id)).resolves.toMatchObject({
      status: 'succeeded',
      result_json: { product_generation_result: 'applied' },
    });
    await expect(
      resultWriter.handleGenerationRuntimeTerminal({
        runtimeJobId: actionResponse.runtime_job.id,
        actionRunId: actionResponse.action_run.id,
        terminalResult,
      }),
    ).resolves.toEqual({ applied: true });
    const replayed = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/spec-revisions/generate`)
        .send({ actor_id: actorTech })
        .expect(201)
    ).body;
    expect(replayed.action_run.id).toBe(actionResponse.action_run.id);
    expect(replayed.runtime_job.id).toBe(actionResponse.runtime_job.id);
  });

  it('rejects Spec generation when the approved Boundary Summary belongs to an older item revision', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    await repository.saveDevelopmentPlanItem({
      ...(await repository.getDevelopmentPlanItem(item.id))!,
      revision_id: 'item-revision-after-boundary-approval',
      updated_at: '2026-05-05T00:02:00.000Z',
    });

    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec-revisions/generate`)
      .send({ actor_id: actorTech })
      .expect(400)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('stale_boundary_summary_revision');
      });
  });

  it('rejects legacy Spec draft generation when the approved Boundary Summary belongs to an older item revision', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    await repository.saveDevelopmentPlanItem({
      ...(await repository.getDevelopmentPlanItem(item.id))!,
      revision_id: 'legacy-item-revision-after-boundary-approval',
      updated_at: '2026-05-05T00:02:00.000Z',
    });

    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec/generate-draft`)
      .send({ actor_id: actorTech })
      .expect(400)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('stale_boundary_summary_revision');
      });
  });

  it('does not create a Spec revision when the generation precondition is stale', async () => {
    const { plan, item, boundary } = await seedApprovedBoundary(app);
    await seedGenerationRuntimeForProject(app, plan.project_id, 'repo-1');
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const resultWriter = app.get(ProductGenerationResultService);

    const actionResponse = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/spec-revisions/generate`)
        .send({ actor_id: actorTech })
        .expect(201)
    ).body;
    await repository.saveDevelopmentPlanItem({
      ...(await repository.getDevelopmentPlanItem(item.id))!,
      revision_id: 'stale-spec-item-revision',
      updated_at: '2026-05-05T00:03:00.000Z',
    });

    const terminalResult = generationTerminalResult('development_plan_item_spec_revision', generatedSpecRevision(item.id, boundary.revision_id));
    await terminalizeGenerationRuntimeJob(repository, actionResponse.runtime_job, terminalResult, 'spec-stale');
    await expect(
      resultWriter.handleGenerationRuntimeTerminal({
        runtimeJobId: actionResponse.runtime_job.id,
        actionRunId: actionResponse.action_run.id,
        terminalResult,
      }),
    ).resolves.toEqual({ applied: false, reason: 'stale_precondition_fingerprint' });
    await expect(repository.listSpecs()).resolves.toEqual([]);
  });

  it('replays an already-applied Spec writer result before checking now-stale item preconditions', async () => {
    const { plan, item, boundary } = await seedApprovedBoundary(app);
    await seedGenerationRuntimeForProject(app, plan.project_id, 'repo-1');
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const specPlanService = app.get(SpecPlanService);

    const actionResponse = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/spec-revisions/generate`)
        .send({ actor_id: actorTech })
        .expect(201)
    ).body;
    const actionRun = (await repository.getAutomationActionRun(actionResponse.action_run.id))!;
    const generated = generatedSpecRevision(item.id, boundary.revision_id);

    const first = await specPlanService.writeGeneratedItemSpecRevision({
      actionRun,
      runtime_job_id: actionResponse.runtime_job.id,
      generated,
    });
    expect(first).toMatchObject({ applied: true });

    await expect(
      specPlanService.writeGeneratedItemSpecRevision({
        actionRun,
        runtime_job_id: actionResponse.runtime_job.id,
        generated,
      }),
    ).resolves.toMatchObject({ applied: true, revision: { id: first.applied ? first.revision.id : undefined } });
  });

  it('schedules runtime-backed Implementation Plan Doc generation and writes structured draft fields from the approved Spec', async () => {
    const { plan, item, boundary } = await seedApprovedBoundary(app);
    await seedGenerationRuntimeForProject(app, plan.project_id, 'repo-1');
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const resultWriter = app.get(ProductGenerationResultService);
    const codexRuntimeService = app.get(CodexRuntimeService);
    const specRevision = await generateItemSpecDraft(app, plan.id, item.id);
    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec/submit-for-approval`)
      .send({ actor_id: actorTech })
      .expect(201);
    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec/approve`)
      .send({ actor_id: actorReviewer, rationale: 'Spec approved.' })
      .expect(201);

    const actionResponse = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/implementation-plan-revisions/generate`)
        .send({ actor_id: actorTech })
        .expect(201)
    ).body;

    expect(actionResponse.action_run).toMatchObject({
      action_type: 'generate_development_plan_item_implementation_plan_revision',
      target_object_id: item.id,
      action_input_json: expect.objectContaining({
        approved_boundary_summary_revision_id: boundary.revision_id,
        approved_spec_revision_id: specRevision.id,
        precondition_fingerprint_json: expect.objectContaining({
          approved_boundary_summary_revision_id: boundary.revision_id,
          approved_spec_revision_id: specRevision.id,
        }),
      }),
    });
    expect(actionResponse.action_run.precondition_fingerprint).toBe(
      codexCanonicalDigest(actionResponse.action_run.action_input_json.precondition_fingerprint_json),
    );
    expect(actionResponse.runtime_job).toMatchObject({
      target_type: 'automation_action_run',
      target_id: actionResponse.action_run.id,
      target_kind: 'generation',
      project_id: plan.project_id,
      repo_id: 'repo-1',
      status: 'queued',
      input: { schema_version: 'codex_generation_workload.v1', input_digest: expect.any(String) },
    });
    expect(actionResponse.runtime_job.input_json).toBeUndefined();
    expect(actionResponse.runtime_job.workspace_acquisition_json).toBeUndefined();
    const rawRuntimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: actionResponse.runtime_job.id }))!;
    expect(rawRuntimeJob.input_json).toMatchObject({
      schema_version: 'codex_generation_workload.v1',
      task_kind: 'development_plan_item_execution_plan_revision',
      action_run_id: actionResponse.action_run.id,
    });

    const terminalResult = generationTerminalResult(
      'development_plan_item_execution_plan_revision',
      generatedExecutionPlanRevision(item.id, specRevision.id),
    );
    const { sessionToken, terminalAt } = await startGenerationRuntimeJob(repository, actionResponse.runtime_job, 'execution-plan-success');
    await codexRuntimeService.terminalizeRuntimeJob(
      actionResponse.runtime_job.worker_id,
      actionResponse.runtime_job.id,
      withBodyDigest({
        worker_session_token: sessionToken,
        nonce: 'execution-plan-success-terminal',
        nonce_timestamp: terminalAt,
        launch_lease_id: actionResponse.runtime_job.launch_lease_id,
        terminal_status: 'succeeded',
        reason_code: 'completed',
        terminal_idempotency_key: 'execution-plan-success-terminal',
        terminal_result_json: terminalResult,
      }),
    );
    await expect(
      resultWriter.handleGenerationRuntimeTerminal({
        runtimeJobId: actionResponse.runtime_job.id,
        actionRunId: actionResponse.action_run.id,
        terminalResult,
      }),
    ).resolves.toEqual({ applied: true });

    const [executionPlan] = await repository.listExecutionPlansForDevelopmentPlanItem(item.id);
    expect(executionPlan).toMatchObject({
      development_plan_item_id: item.id,
      status: 'draft',
    });
    expect(executionPlan.approved_revision_id).toBeUndefined();
    const [executionPlanRevision] = await repository.listExecutionPlanRevisions(executionPlan.id);
    expect(executionPlanRevision).toMatchObject({
      development_plan_item_id: item.id,
      based_on_spec_revision_id: specRevision.id,
      summary: 'Generated Implementation Plan Doc revision',
      content: 'Implement the approved Spec in focused slices.',
      author_actor_id: actorTech,
      structured_document: expect.objectContaining({
        implementation_sequence: ['Add schemas', 'Wire worker dispatch'],
        validation_strategy: ['Run targeted runtime tests'],
        allowed_paths: ['packages/codex-runtime/src/**'],
        forbidden_paths: ['packages/db/migrations/**'],
        required_checks: expect.arrayContaining([expect.objectContaining({ check_id: 'unit', blocks_review: true })]),
        rollback_notes: 'Revert generated runtime changes.',
        handoff_criteria: ['Targeted tests pass'],
      }),
    });
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ implementation_plan_status: 'draft' });
    const replayed = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/implementation-plan-revisions/generate`)
        .send({ actor_id: actorTech })
        .expect(201)
    ).body;
    expect(replayed.action_run.id).toBe(actionResponse.action_run.id);
    expect(replayed.runtime_job.id).toBe(actionResponse.runtime_job.id);
  });

  it('does not create an Implementation Plan Doc revision when the approved Spec precondition is stale', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    await seedGenerationRuntimeForProject(app, plan.project_id, 'repo-1');
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const resultWriter = app.get(ProductGenerationResultService);
    const specRevision = await generateItemSpecDraft(app, plan.id, item.id);
    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec/submit-for-approval`)
      .send({ actor_id: actorTech })
      .expect(201);
    const spec = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/spec/approve`)
        .send({ actor_id: actorReviewer, rationale: 'Spec approved.' })
        .expect(201)
    ).body;
    const actionResponse = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/implementation-plan-revisions/generate`)
        .send({ actor_id: actorTech })
        .expect(201)
    ).body;
    await repository.saveSpec({
      ...(await repository.getSpec(spec.id))!,
      approved_revision_id: 'stale-approved-spec-revision',
      updated_at: '2026-05-05T00:04:00.000Z',
    });

    const terminalResult = generationTerminalResult(
      'development_plan_item_execution_plan_revision',
      generatedExecutionPlanRevision(item.id, specRevision.id),
    );
    await terminalizeGenerationRuntimeJob(repository, actionResponse.runtime_job, terminalResult, 'execution-plan-stale');
    await expect(
      resultWriter.handleGenerationRuntimeTerminal({
        runtimeJobId: actionResponse.runtime_job.id,
        actionRunId: actionResponse.action_run.id,
        terminalResult,
      }),
    ).resolves.toEqual({ applied: false, reason: 'stale_precondition_fingerprint' });
    await expect(repository.listExecutionPlansForDevelopmentPlanItem(item.id)).resolves.toEqual([]);
  });

  it('rejects runtime-backed Implementation Plan Doc generation when the item drifts after Spec approval', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    await seedGenerationRuntimeForProject(app, plan.project_id, 'repo-1');
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
    await repository.saveDevelopmentPlanItem({
      ...(await repository.getDevelopmentPlanItem(item.id))!,
      revision_id: 'item-revision-after-spec-approval-drift',
      updated_at: '2026-05-05T00:05:00.000Z',
    });

    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/implementation-plan-revisions/generate`)
      .send({ actor_id: actorTech })
      .expect(400)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('approved_spec_not_current_item_revision');
      });
  });

  it('replays an already-applied Implementation Plan Doc writer result before checking now-stale item preconditions', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    await seedGenerationRuntimeForProject(app, plan.project_id, 'repo-1');
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const specPlanService = app.get(SpecPlanService);
    const specRevision = await generateItemSpecDraft(app, plan.id, item.id);
    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec/submit-for-approval`)
      .send({ actor_id: actorTech })
      .expect(201);
    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec/approve`)
      .send({ actor_id: actorReviewer, rationale: 'Spec approved.' })
      .expect(201);
    const actionResponse = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/implementation-plan-revisions/generate`)
        .send({ actor_id: actorTech })
        .expect(201)
    ).body;
    const actionRun = (await repository.getAutomationActionRun(actionResponse.action_run.id))!;
    const generated = generatedExecutionPlanRevision(item.id, specRevision.id);

    const first = await specPlanService.writeGeneratedItemImplementationPlanRevision({
      actionRun,
      runtime_job_id: actionResponse.runtime_job.id,
      generated,
    });
    expect(first).toMatchObject({ applied: true });

    await expect(
      specPlanService.writeGeneratedItemImplementationPlanRevision({
        actionRun,
        runtime_job_id: actionResponse.runtime_job.id,
        generated,
      }),
    ).resolves.toMatchObject({ applied: true, revision: { id: first.applied ? first.revision.id : undefined } });
  });

  it('rejects legacy Implementation Plan Doc draft generation when the approved Spec no longer matches the approved Boundary Summary revision', async () => {
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
    await repository.saveSpecRevision({
      ...specRevision,
      structured_document: {
        ...(specRevision.structured_document ?? {}),
        boundary_summary_revision_id: 'stale-boundary-summary-revision',
      },
    });

    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/implementation-plan/generate-draft`)
      .send({ actor_id: actorTech })
      .expect(400)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('stale_boundary_summary_revision');
      });
  });

  it('replays runtime-backed Spec generation scheduling for duplicate POSTs', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    await seedGenerationRuntimeForProject(app, plan.project_id, 'repo-1');
    const server = app.getHttpServer();

    const first = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/spec-revisions/generate`)
        .send({ actor_id: actorTech })
        .expect(201)
    ).body;
    const secondResponse = await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec-revisions/generate`)
      .send({ actor_id: actorTech });
    expect(secondResponse.status, JSON.stringify(secondResponse.body)).toBe(201);
    const second = secondResponse.body;

    expect(second.action_run.id).toBe(first.action_run.id);
    expect(second.runtime_job.id).toBe(first.runtime_job.id);
    expect(second.runtime_job.input_digest).toBe(first.runtime_job.input_digest);
  });

  it('replays runtime-backed Implementation Plan Doc generation scheduling for duplicate POSTs', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    await seedGenerationRuntimeForProject(app, plan.project_id, 'repo-1');
    const server = app.getHttpServer();
    await generateItemSpecDraft(app, plan.id, item.id);
    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec/submit-for-approval`)
      .send({ actor_id: actorTech })
      .expect(201);
    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec/approve`)
      .send({ actor_id: actorReviewer, rationale: 'Spec approved.' })
      .expect(201);

    const first = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/implementation-plan-revisions/generate`)
        .send({ actor_id: actorTech })
        .expect(201)
    ).body;
    const secondResponse = await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/implementation-plan-revisions/generate`)
      .send({ actor_id: actorTech });
    expect(secondResponse.status, JSON.stringify(secondResponse.body)).toBe(201);
    const second = secondResponse.body;

    expect(second.action_run.id).toBe(first.action_run.id);
    expect(second.runtime_job.id).toBe(first.runtime_job.id);
    expect(second.runtime_job.input_digest).toBe(first.runtime_job.input_digest);
  });

  it('creates retry runtime jobs from the new claim time instead of the first attempt start time', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    await seedGenerationRuntimeForProject(app, plan.project_id, 'repo-1');
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

    const first = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/spec-revisions/generate`)
        .send({ actor_id: actorTech })
        .expect(201)
    ).body;
    const firstClaim = await repository.getAutomationActionRun(first.action_run.id);
    expect(firstClaim?.claim_token).toBeDefined();
    await repository.completeAutomationActionRun({
      id: firstClaim!.id,
      idempotency_key: firstClaim!.idempotency_key,
      claim_token: firstClaim!.claim_token!,
      status: 'failed',
      retryable: true,
      finished_at: '2026-05-05T00:11:00.000Z',
    });

    vi.stubEnv('FORGELOOP_AUTOMATION_TEST_NOW', '2026-05-05T00:11:30.000Z');
    const second = (
      await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/spec-revisions/generate`)
        .send({ actor_id: actorTech })
        .expect(201)
    ).body;

    expect(second.action_run.id).toBe(first.action_run.id);
    expect(second.runtime_job.id).not.toBe(first.runtime_job.id);
    const secondClaim = await repository.getAutomationActionRun(second.action_run.id);
    const rawSecondRuntimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: second.runtime_job.id }))!;
    expect(secondClaim).toMatchObject({ attempt: 2, claimed_at: rawSecondRuntimeJob.input_json.created_at });
    expect(rawSecondRuntimeJob.input_json).toMatchObject({
      created_at: secondClaim!.claimed_at,
      expires_at: new Date(Date.parse(secondClaim!.claimed_at!) + 10 * 60 * 1000).toISOString(),
    });
  });
});

async function seedRevisionAttachment(
  repository: DeliveryRepository,
  input: {
    id: string;
    objectRef:
      | { type: 'spec_revision'; id: string; spec_id: string }
      | { type: 'implementation_plan_revision'; id: string; implementation_plan_id: string };
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

async function generateItemImplementationPlanDraft(app: INestApplication, developmentPlanId: string, itemId: string) {
  return (
    await request(app.getHttpServer())
      .post(`/development-plans/${developmentPlanId}/items/${itemId}/implementation-plan/generate-draft`)
      .send({ actor_id: actorTech })
      .expect(201)
  ).body;
}

async function seedApprovedBoundary(app: INestApplication, itemOverrides: ItemSeedOverrides = {}) {
  const seeded = await seedDevelopmentPlanItem(app, itemOverrides);
  const server = app.getHttpServer();
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const codexRuntimeService = app.get(CodexRuntimeService);
  await seedGenerationRuntimeForProject(app, seeded.plan.project_id);
  const session = (
    await request(server)
      .post(`/development-plans/${seeded.plan.id}/items/${seeded.item.id}/boundary-brainstorming`)
      .send({ actor_id: actorTech, leader_actor_id: actorTech })
      .expect(201)
  ).body;

  let rounds = await repository.listBoundaryRounds(session.id);
  const firstRoundRuntimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: rounds[0].runtime_job_id! }))!;
  const firstRoundTerminalResult = generationTerminalResult('boundary_brainstorming_round', {
      schema_version: 'boundary_round_result.v1',
      session_id: session.id,
      round_id: rounds[0].id,
      questions: [{ text: 'Which approved Boundary Summary evidence should gate Spec generation?', required: true }],
      proposed_decisions: [{ text: 'Use the approved Boundary Summary revision as the Spec source.' }],
      needs_leader_input: true,
      public_summary: 'Boundary question generated.',
      artifacts: [],
  });
  const firstRoundTerminal = await startGenerationRuntimeJob(repository, firstRoundRuntimeJob, 'boundary-question');
  await codexRuntimeService.terminalizeRuntimeJob(
    firstRoundRuntimeJob.worker_id,
    firstRoundRuntimeJob.id,
    withBodyDigest({
      worker_session_token: firstRoundTerminal.sessionToken,
      nonce: 'boundary-question-terminal',
      nonce_timestamp: firstRoundTerminal.terminalAt,
      launch_lease_id: firstRoundRuntimeJob.launch_lease_id,
      terminal_status: 'succeeded',
      reason_code: 'completed',
      terminal_idempotency_key: 'boundary-question-terminal',
      terminal_result_json: firstRoundTerminalResult,
    }),
  );
  const [question] = await repository.listBoundaryQuestions(session.id);
  await request(server)
    .post(`/boundary-brainstorming-sessions/${session.id}/answers`)
    .send({
      question_id: question.id,
      text: `Answered boundary question: ${question.text}`,
      actor_id: actorTech,
    })
    .expect(201);

  await request(server)
    .post(`/boundary-brainstorming-sessions/${session.id}/decisions`)
    .send({
      text: 'Keep implementation scoped to item-level Spec and Implementation Plan Doc gates.',
      rationale: 'The Development Plan Item is the product boundary.',
      actor_id: actorTech,
    })
    .expect(201);
  await request(server)
    .post(`/boundary-brainstorming-sessions/${session.id}/continue`)
    .send({ actor_id: actorTech, leader_input_markdown: 'Please propose the Boundary Summary for approval.' })
    .expect(201);
  rounds = await repository.listBoundaryRounds(session.id);
  const summaryRound = rounds[1];
  const summaryRuntimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: summaryRound.runtime_job_id! }))!;
  const summaryTerminalResult = generationTerminalResult('boundary_brainstorming_round', {
    schema_version: 'boundary_round_result.v1',
    session_id: session.id,
    round_id: summaryRound.id,
    questions: [],
    proposed_decisions: [],
    summary_proposal: boundarySummaryProposal(),
    needs_leader_input: false,
    public_summary: 'Boundary Summary proposed.',
    artifacts: [],
  });
  const { sessionToken, terminalAt } = await startGenerationRuntimeJob(repository, summaryRuntimeJob, 'boundary-summary');
  await codexRuntimeService.terminalizeRuntimeJob(
    summaryRuntimeJob.worker_id,
    summaryRuntimeJob.id,
    withBodyDigest({
      worker_session_token: sessionToken,
      nonce: 'boundary-summary-terminal',
      nonce_timestamp: terminalAt,
      launch_lease_id: summaryRuntimeJob.launch_lease_id,
      terminal_status: 'succeeded',
      reason_code: 'completed',
      terminal_idempotency_key: 'boundary-summary-terminal',
      terminal_result_json: summaryTerminalResult,
    }),
  );
  const [proposed] = await repository.listBoundarySummaryRevisions((await repository.getBrainstormingSession(session.id))!.boundary_summary_id!);

  const approved = (
    await request(server)
      .post(`/boundary-brainstorming-sessions/${session.id}/summary-revisions/${proposed.id}/approve`)
      .send({
        actor_id: actorTech,
        final_decision: 'Approve this Development Plan Item boundary.',
      })
      .expect(201)
  ).body;

  const boundary = await repository.getBoundarySummary(approved.boundary_summary_id);
  expect(boundary).toBeDefined();

  return { ...seeded, session: approved, boundary: boundary! };
}

type ItemSeedOverrides = Partial<{
  affected_surfaces: string[];
  driver_actor_id: string;
  release_impact: 'none' | 'release_scoped' | 'release_blocking';
  reviewer_actor_id: string;
  risk: 'low' | 'medium' | 'high' | 'critical';
}>;

async function seedDevelopmentPlanItem(app: INestApplication, itemOverrides: ItemSeedOverrides = {}) {
  const { project, workItem } = await createProjectRepoWorkItem(app);
  const server = app.getHttpServer();
  const plan = (
    await request(server)
      .post('/development-plans')
      .send({
        project_id: project.id,
        source_ref: { type: 'requirement', id: workItem.id },
        title: 'Spec and Implementation Plan Doc gate development plan',
        actor_id: actorProduct,
      })
      .expect(201)
  ).body;
  const item = (
    await request(server)
      .post(`/development-plans/${plan.id}/items`)
      .send({
        title: 'Gate Specs and Implementation Plan Docs by item',
        summary: 'Generate and review artifacts only from approved Development Plan Item boundaries.',
        responsible_role: 'tech_lead',
        driver_actor_id: actorTech,
        reviewer_actor_id: actorReviewer,
        risk: 'medium',
        dependency_hints: [],
        affected_surfaces: ['apps/control-plane-api', 'apps/web'],
        release_impact: 'release_scoped',
        ...itemOverrides,
      })
      .expect(201)
  ).body;

  return { project, workItem, plan, item };
}

async function startGenerationRuntimeJob(
  repository: DeliveryRepository,
  runtimeJob: RuntimeJobRef,
  suffix: string,
): Promise<{ sessionToken: string; terminalAt: string; materialization: CodexLaunchMaterialization }> {
  const job = (await repository.getCodexRuntimeJob({ runtime_job_id: runtimeJob.id })) ?? runtimeJob;
  const terminalAt = '2026-05-05T00:00:45.000Z';
  const projectScopedWorkerId = stableUuid({ kind: 'generation-worker', projectId: job.project_id, repoId: 'project' });
  const sessionScopeKey =
    job.worker_id === projectScopedWorkerId || job.repo_id === undefined ? job.project_id : `${job.project_id}-${job.repo_id}`;
  const sessionToken =
    `session-${sessionScopeKey}`;
  const sessionKey =
    `session-key-${sessionScopeKey}`;
  const acceptedSessionDigest = codexCredentialPayloadDigest(sessionToken);
  const envelope = await repository.getCodexRuntimeJobEnvelope({ runtime_job_id: job.id });
  expect(envelope).toBeDefined();
  const launchTokenHash = String(envelope!.ciphertext).replace(/^in-memory:/, '');
  const replayProtection = (step: string) => ({
    method: 'POST' as const,
    path: `/test/product-generation-runtime/${job.id}/${suffix}/${step}`,
    body_digest: digest(`${job.id}:${suffix}:${step}:body`),
  });
  await repository.acceptCodexRuntimeJob({
    runtime_job_id: job.id,
    worker_id: job.worker_id,
    worker_session_token: sessionToken,
    nonce: `${suffix}-accept`,
    nonce_timestamp: terminalAt,
    accepted_worker_session_digest: acceptedSessionDigest,
    accepted_session_public_key_id: sessionKey,
    accepted_session_epoch: 1,
    idempotency_key: `${suffix}-accept`,
    request_digest: digest(`${suffix}:accept`),
    replay_protection: replayProtection('accept'),
    now: terminalAt,
  });
  await repository.claimCodexLaunchTokenEnvelope({
    runtime_job_id: job.id,
    envelope_id: envelope!.id,
    worker_id: job.worker_id,
    worker_session_token: sessionToken,
    nonce: `${suffix}-claim-envelope`,
    nonce_timestamp: terminalAt,
    accepted_worker_session_digest: acceptedSessionDigest,
    key_id: sessionKey,
    accepted_session_epoch: 1,
    claim_request_id: `${suffix}-claim-envelope`,
    request_digest: digest(`${suffix}:claim-envelope`),
    replay_protection: replayProtection('claim-envelope'),
    now: terminalAt,
  });
  const materialization = await repository.materializeCodexRuntimeJob({
    runtime_job_id: job.id,
    launch_lease_id: job.launch_lease_id,
    worker_id: job.worker_id,
    worker_session_token: sessionToken,
    nonce: `${suffix}-materialize`,
    nonce_timestamp: terminalAt,
    launch_token_hash: launchTokenHash,
    accepted_worker_session_digest: acceptedSessionDigest,
    accepted_session_public_key_id: sessionKey,
    accepted_session_epoch: 1,
    materialization_request_id: `${suffix}-materialize`,
    request_digest: digest(`${suffix}:materialize`),
    replay_protection: replayProtection('materialize'),
    now: terminalAt,
  });
  await repository.startCodexRuntimeJob({
    runtime_job_id: job.id,
    worker_id: job.worker_id,
    worker_session_token: sessionToken,
    nonce: `${suffix}-start`,
    nonce_timestamp: terminalAt,
    idempotency_key: `${suffix}-start`,
    request_digest: digest(`${suffix}:start`),
    runtime_evidence_digest: digest(`${suffix}:runtime-evidence`),
    launch_materialization_digest: digest(`${suffix}:launch-materialization`),
    replay_protection: replayProtection('start'),
    now: terminalAt,
  });
  return { sessionToken, terminalAt, materialization };
}

async function terminalizeGenerationRuntimeJob(
  repository: DeliveryRepository,
  runtimeJob: RuntimeJobRef,
  terminalResult: CodexGenerationRuntimeJobResult,
  suffix: string,
) {
  const job = (await repository.getCodexRuntimeJob({ runtime_job_id: runtimeJob.id })) ?? runtimeJob;
  const { sessionToken, terminalAt } = await startGenerationRuntimeJob(repository, runtimeJob, suffix);
  const replayProtection = (step: string) => ({
    method: 'POST' as const,
    path: `/test/product-generation-runtime/${job.id}/${suffix}/${step}`,
    body_digest: digest(`${job.id}:${suffix}:${step}:body`),
  });
  await repository.terminalizeCodexRuntimeJob({
    runtime_job_id: job.id,
    launch_lease_id: job.launch_lease_id,
    worker_id: job.worker_id,
    worker_session_token: sessionToken,
    nonce: `${suffix}-terminal`,
    nonce_timestamp: terminalAt,
    terminal_status: 'succeeded',
    reason_code: 'completed',
    terminal_result_json: terminalResult as unknown as Record<string, unknown>,
    idempotency_key: `${suffix}-terminal`,
    request_digest: digest(`${suffix}:terminal`),
    replay_protection: replayProtection('terminal'),
    now: terminalAt,
  });
}

async function seedGenerationRuntimeForProject(app: INestApplication, projectId: string, repoId?: string) {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const now = '2026-05-05T00:00:00.000Z';
  const expiresAt = '2026-05-05T00:10:00.000Z';
  const networkPolicy = { mode: 'disabled' as const };
  const codexConfigToml = 'approval_policy = "never"\n';
  const scopeKey = repoId ?? 'project';
  const sessionScopeKey = repoId === undefined ? projectId : `${projectId}-${repoId}`;
  const allowedScope = repoId === undefined ? { project_id: projectId } : { project_id: projectId, repo_id: repoId };
  const profileId = stableUuid({ kind: 'generation-profile', projectId, repoId: scopeKey });
  const profileRevisionId = stableUuid({ kind: 'generation-profile-revision', projectId, repoId: scopeKey });
  const credentialBindingId = stableUuid({ kind: 'generation-credential-binding', projectId, repoId: scopeKey });
  const credentialVersionId = stableUuid({ kind: 'generation-credential-version', projectId, repoId: scopeKey });
  const workerId = stableUuid({ kind: 'generation-worker', projectId, repoId: scopeKey });
  const dockerImageDigest = digest('docker-image');
  const networkPolicyDigest = codexRuntimeNetworkPolicyDigest(networkPolicy);
  const revisionWithoutDigest = {
    id: profileRevisionId,
    profile_id: profileId,
    revision_number: 1,
    status: 'active' as const,
    environment: 'test' as const,
    docker_image: 'ghcr.io/forgeloop/codex-worker:test',
    docker_image_digest: dockerImageDigest,
    target_kind: 'generation' as const,
    source_access_mode: 'artifact_only' as const,
    codex_config_toml: codexConfigToml,
    codex_config_digest: codexCanonicalDigest(codexConfigToml),
    expected_effective_config_digest: digest('effective-config'),
    effective_config_assertions: {
      target_kind: 'generation' as const,
      approval_policy: 'never' as const,
      source_write_policy: 'artifact_only' as const,
      forbidden_writable_roots: ['workspace'] as const,
    },
    app_server_required: true,
    allowed_driver_kind: 'app_server' as const,
    network_policy: networkPolicy,
    resource_limits: {
      cpu_ms: 300_000,
      memory_mb: 1024,
      pids: 256,
      fds: 1024,
      workspace_bytes: 1,
      artifact_bytes: 1_048_576,
      timeout_ms: 300_000,
      output_limit_bytes: 1_048_576,
      run_output_limit_bytes: 1_048_576,
    },
    docker_policy: {
      network_disabled: true,
      app_server_only: true,
      rootless: true,
      read_only_rootfs: true,
      no_new_privileges: true,
      drop_capabilities: ['ALL'],
    },
    allowed_scopes: [allowedScope],
    profile_digest: digest('placeholder'),
    created_by_actor_id: actorTech,
    created_at: now,
  } satisfies CodexRuntimeProfileRevision;
  const revision = { ...revisionWithoutDigest, profile_digest: codexRuntimeProfileRevisionDigest(revisionWithoutDigest) };
  await repository.createCodexRuntimeProfileWithRevision({
    profile: {
      id: profileId,
      name: 'Product generation test profile',
      environment: 'test',
      target_kind: 'generation',
      active_revision_id: profileRevisionId,
      created_by_actor_id: actorTech,
      created_at: now,
      updated_at: now,
    },
    revision,
  });
  const secretPayload = { auth: { api_key: 'test-api-key' } };
  await repository.createCodexCredentialBindingWithVersion({
    binding: {
      id: credentialBindingId,
      profile_id: profileId,
      project_id: projectId,
      ...(repoId === undefined ? {} : { repo_id: repoId }),
      provider: 'unsafe_db',
      purpose: 'model_provider',
      active_version_id: credentialVersionId,
      created_by_actor_id: actorTech,
      created_at: now,
      updated_at: now,
    },
    version: {
      id: credentialVersionId,
      binding_id: credentialBindingId,
      version_number: 1,
      status: 'active',
      payload_digest: codexCredentialPayloadDigest(secretPayload),
      created_by_actor_id: actorTech,
      created_at: now,
    },
    secret_payload_json: secretPayload,
  });
  await repository.createCodexWorkerBootstrapToken({
    id: stableUuid({ kind: 'generation-bootstrap', projectId, repoId: scopeKey }),
    worker_identity: `worker-${projectId}-${scopeKey}`,
    bootstrap_token_hash: codexCredentialPayloadDigest(`bootstrap-${projectId}-${scopeKey}`),
    bootstrap_token_version: 1,
    status: 'active',
    allowed_scopes_json: [allowedScope],
    allowed_capabilities_json: {
      target_kinds: ['generation'],
      docker_image_digests: [dockerImageDigest],
      network_policy_digests: [networkPolicyDigest],
    },
    created_by_actor_id: actorTech,
    created_at: now,
    expires_at: expiresAt,
  });
  await repository.upsertCodexWorkerRegistration({
    worker_id: workerId,
    worker_identity: `worker-${projectId}-${scopeKey}`,
    version: 'test-worker',
    bootstrap_token_hash: codexCredentialPayloadDigest(`bootstrap-${projectId}-${scopeKey}`),
    bootstrap_token_version: 1,
    session_token: `session-${sessionScopeKey}`,
    session_expires_at: expiresAt,
    status: 'online',
    control_channel_status: 'connected',
    allowed_scopes: [allowedScope],
    capabilities: ['generation'],
    docker_image_digests: [dockerImageDigest],
    network_policy_digests: [networkPolicyDigest],
    host_worker_uid: 501,
    host_worker_gid: 20,
    lease_count: 0,
    max_concurrency: 100,
    session_public_key_id: `session-key-${sessionScopeKey}`,
    session_public_key_algorithm: 'x25519',
    session_public_key_material: 'base64-public-key-material',
    session_public_key_expires_at: expiresAt,
    now,
  });
  await repository.heartbeatCodexWorker({
    worker_id: workerId,
    session_token: `session-${sessionScopeKey}`,
    nonce: `heartbeat-${projectId}-${scopeKey}`,
    nonce_timestamp: now,
    status: 'online',
    control_channel_status: 'connected',
    active_lease_count: 0,
    capabilities: ['generation'],
    now,
  });
  vi.stubEnv('FORGELOOP_CODEX_GENERATION_RUNTIME_PROFILE_ID', profileId);
  vi.stubEnv('FORGELOOP_CODEX_GENERATION_CREDENTIAL_BINDING_ID', credentialBindingId);
  vi.stubEnv('FORGELOOP_AUTOMATION_TEST_NOW', '2026-05-05T00:00:30.000Z');
  return { profileId, profileRevisionId, credentialBindingId, credentialVersionId, workerId };
}

function stableUuid(input: Record<string, unknown>): string {
  const hex = codexCanonicalDigest(input).slice('sha256:'.length);
  const variant = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function digest(label: string): string {
  return codexCanonicalDigest({ label });
}

const withBodyDigest = <T extends Record<string, unknown>>(body: T): T & { body_digest: string } => ({
  ...body,
  body_digest: codexCanonicalDigest(body),
});

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
      local_path: await createWorkflowPolicyRepoRoot(),
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
        goal: 'Move Spec and Implementation Plan Doc commands to the item boundary.',
        success_criteria: ['Spec and Implementation Plan Doc routes are item-scoped.'],
        priority: 'P0',
        risk: 'medium',
        driver_actor_id: actorProduct,
        intake_context: {
          type: 'requirement',
          stakeholder_problem: 'Direct document-workspace spec and plan routing bypasses item boundaries.',
          desired_outcome: 'Artifacts are generated from approved Development Plan Items.',
          acceptance_criteria: ['Spec and Implementation Plan Doc commands require item gates.'],
          in_scope: ['SpecPlanService API tests'],
        },
      })
      .expect(201)
  ).body;

  return { project, workItem };
};

function boundarySummaryProposal() {
  return {
    summary_markdown: '# Boundary Summary\n\nGenerate Spec and Implementation Plan Doc revisions from the approved item boundary.',
    confirmed_scope: ['Item-scoped Spec and Implementation Plan Doc APIs'],
    confirmed_out_of_scope: ['Direct Work Item creation compatibility'],
    accepted_assumptions: ['Mock draft generation is sufficient for service tests'],
    open_risks: ['Reviewers need structured revision comparison'],
    validation_expectations: ['API and contract tests pass'],
  };
}

function generatedSpecRevision(itemId: string, boundarySummaryRevisionId: string) {
  return {
    schema_version: 'spec_revision.v1',
    development_plan_item_id: itemId,
    boundary_summary_revision_id: boundarySummaryRevisionId,
    summary: 'Generated Spec revision',
    content_markdown: 'Implement the approved boundary.',
    problem_context: 'The Development Plan Item needs a Spec revision.',
    scope_in: ['Spec generation'],
    scope_out: ['Execution'],
    acceptance_criteria: ['Draft Spec revision is created'],
    test_strategy: ['API writer tests'],
    risks: ['Stale boundary'],
    assumptions: ['Leader approved boundary summary'],
    unresolved_questions: [],
    public_summary: 'Generated a Spec revision.',
  };
}

function generatedExecutionPlanRevision(itemId: string, specRevisionId: string) {
  return {
    schema_version: 'execution_plan_revision.v1',
    development_plan_item_id: itemId,
    based_on_spec_revision_id: specRevisionId,
    summary: 'Generated Implementation Plan Doc revision',
    content_markdown: 'Implement the approved Spec in focused slices.',
    implementation_sequence: ['Add schemas', 'Wire worker dispatch'],
    validation_strategy: ['Run targeted runtime tests'],
    allowed_paths: ['packages/codex-runtime/src/**'],
    forbidden_paths: ['packages/db/migrations/**'],
    required_checks: [
      {
        check_id: 'unit',
        command: 'pnpm vitest run tests/codex-runtime/payloads.test.ts',
        timeout_seconds: 120,
        blocks_review: true,
      },
    ],
    rollback_notes: 'Revert generated runtime changes.',
    handoff_criteria: ['Targeted tests pass'],
    public_summary: 'Generated an Implementation Plan Doc revision.',
  };
}

function generationTerminalResult(
  taskKind: CodexGenerationRuntimeJobResult['task_kind'],
  generatedPayload: Record<string, unknown>,
): CodexGenerationRuntimeJobResult {
  const generationContracts: Record<string, { promptVersion: string; outputSchemaVersion: string }> = {
    boundary_brainstorming_round: {
      promptVersion: 'boundary-brainstorming-round:v1',
      outputSchemaVersion: 'boundary_round_result.v1',
    },
    development_plan_item_spec_revision: {
      promptVersion: 'development-plan-item-spec-revision:v1',
      outputSchemaVersion: 'spec_revision.v1',
    },
    development_plan_item_execution_plan_revision: {
      promptVersion: 'development-plan-item-execution-plan-revision:v1',
      outputSchemaVersion: 'execution_plan_revision.v1',
    },
  };
  const contract = generationContracts[taskKind] ?? { promptVersion: 'prompt-v1', outputSchemaVersion: `${taskKind}.v1` };
  return {
    task_kind: taskKind,
    prompt_version: contract.promptVersion,
    output_schema_version: contract.outputSchemaVersion,
    generated_payload: generatedPayload,
    generated_payload_digest: codexCanonicalDigest(generatedPayload),
    generation_artifacts: [],
    public_summary: 'Generated product artifact.',
  };
}
