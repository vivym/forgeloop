import { createHash } from 'node:crypto';

import { INestApplication } from '@nestjs/common';
import type { AttachmentRef } from '@forgeloop/contracts';
import type { Attachment, ExecutionPackage, ExecutionReadinessRecord } from '@forgeloop/domain';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { ProductGenerationResultService } from '../../apps/control-plane-api/src/modules/automation/product-generation-result.service';
import { DELIVERY_REPOSITORY, INTERNAL_ARTIFACT_STORE_ROOT } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import { CodexRuntimeService } from '../../apps/control-plane-api/src/modules/codex-runtime/codex-runtime.service';
import { DEFAULT_SOURCE_MUTATION_POLICY, defaultPackagePolicyFields } from '../../apps/control-plane-api/src/modules/execution-packages/package-policy-fields';
import { SpecPlanService } from '../../apps/control-plane-api/src/modules/spec-plan/spec-plan.service';
import { LocalInternalArtifactStore, type DeliveryRepository } from '../../packages/db/src/index';
import {
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  codexRuntimeNetworkPolicyDigest,
  codexRuntimeProfileRevisionDigest,
  type BoundaryAnswerRecord,
  type BoundaryDecisionRecord,
  type BoundaryQuestionRecord,
  type BrainstormingSession,
  type BoundarySummary,
  type BoundarySummaryRevision,
  type CodexSessionTurn,
  type CodexGenerationRuntimeJobResult,
  type CodexLaunchMaterialization,
  type CodexRuntimeJob,
  type CodexRuntimeProfileRevision,
} from '../../packages/domain/src';
import type { WorkflowChildContext } from '../../apps/control-plane-api/src/modules/brainstorming/brainstorming.service';
import { createWorkflowPolicyRepoRoot } from '../helpers/runtime-policy-repo';

const actorProduct = 'actor-product';
const actorTech = 'actor-tech';
const actorReviewer = 'actor-reviewer';
type RuntimeJobRef = Pick<CodexRuntimeJob, 'id' | 'worker_id' | 'launch_lease_id' | 'project_id' | 'repo_id'>;
type PublicRuntimeJobRef = Pick<CodexRuntimeJob, 'id' | 'project_id' | 'repo_id'>;
const now = '2026-05-23T00:00:00.000Z';
const testCapsuleSequences = new Map<string, number>();
const testCapsuleSequenceByRuntimeJob = new Map<string, number>();

const createRuntimeArtifactObject = async (
  repository: DeliveryRepository,
  input: {
    id: string;
    artifact_id: string;
    ref: string;
    digest: string;
    content_type: string;
    size_bytes: number;
    runtime_job_id: string;
    idempotency_key: string;
    request_digest: string;
    metadata_json: Record<string, unknown>;
    worker_id: string;
    created_at: string;
  },
) =>
  repository.createOrReplayInternalArtifactObject({
    id: input.id,
    artifact_id: input.artifact_id,
    ref: input.ref,
    storage_key: `objects/${input.digest.slice('sha256:'.length)}`,
    kind: 'codex_runtime_job_artifact',
    content_type: input.content_type,
    size_bytes: String(input.size_bytes),
    digest: input.digest,
    visibility: 'internal',
    owner_type: 'codex_runtime_job',
    owner_id: input.runtime_job_id,
    idempotency_key: input.idempotency_key,
    request_digest: input.request_digest,
    metadata_json: input.metadata_json,
    created_by_actor_type: 'codex_worker',
    created_by_actor_id: input.worker_id,
    created_at: input.created_at,
  });

describe('SpecPlanService item-scoped delivery API', () => {
  let app: INestApplication;

  beforeEach(async () => {
    testCapsuleSequences.clear();
    testCapsuleSequenceByRuntimeJob.clear();
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
    const unapprovedWorkflow = await startWorkflowForPlanItem(app, unapprovedPlan.id, unapprovedItem.id, unapprovedPlan.project_id);

    await request(server)
      .post(`/plan-item-workflows/${unapprovedWorkflow.id}/spec/generate-draft`)
      .send({ actor_id: actorTech })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_legacy_entrypoint_disabled');
      });

    const { plan, item, boundary, workflow } = await seedApprovedBoundary(app);
    const specRevision = await generateItemSpecDraft(app, plan.id, item.id);

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
    const { item, workflow } = await seedApprovedBoundary(app);
    const server = app.getHttpServer();

    await expect(generateItemImplementationPlanDraft(app, workflow.development_plan_id, item.id)).rejects.toThrow('spec_not_approved');
  });

  it('uses the source driver as QA owner fallback when Plan Item actors are omitted', async () => {
    const { plan, item } = await seedApprovedBoundary(app, {
      driver_actor_id: undefined,
      reviewer_actor_id: undefined,
    });
    const specRevision = await generateItemSpecDraft(app, plan.id, item.id);
    expect(specRevision.qa_owner_actor_id).toBe(actorProduct);

    await submitCurrentSpecRevision(app, item.id);
    await approveCurrentSpecRevision(app, item.id, actorTech, 'Spec approved with source driver QA fallback.');
    await expect(generateItemImplementationPlanDraft(app, plan.id, item.id)).resolves.toMatchObject({
      development_plan_item_id: item.id,
      based_on_spec_revision_id: specRevision.id,
    });
  });

  it('rejects legacy direct Boundary approval before Spec generation', async () => {
    const seeded = await seedDevelopmentPlanItem(app);
    const server = app.getHttpServer();
    const workflow = await startWorkflowForPlanItem(app, seeded.plan.id, seeded.item.id, seeded.plan.project_id);
    const { session } = await seedApprovedBoundary(app);

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
      .post(`/plan-item-workflows/${workflow.id}/spec/generate-draft`)
      .send({ actor_id: actorTech })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_legacy_entrypoint_disabled');
      });
  });

  it('rejects Implementation Plan Doc generation when required QA and test strategy evidence is missing from approved Spec', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

    const specRevision = await generateItemSpecDraft(app, plan.id, item.id);
    await submitCurrentSpecRevision(app, item.id);
    await approveCurrentSpecRevision(app, item.id, actorReviewer, 'Spec approved without QA evidence.');
    await repository.saveSpecRevision({
      ...specRevision,
      qa_owner_actor_id: undefined,
      testability_note: '',
      acceptance_criteria: [],
      test_strategy_summary: '',
    });

    await expect(generateItemImplementationPlanDraft(app, plan.id, item.id)).rejects.toThrow('qa_test_owner_missing');
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
    await submitCurrentSpecRevision(app, item.id);
    await approveCurrentSpecRevision(app, item.id, actorReviewer, 'Spec approved without QA evidence.');
    await repository.saveSpecRevision({
      ...specRevision,
      qa_owner_actor_id: undefined,
      test_owner_actor_id: undefined,
      testability_note: '',
      acceptance_criteria: [],
      test_strategy_summary: '',
    });

    await expect(generateItemImplementationPlanDraft(app, plan.id, item.id)).rejects.toThrow('qa_test_owner_missing');
  });

  it('supports submit, request changes, regenerate, compare, submit, and approve for Spec reviews', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const workflow = await activeWorkflowForItem(app, item.id);

    const firstSpecRevision = await generateItemSpecDraft(app, plan.id, item.id);
    await submitCurrentSpecRevision(app, item.id);
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ spec_status: 'in_review' });

    await requestItemSpecChanges(app, item.id, firstSpecRevision.id, actorReviewer, 'Clarify acceptance criteria.');
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ spec_status: 'changes_requested' });

    const secondSpecRevision = await regenerateItemSpecDraft(app, plan.id, item.id, 'Add explicit route and API validation.');
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

    await submitCurrentSpecRevision(app, item.id);
    await approveCurrentSpecRevision(app, item.id, actorReviewer, 'Spec approved.');

    const approvedSpec = (await repository.listSpecs()).find((candidate) => candidate.development_plan_item_id === item.id);
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

	    const savedRevision = await saveItemSpecDraft(app, item.id, {
	      markdown,
	      object_ref: { type: 'spec_revision', id: firstSpecRevision.id, spec_id: firstSpecRevision.spec_id },
	      allowed_blocks: ['paragraph', 'heading', 'list', 'link', 'image', 'table', 'code_block', 'inline_code'],
	      attachment_refs: [],
	      validation_version: '2026-05-23',
	    });

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

	    const savedRevision = await saveItemSpecDraft(app, item.id, {
	      markdown: '# Saved Spec draft\n\nText-only edit should keep the attached diagram available.',
	      object_ref: { type: 'spec_revision', id: firstSpecRevision.id, spec_id: firstSpecRevision.spec_id },
	      allowed_blocks: ['paragraph', 'heading', 'link', 'image', 'table', 'code_block', 'inline_code'],
	      attachment_refs: [attachment],
	      validation_version: '2026-05-23',
	    });

    expect(savedRevision.attachment_refs).toEqual([expect.objectContaining({ id: attachment.id })]);
    await expect(repository.listAttachmentsForObject('spec_revision', savedRevision.id)).resolves.toEqual([
      expect.objectContaining({ id: attachment.id }),
    ]);
  });

  it('supports generate after approved Spec, submit, reject, regenerate, and compare for Implementation Plan Doc reviews', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const workflow = await activeWorkflowForItem(app, item.id);

    const specRevision = await generateItemSpecDraft(app, plan.id, item.id);
    await submitCurrentSpecRevision(app, item.id);
    await approveCurrentSpecRevision(app, item.id);

    const firstExecutionPlanRevision = await generateItemImplementationPlanDraft(app, plan.id, item.id);
    expect(firstExecutionPlanRevision).toMatchObject({
      implementation_plan_id: expect.any(String),
      development_plan_item_id: item.id,
      based_on_spec_revision_id: specRevision.id,
      author_actor_id: actorTech,
    });
    expect(firstExecutionPlanRevision).not.toHaveProperty('execution_plan_id');
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ implementation_plan_status: 'draft' });

    await submitCurrentImplementationPlanRevision(app, item.id);
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ implementation_plan_status: 'in_review' });

    const rejectedPlan = await requestItemImplementationPlanChanges(
      app,
      item.id,
      firstExecutionPlanRevision.id,
      actorReviewer,
      'Plan does not include QA handoff validation.',
    );
    expect(rejectedPlan.status).toBe('changes_requested');
    await expect(repository.getDevelopmentPlanItem(item.id)).resolves.toMatchObject({ implementation_plan_status: 'changes_requested' });

    await request(server)
        .post(`/development-plans/${plan.id}/items/${item.id}/implementation-plan/submit-for-approval`)
        .send({ actor_id: actorTech })
        .expect(409);

    const secondExecutionPlanRevision = await regenerateItemImplementationPlanDraft(
      app,
      plan.id,
      item.id,
      'Add QA handoff validation and visual checks.',
    );
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
    const implementationPlan = await repository.getExecutionPlan(firstExecutionPlanRevision.implementation_plan_id);
    await expect(repository.listDecisionsForObject('implementation_plan_doc', implementationPlan!.id)).resolves.toEqual(
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
    await submitCurrentSpecRevision(app, item.id);
    await approveCurrentSpecRevision(app, item.id);

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

    await submitCurrentImplementationPlanRevision(app, item.id);
    await approveCurrentImplementationPlanRevision(app, item.id);

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
    await submitCurrentSpecRevision(app, item.id);
    await approveCurrentSpecRevision(app, item.id);
    const firstExecutionPlanRevision = await generateItemImplementationPlanDraft(app, plan.id, item.id);

	    const savedRevision = await saveItemImplementationPlanDraft(app, item.id, {
	      markdown: '# Saved Implementation Plan Doc draft\n\nPersisted through the item-scoped draft endpoint.',
	      object_ref: {
	        type: 'implementation_plan_revision',
	        id: firstExecutionPlanRevision.id,
	        implementation_plan_id: firstExecutionPlanRevision.implementation_plan_id,
	      },
	      allowed_blocks: ['paragraph', 'heading', 'link', 'image', 'table', 'code_block', 'inline_code'],
	      attachment_refs: [],
	      validation_version: '2026-05-23',
	    });

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
    await submitCurrentSpecRevision(app, item.id);
    await approveCurrentSpecRevision(app, item.id);
    const firstExecutionPlanRevision = await generateItemImplementationPlanDraft(app, plan.id, item.id);
    const attachment = await seedRevisionAttachment(repository, {
      id: 'att-execution-plan-non-inline',
      objectRef: {
        type: 'implementation_plan_revision',
        id: firstExecutionPlanRevision.id,
        implementation_plan_id: firstExecutionPlanRevision.implementation_plan_id,
      },
    });

	    const savedRevision = await saveItemImplementationPlanDraft(app, item.id, {
	      markdown: '# Saved Implementation Plan Doc draft\n\nText-only edit should keep the attached checklist available.',
	      object_ref: {
	        type: 'implementation_plan_revision',
	        id: firstExecutionPlanRevision.id,
	        implementation_plan_id: firstExecutionPlanRevision.implementation_plan_id,
	      },
	      allowed_blocks: ['paragraph', 'heading', 'link', 'image', 'table', 'code_block', 'inline_code'],
	      attachment_refs: [attachment],
	      validation_version: '2026-05-23',
	    });

    expect(savedRevision.attachment_refs).toEqual([expect.objectContaining({ id: attachment.id })]);
    await expect(repository.listAttachmentsForObject('implementation_plan_revision', savedRevision.id)).resolves.toEqual([
      expect.objectContaining({ id: attachment.id }),
    ]);
  });

  it('schedules runtime-backed Spec generation and writes a draft revision from the approved Boundary Summary only', async () => {
    const { plan, item, boundary } = await seedApprovedBoundary(app);
    await seedGenerationRuntimeForProject(app, plan.project_id, 'repo-1');
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const resultWriter = app.get(ProductGenerationResultService);

    const actionResponse = await generateItemSpecRevisionRuntime(app, item.id);

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

    const actionResponse = await generateItemSpecRevisionRuntime(app, item.id);

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

    const actionResponse = await generateItemSpecRevisionRuntime(app, item.id);

    const rawRuntimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: actionResponse.runtime_job.id }))!;
    expect(rawRuntimeJob.repo_id).toBe('repo-1');
    await startGenerationRuntimeJob(repository, actionResponse.runtime_job, 'stale-env-fallback');
    expect(rawRuntimeJob.input_json.codex_session_runtime_context?.continuation).toMatchObject({ kind: 'start_thread' });
    const projectScopedWorkerId = stableUuid({ kind: 'generation-worker', projectId: rawRuntimeJob.project_id, repoId: 'project' });
    const workerSessionScope =
      rawRuntimeJob.worker_id === projectScopedWorkerId || rawRuntimeJob.repo_id === undefined
        ? rawRuntimeJob.project_id
        : `${rawRuntimeJob.project_id}-${rawRuntimeJob.repo_id}`;
    const launchLease = await repository.getCodexLaunchLeaseStatus({
      launch_lease_id: rawRuntimeJob.launch_lease_id,
      worker_id: rawRuntimeJob.worker_id,
      worker_session_token: `session-${workerSessionScope}`,
      nonce: 'stale-env-fallback-lease-status',
      nonce_timestamp: '2026-05-05T00:00:45.000Z',
      replay_protection: {
        method: 'GET',
        path: `/test/product-generation-runtime/${rawRuntimeJob.id}/stale-env-fallback/launch-lease`,
        body_digest: digest(`${rawRuntimeJob.id}:stale-env-fallback:launch-lease:body`),
      },
      now: '2026-05-05T00:00:45.000Z',
    });
    expect(launchLease.profile_revision_id).not.toBe('stale-profile-from-another-control-plane');
  });

  it('fails product generation without a retryable claim when the terminal result prompt contract mismatches the workload', async () => {
    const { plan, item, boundary } = await seedApprovedBoundary(app);
    await seedGenerationRuntimeForProject(app, plan.project_id, 'repo-1');
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const resultWriter = app.get(ProductGenerationResultService);

    const actionResponse = await generateItemSpecRevisionRuntime(app, item.id);

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

    const actionResponse = await generateItemSpecRevisionRuntime(app, item.id);

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

    const actionResponse = await generateItemSpecRevisionRuntime(app, item.id);

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

    const actionResponse = await generateItemSpecRevisionRuntime(app, item.id);
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

    const actionResponse = await generateItemSpecRevisionRuntime(app, item.id);
    const runtimeJob = await requireInternalRuntimeJob(repository, actionResponse.runtime_job.id);
    const { sessionToken, terminalAt } = await startGenerationRuntimeJob(repository, runtimeJob, 'unsupported-payload-ref');
    const generated = generatedSpecRevision(item.id, boundary.revision_id);
    const generatedPayloadDigest = codexCanonicalDigest(generated);
    const artifactId = 'generated-payload-ref';
    const internalRef = `artifact://internal/codex_runtime_job_artifact/codex_runtime_job/${runtimeJob.id}/${artifactId}`;
    const internalArtifactObjectId = stableUuid({ test: 'unsupported-payload-ref', runtime_job_id: runtimeJob.id });
    const artifact = {
      kind: 'generated_payload',
      name: 'generated-spec.json',
      content_type: 'application/json',
      digest: generatedPayloadDigest,
      internal_ref: internalRef,
    };
    await createRuntimeArtifactObject(repository, {
      id: internalArtifactObjectId,
      artifact_id: artifactId,
      ref: internalRef,
      digest: generatedPayloadDigest,
      content_type: 'application/json',
      size_bytes: 70_000,
      runtime_job_id: runtimeJob.id,
      idempotency_key: artifactId,
      request_digest: digest('unsupported-payload-ref-artifact'),
      metadata_json: {},
      worker_id: runtimeJob.worker_id,
      created_at: terminalAt,
    });
    await repository.createCodexRuntimeJobArtifact({
      runtime_job_id: runtimeJob.id,
      worker_id: runtimeJob.worker_id,
      worker_session_token: sessionToken,
      nonce: 'unsupported-payload-ref-artifact',
      nonce_timestamp: terminalAt,
      artifact_id: artifactId,
      artifact_idempotency_key: artifactId,
      ...artifact,
      internal_artifact_object_id: internalArtifactObjectId,
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
    addCodexThreadEvidence(runtimeJob, terminalResult);
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

    const actionResponse = await generateItemSpecRevisionRuntime(app, item.id);
    const runtimeJob = await requireInternalRuntimeJob(repository, actionResponse.runtime_job.id);
    const { sessionToken, terminalAt } = await startGenerationRuntimeJob(repository, runtimeJob, 'payload-ref-success');
    const generated = generatedSpecRevision(item.id, boundary.revision_id);
    const generatedPayloadBytes = Buffer.from(`${JSON.stringify(generated)}\n`, 'utf8');
    const generatedPayloadDigest = codexCanonicalDigest(generated);
    const generatedPayloadByteDigest = rawSha256(generatedPayloadBytes);
    const artifactId = 'generated-payload-ref-success';
    const internalArtifactObject = await new LocalInternalArtifactStore({
      root: app.get(INTERNAL_ARTIFACT_STORE_ROOT) as string,
      repository,
      requestId: 'payload-ref-success',
    }).putObject({
      artifact_id: artifactId,
      kind: 'codex_runtime_job_artifact',
      owner_type: 'codex_runtime_job',
      owner_id: runtimeJob.id,
      visibility: 'internal',
      content_type: 'application/json',
      declared_size_bytes: String(generatedPayloadBytes.byteLength),
      declared_artifact_digest: generatedPayloadByteDigest,
      idempotency_key: artifactId,
      metadata_json: { output_schema_version: 'spec_revision.v1' },
      created_by_actor_type: 'codex_worker',
      created_by_actor_id: runtimeJob.worker_id,
      now: terminalAt,
      max_size_bytes: 1_000_000,
      bytes: generatedPayloadBytes,
    });
    const artifact = {
      kind: 'generated_payload',
      name: 'generated-spec.json',
      content_type: 'application/json',
      digest: generatedPayloadByteDigest,
      internal_ref: internalArtifactObject.ref,
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
      internal_artifact_object_id: internalArtifactObject.id,
      size_bytes: generatedPayloadBytes.byteLength,
      metadata_json: { output_schema_version: 'spec_revision.v1' },
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
    addCodexThreadEvidence(runtimeJob, terminalResult);
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
    const [runtimeArtifact] = await repository.listCodexRuntimeJobArtifacts({ runtime_job_id: runtimeJob.id });
    expect(JSON.stringify(runtimeArtifact?.metadata_json)).not.toContain('generated_payload');
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

    const actionResponse = await generateItemSpecRevisionRuntime(app, item.id);
    const terminalResult = generationTerminalResult('development_plan_item_spec_revision', generatedSpecRevision(item.id, boundary.revision_id));
    const runtimeJob = await requireInternalRuntimeJob(repository, actionResponse.runtime_job.id);
    addCodexThreadEvidence(runtimeJob, terminalResult);
    const { sessionToken, terminalAt } = await startGenerationRuntimeJob(repository, actionResponse.runtime_job, 'spec-service-terminal');

    await codexRuntimeService.terminalizeRuntimeJob(
      runtimeJob.worker_id,
      actionResponse.runtime_job.id,
      withBodyDigest({
        worker_session_token: sessionToken,
        nonce: 'spec-service-terminal',
        nonce_timestamp: terminalAt,
        launch_lease_id: runtimeJob.launch_lease_id,
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
    const replayed = await generateItemSpecRevisionRuntime(app, item.id);
    expect(replayed.action_run.id).toBe(actionResponse.action_run.id);
    expect(replayed.runtime_job.id).toBe(actionResponse.runtime_job.id);
  });

  it('applies runtime-backed Spec generation with QA evidence required by Execution Plan generation', async () => {
    const { plan, item, boundary } = await seedApprovedBoundary(app);
    await seedGenerationRuntimeForProject(app, plan.project_id, 'repo-1');
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const codexRuntimeService = app.get(CodexRuntimeService);

    const actionResponse = await generateItemSpecRevisionRuntime(app, item.id);
    const terminalResult = generationTerminalResult('development_plan_item_spec_revision', generatedSpecRevision(item.id, boundary.revision_id));
    const runtimeJob = await requireInternalRuntimeJob(repository, actionResponse.runtime_job.id);
    addCodexThreadEvidence(runtimeJob, terminalResult);
    const { sessionToken, terminalAt } = await startGenerationRuntimeJob(repository, actionResponse.runtime_job, 'spec-qa-owner');

    await codexRuntimeService.terminalizeRuntimeJob(
      runtimeJob.worker_id,
      actionResponse.runtime_job.id,
      withBodyDigest({
        worker_session_token: sessionToken,
        nonce: 'spec-qa-owner-terminal',
        nonce_timestamp: terminalAt,
        launch_lease_id: runtimeJob.launch_lease_id,
        terminal_status: 'succeeded',
        reason_code: 'completed',
        terminal_idempotency_key: 'spec-qa-owner-terminal',
        terminal_result_json: terminalResult,
      }),
    );

    const [spec] = await repository.listSpecs();
    const [specRevision] = await repository.listSpecRevisions(spec.id);
    expect(specRevision).toMatchObject({
      qa_owner_actor_id: actorReviewer,
      testability_note: expect.stringContaining(item.title),
      acceptance_criteria: ['Draft Spec revision is created'],
      test_strategy_summary: 'API writer tests',
    });

    await submitCurrentSpecRevision(app, item.id);
    await approveCurrentSpecRevision(app, item.id, actorReviewer, 'Runtime Spec approved with QA evidence.');
    await generateItemImplementationPlanRevisionRuntime(app, item.id);
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

    const workflow = await activeWorkflowForItem(app, item.id);
	    await expect(generateItemSpecRevisionRuntime(app, item.id)).rejects.toThrow('stale_boundary_summary_revision');
  });

  it('rejects legacy Spec draft generation through the disabled public mutator', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    const server = app.getHttpServer();

    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/spec/generate-draft`)
      .send({ actor_id: actorTech })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_legacy_entrypoint_disabled');
      });
  });

  it('does not create a Spec revision when the generation precondition is stale', async () => {
    const { plan, item, boundary } = await seedApprovedBoundary(app);
    await seedGenerationRuntimeForProject(app, plan.project_id, 'repo-1');
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const resultWriter = app.get(ProductGenerationResultService);

    const actionResponse = await generateItemSpecRevisionRuntime(app, item.id);
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

    const actionResponse = await generateItemSpecRevisionRuntime(app, item.id);
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
    await submitCurrentSpecRevision(app, item.id);
    await approveCurrentSpecRevision(app, item.id);

    const actionResponse = await generateItemImplementationPlanRevisionRuntime(app, item.id);

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
    const runtimeJob = await requireInternalRuntimeJob(repository, actionResponse.runtime_job.id);
    addCodexThreadEvidence(runtimeJob, terminalResult);
    const { sessionToken, terminalAt } = await startGenerationRuntimeJob(repository, actionResponse.runtime_job, 'execution-plan-success');
    await codexRuntimeService.terminalizeRuntimeJob(
      runtimeJob.worker_id,
      actionResponse.runtime_job.id,
      withBodyDigest({
        worker_session_token: sessionToken,
        nonce: 'execution-plan-success-terminal',
        nonce_timestamp: terminalAt,
        launch_lease_id: runtimeJob.launch_lease_id,
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
    const replayed = await generateItemImplementationPlanRevisionRuntime(app, item.id);
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
    await submitCurrentSpecRevision(app, item.id);
    await approveCurrentSpecRevision(app, item.id);
    const spec = (await repository.listSpecs()).find((candidate) => candidate.development_plan_item_id === item.id)!;
    const actionResponse = await generateItemImplementationPlanRevisionRuntime(app, item.id);
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
    await submitCurrentSpecRevision(app, item.id);
    await approveCurrentSpecRevision(app, item.id);
    await repository.saveDevelopmentPlanItem({
      ...(await repository.getDevelopmentPlanItem(item.id))!,
      revision_id: 'item-revision-after-spec-approval-drift',
      updated_at: '2026-05-05T00:05:00.000Z',
    });

    await expect(generateItemImplementationPlanRevisionRuntime(app, item.id)).rejects.toThrow('approved_spec_not_current_item_revision');
  });

  it('replays an already-applied Implementation Plan Doc writer result before checking now-stale item preconditions', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    await seedGenerationRuntimeForProject(app, plan.project_id, 'repo-1');
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
    const specPlanService = app.get(SpecPlanService);
    const specRevision = await generateItemSpecDraft(app, plan.id, item.id);
    await submitCurrentSpecRevision(app, item.id);
    await approveCurrentSpecRevision(app, item.id);
    const actionResponse = await generateItemImplementationPlanRevisionRuntime(app, item.id);
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

  it('rejects legacy Implementation Plan Doc draft generation through the disabled public mutator', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    const server = app.getHttpServer();

    await request(server)
      .post(`/development-plans/${plan.id}/items/${item.id}/implementation-plan/generate-draft`)
      .send({ actor_id: actorTech })
      .expect(409)
      .expect(({ body }) => {
        expect(JSON.stringify(body)).toContain('workflow_legacy_entrypoint_disabled');
      });
  });

  it('replays runtime-backed Spec generation scheduling for duplicate POSTs', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    await seedGenerationRuntimeForProject(app, plan.project_id, 'repo-1');
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

    const first = await generateItemSpecRevisionRuntime(app, item.id);
    const second = await generateItemSpecRevisionRuntime(app, item.id);

    expect(second.action_run.id).toBe(first.action_run.id);
    expect(second.runtime_job.id).toBe(first.runtime_job.id);
    expect(second.runtime_job.input_digest).toBe(first.runtime_job.input_digest);
    expect(second.action_run.codex_session_turn_id).toBe(first.action_run.codex_session_turn_id);
  });

  it('replays runtime-backed Implementation Plan Doc generation scheduling for duplicate POSTs', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    await seedGenerationRuntimeForProject(app, plan.project_id, 'repo-1');
    const server = app.getHttpServer();
    await generateItemSpecDraft(app, plan.id, item.id);
    await submitCurrentSpecRevision(app, item.id);
    await approveCurrentSpecRevision(app, item.id);

    const first = await generateItemImplementationPlanRevisionRuntime(app, item.id);
    const second = await generateItemImplementationPlanRevisionRuntime(app, item.id);

    expect(second.action_run.id).toBe(first.action_run.id);
    expect(second.runtime_job.id).toBe(first.runtime_job.id);
    expect(second.runtime_job.input_digest).toBe(first.runtime_job.input_digest);
    expect(second.action_run.codex_session_turn_id).toBe(first.action_run.codex_session_turn_id);
  });

  it('replays live running runtime jobs without rebuilding workload timestamps', async () => {
    const { plan, item } = await seedApprovedBoundary(app);
    const generationRuntime = await seedGenerationRuntimeForProject(app, plan.project_id, 'repo-1');
    const server = app.getHttpServer();
    const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;

    const first = await generateItemSpecRevisionRuntime(app, item.id);
    const firstClaim = await repository.getAutomationActionRun(first.action_run.id);
    expect(firstClaim?.claim_token).toBeDefined();
    const retryNow = new Date(Date.parse(firstClaim!.claimed_at!) + 5 * 60 * 1000).toISOString();
    vi.stubEnv('FORGELOOP_AUTOMATION_TEST_NOW', retryNow);
    await repository.heartbeatCodexWorker({
      worker_id: generationRuntime.workerId,
      session_token: generationRuntime.sessionToken,
      nonce: 'heartbeat-live-replay-runtime-job',
      nonce_timestamp: retryNow,
      status: 'online',
      control_channel_status: 'connected',
      active_lease_count: 0,
      capabilities: ['generation'],
      now: retryNow,
    });
    const second = await generateItemSpecRevisionRuntime(app, item.id);

    expect(second.action_run.id).toBe(first.action_run.id);
    expect(second.runtime_job.id).toBe(first.runtime_job.id);
    const secondClaim = await repository.getAutomationActionRun(second.action_run.id);
    const rawSecondRuntimeJob = (await repository.getCodexRuntimeJob({ runtime_job_id: second.runtime_job.id }))!;
    expect(secondClaim).toMatchObject({ attempt: 1, claimed_at: rawSecondRuntimeJob.input_json.created_at });
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
  const specPlanService = app.get(SpecPlanService);
  return specPlanService.generateItemSpecDraft(developmentPlanId, itemId, { actor_id: actorTech }, await createWorkflowContext(app, itemId, {
    intent: 'draft_spec_doc',
    actor_id: actorTech,
    operation: 'test-spec-draft',
  }));
}

async function generateItemImplementationPlanDraft(app: INestApplication, developmentPlanId: string, itemId: string) {
  const specPlanService = app.get(SpecPlanService);
  return specPlanService.generateItemImplementationPlanDraft(
    developmentPlanId,
    itemId,
    { actor_id: actorTech },
    await createWorkflowContext(app, itemId, {
      intent: 'draft_implementation_plan_doc',
      actor_id: actorTech,
      operation: 'test-implementation-plan-draft',
    }),
  );
}

async function generateItemSpecRevisionRuntime(app: INestApplication, itemId: string) {
  const workflow = await activeWorkflowForItem(app, itemId);
  const specPlanService = app.get(SpecPlanService);
  return specPlanService.generateItemSpecRevisionRuntime(
    workflow.development_plan_id,
    itemId,
    { actor_id: actorTech },
    await createWorkflowContext(app, itemId, {
      intent: 'draft_spec_doc',
      actor_id: actorTech,
      operation: 'test-spec-runtime-draft',
    }),
  );
}

async function generateItemImplementationPlanRevisionRuntime(app: INestApplication, itemId: string) {
  const workflow = await activeWorkflowForItem(app, itemId);
  const specPlanService = app.get(SpecPlanService);
  return specPlanService.generateItemImplementationPlanRevisionRuntime(
    workflow.development_plan_id,
    itemId,
    { actor_id: actorTech },
    await createWorkflowContext(app, itemId, {
      intent: 'draft_implementation_plan_doc',
      actor_id: actorTech,
      operation: 'test-implementation-plan-runtime-draft',
    }),
  );
}

async function saveItemSpecDraft(app: INestApplication, itemId: string, document: Parameters<SpecPlanService['saveItemSpecDraft']>[2]) {
  const workflow = await activeWorkflowForItem(app, itemId);
  const specPlanService = app.get(SpecPlanService);
  return specPlanService.saveItemSpecDraft(
    workflow.development_plan_id,
    itemId,
    document,
    await createWorkflowContext(app, itemId, {
      intent: 'revise_spec_doc',
      actor_id: actorTech,
      operation: 'test-spec-save-draft',
    }),
  );
}

async function saveItemImplementationPlanDraft(
  app: INestApplication,
  itemId: string,
  document: Parameters<SpecPlanService['saveItemImplementationPlanDraft']>[2],
) {
  const workflow = await activeWorkflowForItem(app, itemId);
  const specPlanService = app.get(SpecPlanService);
  return specPlanService.saveItemImplementationPlanDraft(
    workflow.development_plan_id,
    itemId,
    document,
    await createWorkflowContext(app, itemId, {
      intent: 'revise_implementation_plan_doc',
      actor_id: actorTech,
      operation: 'test-implementation-plan-save-draft',
    }),
  );
}

async function requestItemSpecChanges(
  app: INestApplication,
  itemId: string,
  _revisionId: string,
  actorId: string,
  rationale: string,
) {
  const workflow = await activeWorkflowForItem(app, itemId);
  const specPlanService = app.get(SpecPlanService);
  return specPlanService.requestItemSpecChanges(
    workflow.development_plan_id,
    itemId,
    { actor_id: actorId, rationale },
    await createWorkflowContext(app, itemId, {
      intent: 'revise_spec_doc',
      actor_id: actorId,
      operation: 'test-spec-request-changes',
    }),
  );
}

async function regenerateItemSpecDraft(app: INestApplication, developmentPlanId: string, itemId: string, feedback: string) {
  const specPlanService = app.get(SpecPlanService);
  return specPlanService.regenerateItemSpecDraft(
    developmentPlanId,
    itemId,
    { actor_id: actorTech, feedback, preserve_prior_decisions: true },
    await createWorkflowContext(app, itemId, {
      intent: 'revise_spec_doc',
      actor_id: actorTech,
      operation: 'test-spec-regenerate-draft',
    }),
  );
}

async function requestItemImplementationPlanChanges(
  app: INestApplication,
  itemId: string,
  _revisionId: string,
  actorId: string,
  rationale: string,
) {
  const workflow = await activeWorkflowForItem(app, itemId);
  const specPlanService = app.get(SpecPlanService);
  return specPlanService.requestItemImplementationPlanChanges(
    workflow.development_plan_id,
    itemId,
    { actor_id: actorId, rationale },
    await createWorkflowContext(app, itemId, {
      intent: 'revise_implementation_plan_doc',
      actor_id: actorId,
      operation: 'test-implementation-plan-request-changes',
    }),
  );
}

async function regenerateItemImplementationPlanDraft(
  app: INestApplication,
  developmentPlanId: string,
  itemId: string,
  feedback: string,
) {
  const specPlanService = app.get(SpecPlanService);
  return specPlanService.regenerateItemImplementationPlanDraft(
    developmentPlanId,
    itemId,
    { actor_id: actorTech, feedback, preserve_prior_decisions: true },
    await createWorkflowContext(app, itemId, {
      intent: 'revise_implementation_plan_doc',
      actor_id: actorTech,
      operation: 'test-implementation-plan-regenerate-draft',
    }),
  );
}

async function startWorkflowForPlanItem(app: INestApplication, planId: string, itemId: string, projectId: string) {
  const generationRuntime = await seedGenerationRuntimeForProject(app, projectId);
  return (
    await request(app.getHttpServer())
      .post(`/development-plans/${planId}/items/${itemId}/workflow/start-brainstorming`)
      .send({
        actor_id: actorTech,
        runtime_profile_id: generationRuntime.profileId,
        runtime_profile_revision_id: generationRuntime.profileRevisionId,
        credential_binding_id: generationRuntime.credentialBindingId,
        credential_binding_version_id: generationRuntime.credentialVersionId,
        reason: 'Start Spec/Plan service workflow fixture.',
      })
      .expect(201)
  ).body;
}

async function submitCurrentSpecRevision(app: INestApplication, itemId: string, actorId = actorTech) {
  const workflow = await activeWorkflowForItem(app, itemId);
  const revision = await currentSpecRevisionForItem(app, itemId);
  const specPlanService = app.get(SpecPlanService);
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const spec = await repository.withDeliveryTransaction((transaction) =>
    specPlanService.submitItemSpecForApprovalWithRepository(transaction, workflow.development_plan_id, itemId, {
      actor_id: actorId,
      reason: 'Submit Spec for review.',
    }),
  );
  await transitionWorkflowForSpecSubmit(app, workflow.id, revision.id, actorId);
  return spec;
}

async function approveCurrentSpecRevision(app: INestApplication, itemId: string, actorId = actorReviewer, reason = 'Spec approved.') {
  const workflow = await activeWorkflowForItem(app, itemId);
  const revision = await currentSpecRevisionForItem(app, itemId);
  const specPlanService = app.get(SpecPlanService);
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const spec = await repository.withDeliveryTransaction((transaction) =>
    specPlanService.approveItemSpecWithRepository(transaction, workflow.development_plan_id, itemId, {
      actor_id: actorId,
      rationale: reason,
    }),
  );
  await transitionWorkflowForSpecApproval(app, workflow.id, revision.id, actorId);
  return spec;
}

async function submitCurrentImplementationPlanRevision(app: INestApplication, itemId: string, actorId = actorTech) {
  const workflow = await activeWorkflowForItem(app, itemId);
  const revision = await currentImplementationPlanRevisionForItem(app, itemId);
  const specPlanService = app.get(SpecPlanService);
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const implementationPlan = await repository.withDeliveryTransaction((transaction) =>
    specPlanService.submitItemImplementationPlanForApprovalWithRepository(transaction, workflow.development_plan_id, itemId, {
      actor_id: actorId,
      reason: 'Submit Implementation Plan Doc for review.',
    }),
  );
  await transitionWorkflowForImplementationPlanSubmit(app, workflow.id, revision.id, actorId);
  return implementationPlan;
}

async function approveCurrentImplementationPlanRevision(
  app: INestApplication,
  itemId: string,
  actorId = actorReviewer,
  reason = 'Implementation Plan Doc approved.',
) {
  const workflow = await activeWorkflowForItem(app, itemId);
  const revision = await currentImplementationPlanRevisionForItem(app, itemId);
  const specPlanService = app.get(SpecPlanService);
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const implementationPlan = await repository.withDeliveryTransaction((transaction) =>
    specPlanService.approveItemImplementationPlanWithRepository(transaction, workflow.development_plan_id, itemId, {
      actor_id: actorId,
      rationale: reason,
    }),
  );
	  await transitionWorkflowForImplementationPlanApproval(app, workflow.id, revision.id, actorId);
	  return implementationPlan;
	}

async function saveExecutionReadinessForApprovedImplementationPlan(
  repository: DeliveryRepository,
  input: {
    workflow_id: string;
    development_plan_id: string;
    development_plan_item_id: string;
    codex_session_id: string;
    boundary_revision_id: string;
    spec_revision_id: string;
    implementation_plan_revision_id: string;
    implementation_plan_turn_id?: string;
    actor_id: string;
  },
): Promise<ExecutionReadinessRecord> {
  const readiness: ExecutionReadinessRecord = {
    id: stableUuid({
      kind: 'spec-plan-service-readiness',
      workflowId: input.workflow_id,
      implementationPlanRevisionId: input.implementation_plan_revision_id,
    }),
    workflow_id: input.workflow_id,
    development_plan_id: input.development_plan_id,
    development_plan_item_id: input.development_plan_item_id,
    codex_session_id: input.codex_session_id,
    ...(input.implementation_plan_turn_id === undefined ? {} : { codex_session_turn_id: input.implementation_plan_turn_id }),
    approved_boundary_summary_revision_id: input.boundary_revision_id,
    approved_spec_revision_id: input.spec_revision_id,
    approved_implementation_plan_revision_id: input.implementation_plan_revision_id,
    readiness_state: 'ready',
    blocker_codes: [],
    supporting_evidence: [{ object_type: 'implementation_plan_revision', object_id: input.implementation_plan_revision_id }],
    created_by_actor_id: input.actor_id,
    created_at: now,
  };
  await repository.saveExecutionReadinessRecord(readiness);
  return readiness;
}

async function createWorkflowContext(
  app: INestApplication,
  itemId: string,
  input: {
    intent: CodexSessionTurn['intent'];
    actor_id: string;
    operation: string;
  },
): Promise<WorkflowChildContext> {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const workflow = await activeWorkflowForItem(app, itemId);
  if (workflow.active_codex_session_id === undefined) {
    throw new Error(`Workflow ${workflow.id} has no active Codex session`);
  }
  const session = await repository.getCodexSession(workflow.active_codex_session_id);
  if (session === undefined) {
    throw new Error(`Codex session ${workflow.active_codex_session_id} was not found`);
  }
  const turn = await createWorkflowFixtureTurn(repository, workflow, session, {
    id: stableUuid({
      kind: 'spec-plan-service-context-turn',
      itemId,
      operation: input.operation,
      count: (await repository.listCodexSessionTurns(session.id)).length + 1,
    }),
    intent: input.intent,
    actor_id: input.actor_id,
  });
  return {
    workflow_id: workflow.id,
    codex_session_id: session.id,
    codex_session_turn_id: turn.id,
  };
}

async function transitionWorkflowForSpecSubmit(app: INestApplication, workflowId: string, revisionId: string, actorId: string) {
  await applyWorkflowTransition(app, {
    workflowId,
    toStatus: 'spec_review',
    actorId,
    evidenceObjectType: 'spec_revision',
    evidenceObjectId: revisionId,
  });
}

async function transitionWorkflowForSpecApproval(app: INestApplication, workflowId: string, revisionId: string, actorId: string) {
  await applyWorkflowTransition(app, {
    workflowId,
    toStatus: 'implementation_plan_generation_queued',
    actorId,
    evidenceObjectType: 'spec_revision',
    evidenceObjectId: revisionId,
    projectionPatch: { active_spec_doc_revision_id: revisionId },
  });
}

async function transitionWorkflowForImplementationPlanSubmit(app: INestApplication, workflowId: string, revisionId: string, actorId: string) {
  await applyWorkflowTransition(app, {
    workflowId,
    toStatus: 'implementation_plan_review',
    actorId,
    evidenceObjectType: 'implementation_plan_revision',
    evidenceObjectId: revisionId,
  });
}

async function transitionWorkflowForImplementationPlanApproval(
  app: INestApplication,
  workflowId: string,
  revisionId: string,
  actorId: string,
) {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const workflow = await repository.getPlanItemWorkflow(workflowId);
  if (
    workflow === undefined ||
    workflow.active_codex_session_id === undefined ||
    workflow.active_boundary_summary_revision_id === undefined ||
    workflow.active_spec_doc_revision_id === undefined
  ) {
    throw new Error(`Workflow ${workflowId} is missing approved document evidence`);
  }
  const revision = await repository.getExecutionPlanRevision(revisionId);
  const readiness = await saveExecutionReadinessForApprovedImplementationPlan(repository, {
    workflow_id: workflow.id,
    development_plan_id: workflow.development_plan_id,
    development_plan_item_id: workflow.development_plan_item_id,
    codex_session_id: workflow.active_codex_session_id,
    boundary_revision_id: workflow.active_boundary_summary_revision_id,
    spec_revision_id: workflow.active_spec_doc_revision_id,
    implementation_plan_revision_id: revisionId,
    ...(revision?.codex_session_turn_id === undefined ? {} : { implementation_plan_turn_id: revision.codex_session_turn_id }),
    actor_id: actorId,
  });
  await applyWorkflowTransition(app, {
    workflowId,
    toStatus: 'execution_ready',
    actorId,
    evidenceObjectType: 'execution_readiness_record',
    evidenceObjectId: readiness.id,
    projectionPatch: { active_implementation_plan_doc_revision_id: revisionId },
    supportingEvidence: [{ object_type: 'implementation_plan_revision', object_id: revisionId }],
  });
}

async function applyWorkflowTransition(
  app: INestApplication,
  input: {
    workflowId: string;
	    toStatus:
	      | 'spec_review'
	      | 'implementation_plan_generation_queued'
	      | 'implementation_plan_review'
	      | 'execution_ready';
	    actorId: string;
	    evidenceObjectType: 'spec_revision' | 'implementation_plan_revision' | 'execution_readiness_record';
	    evidenceObjectId: string;
	    projectionPatch?: {
	      active_spec_doc_revision_id?: string;
	      active_implementation_plan_doc_revision_id?: string;
	    };
	    supportingEvidence?: Array<{ object_type: 'implementation_plan_revision'; object_id: string }>;
	  },
	) {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const workflow = await repository.getPlanItemWorkflow(input.workflowId);
  if (workflow === undefined) {
    throw new Error(`Workflow ${input.workflowId} was not found`);
  }
  if (workflow.status === input.toStatus) {
    return workflow;
  }
  if (workflow.active_codex_session_id === undefined) {
    throw new Error(`Workflow ${input.workflowId} has no active Codex session`);
  }
	  return repository.applyPlanItemWorkflowTransition({
	    transition: {
	      id: stableUuid({
	        kind: 'spec-plan-service-transition',
	        workflowId: input.workflowId,
        toStatus: input.toStatus,
        evidenceObjectId: input.evidenceObjectId,
      }),
      workflow_id: workflow.id,
      from_status: workflow.status,
      to_status: input.toStatus,
      actor_id: input.actorId,
	      evidence_object_type: input.evidenceObjectType,
	      evidence_object_id: input.evidenceObjectId,
	      codex_session_id: workflow.active_codex_session_id,
	      created_at: now,
	      ...(input.supportingEvidence === undefined ? {} : { supporting_evidence: input.supportingEvidence }),
	    },
	    ...(input.projectionPatch === undefined ? {} : { projection_patch: input.projectionPatch }),
	  });
	}

async function activeWorkflowForItem(app: INestApplication, itemId: string) {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const workflow = await repository.getActivePlanItemWorkflowByItem(itemId);
  if (workflow === undefined) {
    throw new Error(`Active workflow for item ${itemId} was not found`);
  }
  return workflow;
}

async function currentSpecRevisionForItem(app: INestApplication, itemId: string) {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const spec = (await repository.listSpecs()).find((candidate) => candidate.development_plan_item_id === itemId);
  if (spec?.current_revision_id === undefined) {
    throw new Error(`Current Spec revision for item ${itemId} was not found`);
  }
  const revision = await repository.getSpecRevision(spec.current_revision_id);
  if (revision === undefined) {
    throw new Error(`Spec revision ${spec.current_revision_id} was not found`);
  }
  return revision;
}

async function currentImplementationPlanRevisionForItem(app: INestApplication, itemId: string) {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const [executionPlan] = await repository.listExecutionPlansForDevelopmentPlanItem(itemId);
  if (executionPlan?.current_revision_id === undefined) {
    throw new Error(`Current Implementation Plan Doc revision for item ${itemId} was not found`);
  }
  const revision = await repository.getExecutionPlanRevision(executionPlan.current_revision_id);
  if (revision === undefined) {
    throw new Error(`Implementation Plan Doc revision ${executionPlan.current_revision_id} was not found`);
  }
  return revision;
}

async function seedApprovedBoundary(app: INestApplication, itemOverrides: ItemSeedOverrides = {}) {
  const seeded = await seedDevelopmentPlanItem(app, itemOverrides);
  const server = app.getHttpServer();
	  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
	  const generationRuntime = await seedGenerationRuntimeForProject(app, seeded.plan.project_id);
	  const workflowActorId = seeded.item.driver_actor_id ?? seeded.item.reviewer_actor_id ?? seeded.workItem.driver_actor_id;
	  const startedWorkflow = (
    await request(server)
      .post(`/development-plans/${seeded.plan.id}/items/${seeded.item.id}/workflow/start-brainstorming`)
      .send({
        actor_id: workflowActorId,
        runtime_profile_id: generationRuntime.profileId,
        runtime_profile_revision_id: generationRuntime.profileRevisionId,
        credential_binding_id: generationRuntime.credentialBindingId,
        credential_binding_version_id: generationRuntime.credentialVersionId,
        reason: 'Start Spec/Plan service workflow fixture.',
	      })
	      .expect(201)
	  ).body;
	  const workflow = (await repository.getPlanItemWorkflow(startedWorkflow.id))!;
	  const activeSession = await repository.getCodexSession(workflow.active_codex_session_id!);
	  if (activeSession === undefined) {
	    throw new Error(`Active workflow session ${workflow.active_codex_session_id} was not persisted`);
	  }
	  const contextManifest = await seedBoundaryContextManifest(repository, seeded, workflow);
	  const turn = await createWorkflowFixtureTurn(repository, workflow, activeSession, {
	    id: stableUuid({ kind: 'spec-plan-boundary-turn', itemId: seeded.item.id }),
	    intent: 'draft_boundary_summary',
	    actor_id: actorTech,
	  });
	  const question: BoundaryQuestionRecord = {
	    id: stableUuid({ kind: 'spec-plan-boundary-question', itemId: seeded.item.id }),
	    session_id: stableUuid({ kind: 'spec-plan-boundary-session', itemId: seeded.item.id }),
	    sequence: 1,
	    round_id: stableUuid({ kind: 'spec-plan-boundary-round', itemId: seeded.item.id }),
	    text: 'Which approved Boundary Summary evidence should gate Spec generation?',
	    author_id: actorTech,
	    created_at: now,
	    status: 'resolved',
	    required: true,
	    answered_by_answer_id: stableUuid({ kind: 'spec-plan-boundary-answer', itemId: seeded.item.id }),
	  };
	  const answer: BoundaryAnswerRecord = {
	    id: question.answered_by_answer_id!,
	    session_id: question.session_id,
	    sequence: 1,
	    question_id: question.id,
	    round_id: question.round_id,
	    text: `Answered boundary question: ${question.text}`,
	    actor_id: actorTech,
	    actor_role: 'leader',
	    created_at: now,
	  };
	  const decision: BoundaryDecisionRecord = {
	    id: stableUuid({ kind: 'spec-plan-boundary-decision', itemId: seeded.item.id }),
	    session_id: question.session_id,
	    sequence: 1,
	    round_id: question.round_id,
	    text: 'Keep implementation scoped to item-level Spec and Implementation Plan Doc gates.',
	    rationale: 'The Development Plan Item is the product boundary.',
	    actor_id: actorTech,
	    actor_role: 'leader',
	    source: 'leader',
	    state: 'accepted',
	    created_at: now,
	  };
	  const boundarySummaryId = stableUuid({ kind: 'spec-plan-boundary-summary', itemId: seeded.item.id });
	  const boundaryRevisionId = stableUuid({ kind: 'spec-plan-boundary-summary-revision', itemId: seeded.item.id });
	  const session: BrainstormingSession = {
	    id: question.session_id,
	    revision_id: stableUuid({ kind: 'spec-plan-boundary-session-revision', itemId: seeded.item.id }),
	    source_ref: { type: 'requirement', id: seeded.workItem.id },
	    development_plan_id: seeded.plan.id,
	    development_plan_revision_id: seeded.plan.revision_id,
	    development_plan_item_id: seeded.item.id,
	    development_plan_item_revision_id: seeded.item.revision_id,
	    context_manifest_id: contextManifest.id,
	    context_manifest_revision_id: contextManifest.revision_id,
	    leader_actor_id: actorTech,
	    leader_delegate_actor_ids: [],
	    status: 'approved',
	    current_round_id: question.round_id,
	    latest_summary_revision_id: boundaryRevisionId,
	    approved_summary_revision_id: boundaryRevisionId,
	    closed_at: now,
	    questions: [question],
	    answers: [answer],
	    decisions: [decision],
	    approval_state: 'approved',
	    boundary_summary_id: boundarySummaryId,
	    approver_actor_id: actorTech,
	    approved_at: now,
	    workflow_id: workflow.id,
	    codex_session_id: activeSession.id,
	    created_at: now,
	    updated_at: now,
	  };
	  await repository.saveBrainstormingSession(session);
	  await repository.saveBoundaryRound({
	    id: question.round_id!,
	    session_id: session.id,
	    session_revision_id: session.revision_id,
	    round_number: 1,
	    trigger: 'summary_proposal',
	    status: 'terminal',
	    codex_session_turn_id: turn.id,
	    created_at: now,
	    updated_at: now,
	  });
	  await repository.saveBoundaryQuestion(question);
	  await repository.saveBoundaryAnswer(answer);
	  await repository.saveBoundaryDecision(decision);
	  const boundary: BoundarySummary = {
	    id: boundarySummaryId,
	    revision_id: boundaryRevisionId,
	    brainstorming_session_id: session.id,
	    brainstorming_session_revision_id: session.revision_id,
	    development_plan_id: seeded.plan.id,
	    development_plan_item_id: seeded.item.id,
	    development_plan_item_revision_id: seeded.item.revision_id,
	    source_ref: { type: 'requirement', id: seeded.workItem.id },
	    summary: 'Approved item boundary for Spec and Implementation Plan Doc service tests.',
	    approved_by_actor_id: actorTech,
	    approved_at: now,
	    created_at: now,
	    updated_at: now,
	  };
	  await repository.saveBoundarySummary(boundary);
	  const revision: BoundarySummaryRevision = {
	    id: boundaryRevisionId,
	    boundary_summary_id: boundarySummaryId,
	    session_id: session.id,
	    session_revision_id: session.revision_id,
	    source_round_id: question.round_id!,
	    development_plan_id: seeded.plan.id,
	    development_plan_item_id: seeded.item.id,
	    development_plan_item_revision_id: seeded.item.revision_id,
	    workflow_id: workflow.id,
	    codex_session_id: activeSession.id,
	    codex_session_turn_id: turn.id,
	    revision_number: 1,
	    status: 'approved',
	    summary_markdown: boundarySummaryProposal().summary_markdown,
	    confirmed_scope: boundarySummaryProposal().confirmed_scope,
	    confirmed_out_of_scope: boundarySummaryProposal().confirmed_out_of_scope,
	    accepted_assumptions: boundarySummaryProposal().accepted_assumptions,
	    open_risks: boundarySummaryProposal().open_risks,
	    validation_expectations: boundarySummaryProposal().validation_expectations,
	    question_answer_snapshot: [{ question_id: question.id, answer_id: answer.id, text: answer.text }],
	    decision_snapshot: [{ decision_id: decision.id, text: decision.text, rationale: decision.rationale }],
	    decision_count: 1,
	    context_manifest_id: contextManifest.id,
	    context_manifest_revision_id: contextManifest.revision_id,
	    approved_by_actor_id: actorTech,
	    approved_at: now,
	    created_at: now,
	  } as BoundarySummaryRevision;
	  await repository.saveBoundarySummaryRevision(revision);
	  const boundaryReviewWorkflow = await repository.applyPlanItemWorkflowTransition({
	    transition: {
	      id: stableUuid({ kind: 'spec-plan-boundary-submitted-transition', itemId: seeded.item.id }),
	      workflow_id: workflow.id,
	      from_status: workflow.status,
	      to_status: 'boundary_review',
	      actor_id: actorTech,
	      evidence_object_type: 'boundary_summary_revision',
	      evidence_object_id: revision.id,
	      codex_session_id: activeSession.id,
	      created_at: now,
	    },
	  });
	  const approvedWorkflow = await repository.applyPlanItemWorkflowTransition({
	    transition: {
	      id: stableUuid({ kind: 'spec-plan-boundary-approved-transition', itemId: seeded.item.id }),
	      workflow_id: workflow.id,
	      from_status: boundaryReviewWorkflow.status,
	      to_status: 'spec_generation_queued',
	      actor_id: actorTech,
	      evidence_object_type: 'boundary_summary_revision',
	      evidence_object_id: revision.id,
	      codex_session_id: activeSession.id,
	      created_at: now,
	    },
	    projection_patch: { active_boundary_summary_revision_id: revision.id },
	  });
	  await repository.saveDevelopmentPlanItem({
	    ...seeded.item,
	    boundary_status: 'approved',
	    spec_status: 'missing',
	    next_action: 'generate_spec',
	    updated_at: now,
	  });

	  return { ...seeded, workflow: approvedWorkflow, session, boundary };
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

async function seedBoundaryContextManifest(
  repository: DeliveryRepository,
  seeded: Awaited<ReturnType<typeof seedDevelopmentPlanItem>>,
  workflow: { id: string; active_codex_session_id?: string },
): Promise<ContextManifest> {
  const manifest: ContextManifest = {
    id: stableUuid({ kind: 'spec-plan-boundary-context-manifest', itemId: seeded.item.id }),
    revision_id: stableUuid({ kind: 'spec-plan-boundary-context-manifest-revision', itemId: seeded.item.id }),
    source_ref: { type: 'requirement', id: seeded.workItem.id },
    project_id: seeded.project.id,
    development_plan_id: seeded.plan.id,
    development_plan_revision_id: seeded.plan.revision_id,
    development_plan_item_id: seeded.item.id,
    development_plan_item_revision_id: seeded.item.revision_id,
    actor_guidance: actorTech,
    sources: [
      { type: 'development_plan', ref: seeded.plan.id, digest: seeded.plan.revision_id },
      { type: 'development_plan_item', ref: seeded.item.id, digest: seeded.item.revision_id },
      { type: 'requirement', ref: seeded.workItem.id, digest: seeded.workItem.updated_at },
    ],
    generated_at: now,
    runtime_identity: 'test:spec-plan-service-seeded-boundary',
    workflow_id: workflow.id,
    ...(workflow.active_codex_session_id === undefined ? {} : { codex_session_id: workflow.active_codex_session_id }),
    created_at: now,
    updated_at: now,
  };
  await repository.saveContextManifest(manifest);
  return manifest;
}

async function createWorkflowFixtureTurn(
  repository: DeliveryRepository,
  workflow: { id: string },
  session: { id: string; latest_capsule_digest?: string },
  input: {
    id: string;
    intent: CodexSessionTurn['intent'];
    actor_id: string;
  },
): Promise<CodexSessionTurn> {
  const turn: CodexSessionTurn = {
    id: input.id,
    workflow_id: workflow.id,
    codex_session_id: session.id,
    intent: input.intent,
    status: 'running',
    input_digest: codexCanonicalDigest({
      workflow_id: workflow.id,
      codex_session_id: session.id,
      fixture_turn_id: input.id,
      expected_input_capsule_digest: session.latest_capsule_digest ?? null,
    }),
    ...(session.latest_capsule_digest === undefined ? {} : { expected_input_capsule_digest: session.latest_capsule_digest }),
    created_by_actor_id: input.actor_id,
    created_at: now,
    updated_at: now,
  };
  await repository.createCodexSessionTurn(turn);
  return turn;
}

async function startGenerationRuntimeJob(
  repository: DeliveryRepository,
  runtimeJob: PublicRuntimeJobRef,
  suffix: string,
): Promise<{ sessionToken: string; terminalAt: string; materialization?: CodexLaunchMaterialization }> {
  const job = await requireInternalRuntimeJob(repository, runtimeJob.id);
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
  const runtimeContext = job.input_json.codex_session_runtime_context;
  const continuation =
    runtimeContext !== undefined &&
    typeof runtimeContext === 'object' &&
    runtimeContext !== null &&
    'continuation' in runtimeContext &&
    typeof runtimeContext.continuation === 'object' &&
    runtimeContext.continuation !== null &&
    'kind' in runtimeContext.continuation
      ? runtimeContext.continuation.kind
      : undefined;
  if (continuation === 'resume_thread') {
    const runnerRuntimeJobId = String((runtimeContext as { runner_runtime_job_id?: unknown }).runner_runtime_job_id);
    const runnerLaunchLeaseId = String((runtimeContext as { runner_launch_lease_id?: unknown }).runner_launch_lease_id);
    await repository.attachCodexSessionRunnerRuntimeJob({
      session_id: job.codex_session_id!,
      runner_runtime_job_id: runnerRuntimeJobId,
      runner_launch_lease_id: runnerLaunchLeaseId,
      runner_expires_at: new Date(Date.parse(terminalAt) + 10 * 60 * 1000).toISOString(),
      attached_runtime_job_id: job.id,
      worker_id: job.worker_id,
      worker_session_token: sessionToken,
      nonce: `${suffix}-attach`,
      nonce_timestamp: terminalAt,
      runtime_evidence_digest: digest(`${suffix}:runtime-evidence`),
      launch_materialization_digest: digest(`${suffix}:launch-materialization`),
      idempotency_key: `${suffix}-start`,
      request_digest: digest(`${suffix}:start`),
      replay_protection: replayProtection('attach'),
      now: terminalAt,
    });
    return { sessionToken, terminalAt };
  }
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
  if (job.codex_session_id !== undefined && job.codex_session_turn_id !== undefined) {
    await repository.markCodexSessionRunnerOwner({
      session_id: job.codex_session_id,
      runner_worker_id: job.worker_id,
      runner_runtime_job_id: job.id,
      runner_launch_lease_id: job.launch_lease_id,
      runner_expires_at: new Date(Date.parse(terminalAt) + 10 * 60 * 1000).toISOString(),
      now: terminalAt,
    });
  }
  return { sessionToken, terminalAt, materialization };
}

async function terminalizeGenerationRuntimeJob(
  repository: DeliveryRepository,
  runtimeJob: PublicRuntimeJobRef,
  terminalResult: CodexGenerationRuntimeJobResult,
  suffix: string,
) {
  const job = await requireInternalRuntimeJob(repository, runtimeJob.id);
  const { sessionToken, terminalAt } = await startGenerationRuntimeJob(repository, job, suffix);
  addCodexThreadEvidence(job, terminalResult);
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

async function requireInternalRuntimeJob(repository: DeliveryRepository, runtimeJobId: string): Promise<CodexRuntimeJob> {
  const job = await repository.getCodexRuntimeJob({ runtime_job_id: runtimeJobId });
  if (job === undefined) {
    throw new Error(`Runtime job ${runtimeJobId} was not found`);
  }
  return job;
}

async function seedGenerationRuntimeForProject(app: INestApplication, projectId: string, repoId?: string) {
  const repository = app.get(DELIVERY_REPOSITORY) as DeliveryRepository;
  const now = '2026-05-05T00:00:00.000Z';
  const expiresAt = '2026-05-05T00:30:00.000Z';
  const networkPolicy = { mode: 'disabled' as const };
  const codexConfigToml = 'approval_policy = "never"\n';
  const scopeKey = repoId ?? 'project';
  const sessionScopeKey = repoId === undefined ? projectId : `${projectId}-${repoId}`;
  const sessionToken = `session-${sessionScopeKey}`;
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
    session_token: sessionToken,
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
    session_token: sessionToken,
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
  return { profileId, profileRevisionId, credentialBindingId, credentialVersionId, workerId, sessionToken };
}

function stableUuid(input: Record<string, unknown>): string {
  const hex = codexCanonicalDigest(input).slice('sha256:'.length);
  const variant = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function digest(label: string): string {
  return codexCanonicalDigest({ label });
}

function rawSha256(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
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

function addCodexThreadEvidence(
  runtimeJob: CodexRuntimeJob,
  terminalResult: CodexGenerationRuntimeJobResult,
): CodexGenerationRuntimeJobResult {
  if (runtimeJob.codex_session_id === undefined || runtimeJob.codex_session_turn_id === undefined) {
    return terminalResult;
  }
  const codexThreadId = `thread-${runtimeJob.codex_session_id}`;
  const scopeKey = runtimeJob.repo_id ?? 'project';
  const capsuleId = stableUuid({ kind: 'test-runtime-capsule', runtimeJobId: runtimeJob.id });
  let sequence = testCapsuleSequenceByRuntimeJob.get(runtimeJob.id);
  if (sequence === undefined) {
    sequence = (testCapsuleSequences.get(runtimeJob.codex_session_id) ?? 0) + 1;
    testCapsuleSequences.set(runtimeJob.codex_session_id, sequence);
    testCapsuleSequenceByRuntimeJob.set(runtimeJob.id, sequence);
  }
  const digestFor = (kind: string) => codexCanonicalDigest({ kind, runtimeJobId: runtimeJob.id });
  return Object.assign(terminalResult, {
    codex_session_thread: {
      codex_thread_id: codexThreadId,
      codex_thread_id_digest: codexCanonicalDigest({ kind: 'codex_app_server_thread_id', thread_id: codexThreadId }),
      app_server_turn_id: `app-server-turn-${runtimeJob.codex_session_turn_id}`,
    },
    output_capsule: {
      id: capsuleId,
      codex_session_id: runtimeJob.codex_session_id,
      created_from_turn_id: runtimeJob.codex_session_turn_id,
      sequence,
      artifact_ref: `artifact://internal/codex_runtime_capsule/codex_session/${runtimeJob.codex_session_id}/${capsuleId}`,
      digest: digestFor('test-runtime-capsule-digest'),
      size_bytes: '1024',
      manifest_digest: digestFor('test-runtime-capsule-manifest'),
      thread_state_digest: digestFor('test-runtime-capsule-thread-state'),
      memory_state_digest: digestFor('test-runtime-capsule-memory-state'),
      environment_manifest_digest: digestFor('test-runtime-capsule-environment-manifest'),
      codex_thread_id_digest: codexCanonicalDigest({ kind: 'codex_app_server_thread_id', thread_id: codexThreadId }),
      codex_cli_version: '0.1.0-test',
      app_server_protocol_digest: digestFor('test-runtime-capsule-app-server-protocol'),
      runtime_profile_revision_id: stableUuid({ kind: 'generation-profile-revision', projectId: runtimeJob.project_id, repoId: scopeKey }),
      trusted_runtime_manifest_digest: digestFor('test-runtime-capsule-trusted-runtime-manifest'),
      credential_binding_lineage_digest: digestFor('test-runtime-capsule-credential-lineage'),
      created_by_actor_id: runtimeJob.worker_id,
      created_at: '2026-05-05T00:00:45.000Z',
    },
    output_memory_bundle_ref: `artifact://internal/codex_memory_bundle/codex_session/${runtimeJob.codex_session_id}/memory-${runtimeJob.codex_session_turn_id}`,
    output_memory_bundle_digest: digestFor('test-runtime-capsule-memory-bundle'),
    output_environment_manifest_ref: `artifact://internal/codex_environment_manifest/codex_session/${runtimeJob.codex_session_id}/environment-${runtimeJob.codex_session_turn_id}`,
    output_environment_manifest_digest: digestFor('test-runtime-capsule-environment-bundle'),
  });
}
