import { Body, Controller, Inject, Param, Post } from '@nestjs/common';
import { sourceObjectRefSchema } from '@forgeloop/contracts';
import { z } from 'zod';

import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { DevelopmentPlansService } from './development-plans.service';

const nonEmptyString = z.string().trim().min(1);
const sourceTypeSchema = z.enum(['initiative', 'requirement', 'bug', 'tech_debt']);

const createDevelopmentPlanCommandSchema = z
  .object({
    project_id: nonEmptyString,
    source_ref: sourceObjectRefSchema,
    title: nonEmptyString,
    actor_id: nonEmptyString.optional(),
  })
  .strict();

const createDevelopmentPlanItemCommandSchema = z
  .object({
    title: nonEmptyString,
    summary: nonEmptyString,
    responsible_role: z.enum(['product', 'tech_lead', 'developer', 'qa', 'release_owner', 'manager']),
    driver_actor_id: nonEmptyString.optional(),
    reviewer_actor_id: nonEmptyString.optional(),
    risk: z.enum(['low', 'medium', 'high', 'critical']),
    dependency_hints: z.array(nonEmptyString).default([]),
    affected_surfaces: z.array(nonEmptyString).default([]),
    release_impact: z.enum(['none', 'release_scoped', 'release_blocking']),
  })
  .strict();

const generateDevelopmentPlanDraftCommandSchema = z
  .object({
    project_id: nonEmptyString,
    source_ref: sourceObjectRefSchema,
    actor_id: nonEmptyString.optional(),
    guidance: nonEmptyString.optional(),
  })
  .strict();

const regenerateDevelopmentPlanDraftCommandSchema = z
  .object({
    actor_id: nonEmptyString.optional(),
    feedback: nonEmptyString,
    preserve_prior_decisions: z.boolean().default(false),
  })
  .strict();

const linkDevelopmentPlanCommandSchema = z
  .object({
    actor_id: nonEmptyString.optional(),
    rationale: nonEmptyString.optional(),
  })
  .strict();

type CreateDevelopmentPlanCommandDto = z.infer<typeof createDevelopmentPlanCommandSchema>;
type CreateDevelopmentPlanItemCommandDto = z.infer<typeof createDevelopmentPlanItemCommandSchema>;
type GenerateDevelopmentPlanDraftCommandDto = z.infer<typeof generateDevelopmentPlanDraftCommandSchema>;
type RegenerateDevelopmentPlanDraftCommandDto = z.infer<typeof regenerateDevelopmentPlanDraftCommandSchema>;
type LinkDevelopmentPlanCommandDto = z.infer<typeof linkDevelopmentPlanCommandSchema>;
type SourceObjectType = z.infer<typeof sourceTypeSchema>;

@Controller()
export class DevelopmentPlansController {
  constructor(@Inject(DevelopmentPlansService) private readonly service: DevelopmentPlansService) {}

  @Post('development-plans')
  createDevelopmentPlan(@Body(new ZodValidationPipe(createDevelopmentPlanCommandSchema)) body: CreateDevelopmentPlanCommandDto) {
    return this.service.createDevelopmentPlan(body);
  }

  @Post('development-plans/:developmentPlanId/items')
  createDevelopmentPlanItem(
    @Param('developmentPlanId') developmentPlanId: string,
    @Body(new ZodValidationPipe(createDevelopmentPlanItemCommandSchema)) body: CreateDevelopmentPlanItemCommandDto,
  ) {
    return this.service.createDevelopmentPlanItem(developmentPlanId, body);
  }

  @Post('development-plans/generate-draft')
  generateDevelopmentPlanDraft(
    @Body(new ZodValidationPipe(generateDevelopmentPlanDraftCommandSchema)) body: GenerateDevelopmentPlanDraftCommandDto,
  ) {
    return this.service.generateDevelopmentPlanDraft(body);
  }

  @Post('development-plans/:developmentPlanId/regenerate-draft')
  regenerateDevelopmentPlanDraft(
    @Param('developmentPlanId') developmentPlanId: string,
    @Body(new ZodValidationPipe(regenerateDevelopmentPlanDraftCommandSchema)) body: RegenerateDevelopmentPlanDraftCommandDto,
  ) {
    return this.service.regenerateDevelopmentPlanDraft(developmentPlanId, body);
  }

  @Post('source-objects/:sourceType/:sourceId/development-plans/:developmentPlanId/link')
  linkSourceObjectToDevelopmentPlan(
    @Param('sourceType', new ZodValidationPipe(sourceTypeSchema)) sourceType: SourceObjectType,
    @Param('sourceId') sourceId: string,
    @Param('developmentPlanId') developmentPlanId: string,
    @Body(new ZodValidationPipe(linkDevelopmentPlanCommandSchema)) body: LinkDevelopmentPlanCommandDto,
  ) {
    return this.service.linkSourceObjectToDevelopmentPlan({
      source_type: sourceType,
      source_id: sourceId,
      development_plan_id: developmentPlanId,
      ...body,
    });
  }
}
