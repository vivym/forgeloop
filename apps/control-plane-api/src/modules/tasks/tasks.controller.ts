import { Body, Controller, Inject, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { markdownDocumentSchema, objectRefSchema } from '@forgeloop/contracts';

import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { TasksService } from './tasks.service';

const createTaskSchema = z
  .object({
    project_id: z.string().trim().min(1),
    title: z.string().trim().min(1),
    execution_brief: z.string().trim().min(1),
    acceptance_checklist: z.array(z.string().trim().min(1)).default([]),
    parent_ref: objectRefSchema.optional(),
    controlling_spec_revision_id: z.string().trim().min(1).optional(),
    controlling_plan_revision_id: z.string().trim().min(1).optional(),
    actor_id: z.string().trim().min(1).optional(),
  })
  .strict();

const createPackageSchema = z
  .object({
    actor_id: z.string().trim().min(1).optional(),
  })
  .strict();

type CreateTaskBody = z.infer<typeof createTaskSchema>;
type CreatePackageBody = z.infer<typeof createPackageSchema>;

@Controller('tasks')
export class TasksController {
  constructor(@Inject(TasksService) private readonly service: TasksService) {}

  @Post()
  createTask(@Body(new ZodValidationPipe(createTaskSchema)) body: CreateTaskBody) {
    return this.service.createTask(body);
  }

  @Patch(':taskId/narrative')
  updateNarrative(@Param('taskId') taskId: string, @Body(new ZodValidationPipe(markdownDocumentSchema)) body: unknown) {
    return this.service.updateNarrative(taskId, body);
  }

  @Post(':taskId/packages')
  createPackage(@Param('taskId') taskId: string, @Body(new ZodValidationPipe(createPackageSchema)) body: CreatePackageBody) {
    return this.service.createPackageForTask(taskId, body);
  }
}
