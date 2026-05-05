import { ForbiddenException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import {
  type Artifact,
  type Decision,
  type ExecutionPackage,
  type ObjectEvent,
  type Plan,
  type PlanRevision,
  type Project,
  type ProjectRepo,
  type ReviewPacket,
  type RunSession,
  type Spec,
  type SpecRevision,
  type StatusHistory,
  type WorkItem,
  DomainError,
  deriveWorkItemCompletion,
  transitionExecutionPackage,
  transitionReviewPacket,
  transitionRunSession,
  transitionSpecPlan,
  transitionWorkItem,
  validateExecutionPackage,
  validateForceRerunAllowed,
  validatePackageEditAllowed,
} from '@forgeloop/domain';
import { InMemoryP0Repository, type P0Repository } from '@forgeloop/db';
import type { CheckResult, ExecutorResult, RunSpec, SelfReviewInput, SelfReviewResult } from '@forgeloop/contracts';
import { executePackageRun } from '@forgeloop/workflow';

import type {
  ActorCommandDto,
  CreateExecutionPackageDto,
  CreatePlanRevisionDto,
  CreateProjectDto,
  CreateProjectRepoDto,
  CreateSpecRevisionDto,
  CreateWorkItemDto,
  PatchExecutionPackageDto,
  ReviewDecisionDto,
  RunPackageDto,
} from './dto';

type TimelineEntry = {
  id: string;
  source: 'object_event' | 'status_history' | 'decision' | 'artifact';
  object_type: string;
  object_id: string;
  summary: string;
  created_at: string;
  payload: ObjectEvent | StatusHistory | Decision | Artifact;
};

const actorOrSystem = (actorId: string | undefined): string => actorId ?? 'system';

const statusForPackage = (executionPackage: ExecutionPackage): string =>
  `${executionPackage.phase}/${executionPackage.activity_state}/${executionPackage.gate_state}`;

@Injectable()
export class P0Service {
  private readonly repository: P0Repository = new InMemoryP0Repository();
  private idCounter = 0;
  private timeCounter = 0;
  private readonly specRevisionIndex = new Map<string, string>();
  private readonly planRevisionIndex = new Map<string, string>();

  async createProject(dto: CreateProjectDto): Promise<Project> {
    const at = this.now();
    const project: Project = {
      id: this.id('project'),
      name: this.required(dto.name, 'name'),
      repo_ids: [],
      ...(dto.owner_actor_id !== undefined ? { owner_actor_id: dto.owner_actor_id } : {}),
      created_at: at,
      updated_at: at,
    };
    await this.repository.saveProject(project);
    await this.event('project', project.id, 'project_created', dto.owner_actor_id, {});
    return project;
  }

  async getProject(projectId: string): Promise<Project> {
    return this.requireFound(await this.repository.getProject(projectId), `Project ${projectId}`);
  }

  async createProjectRepo(projectId: string, dto: CreateProjectRepoDto): Promise<ProjectRepo> {
    const project = await this.getProject(projectId);
    const at = this.now();
    const repo: ProjectRepo = {
      id: this.id('project-repo'),
      repo_id: this.required(dto.repo_id, 'repo_id'),
      project_id: project.id,
      name: this.required(dto.name, 'name'),
      status: 'active',
      local_path: this.required(dto.local_path, 'local_path'),
      default_branch: dto.default_branch ?? 'main',
      ...(dto.remote_url !== undefined ? { remote_url: dto.remote_url } : {}),
      base_commit_sha: this.required(dto.base_commit_sha, 'base_commit_sha'),
      created_at: at,
      updated_at: at,
    };
    await this.repository.saveProjectRepo(repo);
    await this.repository.saveProject({ ...project, repo_ids: [...new Set([...project.repo_ids, repo.repo_id])], updated_at: at });
    await this.event('project_repo', repo.id, 'repo_bound', project.owner_actor_id, { project_id: project.id });
    return repo;
  }

  listProjectRepos(projectId: string): Promise<ProjectRepo[]> {
    return this.repository.listProjectRepos(projectId);
  }

  async createWorkItem(dto: CreateWorkItemDto): Promise<WorkItem> {
    await this.getProject(dto.project_id);
    const workItem = transitionWorkItem(undefined, {
      type: 'create',
      id: this.id('work-item'),
      project_id: dto.project_id,
      kind: dto.kind,
      title: this.required(dto.title, 'title'),
      goal: this.required(dto.goal, 'goal'),
      success_criteria: dto.success_criteria ?? [],
      priority: this.required(dto.priority, 'priority'),
      risk: this.required(dto.risk, 'risk'),
      owner_actor_id: this.required(dto.owner_actor_id, 'owner_actor_id'),
      at: this.now(),
    });
    await this.repository.saveWorkItem(workItem);
    await this.event('work_item', workItem.id, 'work_item_created', workItem.owner_actor_id, {});
    return workItem;
  }

  listWorkItems(projectId?: string): Promise<WorkItem[]> {
    return this.repository.listWorkItems(projectId);
  }

  async getWorkItem(workItemId: string): Promise<WorkItem> {
    return this.requireFound(await this.repository.getWorkItem(workItemId), `WorkItem ${workItemId}`);
  }

  async createSpec(workItemId: string): Promise<Spec> {
    const workItem = await this.getWorkItem(workItemId);
    const spec = transitionSpecPlan(undefined, {
      type: 'create',
      entity_type: 'spec',
      id: this.id('spec'),
      work_item_id: workItem.id,
      at: this.now(),
    }) as Spec;
    await this.repository.saveSpec(spec);
    await this.repository.saveWorkItem({ ...workItem, current_spec_id: spec.id, updated_at: spec.updated_at });
    await this.event('spec', spec.id, 'spec_created', workItem.owner_actor_id, { work_item_id: workItem.id });
    return spec;
  }

  async getSpec(specId: string): Promise<Spec> {
    return this.requireFound(await this.repository.getSpec(specId), `Spec ${specId}`);
  }

  listSpecRevisions(specId: string): Promise<SpecRevision[]> {
    return this.repository.listSpecRevisions(specId);
  }

  async getSpecRevision(specRevisionId: string): Promise<SpecRevision> {
    const specId = this.specRevisionIndex.get(specRevisionId);
    if (specId === undefined) {
      throw new NotFoundException(`SpecRevision ${specRevisionId} not found`);
    }
    const revision = (await this.repository.listSpecRevisions(specId)).find((item) => item.id === specRevisionId);
    return this.requireFound(revision, `SpecRevision ${specRevisionId}`);
  }

  async createSpecRevision(specId: string, dto: CreateSpecRevisionDto): Promise<SpecRevision> {
    const spec = await this.getSpec(specId);
    const revision = await this.saveSpecRevision(spec, {
      summary: dto.summary,
      content: dto.content,
      background: dto.background,
      goals: dto.goals,
      scope_in: dto.scope_in,
      scope_out: dto.scope_out,
      acceptance_criteria: dto.acceptance_criteria,
      risk_notes: dto.risk_notes ?? [],
      test_strategy_summary: dto.test_strategy_summary,
      ...(dto.structured_document !== undefined ? { structured_document: dto.structured_document } : {}),
      ...(dto.author_actor_id !== undefined ? { author_actor_id: dto.author_actor_id } : {}),
    });
    await this.event('spec_revision', revision.id, 'spec_revision_created', dto.author_actor_id, { spec_id: spec.id });
    return revision;
  }

  async generateSpecDraft(specId: string): Promise<SpecRevision> {
    const spec = await this.getSpec(specId);
    const workItem = await this.getWorkItem(spec.work_item_id);
    const drafting = transitionSpecPlan(spec, { type: 'generate_draft_start', at: this.now() }) as Spec;
    await this.repository.saveSpec(drafting);
    await this.event('spec', spec.id, 'spec_draft_generation_started', workItem.owner_actor_id, {});

    const revision = await this.saveSpecRevision(drafting, {
      summary: `Draft spec for ${workItem.title}`,
      content: [
        `Goal: ${workItem.goal}`,
        `Success criteria: ${workItem.success_criteria.join('; ')}`,
        'Scope: implement only the P0 behavior needed for this work item.',
        'Test strategy: cover command flow and persisted evidence.',
      ].join('\n\n'),
      background: workItem.goal,
      goals: [workItem.goal],
      scope_in: [`Deliver ${workItem.title}`],
      scope_out: ['Release, deploy, and non-P0 workflows'],
      acceptance_criteria: [...workItem.success_criteria],
      risk_notes: [workItem.risk],
      test_strategy_summary: `Validate ${workItem.title} with API and workflow tests.`,
      structured_document: { generated_by: 'mock_spec_draft_adapter', work_item_id: workItem.id },
      author_actor_id: 'ai-spec-drafter',
    });
    const updated = transitionSpecPlan({ ...drafting, current_revision_id: revision.id }, {
      type: 'generate_draft_success',
      at: this.now(),
    }) as Spec;
    await this.repository.saveSpec(updated);
    await this.event('spec_revision', revision.id, 'spec_draft_generated', 'ai-spec-drafter', { spec_id: spec.id });
    return revision;
  }

  async submitSpecForApproval(specId: string, dto: ActorCommandDto): Promise<Spec> {
    const spec = await this.getSpec(specId);
    const updated = transitionSpecPlan(spec, { type: 'submit_for_approval', at: this.now() }) as Spec;
    await this.repository.saveSpec(updated);
    await this.updateWorkItemForSpecPlan(updated.work_item_id, 'submit_spec', dto.actor_id);
    await this.history('spec', spec.id, spec.status, updated.status, dto.actor_id);
    return updated;
  }

  async approveSpec(specId: string, dto: ActorCommandDto): Promise<Spec> {
    const spec = await this.getSpec(specId);
    const updated = transitionSpecPlan(spec, { type: 'approve', at: this.now() }) as Spec;
    await this.repository.saveSpec(updated);
    await this.updateWorkItemForSpecPlan(updated.work_item_id, 'approve_spec', dto.actor_id);
    await this.history('spec', spec.id, spec.status, updated.status, dto.actor_id);
    await this.decision('spec', spec.id, actorOrSystem(dto.actor_id), 'approved', 'Spec approved.');
    return updated;
  }

  async requestSpecChanges(specId: string, dto: ActorCommandDto): Promise<Spec> {
    const spec = await this.getSpec(specId);
    const updated = transitionSpecPlan(spec, { type: 'request_changes', at: this.now() }) as Spec;
    await this.repository.saveSpec(updated);
    await this.updateWorkItemForSpecPlan(updated.work_item_id, 'request_spec_changes', dto.actor_id);
    await this.history('spec', spec.id, spec.status, updated.status, dto.actor_id);
    return updated;
  }

  async createPlan(workItemId: string): Promise<Plan> {
    const workItem = await this.getWorkItem(workItemId);
    const plan = transitionSpecPlan(undefined, {
      type: 'create',
      entity_type: 'plan',
      id: this.id('plan'),
      work_item_id: workItem.id,
      at: this.now(),
    }) as Plan;
    await this.repository.savePlan(plan);
    await this.repository.saveWorkItem({ ...workItem, current_plan_id: plan.id, updated_at: plan.updated_at });
    await this.event('plan', plan.id, 'plan_created', workItem.owner_actor_id, { work_item_id: workItem.id });
    return plan;
  }

  async getPlan(planId: string): Promise<Plan> {
    return this.requireFound(await this.repository.getPlan(planId), `Plan ${planId}`);
  }

  listPlanRevisions(planId: string): Promise<PlanRevision[]> {
    return this.repository.listPlanRevisions(planId);
  }

  async getPlanRevision(planRevisionId: string): Promise<PlanRevision> {
    const planId = this.planRevisionIndex.get(planRevisionId);
    if (planId === undefined) {
      throw new NotFoundException(`PlanRevision ${planRevisionId} not found`);
    }
    const revision = (await this.repository.listPlanRevisions(planId)).find((item) => item.id === planRevisionId);
    return this.requireFound(revision, `PlanRevision ${planRevisionId}`);
  }

  async createPlanRevision(planId: string, dto: CreatePlanRevisionDto): Promise<PlanRevision> {
    const plan = await this.getPlan(planId);
    const revision = await this.savePlanRevision(plan, {
      summary: dto.summary,
      content: dto.content,
      implementation_summary: dto.implementation_summary,
      split_strategy: dto.split_strategy,
      dependency_order: dto.dependency_order ?? [],
      test_matrix: dto.test_matrix,
      risk_mitigations: dto.risk_mitigations ?? [],
      rollback_notes: dto.rollback_notes,
      ...(dto.structured_document !== undefined ? { structured_document: dto.structured_document } : {}),
      ...(dto.author_actor_id !== undefined ? { author_actor_id: dto.author_actor_id } : {}),
    });
    await this.event('plan_revision', revision.id, 'plan_revision_created', dto.author_actor_id, { plan_id: plan.id });
    return revision;
  }

  async generatePlanDraft(planId: string): Promise<PlanRevision> {
    const plan = await this.getPlan(planId);
    const workItem = await this.getWorkItem(plan.work_item_id);
    const spec = await this.requireApprovedCurrentSpec(workItem);
    const specRevision = await this.getSpecRevision(spec.current_revision_id!);
    const drafting = transitionSpecPlan(plan, { type: 'generate_draft_start', at: this.now() }) as Plan;
    await this.repository.savePlan(drafting);
    await this.event('plan', plan.id, 'plan_draft_generation_started', workItem.owner_actor_id, {});

    const revision = await this.savePlanRevision(drafting, {
      summary: `Draft plan for ${workItem.title}`,
      content: `Implement the approved spec revision ${specRevision.id} with a bounded package and required checks.`,
      implementation_summary: `Deliver ${workItem.title} through the P0 control plane.`,
      split_strategy: 'Create one repo-bound execution package for the approved plan.',
      dependency_order: ['api-package'],
      test_matrix: ['pnpm test tests/api'],
      risk_mitigations: specRevision.risk_notes.length === 0 ? ['Keep package scope narrow.'] : specRevision.risk_notes,
      rollback_notes: 'Revert the execution package changes.',
      structured_document: { generated_by: 'mock_plan_draft_adapter', spec_revision_id: specRevision.id },
      author_actor_id: 'ai-plan-drafter',
    });
    const updated = transitionSpecPlan({ ...drafting, current_revision_id: revision.id }, {
      type: 'generate_draft_success',
      at: this.now(),
    }) as Plan;
    await this.repository.savePlan(updated);
    await this.event('plan_revision', revision.id, 'plan_draft_generated', 'ai-plan-drafter', { plan_id: plan.id });
    return revision;
  }

  async submitPlanForApproval(planId: string, dto: ActorCommandDto): Promise<Plan> {
    const plan = await this.getPlan(planId);
    const updated = transitionSpecPlan(plan, { type: 'submit_for_approval', at: this.now() }) as Plan;
    await this.repository.savePlan(updated);
    await this.updateWorkItemForSpecPlan(updated.work_item_id, 'submit_plan', dto.actor_id);
    await this.history('plan', plan.id, plan.status, updated.status, dto.actor_id);
    return updated;
  }

  async approvePlan(planId: string, dto: ActorCommandDto): Promise<Plan> {
    const plan = await this.getPlan(planId);
    const updated = transitionSpecPlan(plan, { type: 'approve', at: this.now() }) as Plan;
    await this.repository.savePlan(updated);
    await this.updateWorkItemForSpecPlan(updated.work_item_id, 'approve_plan', dto.actor_id);
    await this.history('plan', plan.id, plan.status, updated.status, dto.actor_id);
    await this.decision('plan', plan.id, actorOrSystem(dto.actor_id), 'approved', 'Plan approved.');
    return updated;
  }

  async requestPlanChanges(planId: string, dto: ActorCommandDto): Promise<Plan> {
    const plan = await this.getPlan(planId);
    const updated = transitionSpecPlan(plan, { type: 'request_changes', at: this.now() }) as Plan;
    await this.repository.savePlan(updated);
    await this.updateWorkItemForSpecPlan(updated.work_item_id, 'request_plan_changes', dto.actor_id);
    await this.history('plan', plan.id, plan.status, updated.status, dto.actor_id);
    return updated;
  }

  async generatePackages(planRevisionId: string): Promise<ExecutionPackage[]> {
    const context = await this.packageContext(planRevisionId);
    const repo = (await this.repository.listProjectRepos(context.project.id))[0];
    if (repo === undefined) {
      throw new BadRequestException('Project has no bound repos');
    }
    const executionPackage = await this.createExecutionPackageFromContext(context, {
      repo_id: repo.repo_id,
      objective: `Implement ${context.workItem.title}.`,
      owner_actor_id: context.workItem.owner_actor_id,
      reviewer_actor_id: 'actor-reviewer',
      qa_owner_actor_id: 'actor-qa',
      required_checks: [
        {
          check_id: 'unit',
          display_name: 'Unit tests',
          command: 'pnpm test tests/api',
          timeout_seconds: 120,
          blocks_review: true,
        },
      ],
      required_artifact_kinds: ['execution_summary'],
      allowed_paths: ['apps/control-plane-api/**', 'tests/api/**'],
      forbidden_paths: ['packages/db/**'],
    });
    await this.event('execution_package', executionPackage.id, 'package_draft_generated', 'ai-package-drafter', {
      plan_revision_id: planRevisionId,
    });
    return [executionPackage];
  }

  async createExecutionPackage(planRevisionId: string, dto: CreateExecutionPackageDto): Promise<ExecutionPackage> {
    return this.createExecutionPackageFromContext(await this.packageContext(planRevisionId), dto);
  }

  async listExecutionPackages(workItemId: string): Promise<ExecutionPackage[]> {
    return this.repository.listExecutionPackagesForWorkItem(workItemId);
  }

  async getExecutionPackage(packageId: string): Promise<ExecutionPackage> {
    return this.requireFound(await this.repository.getExecutionPackage(packageId), `ExecutionPackage ${packageId}`);
  }

  async patchExecutionPackage(packageId: string, dto: PatchExecutionPackageDto): Promise<ExecutionPackage> {
    const executionPackage = await this.getExecutionPackage(packageId);
    const openPacket = await this.repository.findOpenReviewPacketForPackage(packageId);
    if (openPacket === undefined) {
      validatePackageEditAllowed(executionPackage);
    } else {
      await this.archiveReviewPacket(openPacket, 'package_edited');
    }

    const editablePackage: ExecutionPackage =
      executionPackage.phase === 'review'
        ? {
            ...executionPackage,
            phase: 'draft',
            activity_state: 'idle',
            gate_state: 'not_submitted',
            resolution: 'none',
          }
        : executionPackage;
    const patch = Object.fromEntries(Object.entries(dto).filter(([, value]) => value !== undefined)) as Partial<ExecutionPackage>;
    const updated: ExecutionPackage = {
      ...editablePackage,
      ...patch,
      updated_at: this.now(),
    };
    const project = await this.getProject(updated.project_id);
    validateExecutionPackage(project, updated);
    await this.repository.saveExecutionPackage(updated);
    await this.event('execution_package', updated.id, 'package_edited', updated.owner_actor_id, {});
    return updated;
  }

  async markPackageReady(packageId: string, dto: ActorCommandDto): Promise<ExecutionPackage> {
    const executionPackage = await this.getExecutionPackage(packageId);
    const updated = transitionExecutionPackage(executionPackage, { type: 'mark_ready', at: this.now() });
    await this.repository.saveExecutionPackage(updated);
    await this.history('execution_package', packageId, statusForPackage(executionPackage), statusForPackage(updated), dto.actor_id);
    return updated;
  }

  async runPackage(packageId: string, dto: RunPackageDto, mode: 'run' | 'rerun' | 'force_rerun'): Promise<Record<string, unknown>> {
    const executionPackage = await this.getExecutionPackage(packageId);
    const reviewPackets = await this.repository.listReviewPacketsForPackage(packageId);
    const validation = this.validateRunRequest(packageId, executionPackage, reviewPackets, dto, mode);
    if (mode === 'force_rerun' && validation.currentOpenReviewPacket !== undefined) {
      try {
        validateForceRerunAllowed(executionPackage, reviewPackets, validation.requestedByActorId);
      } catch (error) {
        if (error instanceof DomainError && error.code === 'FORCE_RERUN_FORBIDDEN') {
          throw new ForbiddenException(error.message);
        }
        throw error;
      }
      await this.archiveReviewPacket(validation.currentOpenReviewPacket, 'force_rerun');
    }
    const runSessionId = this.id('run-session');
    const queuedPackage =
      mode === 'force_rerun'
        ? transitionExecutionPackage(executionPackage, {
            type: 'force_rerun',
            run_session_id: runSessionId,
            has_open_review_packet: true,
            at: this.now(),
          })
        : transitionExecutionPackage(executionPackage, {
            type: mode,
            run_session_id: runSessionId,
            at: this.now(),
          });
    const runSession = transitionRunSession(undefined, {
      type: 'create',
      id: runSessionId,
      execution_package_id: packageId,
      requested_by_actor_id: validation.requestedByActorId,
      executor_type: dto.executor_type ?? 'mock',
      at: this.now(),
    });
    await this.repository.saveExecutionPackage(queuedPackage);
    await this.repository.saveRunSession(runSession);
    await this.event('execution_package', packageId, mode === 'force_rerun' ? 'force_rerun_requested' : `${mode}_requested`, validation.requestedByActorId, {
      run_session_id: runSessionId,
    });

    const workflowResult = await executePackageRun({
      repository: this.repository,
      runSessionId,
      executor: (runSpec) => Promise.resolve(this.mockExecutorResult(runSpec)),
      selfReview: (input) => Promise.resolve(this.mockSelfReview(input)),
      workflowOnly: dto.workflow_only ?? false,
      defaultExecutorType: dto.executor_type ?? 'mock',
      now: () => this.now(),
      ...(mode === 'force_rerun' ? { forceRerun: true } : {}),
    });

    return {
      command_id: this.id('command'),
      execution_package_id: packageId,
      workflow_only: dto.workflow_only ?? false,
      idempotency_key: runSessionId,
      status: 'accepted',
      run_session_id: runSessionId,
      workflow_result: workflowResult,
    };
  }

  private validateRunRequest(
    packageId: string,
    executionPackage: ExecutionPackage,
    reviewPackets: ReviewPacket[],
    dto: RunPackageDto,
    mode: 'run' | 'rerun' | 'force_rerun',
  ): { requestedByActorId: string; currentOpenReviewPacket?: ReviewPacket } {
    const requestedByActorId = this.required(dto.requested_by_actor_id, 'requested_by_actor_id');

    if (dto.execution_package_id !== undefined && dto.execution_package_id !== packageId) {
      throw new BadRequestException('execution_package_id must match packageId path parameter');
    }

    if (mode === 'run') {
      return { requestedByActorId };
    }

    const previousRunSessionId = this.required(dto.previous_run_session_id, 'previous_run_session_id');
    if (executionPackage.last_run_session_id !== previousRunSessionId) {
      throw new BadRequestException('previous_run_session_id must match the package current last_run_session_id');
    }

    if (mode === 'rerun') {
      return { requestedByActorId };
    }

    if (dto.force !== true) {
      throw new BadRequestException('force must be true for force-rerun');
    }
    this.required(dto.force_reason, 'force_reason');

    const currentOpenReviewPacket = reviewPackets.find(
      (reviewPacket) =>
        reviewPacket.run_session_id === previousRunSessionId &&
        reviewPacket.decision === 'none' &&
        (reviewPacket.status === 'ready' || reviewPacket.status === 'in_review'),
    );

    if (currentOpenReviewPacket === undefined) {
      throw new BadRequestException('force-rerun requires a current open ready or in_review ReviewPacket');
    }

    return { requestedByActorId, currentOpenReviewPacket };
  }

  async getRunSession(runSessionId: string): Promise<RunSession> {
    return this.requireFound(await this.repository.getRunSession(runSessionId), `RunSession ${runSessionId}`);
  }

  async getReviewPacket(reviewPacketId: string): Promise<ReviewPacket> {
    return this.requireFound(await this.repository.getReviewPacket(reviewPacketId), `ReviewPacket ${reviewPacketId}`);
  }

  async approveReviewPacket(reviewPacketId: string, dto: ReviewDecisionDto): Promise<Record<string, unknown>> {
    const reviewPacket = await this.getReviewPacket(reviewPacketId);
    const updated = transitionReviewPacket(reviewPacket, {
      type: 'approve',
      summary: dto.summary,
      reviewed_by_actor_id: dto.reviewed_by_actor_id,
      reviewed_at: dto.reviewed_at,
      at: this.now(),
    });
    await this.repository.saveReviewPacket(updated);
    await this.decision('review_packet', reviewPacketId, dto.reviewed_by_actor_id, 'approved', dto.summary);
    await this.applyReviewToPackage(updated, 'review_approved');
    return { review_packet_id: reviewPacketId, status: 'completed', decision: 'approved', recorded_at: updated.updated_at };
  }

  async requestReviewChanges(reviewPacketId: string, dto: ReviewDecisionDto): Promise<Record<string, unknown>> {
    const reviewPacket = await this.getReviewPacket(reviewPacketId);
    const updated = transitionReviewPacket(reviewPacket, {
      type: 'request_changes',
      summary: dto.summary,
      reviewed_by_actor_id: dto.reviewed_by_actor_id,
      reviewed_at: dto.reviewed_at,
      requested_changes: dto.requested_changes ?? [],
      at: this.now(),
    });
    await this.repository.saveReviewPacket(updated);
    await this.decision('review_packet', reviewPacketId, dto.reviewed_by_actor_id, 'changes_requested', dto.summary);
    await this.applyReviewToPackage(updated, 'review_changes_requested');
    return { review_packet_id: reviewPacketId, status: 'completed', decision: 'changes_requested', recorded_at: updated.updated_at };
  }

  async cockpit(workItemId: string): Promise<Record<string, unknown>> {
    const workItem = await this.getWorkItem(workItemId);
    const packages = await this.repository.listExecutionPackagesForWorkItem(workItem.id);
    const runSessions = (await Promise.all(packages.map((item) => this.repository.listRunSessionsForPackage(item.id)))).flat();
    const reviewPackets = (await Promise.all(packages.map((item) => this.repository.listReviewPacketsForPackage(item.id)))).flat();
    const completionState = deriveWorkItemCompletion(workItem, packages, runSessions, reviewPackets);
    return {
      work_item: workItem,
      current_spec: workItem.current_spec_id === undefined ? null : await this.repository.getSpec(workItem.current_spec_id),
      current_plan: workItem.current_plan_id === undefined ? null : await this.repository.getPlan(workItem.current_plan_id),
      packages,
      run_sessions: runSessions,
      review_packets: reviewPackets,
      next_actions: this.nextActions(packages, reviewPackets),
      completion_state: completionState,
    };
  }

  async timeline(workItemId: string): Promise<TimelineEntry[]> {
    const workItem = await this.getWorkItem(workItemId);
    const objectRefs: Array<{ objectType: string; objectId: string }> = [{ objectType: 'work_item', objectId: workItem.id }];
    if (workItem.current_spec_id !== undefined) {
      objectRefs.push({ objectType: 'spec', objectId: workItem.current_spec_id });
      for (const revision of await this.repository.listSpecRevisions(workItem.current_spec_id)) {
        objectRefs.push({ objectType: 'spec_revision', objectId: revision.id });
      }
    }
    if (workItem.current_plan_id !== undefined) {
      objectRefs.push({ objectType: 'plan', objectId: workItem.current_plan_id });
      for (const revision of await this.repository.listPlanRevisions(workItem.current_plan_id)) {
        objectRefs.push({ objectType: 'plan_revision', objectId: revision.id });
      }
    }
    for (const executionPackage of await this.repository.listExecutionPackagesForWorkItem(workItem.id)) {
      objectRefs.push({ objectType: 'execution_package', objectId: executionPackage.id });
      for (const runSession of await this.repository.listRunSessionsForPackage(executionPackage.id)) {
        objectRefs.push({ objectType: 'run_session', objectId: runSession.id });
      }
      for (const reviewPacket of await this.repository.listReviewPacketsForPackage(executionPackage.id)) {
        objectRefs.push({ objectType: 'review_packet', objectId: reviewPacket.id });
      }
    }

    const entries: TimelineEntry[] = [];
    for (const ref of objectRefs) {
      for (const item of await this.repository.listObjectEvents(ref.objectId, ref.objectType)) {
        entries.push({
          id: item.id,
          source: 'object_event',
          object_type: item.object_type,
          object_id: item.object_id,
          summary: item.event_type,
          created_at: item.created_at,
          payload: item,
        });
      }
      for (const item of await this.repository.listStatusHistory(ref.objectId, ref.objectType)) {
        entries.push({
          id: item.id,
          source: 'status_history',
          object_type: item.object_type,
          object_id: item.object_id,
          summary: `${item.from_status ?? 'none'} -> ${item.to_status}`,
          created_at: item.created_at,
          payload: item,
        });
      }
      for (const item of await this.repository.listDecisionsForObject(ref.objectType, ref.objectId)) {
        entries.push({
          id: item.id,
          source: 'decision',
          object_type: item.object_type,
          object_id: item.object_id,
          summary: item.summary,
          created_at: item.created_at,
          payload: item,
        });
      }
      for (const item of await this.repository.listArtifactsForObject(ref.objectType, ref.objectId)) {
        entries.push({
          id: item.id,
          source: 'artifact',
          object_type: item.object_type,
          object_id: item.object_id,
          summary: item.ref.name,
          created_at: item.created_at,
          payload: item,
        });
      }
    }
    return entries.sort((left, right) => left.created_at.localeCompare(right.created_at));
  }

  private async createExecutionPackageFromContext(
    context: Awaited<ReturnType<P0Service['packageContext']>>,
    dto: CreateExecutionPackageDto,
  ): Promise<ExecutionPackage> {
    const executionPackage = transitionExecutionPackage(undefined, {
      type: 'generate_package',
      id: this.id('execution-package'),
      work_item_id: context.workItem.id,
      spec_id: context.spec.id,
      spec_revision_id: context.specRevision.id,
      plan_id: context.plan.id,
      plan_revision_id: context.planRevision.id,
      project_id: context.project.id,
      repo_id: dto.repo_id,
      objective: dto.objective,
      owner_actor_id: dto.owner_actor_id,
      reviewer_actor_id: dto.reviewer_actor_id,
      qa_owner_actor_id: dto.qa_owner_actor_id,
      required_checks: dto.required_checks,
      required_artifact_kinds: dto.required_artifact_kinds,
      allowed_paths: dto.allowed_paths,
      forbidden_paths: dto.forbidden_paths,
      at: this.now(),
    });
    validateExecutionPackage(context.project, executionPackage);
    await this.repository.saveExecutionPackage(executionPackage);
    await this.event('execution_package', executionPackage.id, 'package_created', executionPackage.owner_actor_id, {
      plan_revision_id: context.planRevision.id,
    });
    return executionPackage;
  }

  private async packageContext(planRevisionId: string): Promise<{
    project: Project;
    workItem: WorkItem;
    spec: Spec;
    specRevision: SpecRevision;
    plan: Plan;
    planRevision: PlanRevision;
  }> {
    const planRevision = await this.getPlanRevision(planRevisionId);
    const plan = await this.getPlan(planRevision.plan_id);
    if (plan.status !== 'approved' || plan.current_revision_id !== planRevisionId) {
      throw new BadRequestException(`PlanRevision ${planRevisionId} is not current approved revision`);
    }
    const workItem = await this.getWorkItem(plan.work_item_id);
    const spec = await this.requireApprovedCurrentSpec(workItem);
    return {
      project: await this.getProject(workItem.project_id),
      workItem,
      spec,
      specRevision: await this.getSpecRevision(spec.current_revision_id!),
      plan,
      planRevision,
    };
  }

  private async requireApprovedCurrentSpec(workItem: WorkItem): Promise<Spec> {
    if (workItem.current_spec_id === undefined) {
      throw new BadRequestException(`WorkItem ${workItem.id} has no current spec`);
    }
    const spec = await this.getSpec(workItem.current_spec_id);
    if (spec.status !== 'approved' || spec.resolution !== 'approved' || spec.current_revision_id === undefined) {
      throw new BadRequestException(`Spec ${spec.id} is not approved`);
    }
    return spec;
  }

  private async updateWorkItemForSpecPlan(
    workItemId: string,
    type:
      | 'submit_spec'
      | 'approve_spec'
      | 'request_spec_changes'
      | 'submit_plan'
      | 'approve_plan'
      | 'request_plan_changes',
    actorId: string | undefined,
  ): Promise<void> {
    const workItem = await this.getWorkItem(workItemId);
    const updated = transitionWorkItem(workItem, { type, at: this.now() });
    await this.repository.saveWorkItem(updated);
    await this.history('work_item', workItem.id, `${workItem.phase}/${workItem.gate_state}`, `${updated.phase}/${updated.gate_state}`, actorId);
  }

  private async saveSpecRevision(
    spec: Spec,
    input: Omit<SpecRevision, 'id' | 'spec_id' | 'work_item_id' | 'revision_number' | 'artifact_refs' | 'created_at'>,
  ): Promise<SpecRevision> {
    const revision: SpecRevision = {
      id: this.id('spec-revision'),
      spec_id: spec.id,
      work_item_id: spec.work_item_id,
      revision_number: (await this.repository.listSpecRevisions(spec.id)).length + 1,
      summary: input.summary,
      content: input.content,
      background: input.background,
      goals: input.goals,
      scope_in: input.scope_in,
      scope_out: input.scope_out,
      acceptance_criteria: input.acceptance_criteria,
      risk_notes: input.risk_notes,
      test_strategy_summary: input.test_strategy_summary,
      ...(input.structured_document !== undefined ? { structured_document: input.structured_document } : {}),
      ...(input.author_actor_id !== undefined ? { author_actor_id: input.author_actor_id } : {}),
      artifact_refs: [],
      created_at: this.now(),
    };
    await this.repository.saveSpecRevision(revision);
    await this.repository.saveSpec({ ...spec, current_revision_id: revision.id, updated_at: this.now() });
    this.specRevisionIndex.set(revision.id, spec.id);
    return revision;
  }

  private async savePlanRevision(
    plan: Plan,
    input: Omit<PlanRevision, 'id' | 'plan_id' | 'work_item_id' | 'revision_number' | 'artifact_refs' | 'created_at'>,
  ): Promise<PlanRevision> {
    const revision: PlanRevision = {
      id: this.id('plan-revision'),
      plan_id: plan.id,
      work_item_id: plan.work_item_id,
      revision_number: (await this.repository.listPlanRevisions(plan.id)).length + 1,
      summary: input.summary,
      content: input.content,
      implementation_summary: input.implementation_summary,
      split_strategy: input.split_strategy,
      dependency_order: input.dependency_order,
      test_matrix: input.test_matrix,
      risk_mitigations: input.risk_mitigations,
      rollback_notes: input.rollback_notes,
      ...(input.structured_document !== undefined ? { structured_document: input.structured_document } : {}),
      ...(input.author_actor_id !== undefined ? { author_actor_id: input.author_actor_id } : {}),
      artifact_refs: [],
      created_at: this.now(),
    };
    await this.repository.savePlanRevision(revision);
    await this.repository.savePlan({ ...plan, current_revision_id: revision.id, updated_at: this.now() });
    this.planRevisionIndex.set(revision.id, plan.id);
    return revision;
  }

  private mockExecutorResult(runSpec: RunSpec): ExecutorResult {
    const at = this.now();
    const checks: CheckResult[] = runSpec.required_checks.map((check) => ({
      check_id: check.check_id,
      command: check.command,
      status: 'succeeded',
      exit_code: 0,
      duration_seconds: 1,
      blocks_review: check.blocks_review,
    }));
    return {
      run_session_id: runSpec.run_session_id,
      executor_type: runSpec.executor_type,
      executor_version: 'control-plane-mock',
      status: 'succeeded',
      started_at: at,
      finished_at: this.now(),
      summary: `Mock execution completed for ${runSpec.execution_package_id}.`,
      changed_files: [{ repo_id: runSpec.repo.repo_id, path: 'apps/control-plane-api/src/p0/p0.service.ts', change_kind: 'modified' }],
      checks,
      artifacts: [
        {
          kind: 'execution_summary',
          name: 'execution summary',
          content_type: 'text/markdown',
          local_ref: `artifacts/${runSpec.run_session_id}/summary.md`,
        },
        {
          kind: 'diff',
          name: 'patch diff',
          content_type: 'text/x-diff',
          local_ref: `artifacts/${runSpec.run_session_id}/diff.patch`,
        },
      ],
      raw_metadata: { workflow_only: runSpec.workflow_only },
    };
  }

  private mockSelfReview(input: SelfReviewInput): SelfReviewResult {
    return {
      status: 'succeeded',
      summary: `Mock self-review completed for run ${input.run_session_id}.`,
      spec_plan_alignment: 'The mock run uses the approved spec and plan revision ids.',
      test_assessment: `${input.check_results.length} required checks were reported.`,
      risk_notes: [],
      follow_up_questions: [],
    };
  }

  private async applyReviewToPackage(reviewPacket: ReviewPacket, type: 'review_approved' | 'review_changes_requested'): Promise<void> {
    const executionPackage = await this.getExecutionPackage(reviewPacket.execution_package_id);
    const updated = transitionExecutionPackage(executionPackage, { type, at: this.now() });
    await this.repository.saveExecutionPackage(updated);
    await this.history('execution_package', updated.id, statusForPackage(executionPackage), statusForPackage(updated), reviewPacket.reviewed_by_actor_id);
  }

  private async archiveReviewPacket(reviewPacket: ReviewPacket, reason: string): Promise<void> {
    const updated = transitionReviewPacket(reviewPacket, { type: 'archive_for_newer_run', at: this.now() });
    await this.repository.saveReviewPacket(updated);
    await this.event('review_packet', reviewPacket.id, 'review_packet_archived', reviewPacket.reviewer_actor_id, { reason });
  }

  private nextActions(packages: ExecutionPackage[], reviewPackets: ReviewPacket[]): string[] {
    const actions = new Set<string>();
    if (packages.some((item) => item.phase === 'draft')) {
      actions.add('mark_packages_ready');
    }
    if (packages.some((item) => item.phase === 'ready')) {
      actions.add('run_ready_packages');
    }
    if (reviewPackets.some((item) => item.status === 'ready' || item.status === 'in_review')) {
      actions.add('approve_open_review_packets');
    }
    return [...actions];
  }

  private async event(
    objectType: string,
    objectId: string,
    eventType: string,
    actorId: string | undefined,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const objectEvent: ObjectEvent = {
      id: this.id('event'),
      object_type: objectType,
      object_id: objectId,
      event_type: eventType,
      ...(actorId !== undefined ? { actor_id: actorId } : {}),
      metadata,
      created_at: this.now(),
    };
    await this.repository.appendObjectEvent(objectEvent);
  }

  private async history(
    objectType: string,
    objectId: string,
    fromStatus: string | undefined,
    toStatus: string,
    actorId: string | undefined,
  ): Promise<void> {
    const statusHistory: StatusHistory = {
      id: this.id('status-history'),
      object_type: objectType,
      object_id: objectId,
      ...(fromStatus !== undefined ? { from_status: fromStatus } : {}),
      to_status: toStatus,
      ...(actorId !== undefined ? { actor_id: actorId } : {}),
      created_at: this.now(),
    };
    await this.repository.appendStatusHistory(statusHistory);
  }

  private async decision(
    objectType: string,
    objectId: string,
    actorId: string,
    decisionValue: 'approved' | 'changes_requested',
    summary: string,
  ): Promise<void> {
    await this.repository.saveDecision({
      id: this.id('decision'),
      object_type: objectType,
      object_id: objectId,
      actor_id: actorId,
      decision: decisionValue,
      summary,
      created_at: this.now(),
    });
  }

  private id(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}-${this.idCounter}`;
  }

  private now(): string {
    this.timeCounter += 1;
    return new Date(Date.UTC(2026, 4, 5, 0, 0, this.timeCounter)).toISOString();
  }

  private required(value: string | undefined, field: string): string {
    if (value === undefined || value.trim().length === 0) {
      throw new BadRequestException(`${field} is required`);
    }
    return value;
  }

  private requireFound<T>(value: T | undefined, description: string): T {
    if (value === undefined) {
      throw new NotFoundException(`${description} not found`);
    }
    return value;
  }
}
