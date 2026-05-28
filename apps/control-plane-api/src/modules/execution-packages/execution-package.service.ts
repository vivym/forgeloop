import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type AutomationActorClass,
  type DevelopmentPlanItem,
  type ExecutionPlanDocument,
  type ExecutionPlanRevision,
  type ExecutionPackage,
  type Execution,
  type Plan,
  type PlanRevision,
  type Project,
  type Spec,
  type SpecRevision,
  type WorkItem,
  isOpenReviewPacketStatus,
  isWorkItemAutomationTerminal,
  transitionExecutionPackage,
  validateExecutionPackage,
  validatePackageEditAllowed,
} from '@forgeloop/domain';
import type { DeliveryRepository } from '@forgeloop/db';
import type { ObjectRef } from '@forgeloop/contracts';

import { AuditWriterService } from '../audit/audit-writer.service';
import type { ActorContext } from '../auth/actor-context';
import { ControlPlaneRuntimeService } from '../core/control-plane-runtime.service';
import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';
import type { CreateExecutionPackageDto, MarkPackageReadyDto, PatchExecutionPackageDto } from '../delivery/dto';
import {
  DEFAULT_SOURCE_MUTATION_POLICY,
  assertAllowedPathsForSourceMutation,
  defaultPackagePolicyFields,
} from './package-policy-fields';

type GeneratedPackageMetadata = {
  execution_package_set_id: string;
  generation_key: string;
  package_key: string;
  sequence: number;
  manifest_digest: string;
};

type ExecutionPlanPackagePolicy = Pick<
  ExecutionPackage,
  'objective' | 'required_checks' | 'allowed_paths' | 'forbidden_paths' | 'source_mutation_policy'
>;

type PackageContext = {
  project: Project;
  workItem: WorkItem;
  spec: Spec;
  specRevision: SpecRevision;
  plan: Plan;
  planRevision: PlanRevision;
  item?: DevelopmentPlanItem;
};

type ItemExecutionPackageContext = {
  project: Project;
  workItem: WorkItem;
  item: DevelopmentPlanItem;
  spec: Spec;
  specRevision: SpecRevision;
  executionPlan: ExecutionPlanDocument;
  executionPlanRevision: ExecutionPlanRevision;
  ownerActorId: string;
};

export type PublicExecutionPackage = Omit<ExecutionPackage, 'work_item_id'> & { scope_ref: ObjectRef };

const productGateRejectedActorClasses = new Set<AutomationActorClass>([
  'automation_daemon',
  'source_adapter',
  'external_tracker',
  'repo_policy',
]);

const statusForPackage = (executionPackage: ExecutionPackage): string =>
  `${executionPackage.phase}/${executionPackage.activity_state}/${executionPackage.gate_state}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const stringArrayField = (value: unknown): string[] | undefined => {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)) {
    return undefined;
  }
  return value.map((entry) => entry.trim());
};

const requiredChecksField = (value: unknown): ExecutionPackage['required_checks'] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const checks: ExecutionPackage['required_checks'] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      return undefined;
    }
    const checkId = typeof entry.check_id === 'string' ? entry.check_id.trim() : '';
    const command = typeof entry.command === 'string' ? entry.command.trim() : '';
    const timeoutSeconds = entry.timeout_seconds;
    const blocksReview = entry.blocks_review;
    if (
      checkId.length === 0 ||
      command.length === 0 ||
      !Number.isInteger(timeoutSeconds) ||
      Number(timeoutSeconds) <= 0 ||
      typeof blocksReview !== 'boolean'
    ) {
      return undefined;
    }
    checks.push({
      check_id: checkId,
      display_name: typeof entry.display_name === 'string' && entry.display_name.trim().length > 0 ? entry.display_name.trim() : checkId,
      command,
      timeout_seconds: Number(timeoutSeconds),
      blocks_review: blocksReview,
    });
  }
  return checks;
};

const mentionsDocsOnlyWork = (revision: ExecutionPlanRevision): boolean => {
  const structuredDocument = revision.structured_document;
  const structuredText = structuredDocument === undefined ? '' : JSON.stringify(structuredDocument);
  return /docs-only|docs\//i.test(`${revision.summary}\n${revision.content}\n${structuredText}`);
};

const allowsDocsPath = (allowedPaths: readonly string[]): boolean => allowedPaths.includes('docs/**');

@Injectable()
export class ExecutionPackageService {
  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository,
    @Inject(ControlPlaneRuntimeService) private readonly runtime: ControlPlaneRuntimeService,
    @Inject(AuditWriterService) private readonly audit: AuditWriterService,
  ) {}

  async generatePackages(planRevisionId: string): Promise<ExecutionPackage[]> {
    return this.repository.withObjectLock(`plan-revision:${planRevisionId}`, async (repository) => {
      const context = await this.packageContextFromRepository(repository, planRevisionId);
      const repo = (await repository.listProjectRepos(context.project.id))[0];
      if (repo === undefined) {
        throw new BadRequestException('Project has no bound repos');
      }
      const generationKey = 'default';
      const existingPackage = (await repository.listExecutionPackagesForWorkItem(context.workItem.id)).find(
        (executionPackage) =>
          executionPackage.plan_revision_id === context.planRevision.id &&
          executionPackage.generation_key === generationKey &&
          executionPackage.package_key === 'api-package',
      );
      if (existingPackage !== undefined) {
        return [existingPackage];
      }
      const reviewerActorId =
        context.item?.reviewer_actor_id ??
        context.plan.approved_by_actor_id ??
        context.spec.approved_by_actor_id ??
        context.workItem.driver_actor_id;
      const qaOwnerActorId = context.workItem.driver_actor_id;
      const executionPackage = await this.createExecutionPackageFromContext(
        repository,
        context,
        {
          repo_id: repo.repo_id,
          objective: `Implement ${context.workItem.title}.`,
          owner_actor_id: context.workItem.driver_actor_id,
          reviewer_actor_id: reviewerActorId,
          qa_owner_actor_id: qaOwnerActorId,
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
        },
        {
          execution_package_set_id: `generation:${planRevisionId}:${generationKey}`,
          generation_key: generationKey,
          package_key: 'api-package',
          sequence: 0,
          manifest_digest: 'api-package-v1',
        },
        'generated',
      );
      await this.eventWithRepository(repository, 'execution_package', executionPackage.id, 'package_draft_generated', 'ai-package-drafter', {
        plan_revision_id: planRevisionId,
      });
      return [executionPackage];
    });
  }

  async generatePublicPackages(planRevisionId: string): Promise<PublicExecutionPackage[]> {
    return Promise.all((await this.generatePackages(planRevisionId)).map((executionPackage) => this.toPublicExecutionPackage(executionPackage)));
  }

  async createExecutionPackage(planRevisionId: string, dto: CreateExecutionPackageDto): Promise<ExecutionPackage> {
    return this.repository.withObjectLock(`plan-revision:${planRevisionId}`, async (repository) =>
      this.createExecutionPackageFromContext(repository, await this.packageContextFromRepository(repository, planRevisionId), dto, undefined, 'manual'),
    );
  }

  async createPublicExecutionPackage(planRevisionId: string, dto: CreateExecutionPackageDto): Promise<PublicExecutionPackage> {
    return this.toPublicExecutionPackage(await this.createExecutionPackage(planRevisionId, dto));
  }

  listExecutionPackages(workItemId: string): Promise<ExecutionPackage[]> {
    return this.repository.listExecutionPackagesForWorkItem(workItemId);
  }

  async listPublicExecutionPackages(workItemId: string): Promise<PublicExecutionPackage[]> {
    return Promise.all((await this.listExecutionPackages(workItemId)).map((executionPackage) => this.toPublicExecutionPackage(executionPackage)));
  }

  async getExecutionPackage(packageId: string): Promise<ExecutionPackage> {
    return this.requireFound(await this.repository.getExecutionPackage(packageId), `ExecutionPackage ${packageId}`);
  }

  async getPublicExecutionPackage(packageId: string): Promise<PublicExecutionPackage> {
    return this.toPublicExecutionPackage(await this.getExecutionPackage(packageId));
  }

  async createOrReuseItemExecutionPackage(
    repository: DeliveryRepository,
    context: ItemExecutionPackageContext & { execution?: Execution | undefined },
  ): Promise<ExecutionPackage> {
    const existing = (await repository.listExecutionPackagesForWorkItem(context.workItem.id)).find(
      (executionPackage) =>
        executionPackage.development_plan_item_id === context.item.id &&
        executionPackage.execution_plan_revision_id === context.executionPlanRevision.id &&
        executionPackage.generation_key === 'item-execution',
    );
    if (existing !== undefined) {
      if (context.execution !== undefined && existing.execution_id !== undefined && existing.execution_id !== context.execution.id) {
        throw new ConflictException('DevelopmentPlanItem already has an execution package for a different Execution');
      }
      let reusablePackage = existing.phase === 'draft' ? transitionExecutionPackage(existing, { type: 'mark_ready', at: this.now() }) : existing;
      if (context.execution !== undefined && reusablePackage.execution_id === undefined) {
        reusablePackage = { ...reusablePackage, execution_id: context.execution.id, updated_at: this.now() };
      }
      validateExecutionPackage(context.project, reusablePackage);
      if (reusablePackage !== existing) {
        await repository.saveExecutionPackage(reusablePackage);
      }
      return reusablePackage;
    }

    const repo = (await repository.listProjectRepos(context.project.id))[0];
    if (repo === undefined) {
      throw new BadRequestException('Project has no bound repos');
    }
    const reviewerActorId =
      context.item.reviewer_actor_id ?? context.executionPlan.approved_by_actor_id ?? context.spec.approved_by_actor_id ?? context.workItem.driver_actor_id;
    const ownerActorId = context.ownerActorId;
    const createdAt = this.now();
    const packagePolicy = this.packagePolicyFromExecutionPlanRevision(context.executionPlanRevision);
    const packagePolicyFields = await defaultPackagePolicyFields(repository, {
      projectId: context.project.id,
      repoId: repo.repo_id,
      loadedAt: createdAt,
      requiredChecks: packagePolicy.required_checks,
      allowedPaths: packagePolicy.allowed_paths,
      forbiddenPaths: packagePolicy.forbidden_paths,
      sourceMutationPolicy: packagePolicy.source_mutation_policy,
    });
    const draftPackage = {
      ...transitionExecutionPackage(undefined, {
        type: 'generate_package',
        id: this.id('execution-package'),
        work_item_id: context.workItem.id,
        spec_id: context.spec.id,
        spec_revision_id: context.specRevision.id,
        plan_id: context.executionPlan.id,
        plan_revision_id: context.executionPlanRevision.id,
        project_id: context.project.id,
        repo_id: repo.repo_id,
        objective: packagePolicy.objective,
        owner_actor_id: ownerActorId,
        reviewer_actor_id: reviewerActorId,
        qa_owner_actor_id: context.workItem.driver_actor_id,
        required_checks: packagePolicy.required_checks,
        required_artifact_kinds: ['execution_summary'],
        allowed_paths: packagePolicy.allowed_paths,
        forbidden_paths: packagePolicy.forbidden_paths,
        source_mutation_policy: packagePolicy.source_mutation_policy,
        at: createdAt,
      }),
      development_plan_item_id: context.item.id,
      ...(context.execution === undefined ? {} : { execution_id: context.execution.id }),
      execution_plan_id: context.executionPlan.id,
      execution_plan_revision_id: context.executionPlanRevision.id,
      execution_package_set_id: `item-execution:${context.item.id}:${context.executionPlanRevision.id}`,
      generation_key: 'item-execution',
      package_key: 'default-runtime-package',
      sequence: 0,
      manifest_digest: `execution-plan-revision:${context.executionPlanRevision.id}`,
      required_test_gates: [],
      ...packagePolicyFields,
    };
    const readyPackage = transitionExecutionPackage(draftPackage, { type: 'mark_ready', at: createdAt });
    validateExecutionPackage(context.project, readyPackage);
    await repository.saveExecutionPackage(readyPackage);
    await this.eventWithRepository(
      repository,
      'execution_package',
      readyPackage.id,
      'item_execution_package_created',
      ownerActorId,
      {
        development_plan_item_id: context.item.id,
        execution_plan_revision_id: context.executionPlanRevision.id,
      },
    );
    return readyPackage;
  }

  private packagePolicyFromExecutionPlanRevision(revision: ExecutionPlanRevision): ExecutionPlanPackagePolicy {
    const structuredDocument = revision.structured_document;
    const structuredFieldsPresent =
      isRecord(structuredDocument) &&
      stringArrayField(structuredDocument.allowed_paths) !== undefined &&
      stringArrayField(structuredDocument.forbidden_paths) !== undefined &&
      requiredChecksField(structuredDocument.required_checks) !== undefined &&
      stringArrayField(structuredDocument.implementation_sequence) !== undefined;

    if (mentionsDocsOnlyWork(revision) && !structuredFieldsPresent) {
      throw new BadRequestException({
        code: 'execution_plan_structured_policy_required',
        message: 'Docs-only dogfood execution requires structured Execution Plan path policy fields.',
      });
    }

    const allowedPaths = isRecord(structuredDocument) && structuredFieldsPresent
      ? stringArrayField(structuredDocument.allowed_paths)!
      : undefined;
    const forbiddenPaths = isRecord(structuredDocument) && structuredFieldsPresent
      ? stringArrayField(structuredDocument.forbidden_paths)!
      : undefined;
    const requiredChecks = isRecord(structuredDocument) && structuredFieldsPresent
      ? requiredChecksField(structuredDocument.required_checks)!
      : undefined;
    if (mentionsDocsOnlyWork(revision) && !allowsDocsPath(allowedPaths ?? [])) {
      throw new BadRequestException({
        code: 'path_policy_docs_allowlist_required',
        message: 'Docs-only dogfood execution requires docs/** in the approved Execution Plan allowed_paths.',
      });
    }

    return {
      objective: revision.summary.trim().length > 0 ? revision.summary : `Execute Execution Plan revision ${revision.id}.`,
      required_checks:
        requiredChecks ??
        [
          {
            check_id: 'focused',
            display_name: 'Focused verification',
            command: 'pnpm test',
            timeout_seconds: 120,
            blocks_review: true,
          },
        ],
      allowed_paths: allowedPaths ?? [
        'apps/control-plane-api/**',
        'apps/web/**',
        'packages/domain/**',
        'packages/contracts/**',
        'tests/**',
      ],
      forbidden_paths: forbiddenPaths ?? ['packages/db/**'],
      source_mutation_policy: DEFAULT_SOURCE_MUTATION_POLICY,
    };
  }

  async patchExecutionPackage(packageId: string, dto: PatchExecutionPackageDto): Promise<ExecutionPackage> {
    return this.repository.withObjectLock(`execution-package:${packageId}`, async (repository) => {
      const executionPackage = this.requireFound(await repository.getExecutionPackage(packageId), `ExecutionPackage ${packageId}`);
      const openPacket = await repository.findOpenReviewPacketForPackage(packageId);
      if (openPacket !== undefined && isOpenReviewPacketStatus(openPacket.status)) {
        throw new UnprocessableEntityException({
          code: 'automation_gate_pending',
          message: 'Open review packet blocks package edit.',
        });
      }
      validatePackageEditAllowed(executionPackage);

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
      const sourceMutationPolicy = patch.source_mutation_policy ?? editablePackage.source_mutation_policy ?? DEFAULT_SOURCE_MUTATION_POLICY;
      const allowedPaths = patch.allowed_paths ?? editablePackage.allowed_paths;
      const forbiddenPaths = patch.forbidden_paths ?? editablePackage.forbidden_paths;
      const requiredChecks = patch.required_checks ?? editablePackage.required_checks;
      assertAllowedPathsForSourceMutation(sourceMutationPolicy, allowedPaths);
      const policySnapshotAffectingPatch =
        patch.allowed_paths !== undefined ||
        patch.forbidden_paths !== undefined ||
        patch.required_checks !== undefined ||
        patch.source_mutation_policy !== undefined;
      const policySnapshotVersion = (editablePackage.policy_snapshot_version ?? 1) + (policySnapshotAffectingPatch ? 1 : 0);
      const packagePolicyFields = policySnapshotAffectingPatch
        ? await defaultPackagePolicyFields(repository, {
            projectId: editablePackage.project_id,
            repoId: editablePackage.repo_id,
            loadedAt: this.now(),
            requiredChecks,
            allowedPaths,
            forbiddenPaths,
            sourceMutationPolicy,
            policySnapshotVersion,
          })
        : {};
      const updated: ExecutionPackage = {
        ...editablePackage,
        ...patch,
        source_mutation_policy: sourceMutationPolicy,
        ...packagePolicyFields,
        version: editablePackage.version + 1,
        updated_at: this.now(),
      };
      const project = this.requireFound(await repository.getProject(updated.project_id), `Project ${updated.project_id}`);
      validateExecutionPackage(project, updated);
      await repository.saveExecutionPackage(updated);
      await this.eventWithRepository(repository, 'execution_package', updated.id, 'package_edited', updated.owner_actor_id, {});
      return updated;
    });
  }

  async patchPublicExecutionPackage(packageId: string, dto: PatchExecutionPackageDto): Promise<PublicExecutionPackage> {
    return this.toPublicExecutionPackage(await this.patchExecutionPackage(packageId, dto));
  }

  async markPackageReady(packageId: string, dto: MarkPackageReadyDto, actorContext?: ActorContext): Promise<ExecutionPackage> {
    const actorId = this.actorIdForProductGate(dto.actor_id, actorContext);
    return this.repository.withObjectLock(`execution-package:${packageId}`, async (repository) => {
      const executionPackage = this.requireFound(await repository.getExecutionPackage(packageId), `ExecutionPackage ${packageId}`);
      if (executionPackage.version !== dto.expected_package_version) {
        throw new UnprocessableEntityException({
          code: 'stale_execution_package_revision',
          message: 'Execution package version changed before mark ready.',
        });
      }
      await this.assertExecutionPackageGraphStillCurrent(repository, executionPackage);
      const updated = transitionExecutionPackage(executionPackage, { type: 'mark_ready', at: this.now() });
      validateExecutionPackage(this.requireFound(await repository.getProject(updated.project_id), `Project ${updated.project_id}`), updated);
      await repository.saveExecutionPackage(updated);
      await this.historyWithRepository(repository, 'execution_package', packageId, statusForPackage(executionPackage), statusForPackage(updated), actorId);
      return updated;
    });
  }

  async markPublicPackageReady(
    packageId: string,
    dto: MarkPackageReadyDto,
    actorContext?: ActorContext,
  ): Promise<PublicExecutionPackage> {
    return this.toPublicExecutionPackage(await this.markPackageReady(packageId, dto, actorContext));
  }

  private async toPublicExecutionPackage(executionPackage: ExecutionPackage): Promise<PublicExecutionPackage> {
    const { work_item_id: workItemId, ...publicPackage } = executionPackage;
    return { ...publicPackage, scope_ref: await this.scopeRefForWorkItemId(workItemId) };
  }

  private async scopeRefForWorkItemId(workItemId: string): Promise<ObjectRef> {
    const workItem = this.requireFound(await this.repository.getWorkItem(workItemId), `WorkItem ${workItemId}`);
    return { type: workItem.kind, id: workItem.id, title: workItem.title } as ObjectRef;
  }

  async packageContextFromRepository(repository: DeliveryRepository, planRevisionId: string): Promise<PackageContext> {
    const planRevision = this.requireFound(await repository.getPlanRevision(planRevisionId), `PlanRevision ${planRevisionId}`);
    const plan = this.requireFound(await repository.getPlan(planRevision.plan_id), `Plan ${planRevision.plan_id}`);
    if (
      plan.status !== 'approved' ||
      plan.resolution !== 'approved' ||
      plan.approved_revision_id !== planRevisionId ||
      plan.current_revision_id !== planRevisionId
    ) {
      throw new BadRequestException(`PlanRevision ${planRevisionId} is not current approved revision`);
    }
    const workItem = this.requireFound(await repository.getWorkItem(plan.work_item_id), `WorkItem ${plan.work_item_id}`);
    if (workItem.current_plan_id !== plan.id) {
      throw new ConflictException('WorkItem current plan no longer matches PlanRevision');
    }
    const spec = await this.requireApprovedCurrentSpecFromRepository(repository, workItem);
    const specRevision = this.requireFound(await repository.getSpecRevision(spec.current_revision_id!), `SpecRevision ${spec.current_revision_id}`);
    if (planRevision.based_on_spec_revision_id === undefined) {
      throw new ConflictException('PlanRevision is not based on the WorkItem current approved SpecRevision');
    }
    if (planRevision.based_on_spec_revision_id !== specRevision.id) {
      throw new ConflictException('PlanRevision is no longer based on the WorkItem current approved SpecRevision');
    }
    const itemIds = [
      plan.development_plan_item_id,
      spec.development_plan_item_id,
      specRevision.development_plan_item_id,
    ].filter((id): id is string => id !== undefined);
    const uniqueItemIds = [...new Set(itemIds)];
    if (uniqueItemIds.length > 1) {
      throw new ConflictException('PlanRevision item linkage no longer matches the approved SpecRevision');
    }
    const item =
      uniqueItemIds[0] === undefined
        ? undefined
        : this.requireFound(await repository.getDevelopmentPlanItem(uniqueItemIds[0]), `DevelopmentPlanItem ${uniqueItemIds[0]}`);
    return {
      project: this.requireFound(await repository.getProject(workItem.project_id), `Project ${workItem.project_id}`),
      workItem,
      spec,
      specRevision,
      plan,
      planRevision,
      ...(item === undefined ? {} : { item }),
    };
  }

  async requireApprovedCurrentSpecFromRepository(repository: DeliveryRepository, workItem: WorkItem): Promise<Spec> {
    if (workItem.current_spec_id === undefined) {
      throw new BadRequestException(`WorkItem ${workItem.id} has no current spec`);
    }
    const spec = this.requireFound(await repository.getSpec(workItem.current_spec_id), `Spec ${workItem.current_spec_id}`);
    if (
      spec.status !== 'approved' ||
      spec.resolution !== 'approved' ||
      spec.approved_revision_id === undefined ||
      spec.current_revision_id !== spec.approved_revision_id
    ) {
      throw new BadRequestException(`Spec ${spec.id} is not approved`);
    }
    return spec;
  }

  async assertExecutionPackageGraphStillCurrent(repository: DeliveryRepository, executionPackage: ExecutionPackage): Promise<void> {
    const stale = (message: string): never => {
      throw new UnprocessableEntityException({ code: 'stale_execution_package_revision', message });
    };
    const workItem = this.requireFound(await repository.getWorkItem(executionPackage.work_item_id), `WorkItem ${executionPackage.work_item_id}`);
    if (isWorkItemAutomationTerminal(workItem)) {
      throw new UnprocessableEntityException({
        code: 'work_item_terminal',
        message: `WorkItem ${workItem.id} is terminal for automation.`,
      });
    }
    if (workItem.current_spec_id !== executionPackage.spec_id) {
      stale(`ExecutionPackage ${executionPackage.id} spec_id ${executionPackage.spec_id} is not the WorkItem current spec`);
    }
    if (executionPackage.development_plan_item_id !== undefined && executionPackage.execution_plan_revision_id !== undefined) {
      const item = this.requireFound(
        await repository.getDevelopmentPlanItem(executionPackage.development_plan_item_id),
        `DevelopmentPlanItem ${executionPackage.development_plan_item_id}`,
      );
      if (item.source_ref.id !== workItem.id) {
        stale(`ExecutionPackage ${executionPackage.id} item no longer belongs to the WorkItem`);
      }
      const executionPlanRevision = this.requireFound(
        await repository.getExecutionPlanRevision(executionPackage.execution_plan_revision_id),
        `ExecutionPlanRevision ${executionPackage.execution_plan_revision_id}`,
      );
      this.packagePolicyFromExecutionPlanRevision(executionPlanRevision);
      if (executionPlanRevision.development_plan_item_id !== item.id) {
        stale(`ExecutionPackage ${executionPackage.id} execution plan revision no longer belongs to the item`);
      }
      const executionPlan = this.requireFound(
        await repository.getExecutionPlan(executionPlanRevision.execution_plan_id),
        `ExecutionPlan ${executionPlanRevision.execution_plan_id}`,
      );
      if (
        executionPlan.status !== 'approved' ||
        executionPlan.approved_revision_id !== executionPlanRevision.id ||
        executionPlan.current_revision_id !== executionPlanRevision.id
      ) {
        stale(`ExecutionPackage ${executionPackage.id} execution_plan_revision_id is not the current approved Execution Plan revision`);
      }
      const specRevision = this.requireFound(
        await repository.getSpecRevision(executionPlanRevision.based_on_spec_revision_id),
        `SpecRevision ${executionPlanRevision.based_on_spec_revision_id}`,
      );
      const spec = this.requireFound(await repository.getSpec(specRevision.spec_id), `Spec ${specRevision.spec_id}`);
      if (
        spec.id !== executionPackage.spec_id ||
        specRevision.id !== executionPackage.spec_revision_id ||
        spec.status !== 'approved' ||
        spec.resolution !== 'approved' ||
        spec.current_revision_id !== specRevision.id ||
        spec.approved_revision_id !== specRevision.id
      ) {
        stale(`ExecutionPackage ${executionPackage.id} is not based on the item current approved Spec revision`);
      }
      return;
    }
    if (workItem.current_plan_id !== executionPackage.plan_id) {
      stale(`ExecutionPackage ${executionPackage.id} plan_id ${executionPackage.plan_id} is not the WorkItem current plan`);
    }
    const spec = this.requireFound(await repository.getSpec(executionPackage.spec_id), `Spec ${executionPackage.spec_id}`);
    if (
      spec.status !== 'approved' ||
      spec.resolution !== 'approved' ||
      spec.approved_revision_id !== executionPackage.spec_revision_id ||
      spec.current_revision_id !== executionPackage.spec_revision_id
    ) {
      stale(
        `ExecutionPackage ${executionPackage.id} spec_revision_id ${executionPackage.spec_revision_id} is not current approved revision ${spec.current_revision_id ?? 'none'}`,
      );
    }
    const plan = this.requireFound(await repository.getPlan(executionPackage.plan_id), `Plan ${executionPackage.plan_id}`);
    if (
      plan.status !== 'approved' ||
      plan.resolution !== 'approved' ||
      plan.approved_revision_id !== executionPackage.plan_revision_id ||
      plan.current_revision_id !== executionPackage.plan_revision_id
    ) {
      stale(
        `ExecutionPackage ${executionPackage.id} plan_revision_id ${executionPackage.plan_revision_id} is not current approved revision ${plan.current_revision_id ?? 'none'}`,
      );
    }
    const specRevision = this.requireFound(
      await repository.getSpecRevision(executionPackage.spec_revision_id),
      `SpecRevision ${executionPackage.spec_revision_id}`,
    );
    const planRevision = this.requireFound(
      await repository.getPlanRevision(executionPackage.plan_revision_id),
      `PlanRevision ${executionPackage.plan_revision_id}`,
    );
    if (specRevision.spec_id !== spec.id || specRevision.work_item_id !== workItem.id) {
      stale(`ExecutionPackage ${executionPackage.id} spec revision no longer belongs to the current WorkItem spec`);
    }
    if (planRevision.plan_id !== plan.id || planRevision.work_item_id !== workItem.id) {
      stale(`ExecutionPackage ${executionPackage.id} plan revision no longer belongs to the current WorkItem plan`);
    }
    if (planRevision.based_on_spec_revision_id === undefined) {
      stale(`ExecutionPackage ${executionPackage.id} plan revision is missing a frozen spec revision target`);
    }
    if (planRevision.based_on_spec_revision_id !== specRevision.id) {
      stale(`ExecutionPackage ${executionPackage.id} plan revision is based on a stale spec revision`);
    }
    const dependencies = await repository.listExecutionPackageDependencies(executionPackage.id);
    for (const dependency of dependencies) {
      const upstream = this.requireFound(
        await repository.getExecutionPackage(dependency.depends_on_package_id),
        `ExecutionPackage ${dependency.depends_on_package_id}`,
      );
      if (upstream.resolution !== 'completed') {
        throw new UnprocessableEntityException({
          code: 'automation_gate_pending',
          message: `ExecutionPackage ${executionPackage.id} dependency ${upstream.id} is not completed.`,
        });
      }
    }
    const linkedReleases = (await repository.listReleases(executionPackage.project_id)).filter((release) =>
      release.execution_package_ids.includes(executionPackage.id),
    );
    for (const release of linkedReleases) {
      const releaseGateHolds = await repository.listActiveManualPathHolds({
        object_type: 'release_gate',
        object_id: release.id,
      });
      if (releaseGateHolds.length > 0) {
        throw new UnprocessableEntityException({
          code: 'manual_path_hold_active',
          message: `Release gate manual hold blocks run enqueue for ${executionPackage.id}.`,
          hold_ids: releaseGateHolds.map((hold) => hold.id),
        });
      }
      if (release.phase !== 'completed' && release.phase !== 'closed') {
        throw new UnprocessableEntityException({
          code: 'automation_gate_pending',
          message: `Release ${release.id} blocks automatic run enqueue for ${executionPackage.id}.`,
        });
      }
    }
  }

  async createExecutionPackageFromContext(
    repository: DeliveryRepository,
    context: PackageContext,
    dto: CreateExecutionPackageDto,
    generation?: GeneratedPackageMetadata,
    source: 'manual' | 'generated' = 'manual',
  ): Promise<ExecutionPackage> {
    const requiredChecks = dto.required_checks;
    const sourceMutationPolicy = dto.source_mutation_policy ?? DEFAULT_SOURCE_MUTATION_POLICY;
    assertAllowedPathsForSourceMutation(sourceMutationPolicy, dto.allowed_paths);
    const createdAt = this.now();
    const packagePolicyFields = await defaultPackagePolicyFields(repository, {
      projectId: context.project.id,
      repoId: dto.repo_id,
      loadedAt: createdAt,
      requiredChecks,
      allowedPaths: dto.allowed_paths,
      forbiddenPaths: dto.forbidden_paths,
      sourceMutationPolicy,
    });
    const executionPackage = {
      ...transitionExecutionPackage(undefined, {
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
        required_checks: requiredChecks,
        required_artifact_kinds: dto.required_artifact_kinds,
        allowed_paths: dto.allowed_paths,
        forbidden_paths: dto.forbidden_paths,
        source_mutation_policy: sourceMutationPolicy,
        at: createdAt,
      }),
      ...(context.item === undefined ? {} : { development_plan_item_id: context.item.id }),
      ...(generation === undefined
        ? {}
        : {
            execution_package_set_id: generation.execution_package_set_id,
            generation_key: generation.generation_key,
            package_key: generation.package_key,
            sequence: generation.sequence,
            manifest_digest: generation.manifest_digest,
          }),
      required_test_gates: [],
      ...packagePolicyFields,
    };
    validateExecutionPackage(context.project, executionPackage);
    await repository.saveExecutionPackage(executionPackage);
    if (source === 'manual') {
      await this.eventWithRepository(repository, 'execution_package', executionPackage.id, 'package_created', executionPackage.owner_actor_id, {
        plan_revision_id: context.planRevision.id,
      });
    }
    return executionPackage;
  }

  private async eventWithRepository(
    repository: DeliveryRepository,
    objectType: string,
    objectId: string,
    eventType: string,
    actorId: string | undefined,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.objectEvent(
      {
        id: this.id('event'),
        object_type: objectType,
        object_id: objectId,
        event_type: eventType,
        ...(actorId !== undefined ? { actor_id: actorId } : {}),
        metadata,
        created_at: this.now(),
      },
      repository,
    );
  }

  private async historyWithRepository(
    repository: DeliveryRepository,
    objectType: string,
    objectId: string,
    fromStatus: string | undefined,
    toStatus: string,
    actorId: string | undefined,
  ): Promise<void> {
    await this.audit.statusHistory(
      {
        id: this.id('status-history'),
        object_type: objectType,
        object_id: objectId,
        ...(fromStatus !== undefined ? { from_status: fromStatus } : {}),
        to_status: toStatus,
        ...(actorId !== undefined ? { actor_id: actorId } : {}),
        created_at: this.now(),
      },
      repository,
    );
  }

  private actorIdForProductGate(bodyActorId: string | undefined, actorContext?: ActorContext): string {
    const authenticatedActorId = actorContext?.authenticatedActorId?.trim();
    if (authenticatedActorId === undefined || authenticatedActorId.length === 0 || actorContext?.actorClass === undefined) {
      throw new UnauthorizedException('Trusted actor id and class are required for product gate mutations');
    }
    if (bodyActorId !== undefined && bodyActorId !== authenticatedActorId) {
      throw new ForbiddenException('actor_id must match the trusted actor');
    }
    if (productGateRejectedActorClasses.has(actorContext.actorClass)) {
      throw new ForbiddenException({
        code: 'automation_actor_not_allowed_for_product_gate',
        message: `${actorContext.actorClass} actors cannot pass or mutate product gates.`,
      });
    }
    return authenticatedActorId;
  }

  private requireFound<T>(value: T | undefined, label: string): T {
    if (value === undefined) {
      throw new NotFoundException(`${label} not found`);
    }
    return value;
  }

  private id(prefix: string): string {
    return this.runtime.id(prefix);
  }

  private now(): string {
    return this.runtime.now();
  }
}
