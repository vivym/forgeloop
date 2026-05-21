import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { transitionWorkItem, type WorkItem, type WorkItemPhase } from '@forgeloop/domain';
import type { DeliveryRepository } from '@forgeloop/db';

import { AuditWriterService } from '../audit/audit-writer.service';
import { ControlPlaneRuntimeService } from '../core/control-plane-runtime.service';
import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';
import type { CreateWorkItemDto, UpdateWorkItemDto } from '../delivery/dto';
import { ProjectService } from '../projects/project.service';

const serviceOwnedReadinessPhases = new Set<WorkItemPhase>(['draft', 'triage']);

const statusForWorkItem = (workItem: WorkItem): string => `${workItem.phase}/${workItem.gate_state}`;

@Injectable()
export class WorkItemService {
  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository,
    @Inject(ControlPlaneRuntimeService) private readonly runtime: ControlPlaneRuntimeService,
    @Inject(AuditWriterService) private readonly audit: AuditWriterService,
    @Inject(ProjectService) private readonly projectService: ProjectService,
  ) {}

  async createWorkItem(dto: CreateWorkItemDto): Promise<WorkItem> {
    await this.projectService.getProject(dto.project_id);
    const workItem = transitionWorkItem(undefined, {
      type: 'create',
      id: this.runtime.id('work-item'),
      project_id: dto.project_id,
      kind: dto.kind,
      title: dto.title,
      goal: dto.goal,
      success_criteria: dto.success_criteria,
      priority: dto.priority,
      risk: dto.risk,
      driver_actor_id: dto.driver_actor_id,
      intake_context: dto.intake_context,
      at: this.runtime.now(),
    });
    await this.repository.saveWorkItem(workItem);
    await this.audit.objectEvent(
      {
        id: this.runtime.id('object-event'),
        object_type: 'work_item',
        object_id: workItem.id,
        event_type: 'work_item_created',
        actor_id: workItem.driver_actor_id,
        metadata: {},
        created_at: this.runtime.now(),
      },
      this.repository,
    );
    return workItem;
  }

  listWorkItems(projectId?: string): Promise<WorkItem[]> {
    return this.repository.listWorkItems(projectId);
  }

  async getWorkItem(workItemId: string): Promise<WorkItem> {
    const workItem = await this.repository.getWorkItem(workItemId);
    if (workItem === undefined) {
      throw new NotFoundException(`WorkItem ${workItemId} not found`);
    }
    return workItem;
  }

  async updateWorkItem(workItemId: string, dto: UpdateWorkItemDto): Promise<WorkItem> {
    if (Object.values(dto).every((value) => value === undefined)) {
      throw new BadRequestException('At least one work item readiness field is required');
    }

    return this.repository.withObjectLock(`work-item:${workItemId}`, async (repository) => {
      const workItem = await repository.getWorkItem(workItemId);
      if (workItem === undefined) {
        throw new NotFoundException(`WorkItem ${workItemId} not found`);
      }

      if (dto.intake_context !== undefined && dto.intake_context.type !== workItem.kind) {
        throw new BadRequestException('intake_context type must match Work Item kind');
      }

      if (dto.phase !== undefined) {
        if (!serviceOwnedReadinessPhases.has(workItem.phase)) {
          throw new BadRequestException(`WorkItem ${workItemId} is already in lifecycle phase ${workItem.phase}`);
        }
      }

      const updated: WorkItem = {
        id: workItem.id,
        project_id: workItem.project_id,
        kind: workItem.kind,
        title: workItem.title,
        goal: dto.goal ?? workItem.goal,
        success_criteria: dto.success_criteria ?? workItem.success_criteria,
        priority: dto.priority ?? workItem.priority,
        risk: dto.risk ?? workItem.risk,
        driver_actor_id: dto.driver_actor_id ?? workItem.driver_actor_id,
        intake_context: dto.intake_context ?? workItem.intake_context,
        phase: dto.phase ?? workItem.phase,
        activity_state: workItem.activity_state,
        gate_state: workItem.gate_state,
        resolution: workItem.resolution,
        ...(workItem.current_spec_id !== undefined ? { current_spec_id: workItem.current_spec_id } : {}),
        ...(workItem.current_spec_revision_id !== undefined
          ? { current_spec_revision_id: workItem.current_spec_revision_id }
          : {}),
        ...(workItem.current_plan_id !== undefined ? { current_plan_id: workItem.current_plan_id } : {}),
        ...(workItem.current_plan_revision_id !== undefined
          ? { current_plan_revision_id: workItem.current_plan_revision_id }
          : {}),
        ...(workItem.current_release_id !== undefined ? { current_release_id: workItem.current_release_id } : {}),
        ...(workItem.archived_at !== undefined ? { archived_at: workItem.archived_at } : {}),
        ...(workItem.deleted_at !== undefined ? { deleted_at: workItem.deleted_at } : {}),
        created_at: workItem.created_at,
        updated_at: this.runtime.now(),
      };
      await repository.saveWorkItem(updated);
      if (updated.phase !== workItem.phase) {
        await this.audit.statusHistory(
          {
            id: this.runtime.id('status-history'),
            object_type: 'work_item',
            object_id: updated.id,
            from_status: statusForWorkItem(workItem),
            to_status: statusForWorkItem(updated),
            actor_id: dto.driver_actor_id ?? workItem.driver_actor_id,
            created_at: this.runtime.now(),
          },
          repository,
        );
      }
      await this.audit.objectEvent(
        {
          id: this.runtime.id('object-event'),
          object_type: 'work_item',
          object_id: updated.id,
          event_type: 'work_item_updated',
          actor_id: dto.driver_actor_id ?? workItem.driver_actor_id,
          metadata: {},
          created_at: this.runtime.now(),
        },
        repository,
      );
      return updated;
    });
  }
}
