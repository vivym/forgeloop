import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';

import {
  createProjectRepoSchema,
  createProjectSchema,
  type CreateProjectDto,
  type CreateProjectRepoDto,
} from '../delivery/dto';
import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { ProjectService } from './project.service';

@Controller()
export class ProjectsController {
  constructor(@Inject(ProjectService) private readonly projectService: ProjectService) {}

  @Post('projects')
  createProject(@Body(new ZodValidationPipe(createProjectSchema)) body: CreateProjectDto) {
    return this.projectService.createProject(body);
  }

  @Get('projects/:projectId')
  getProject(@Param('projectId') projectId: string) {
    return this.projectService.getProject(projectId);
  }

  @Post('projects/:projectId/repos')
  createProjectRepo(
    @Param('projectId') projectId: string,
    @Body(new ZodValidationPipe(createProjectRepoSchema)) body: CreateProjectRepoDto,
  ) {
    return this.projectService.createProjectRepo(projectId, body);
  }

  @Get('projects/:projectId/repos')
  listProjectRepos(@Param('projectId') projectId: string) {
    return this.projectService.listProjectRepos(projectId);
  }
}
