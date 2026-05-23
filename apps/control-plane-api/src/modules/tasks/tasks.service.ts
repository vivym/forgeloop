import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { MarkdownDocument, ObjectRef } from '@forgeloop/contracts';
import type { DeliveryRepository } from '@forgeloop/db';
import { getTaskDetail } from '@forgeloop/db';
import type { ObjectEvent, Plan, Spec, Task, WorkItem } from '@forgeloop/domain';

import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';
import { ControlPlaneRuntimeService } from '../core/control-plane-runtime.service';
import { ExecutionPackageService } from '../execution-packages/execution-package.service';
import { MarkdownDocumentService } from '../markdown/markdown-document.service';

type CreateTaskInput = {
  project_id: string;
  title: string;
  execution_brief: string;
  acceptance_checklist: string[];
  parent_ref?: ObjectRef | undefined;
  controlling_spec_revision_id?: string | undefined;
  controlling_plan_revision_id?: string | undefined;
  actor_id?: string | undefined;
};

type CreatePackageInput = {
  actor_id?: string | undefined;
};

@Injectable()
export class TasksService {
  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository,
    @Inject(ControlPlaneRuntimeService) private readonly runtime: ControlPlaneRuntimeService,
    @Inject(MarkdownDocumentService) private readonly markdown: MarkdownDocumentService,
    @Inject(ExecutionPackageService) private readonly executionPackages: ExecutionPackageService,
  ) {}

  async createTask(input: CreateTaskInput): Promise<Record<string, unknown>> {
    if ((await this.repository.getProject(input.project_id)) === undefined) {
      throw new NotFoundException(`Project ${input.project_id} not found`);
    }
    const parentWorkItem = input.parent_ref === undefined ? undefined : await this.validateParentRef(input.parent_ref);
    const staleState = await this.computeStaleState(input, parentWorkItem);
    const createdAt = this.runtime.now();
    const task: Task = {
      id: this.runtime.id('task'),
      project_id: input.project_id,
      title: input.title,
      narrative_markdown: '',
      execution_brief: input.execution_brief,
      acceptance_checklist: input.acceptance_checklist,
      status: staleState === 'current' ? 'ready' : 'draft',
      stale_state: staleState,
      created_at: createdAt,
      updated_at: createdAt,
      ...(input.parent_ref === undefined ? {} : { parent_ref: input.parent_ref }),
      ...(input.controlling_spec_revision_id === undefined
        ? {}
        : { controlling_spec_revision_id: input.controlling_spec_revision_id }),
      ...(input.controlling_plan_revision_id === undefined
        ? {}
        : { controlling_plan_revision_id: input.controlling_plan_revision_id }),
    };

    await this.repository.saveTask(task);
    await this.appendTaskEvent(task, 'task_created', input.actor_id);
    return this.taskActionResponse(task);
  }

  async updateNarrative(taskId: string, body: unknown): Promise<Record<string, unknown>> {
    const document = body as MarkdownDocument;
    if (document.object_ref.type !== 'task' || document.object_ref.id !== taskId) {
      throw new BadRequestException('Task narrative object_ref must match the route task');
    }
    await this.requireTask(taskId);
    const validated = await this.markdown.validateForWrite(document);
    await this.repository.updateTaskNarrative({
      task_id: taskId,
      markdown: validated.markdown,
      updated_at: this.runtime.now(),
    });
    const detail = await getTaskDetail(this.repository, taskId);
    return this.requireFound(detail, `Task ${taskId}`);
  }

  async createPackageForTask(taskId: string, _input: CreatePackageInput): Promise<Record<string, unknown>> {
    const task = await this.requireTask(taskId);
    if (task.stale_state === 'manual_exception') {
      throw new ConflictException('manual_exception tasks cannot generate runtime packages');
    }
    if (task.stale_state !== 'current') {
      throw new ConflictException(`Task ${task.id} is not current`);
    }
    if (task.controlling_spec_revision_id === undefined || task.controlling_plan_revision_id === undefined) {
      throw new ConflictException('Task package generation requires controlling Spec and Plan revisions');
    }

    const packages = await this.executionPackages.generatePublicPackages(task.controlling_plan_revision_id);
    const generatedPackage = packages[0];
    if (generatedPackage === undefined) {
      throw new ConflictException('Task package generation did not produce an execution package');
    }
    await this.repository.linkExecutionPackageToTask({
      task_id: task.id,
      execution_package_id: generatedPackage.id,
    });

    return {
      task_ref: { type: 'task', id: task.id },
      package_ref: { type: 'execution_package', id: generatedPackage.id },
      target: {
        type: 'product_action',
        href: `/tasks/${task.id}/packages/${generatedPackage.id}`,
      },
    };
  }

  private async validateParentRef(parentRef: ObjectRef): Promise<WorkItem | undefined> {
    if (parentRef.type === 'task') {
      await this.requireTask(parentRef.id);
      return undefined;
    }
    if (parentRef.type !== 'requirement' && parentRef.type !== 'bug' && parentRef.type !== 'tech_debt' && parentRef.type !== 'initiative') {
      throw new BadRequestException(`Task parent_ref type ${parentRef.type} is not supported`);
    }
    const workItem = this.requireFound(await this.repository.getWorkItem(parentRef.id), `${parentRef.type} ${parentRef.id}`);
    if (workItem.kind !== parentRef.type) {
      throw new BadRequestException(`Task parent_ref ${parentRef.id} is not a ${parentRef.type}`);
    }
    return workItem;
  }

  private async computeStaleState(input: CreateTaskInput, parentWorkItem: WorkItem | undefined): Promise<Task['stale_state']> {
    if (input.controlling_spec_revision_id === undefined) {
      return 'stale_spec';
    }
    if (input.controlling_plan_revision_id === undefined) {
      return 'stale_plan';
    }
    const specRevision = await this.repository.getSpecRevision(input.controlling_spec_revision_id);
    const planRevision = await this.repository.getPlanRevision(input.controlling_plan_revision_id);
    if (specRevision === undefined) {
      return 'stale_spec';
    }
    if (planRevision === undefined) {
      return 'stale_plan';
    }
    if (parentWorkItem !== undefined) {
      const spec = this.requireFound(await this.repository.getSpec(specRevision.spec_id), `Spec ${specRevision.spec_id}`);
      const plan = this.requireFound(await this.repository.getPlan(planRevision.plan_id), `Plan ${planRevision.plan_id}`);
      if (!isCurrentApprovedSpec(spec, input.controlling_spec_revision_id) || parentWorkItem.current_spec_revision_id !== input.controlling_spec_revision_id) {
        return 'stale_spec';
      }
      if (
        !isCurrentApprovedPlan(plan, input.controlling_plan_revision_id) ||
        parentWorkItem.current_plan_revision_id !== input.controlling_plan_revision_id ||
        planRevision.based_on_spec_revision_id !== input.controlling_spec_revision_id
      ) {
        return 'stale_plan';
      }
    }
    return 'current';
  }

  private async requireTask(taskId: string): Promise<Task> {
    return this.requireFound(await this.repository.getTask(taskId), `Task ${taskId}`);
  }

  private requireFound<T>(value: T | undefined, label: string): T {
    if (value === undefined) {
      throw new NotFoundException(`${label} not found`);
    }
    return value;
  }

  private async appendTaskEvent(task: Task, eventType: string, actorId: string | undefined): Promise<void> {
    const event: ObjectEvent = {
      id: this.runtime.id('event'),
      object_type: 'task',
      object_id: task.id,
      event_type: eventType,
      ...(actorId === undefined ? {} : { actor_id: actorId }),
      metadata: {},
      created_at: this.runtime.now(),
    };
    await this.repository.appendObjectEvent(event);
  }

  private taskActionResponse(task: Task): Record<string, unknown> {
    return {
      id: task.id,
      object_ref: { type: 'task', id: task.id },
      title: task.title,
      stale_state: task.stale_state,
      package_generation_eligible:
        task.stale_state === 'current' &&
        task.controlling_spec_revision_id !== undefined &&
        task.controlling_plan_revision_id !== undefined,
      href: `/tasks/${task.id}`,
    };
  }
}

function isCurrentApprovedSpec(spec: Spec, revisionId: string): boolean {
  return spec.status === 'approved' && spec.resolution === 'approved' && spec.current_revision_id === revisionId && spec.approved_revision_id === revisionId;
}

function isCurrentApprovedPlan(plan: Plan, revisionId: string): boolean {
  return plan.status === 'approved' && plan.resolution === 'approved' && plan.current_revision_id === revisionId && plan.approved_revision_id === revisionId;
}
