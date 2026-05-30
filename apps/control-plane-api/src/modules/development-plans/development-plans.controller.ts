import { Body, Controller, Inject, Param, Patch, Post } from '@nestjs/common';
import { planningInputRefSchema } from '@forgeloop/contracts';
import { z } from 'zod';

import { ZodValidationPipe } from '../http/zod-validation.pipe';
import { DevelopmentPlansService } from './development-plans.service';

const nonEmptyString = z.string().trim().min(1);
const sourceTypeSchema = z.enum(['initiative', 'requirement', 'bug', 'tech_debt']);

const createDevelopmentPlanCommandSchema = z
  .object({
    project_id: nonEmptyString,
    source_ref: planningInputRefSchema,
    title: nonEmptyString,
    actor_id: nonEmptyString.optional(),
    guidance: nonEmptyString.optional(),
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

const updateDevelopmentPlanItemCommandSchema = z
  .object({
    title: nonEmptyString.optional(),
    summary: nonEmptyString.optional(),
    actor_id: nonEmptyString.optional(),
  })
  .strict()
  .refine((body) => body.title !== undefined || body.summary !== undefined, {
    message: 'title or summary is required',
  });

const generateDevelopmentPlanDraftCommandSchema = z
  .object({
    project_id: nonEmptyString,
    source_ref: planningInputRefSchema,
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
type UpdateDevelopmentPlanItemCommandDto = z.infer<typeof updateDevelopmentPlanItemCommandSchema>;
type GenerateDevelopmentPlanDraftCommandDto = z.infer<typeof generateDevelopmentPlanDraftCommandSchema>;
type RegenerateDevelopmentPlanDraftCommandDto = z.infer<typeof regenerateDevelopmentPlanDraftCommandSchema>;
type LinkDevelopmentPlanCommandDto = z.infer<typeof linkDevelopmentPlanCommandSchema>;
type PlanningInputType = z.infer<typeof sourceTypeSchema>;

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

  @Patch('development-plans/:developmentPlanId/items/:itemId')
  updateDevelopmentPlanItem(
    @Param('developmentPlanId') developmentPlanId: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(updateDevelopmentPlanItemCommandSchema)) body: UpdateDevelopmentPlanItemCommandDto,
  ) {
    return this.service.updateDevelopmentPlanItem(developmentPlanId, itemId, body);
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

  @Post('requirements/:requirementId/development-plans/:developmentPlanId/link')
  linkRequirementToDevelopmentPlan(
    @Param('requirementId') requirementId: string,
    @Param('developmentPlanId') developmentPlanId: string,
    @Body(new ZodValidationPipe(linkDevelopmentPlanCommandSchema)) body: LinkDevelopmentPlanCommandDto,
  ) {
    return this.linkPlanningInputToDevelopmentPlan('requirement', requirementId, developmentPlanId, body);
  }

  @Post('initiatives/:initiativeId/development-plans/:developmentPlanId/link')
  linkInitiativeToDevelopmentPlan(
    @Param('initiativeId') initiativeId: string,
    @Param('developmentPlanId') developmentPlanId: string,
    @Body(new ZodValidationPipe(linkDevelopmentPlanCommandSchema)) body: LinkDevelopmentPlanCommandDto,
  ) {
    return this.linkPlanningInputToDevelopmentPlan('initiative', initiativeId, developmentPlanId, body);
  }

  @Post('tech-debt/:techDebtId/development-plans/:developmentPlanId/link')
  linkTechDebtToDevelopmentPlan(
    @Param('techDebtId') techDebtId: string,
    @Param('developmentPlanId') developmentPlanId: string,
    @Body(new ZodValidationPipe(linkDevelopmentPlanCommandSchema)) body: LinkDevelopmentPlanCommandDto,
  ) {
    return this.linkPlanningInputToDevelopmentPlan('tech_debt', techDebtId, developmentPlanId, body);
  }

  @Post('bugs/:bugId/development-plans/:developmentPlanId/link')
  linkBugToDevelopmentPlan(
    @Param('bugId') bugId: string,
    @Param('developmentPlanId') developmentPlanId: string,
    @Body(new ZodValidationPipe(linkDevelopmentPlanCommandSchema)) body: LinkDevelopmentPlanCommandDto,
  ) {
    return this.linkPlanningInputToDevelopmentPlan('bug', bugId, developmentPlanId, body);
  }

  private linkPlanningInputToDevelopmentPlan(
    sourceType: PlanningInputType,
    sourceId: string,
    developmentPlanId: string,
    body: LinkDevelopmentPlanCommandDto,
  ) {
    return this.service.linkPlanningInputToDevelopmentPlan({
      source_type: sourceType,
      source_id: sourceId,
      development_plan_id: developmentPlanId,
      ...body,
    });
  }
}
