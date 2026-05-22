import { z } from 'zod';

import { artifactKindSchema, executorTypeSchema, jsonObjectSchema } from './executor.js';
import {
  reviewDecisionSchema,
  requestedChangeSchema,
  reviewDecisionPayloadSchema,
  reviewSubmitDecisionSchema,
} from './review.js';

type ProductParsedUrl = {
  origin: string;
  pathname: string;
};

declare const URL: {
  new (input: string, base?: string): ProductParsedUrl;
};

const isoDateTimeSchema = z.string().datetime();

const commandNames = [
  'run_package',
  'rerun_package',
  'force_rerun_package',
  'approve_review_packet',
  'request_review_changes',
] as const;

export const commandNameSchema = z.enum(commandNames);
export type CommandName = z.infer<typeof commandNameSchema>;

const commandInventoryPaths: Record<CommandName, string> = {
  run_package: '/execution-packages/:packageId/run',
  rerun_package: '/execution-packages/:packageId/rerun',
  force_rerun_package: '/execution-packages/:packageId/force-rerun',
  approve_review_packet: '/review-packets/:reviewPacketId/approve',
  request_review_changes: '/review-packets/:reviewPacketId/request-changes',
};

export const commandInventoryItemSchema = z
  .object({
    command: commandNameSchema,
    method: z.enum(['POST']),
    path: z.string().min(1),
    description: z.string().min(1),
  })
  .superRefine((item, ctx) => {
    const expectedPath = commandInventoryPaths[item.command];

    if (item.path !== expectedPath) {
      ctx.addIssue({
        code: 'custom',
        path: ['path'],
        message: `${item.command} command path must be ${expectedPath}`,
      });
    }
  });
export type CommandInventoryItem = z.infer<typeof commandInventoryItemSchema>;

export const commandInventoryResponseSchema = z
  .object({
    commands: z.array(commandInventoryItemSchema),
  })
  .superRefine((inventory, ctx) => {
    const commandCounts = new Map<CommandName, number>();

    inventory.commands.forEach((item, index) => {
      const count = commandCounts.get(item.command) ?? 0;

      if (count > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['commands', index, 'command'],
          message: `command inventory command must be unique: ${item.command}`,
        });
      }

      commandCounts.set(item.command, count + 1);
    });

    commandNames.forEach((command) => {
      if (!commandCounts.has(command)) {
        ctx.addIssue({
          code: 'custom',
          path: ['commands'],
          message: `command inventory is missing command: ${command}`,
        });
      }
    });
  });
export type CommandInventoryResponse = z.infer<typeof commandInventoryResponseSchema>;

const nonEmptyTrimmedStringSchema = z.string().trim().min(1);

export const productLaneIds = [
  'requirements',
  'bugs',
  'tech-debt',
  'initiatives',
  'spec-approver',
  'execution-owner',
  'reviewer',
  'qa-test-owner',
  'release-owner',
  'manager',
] as const;

export const productLaneIdSchema = z.enum(productLaneIds);
export type ProductLaneId = z.infer<typeof productLaneIdSchema>;

export const productActionPrioritySchema = z.enum(['primary', 'secondary', 'tertiary']);
export type ProductActionPriority = z.infer<typeof productActionPrioritySchema>;

export const productObjectTypeSchema = z.enum([
  'work_item',
  'spec',
  'spec_revision',
  'plan',
  'plan_revision',
  'execution_package',
  'run_session',
  'review_packet',
  'release',
]);
export type ProductObjectType = z.infer<typeof productObjectTypeSchema>;

const productHrefPrefixes = [
  '/lanes',
  '/work-items',
  '/specs',
  '/plans',
  '/packages',
  '/runs',
  '/reviews',
  '/releases',
  '/pipeline',
] as const;

const mutatingRouteSegments = new Set([
  'approve',
  'cancel',
  'create',
  'delete',
  'force-rerun',
  'generate-draft',
  'mark-ready',
  'patch',
  'request-changes',
  'rerun',
  'resume',
  'run',
  'submit',
  'update',
]);

const productHrefBaseUrl = 'https://forgeloop.local';

const supportedProductLaneQueryKeys = new Set([
  'project_id',
  'actor_id',
  'driver_actor_id',
  'owner_actor_id',
  'reviewer_actor_id',
  'qa_owner_actor_id',
  'release_owner_actor_id',
  'cursor',
  'limit',
  'kind',
  'phase',
  'status',
  'gate_state',
  'resolution',
  'risk',
  'blocked',
  'stale',
]);

function decodeProductPathname(pathname: string): string | undefined {
  let decoded = pathname;
  for (let index = 0; index < 3; index += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        break;
      }
      decoded = next;
    } catch {
      return undefined;
    }
  }
  return decoded;
}

function isSafeProductPathname(pathname: string): boolean {
  if (/%2e|%2f|%5c/i.test(pathname)) {
    return false;
  }

  const decoded = decodeProductPathname(pathname);
  if (decoded === undefined || /[%\\\s]/.test(decoded)) {
    return false;
  }

  const segments = decoded.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    return false;
  }

  return true;
}

function productLaneTargetQueryKeys(href: string): string[] | undefined {
  const withoutHash = href.split('#', 1)[0] ?? '';
  const queryStart = withoutHash.indexOf('?');
  if (queryStart === -1) {
    return [];
  }

  const query = withoutHash.slice(queryStart + 1);
  if (query.length === 0) {
    return [];
  }

  const keys: string[] = [];
  for (const part of query.split('&')) {
    if (part.length === 0) {
      return undefined;
    }
    const rawKey = part.split('=', 1)[0] ?? '';
    try {
      keys.push(decodeURIComponent(rawKey.replace(/\+/g, ' ')));
    } catch {
      return undefined;
    }
  }
  return keys;
}

export const productHrefSchema = nonEmptyTrimmedStringSchema.refine(
  (href) => {
    if (!href.startsWith('/') || href.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(href) || /[\s\\]/.test(href)) {
      return false;
    }

    const rawPathname = href.split(/[?#]/, 1)[0] ?? '';
    if (!isSafeProductPathname(rawPathname)) {
      return false;
    }

    let url: ProductParsedUrl;
    let pathname: string;
    try {
      url = new URL(href, productHrefBaseUrl);
      pathname = decodeProductPathname(url.pathname) ?? '';
    } catch {
      return false;
    }

    if (!isSafeProductPathname(url.pathname)) {
      return false;
    }

    if (url.origin !== productHrefBaseUrl || pathname === '/query' || pathname.startsWith('/query/')) {
      return false;
    }

    const hasAllowedPrefix = productHrefPrefixes.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
    if (!hasAllowedPrefix) {
      return false;
    }

    const segments = pathname.split('/').filter(Boolean);
    return !segments.some((segment, index) => index > 0 && mutatingRouteSegments.has(segment));
  },
  { message: 'must be a same-origin product UI route' },
);
export type ProductHref = z.infer<typeof productHrefSchema>;

const productActionObjectTargetSchema = z
  .object({
    kind: z.literal('object'),
    object_type: productObjectTypeSchema,
    object_id: nonEmptyTrimmedStringSchema,
    href: productHrefSchema,
  })
  .strict();

const productActionLaneTargetSchema = z
  .object({
    kind: z.literal('lane'),
    lane_id: productLaneIdSchema,
    href: productHrefSchema,
  })
  .strict()
  .superRefine((target, ctx) => {
    let url: ProductParsedUrl;
    try {
      url = new URL(target.href, productHrefBaseUrl);
    } catch {
      return;
    }

    const pathname = decodeProductPathname(url.pathname);
    if (pathname === undefined || pathname !== `/lanes/${target.lane_id}`) {
      ctx.addIssue({
        code: 'custom',
        path: ['href'],
        message: 'lane target href must match lane_id',
      });
    }

    const queryKeys = productLaneTargetQueryKeys(target.href);
    if (queryKeys === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['href'],
        message: 'lane target href query must be parseable',
      });
      return;
    }

    const seenKeys = new Set<string>();
    for (const key of queryKeys) {
      if (!supportedProductLaneQueryKeys.has(key) || seenKeys.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['href'],
          message: 'lane target href query must use supported product lane keys once',
        });
        return;
      }
      seenKeys.add(key);
    }
  });

const productActionRouteTargetSchema = z
  .object({
    kind: z.literal('route'),
    href: productHrefSchema,
  })
  .strict();

export const productActionTargetSchema = z.discriminatedUnion('kind', [
  productActionObjectTargetSchema,
  productActionLaneTargetSchema,
  productActionRouteTargetSchema,
]);
export type ProductActionTarget = z.infer<typeof productActionTargetSchema>;

const commandBaseSchema = {
  object_id: nonEmptyTrimmedStringSchema,
  work_item_id: nonEmptyTrimmedStringSchema,
} as const;

const generateSpecDraftCommandSchema = z
  .object({
    type: z.literal('generate_spec_draft'),
    object_type: z.literal('spec'),
    ...commandBaseSchema,
    spec_id: nonEmptyTrimmedStringSchema,
  })
  .strict()
  .superRefine((command, ctx) => {
    if (command.object_id !== command.spec_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['object_id'],
        message: 'object_id must match spec_id',
      });
    }
  });

const generatePlanDraftCommandSchema = z
  .object({
    type: z.literal('generate_plan_draft'),
    object_type: z.literal('plan'),
    ...commandBaseSchema,
    plan_id: nonEmptyTrimmedStringSchema,
  })
  .strict()
  .superRefine((command, ctx) => {
    if (command.object_id !== command.plan_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['object_id'],
        message: 'object_id must match plan_id',
      });
    }
  });

const generatePackagesCommandSchema = z
  .object({
    type: z.literal('generate_packages'),
    object_type: z.literal('plan_revision'),
    ...commandBaseSchema,
    plan_revision_id: nonEmptyTrimmedStringSchema,
  })
  .strict()
  .superRefine((command, ctx) => {
    if (command.object_id !== command.plan_revision_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['object_id'],
        message: 'object_id must match plan_revision_id',
      });
    }
  });

const markPackageReadyCommandSchema = z
  .object({
    type: z.literal('mark_package_ready'),
    object_type: z.literal('execution_package'),
    ...commandBaseSchema,
    package_id: nonEmptyTrimmedStringSchema,
    expected_package_version: z.number().int(),
  })
  .strict()
  .superRefine((command, ctx) => {
    if (command.object_id !== command.package_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['object_id'],
        message: 'object_id must match package_id',
      });
    }
  });

const runPackageCommandSchema = z
  .object({
    type: z.literal('run_package'),
    object_type: z.literal('execution_package'),
    ...commandBaseSchema,
    package_id: nonEmptyTrimmedStringSchema,
  })
  .strict()
  .superRefine((command, ctx) => {
    if (command.object_id !== command.package_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['object_id'],
        message: 'object_id must match package_id',
      });
    }
  });

export const productCommandSchema = z.discriminatedUnion('type', [
  generateSpecDraftCommandSchema,
  generatePlanDraftCommandSchema,
  generatePackagesCommandSchema,
  markPackageReadyCommandSchema,
  runPackageCommandSchema,
]);
export type ProductCommand = z.infer<typeof productCommandSchema>;

const productActionBaseSchema = {
  id: nonEmptyTrimmedStringSchema,
  lane_id: productLaneIdSchema,
  priority: productActionPrioritySchema,
  label: nonEmptyTrimmedStringSchema,
  description: nonEmptyTrimmedStringSchema.optional(),
  enabled: z.boolean(),
  disabled_reason: nonEmptyTrimmedStringSchema.optional(),
  blocked_reason: nonEmptyTrimmedStringSchema.optional(),
} as const;

const productNavigateActionSchema = z
  .object({
    ...productActionBaseSchema,
    kind: z.literal('navigate'),
    target: productActionTargetSchema,
    command: z.never().optional(),
  })
  .strict();

const productCommandActionSchema = z
  .object({
    ...productActionBaseSchema,
    kind: z.literal('command'),
    command: productCommandSchema,
    target: productActionTargetSchema.optional(),
  })
  .strict();

export const productActionSchema = z
  .discriminatedUnion('kind', [productNavigateActionSchema, productCommandActionSchema])
  .superRefine((action, ctx) => {
    if (action.enabled) {
      if (action.disabled_reason !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['disabled_reason'],
          message: 'enabled actions must not include disabled_reason',
        });
      }

      if (action.blocked_reason !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['blocked_reason'],
          message: 'enabled actions must not include blocked_reason',
        });
      }
    } else if (action.disabled_reason === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['disabled_reason'],
        message: 'disabled actions require disabled_reason',
      });
    }

    if (action.kind === 'command' && action.lane_id === 'manager') {
      ctx.addIssue({
        code: 'custom',
        path: ['lane_id'],
        message: 'manager lane does not allow command actions',
      });
    }
  });
export type ProductNavigateAction = z.infer<typeof productNavigateActionSchema>;
export type ProductCommandAction = z.infer<typeof productCommandActionSchema>;
export type ProductAction = z.infer<typeof productActionSchema>;

const productLaneItemObjectSchema = z
  .object({
    type: productObjectTypeSchema,
    id: nonEmptyTrimmedStringSchema,
  })
  .strict();

const productLaneItemSummaryObjectSchema = z
  .object({
    type: z.literal('lane_summary'),
    id: nonEmptyTrimmedStringSchema,
    lane_id: productLaneIdSchema,
  })
  .strict();

const productLaneItemParentSchema = z
  .object({
    type: productObjectTypeSchema,
    id: nonEmptyTrimmedStringSchema,
    title: nonEmptyTrimmedStringSchema.optional(),
  })
  .strict();

export const productLaneItemSchema = z
  .object({
    id: nonEmptyTrimmedStringSchema,
    title: nonEmptyTrimmedStringSchema,
    object: z.union([productLaneItemObjectSchema, productLaneItemSummaryObjectSchema]),
    parent: productLaneItemParentSchema.optional(),
    kind: nonEmptyTrimmedStringSchema.optional(),
    surface_type: nonEmptyTrimmedStringSchema.optional(),
    phase: nonEmptyTrimmedStringSchema.optional(),
    status: nonEmptyTrimmedStringSchema.optional(),
    gate_state: nonEmptyTrimmedStringSchema.optional(),
    resolution: nonEmptyTrimmedStringSchema.optional(),
    risk: nonEmptyTrimmedStringSchema.optional(),
    driver_actor_id: nonEmptyTrimmedStringSchema.optional(),
    owner_actor_id: nonEmptyTrimmedStringSchema.optional(),
    reviewer_actor_id: nonEmptyTrimmedStringSchema.optional(),
    qa_owner_actor_id: nonEmptyTrimmedStringSchema.optional(),
    release_owner_actor_id: nonEmptyTrimmedStringSchema.optional(),
    updated_at: isoDateTimeSchema,
    actions: z.array(productActionSchema),
  })
  .strict()
  .superRefine((item, ctx) => {
    const actionIds = new Set<string>();

    item.actions.forEach((action, index) => {
      if (actionIds.has(action.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['actions', index, 'id'],
          message: `product action id must be unique within item: ${action.id}`,
        });
      }
      actionIds.add(action.id);
    });
  });
export type ProductLaneItem = z.infer<typeof productLaneItemSchema>;

const productLaneSummarySchema = z
  .object({
    total: z.number().int().nonnegative(),
    blocked: z.number().int().nonnegative(),
    high_risk: z.number().int().nonnegative(),
    stale: z.number().int().nonnegative(),
  })
  .strict();

export const productLaneResponseSchema = z
  .object({
    lane_id: productLaneIdSchema,
    label: nonEmptyTrimmedStringSchema,
    description: nonEmptyTrimmedStringSchema,
    items: z.array(productLaneItemSchema),
    unsupported_filters: z.array(nonEmptyTrimmedStringSchema),
    summary: productLaneSummarySchema,
    next_cursor: nonEmptyTrimmedStringSchema.optional(),
  })
  .strict()
  .superRefine((response, ctx) => {
    const itemIds = new Set<string>();

    response.items.forEach((item, index) => {
      if (itemIds.has(item.id)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'id'],
          message: `product lane item id must be unique: ${item.id}`,
        });
      }
      itemIds.add(item.id);

      if (item.object.type === 'lane_summary' && item.object.lane_id !== response.lane_id) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'object', 'lane_id'],
          message: 'lane summary item lane_id must match response lane_id',
        });
      }

      item.actions.forEach((action, actionIndex) => {
        if (action.lane_id !== response.lane_id) {
          ctx.addIssue({
            code: 'custom',
            path: ['items', index, 'actions', actionIndex, 'lane_id'],
            message: 'action lane_id must match response lane_id',
          });
        }
      });
    });
  });
export type ProductLaneResponse = z.infer<typeof productLaneResponseSchema>;

export const runPackageRequestSchema = z
  .object({
    execution_package_id: z.string().min(1),
    requested_by_actor_id: z.string().min(1),
    executor_type: executorTypeSchema.optional(),
    workflow_only: z.boolean().default(false),
    idempotency_key: z.string().min(1).optional(),
  })
  .strict();
export type RunPackageRequest = z.infer<typeof runPackageRequestSchema>;

export const rerunPackageRequestSchema = z
  .object({
    execution_package_id: z.string().min(1),
    previous_run_session_id: z.string().min(1),
    review_packet_id: z.string().min(1).optional(),
    requested_changes_context: z.array(requestedChangeSchema).default([]),
    requested_by_actor_id: z.string().min(1),
    executor_type: executorTypeSchema.optional(),
    workflow_only: z.boolean().default(false),
    idempotency_key: z.string().min(1).optional(),
  })
  .strict();
export type RerunPackageRequest = z.infer<typeof rerunPackageRequestSchema>;

export const forceRerunPackageRequestSchema = rerunPackageRequestSchema
  .extend({
    force: z.literal(true).default(true),
    force_reason: z.string().min(1),
  })
  .strict();
export type ForceRerunPackageRequest = z.infer<typeof forceRerunPackageRequestSchema>;

export const runEventTypeSchema = z.enum([
  'run_queued',
  'worker_lease_acquired',
  'driver_started',
  'thread_started',
  'thread_resumed',
  'turn_started',
  'turn_status_changed',
  'agent_message_delta',
  'agent_message_completed',
  'plan_updated',
  'tool_call_started',
  'tool_call_progress',
  'tool_call_completed',
  'command_started',
  'command_output_delta',
  'command_completed',
  'waiting_for_input',
  'user_input',
  'watchdog_heartbeat',
  'watchdog_idle_detected',
  'stalled',
  'resuming',
  'cancel_requested',
  'cancelled',
  'codex_warning',
  'driver_fallback_used',
  'executor_result_started',
  'required_check_started',
  'required_check_completed',
  'after_run_diagnostics_recorded',
  'artifact_captured',
  'run_succeeded',
  'run_failed',
]);
export type RunEventType = z.infer<typeof runEventTypeSchema>;

export const runEventSourceSchema = z.enum(['api', 'worker', 'codex', 'executor', 'watchdog', 'user']);
export type RunEventSource = z.infer<typeof runEventSourceSchema>;

export const runEventVisibilitySchema = z.enum(['public', 'internal']);
export type RunEventVisibility = z.infer<typeof runEventVisibilitySchema>;

export const publicRunEventSchema = z
  .object({
    id: z.string().min(1),
    run_session_id: z.string().min(1),
    sequence: z.number().int().positive(),
    cursor: z.string().min(1),
    event_type: runEventTypeSchema,
    source: runEventSourceSchema,
    visibility: z.literal('public'),
    summary: z.string().min(1),
    payload: jsonObjectSchema,
    created_at: isoDateTimeSchema,
  })
  .strict();
export type PublicRunEvent = z.infer<typeof publicRunEventSchema>;

export const runEventListResponseSchema = z
  .object({
    events: z.array(publicRunEventSchema),
    next_cursor: z.string().min(1),
    has_more: z.boolean(),
  })
  .strict();
export type RunEventListResponse = z.infer<typeof runEventListResponseSchema>;

export const runAcceptedResponseSchema = z
  .object({
    status: z.literal('accepted'),
    run_session_id: z.string().min(1),
    execution_package_id: z.string().min(1),
  })
  .strict();
export type RunAcceptedResponse = z.infer<typeof runAcceptedResponseSchema>;

export const runCommandTypeSchema = z.enum(['input', 'cancel', 'resume']);
export type RunCommandType = z.infer<typeof runCommandTypeSchema>;

export const runOperatorCommandResponseSchema = z
  .object({
    status: z.literal('accepted'),
    command_id: z.string().min(1),
    run_session_id: z.string().min(1),
    command_type: runCommandTypeSchema,
  })
  .strict();
export type RunOperatorCommandResponse = z.infer<typeof runOperatorCommandResponseSchema>;

const runCommandResponseBaseSchema = z.object({
  command_id: z.string().min(1),
  execution_package_id: z.string().min(1),
  workflow_only: z.boolean(),
  idempotency_key: z.string().min(1),
});

export const runCommandResponseSchema = z.discriminatedUnion('status', [
  runCommandResponseBaseSchema.extend({
    status: z.literal('accepted'),
    run_session_id: z.string().min(1),
    rejection_reason: z.never().optional(),
  }),
  runCommandResponseBaseSchema.extend({
    status: z.literal('already_running'),
    run_session_id: z.string().min(1),
    rejection_reason: z.never().optional(),
  }),
  runCommandResponseBaseSchema.extend({
    status: z.literal('rejected'),
    run_session_id: z.never().optional(),
    rejection_reason: z.string().min(1),
  }),
]);
export type RunCommandResponse = z.infer<typeof runCommandResponseSchema>;

export const runPackageResponseSchema = runAcceptedResponseSchema;
export type RunPackageResponse = RunAcceptedResponse;

export const rerunPackageResponseSchema = runAcceptedResponseSchema;
export type RerunPackageResponse = RunAcceptedResponse;

export const forceRerunPackageResponseSchema = runAcceptedResponseSchema;
export type ForceRerunPackageResponse = RunAcceptedResponse;

export const evidenceChainSourceSchema = z.enum([
  'run_event',
  'status_history',
  'artifact',
  'decision',
  'review_packet',
  'object_event',
  'trace_event',
]);
export type EvidenceChainSource = z.infer<typeof evidenceChainSourceSchema>;

export const evidenceChainObjectTypeSchema = z.enum([
  'work_item',
  'execution_package',
  'run_session',
  'review_packet',
  'artifact',
  'decision',
  'required_check',
  'trace_event',
]);
export type EvidenceChainObjectType = z.infer<typeof evidenceChainObjectTypeSchema>;

export const evidenceChainRiskFlagSchema = z.enum([
  'no_evidence',
  'missing_required_artifact',
  'redacted_evidence',
  'superseded_run',
  'stale_review_packet',
  'unapproved_review_packet',
  'failed_required_check',
  'changes_requested',
  'projection_partial',
]);
export type EvidenceChainRiskFlag = z.infer<typeof evidenceChainRiskFlagSchema>;

export const evidenceChainRedactionReasonSchema = z.enum([
  'internal_event',
  'raw_ref',
  'logs_artifact',
  'raw_metadata_artifact',
  'local_ref_only',
  'unsafe_storage_uri',
  'internal_payload',
]);
export type EvidenceChainRedactionReason = z.infer<typeof evidenceChainRedactionReasonSchema>;

export const evidenceChainProjectionGapCodeSchema = z.enum([
  'missing_supersession_links',
  'missing_last_run_session',
  'missing_trace_events',
  'missing_trace_artifact_refs',
]);
export type EvidenceChainProjectionGapCode = z.infer<typeof evidenceChainProjectionGapCodeSchema>;

export const evidenceChainTraceLinkRelationshipSchema = z.enum([
  'belongs_to',
  'generated_by',
  'supports',
  'supersedes',
  'replaces',
  'redacted_from',
]);
export type EvidenceChainTraceLinkRelationship = z.infer<typeof evidenceChainTraceLinkRelationshipSchema>;

export const evidenceChainObjectRefSchema = z
  .object({
    object_type: evidenceChainObjectTypeSchema,
    object_id: z.string().min(1),
    relationship: evidenceChainTraceLinkRelationshipSchema.optional(),
  })
  .strict();
export type EvidenceChainObjectRef = z.infer<typeof evidenceChainObjectRefSchema>;

export const evidenceChainItemSchema = z
  .object({
    id: z.string().min(1),
    source: evidenceChainSourceSchema,
    subject: evidenceChainObjectRefSchema,
    summary: z.string().min(1),
    created_at: isoDateTimeSchema,
    visibility: z.literal('public'),
    links: z.array(evidenceChainObjectRefSchema),
    risk_flags: z.array(evidenceChainRiskFlagSchema),
    redacted: z.boolean(),
    details: z
      .object({
        decision: reviewDecisionSchema.optional(),
        run_status: z.string().min(1).optional(),
        missing_artifact_kinds: z.array(artifactKindSchema).optional(),
        required_check_ids: z.array(z.string().min(1)).optional(),
        failed_check_ids: z.array(z.string().min(1)).optional(),
        redaction_reason: evidenceChainRedactionReasonSchema.optional(),
        replacement: z
          .object({
            new_run_session_id: z.string().min(1).optional(),
            previous_run_session_id: z.string().min(1).optional(),
            new_review_packet_id: z.string().min(1).optional(),
            previous_review_packet_id: z.string().min(1).optional(),
          })
          .strict()
          .optional(),
        projection_gap_codes: z.array(evidenceChainProjectionGapCodeSchema).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type EvidenceChainItem = z.infer<typeof evidenceChainItemSchema>;

export const evidenceChainResponseSchema = z
  .object({
    work_item_id: z.string().min(1),
    generated_at: isoDateTimeSchema,
    focus: z
      .object({
        selection: z.enum(['explicit', 'current']),
        review_packet_ids: z.array(z.string().min(1)),
      })
      .strict(),
    projection: z
      .object({
        source: z.enum(['trace_events', 'read_time', 'mixed']),
        version: z.literal(1),
        partial: z.boolean(),
        gaps: z.array(evidenceChainProjectionGapCodeSchema),
      })
      .strict(),
    summary: z
      .object({
        total_items: z.number().int().nonnegative(),
        run_count: z.number().int().nonnegative(),
        review_packet_count: z.number().int().nonnegative(),
        decision_count: z.number().int().nonnegative(),
        artifact_count: z.number().int().nonnegative(),
        risk_flags: z.array(evidenceChainRiskFlagSchema),
        redacted_count: z.number().int().nonnegative(),
      })
      .strict(),
    items: z.array(evidenceChainItemSchema),
  })
  .strict()
  .superRefine((response, ctx) => {
    if (response.summary.total_items !== response.items.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['summary', 'total_items'],
        message: 'EvidenceChainResponse summary.total_items must equal items.length',
      });
    }
  });
export type EvidenceChainResponse = z.infer<typeof evidenceChainResponseSchema>;

const reviewDecisionRequestBaseSchema = z.object({
  review_packet_id: z.string().min(1),
  summary: z.string().min(1),
  reviewed_by_actor_id: z.string().min(1),
  reviewed_at: isoDateTimeSchema,
});

export const approveReviewPacketRequestSchema = reviewDecisionRequestBaseSchema.extend({
  decision: z.literal('approved'),
  requested_changes: z.never().optional(),
});
export type ApproveReviewPacketRequest = z.infer<typeof approveReviewPacketRequestSchema>;

export const requestReviewChangesRequestSchema = reviewDecisionRequestBaseSchema.extend({
  decision: z.literal('changes_requested'),
  requested_changes: z.array(requestedChangeSchema).min(1),
});
export type RequestReviewChangesRequest = z.infer<typeof requestReviewChangesRequestSchema>;

export const submitReviewDecisionRequestSchema = reviewDecisionPayloadSchema;
export type SubmitReviewDecisionRequest = z.infer<typeof submitReviewDecisionRequestSchema>;

export const submitReviewDecisionResponseSchema = z.object({
  review_packet_id: z.string().min(1),
  status: z.literal('completed'),
  decision: reviewSubmitDecisionSchema,
  recorded_at: isoDateTimeSchema,
});
export type SubmitReviewDecisionResponse = z.infer<typeof submitReviewDecisionResponseSchema>;
