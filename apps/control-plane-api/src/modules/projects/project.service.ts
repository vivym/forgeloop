import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Project, ProjectRepo } from '@forgeloop/domain';
import type { DeliveryRepository } from '@forgeloop/db';

import { AuditWriterService } from '../audit/audit-writer.service';
import { ControlPlaneRuntimeService } from '../core/control-plane-runtime.service';
import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';
import type { CreateProjectDto, CreateProjectRepoDto } from '../delivery/dto';

@Injectable()
export class ProjectService {
  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository,
    @Inject(ControlPlaneRuntimeService) private readonly runtime: ControlPlaneRuntimeService,
    @Inject(AuditWriterService) private readonly audit: AuditWriterService,
  ) {}

  async createProject(dto: CreateProjectDto): Promise<Project> {
    const at = this.runtime.now();
    const project: Project = {
      id: this.runtime.id('project'),
      name: dto.name,
      repo_ids: [],
      ...(dto.owner_actor_id !== undefined ? { owner_actor_id: dto.owner_actor_id } : {}),
      created_at: at,
      updated_at: at,
    };
    await this.repository.saveProject(project);
    await this.audit.objectEvent(
      {
        id: this.runtime.id('object-event'),
        object_type: 'project',
        object_id: project.id,
        event_type: 'project_created',
        ...(dto.owner_actor_id !== undefined ? { actor_id: dto.owner_actor_id } : {}),
        metadata: {},
        created_at: this.runtime.now(),
      },
      this.repository,
    );
    return project;
  }

  async getProject(projectId: string): Promise<Project> {
    const project = await this.repository.getProject(projectId);
    if (project === undefined) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    return project;
  }

  async createProjectRepo(projectId: string, dto: CreateProjectRepoDto): Promise<ProjectRepo> {
    const project = await this.getProject(projectId);
    const at = this.runtime.now();
    const repo: ProjectRepo = {
      id: this.runtime.id('project-repo'),
      repo_id: dto.repo_id,
      project_id: project.id,
      name: dto.name,
      status: 'active',
      local_path: dto.local_path,
      default_branch: dto.default_branch ?? 'main',
      ...(dto.remote_url !== undefined ? { remote_url: dto.remote_url } : {}),
      base_commit_sha: dto.base_commit_sha,
      created_at: at,
      updated_at: at,
    };
    await this.repository.saveProjectRepo(repo);
    await this.repository.saveProject({
      ...project,
      repo_ids: [...new Set([...project.repo_ids, repo.repo_id])],
      updated_at: at,
    });
    await this.audit.objectEvent(
      {
        id: this.runtime.id('object-event'),
        object_type: 'project_repo',
        object_id: repo.id,
        event_type: 'repo_bound',
        ...(project.owner_actor_id !== undefined ? { actor_id: project.owner_actor_id } : {}),
        metadata: { project_id: project.id },
        created_at: this.runtime.now(),
      },
      this.repository,
    );
    return repo;
  }

  listProjectRepos(projectId: string): Promise<ProjectRepo[]> {
    return this.repository.listProjectRepos(projectId);
  }
}
