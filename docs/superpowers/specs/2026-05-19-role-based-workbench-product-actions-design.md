# Role-based Workbench Product Actions Design

## Status

User-approved design draft. This document defines the next product slice after Spec / Plan approval productization: replace the coarse Work Item Owner workbench and old role action descriptors with product-grade Work Item type lanes, functional role lanes, and a single ProductAction projection shared by Workbench and Work Item Detail.

## Context

ForgeLoop's PRD defines a role-based software delivery operating system, not a single-owner task list. Work Items are typed business objects: initiatives, requirements, bugs, and tech debt have different intake semantics, different risks, and different next actions. The current Web Workbench still exposes a coarse Work Item Owner view backed by the old `intake` workbench id, while the UI disables all other role tabs.

The backend already contains richer role queue projections:

- `intake`
- `spec-approver`
- `execution-owner`
- `reviewer`
- `qa-test-owner`
- `release-owner`
- `manager-health`

The Web route, however, only uses the Work Item Owner / intake projection:

- `apps/web/src/features/role-workbench/role-workbench-route.tsx`
- `apps/web/src/features/role-workbench/role-workbench-view-model.ts`
- `apps/web/src/features/role-workbench/role-switcher.tsx`

The current Work Item detail page also has placeholder actions:

- `Update brief`
- `Attach evidence`
- generic "Available after a draft exists" copy

That creates a main-flow product gap. Users can now approve Specs and Plans, generate packages, run packages, review packets, and manage releases, but the role entry point and Work Item cockpit do not guide users through those actions in a role- and Work Item type-aware way.

## Goals

- Replace coarse Work Item Owner with explicit Work Item type lanes:
  - Requirements
  - Bugs
  - Tech Debt
  - Initiatives
- Productize all functional role lanes:
  - Spec Approver
  - Execution Owner
  - Reviewer
  - QA / Test Owner
  - Release Owner
  - Manager
- Replace the old `RoleWorkbenchAction` model with one `ProductAction` model used by both:
  - product lane queues;
  - Work Item Detail next actions.
- Remove disabled role tabs and placeholder Work Item actions.
- Make Work Item Detail a lane-aware action hub without duplicating every object detail page.
- Keep command execution bounded to existing simple commands. Complex approval, evidence, request-changes, and override actions navigate to their object pages.
- Avoid compatibility layers, adapter shims, double-write action models, query fallback paths, and historical naming aliases.

## Non-Goals

- No generic command runner.
- No new business commands.
- No inline create-Spec or create-Plan command in ProductAction. First-object creation stays in the existing Work Item Spec / Plan flow.
- No initiative decomposition command in this slice.
- No Review Center form redesign.
- No Release Center gate redesign.
- No Evolution Loop or Retrospective Center implementation.
- No Cross-end Contract Center implementation.
- No changes to the parallel `feature/codex-generation-runtime-plan-package` worktree.
- No compatibility endpoint for the old Workbench API.
- No retention of the old `work-item-owner` product lane.

## PRD Alignment

The PRD names Work Item Owner as a responsibility: propose or advance a Work Item, define business goals, priority, success criteria, brief readiness, and the path into Spec. This slice replaces the old coarse Work Item Owner product surface with four Work Item type lanes:

- `requirements`
- `bugs`
- `tech-debt`
- `initiatives`

Those four lanes are the product replacement for Work Item Owner intake responsibilities. They must preserve owner, brief, readiness, prioritization, and next-Spec semantics, but must not expose `work-item-owner` as route, API, contract, query-key, component, fixture, or test vocabulary.

## Product Lanes

The product model uses Product Lanes rather than a single Work Item Owner role.

```ts
type ProductLaneId =
  | 'requirements'
  | 'bugs'
  | 'tech-debt'
  | 'initiatives'
  | 'spec-approver'
  | 'execution-owner'
  | 'reviewer'
  | 'qa-test-owner'
  | 'release-owner'
  | 'manager';
```

The first four lanes are Work Item type lanes. They are not synonyms for Work Item Owner:

- `requirements`: requirement intake and planning progression.
- `bugs`: bug triage, repair planning, verification, and regression follow-up.
- `tech-debt`: debt scoping, refactor planning, risk control, and validation.
- `initiatives`: strategic work intake, scope clarification, and requirement breakdown readiness.

The remaining lanes are functional role lanes:

- `spec-approver`: Spec and Plan approval queue.
- `execution-owner`: package readiness, run launch, and package blockers.
- `reviewer`: review packet decisions.
- `qa-test-owner`: test strategy gaps, QA gates, and test acceptance.
- `release-owner`: release readiness, blockers, and release gate decisions.
- `manager`: read-only delivery health and bottleneck drill-down.

## Routing

Workbench has two user-facing entry shapes, but one implementation:

- `/workbench`
- `/workbench/:laneId`

`/workbench` must client-redirect to the canonical route `/workbench/requirements`. It preserves supported product-lane query params such as `project_id`, `phase`, `status`, `gate_state`, `resolution`, `risk`, `blocked`, `stale`, `cursor`, and `limit`, and strips old `role` query state. It does not preserve `kind` when defaulting to requirements, because preserving a non-requirement `kind` would create a conflicting lane query. It must not expose `intake` or `work-item-owner` as product route vocabulary.

Canonical lane routes:

- `/workbench/requirements`
- `/workbench/bugs`
- `/workbench/tech-debt`
- `/workbench/initiatives`
- `/workbench/spec-approver`
- `/workbench/execution-owner`
- `/workbench/reviewer`
- `/workbench/qa-test-owner`
- `/workbench/release-owner`
- `/workbench/manager`

There is no `?role=` compatibility path and no old `/workbench/work-item-owner` route.

Work Item detail remains:

- `/work-items/:workItemId`

It may accept a lane query for context:

- `/work-items/:workItemId?lane=bugs`
- `/work-items/:workItemId?lane=reviewer`

If no lane is supplied, Work Item Detail derives the default lane from `work_item.kind`:

- `requirement` -> `requirements`
- `bug` -> `bugs`
- `tech_debt` -> `tech-debt`
- `initiative` -> `initiatives`

## ProductAction Model

`ProductAction` is the only product action descriptor. It replaces `RoleWorkbenchAction`; do not keep adapters, union compatibility, double writes, or fallback action parsing.

```ts
type ProductActionKind = 'navigate' | 'command';
type ProductActionPriority = 'primary' | 'secondary' | 'tertiary';
type ProductObjectType =
  | 'work_item'
  | 'spec'
  | 'spec_revision'
  | 'plan'
  | 'plan_revision'
  | 'execution_package'
  | 'run_session'
  | 'review_packet'
  | 'release';

type ProductHref = string & { readonly __brand: 'ProductHref' };

type ProductActionTarget =
  | {
      kind: 'object';
      object_type: ProductObjectType;
      object_id: string;
      href: ProductHref;
    }
  | {
      kind: 'lane';
      lane_id: ProductLaneId;
      href: ProductHref;
    };

type ProductCommand =
  | {
      type: 'generate_spec_draft';
      object_type: 'spec';
      object_id: string;
      work_item_id: string;
      spec_id: string;
    }
  | {
      type: 'generate_plan_draft';
      object_type: 'plan';
      object_id: string;
      work_item_id: string;
      plan_id: string;
    }
  | {
      type: 'generate_packages';
      object_type: 'plan_revision';
      object_id: string;
      work_item_id: string;
      plan_revision_id: string;
    }
  | {
      type: 'mark_package_ready';
      object_type: 'execution_package';
      object_id: string;
      work_item_id: string;
      package_id: string;
      expected_package_version: number;
    }
  | {
      type: 'run_package';
      object_type: 'execution_package';
      object_id: string;
      work_item_id: string;
      package_id: string;
    };

type ProductActionBase = {
  id: string;
  lane_id: ProductLaneId;
  priority: ProductActionPriority;
  label: string;
  description?: string;
  enabled: boolean;
  disabled_reason?: string;
  blocked_reason?: string;
};

type ProductNavigateAction = ProductActionBase & {
  kind: 'navigate';
  target: ProductActionTarget;
  command?: never;
};

type ProductCommandAction = ProductActionBase & {
  kind: 'command';
  command: ProductCommand;
  target?: ProductActionTarget;
};

type ProductAction = ProductNavigateAction | ProductCommandAction;
```

Rules:

- `ProductAction` must be implemented as a discriminated union, not as one loose object with optional `target` and `command`.
- All ProductAction schemas are strict. `ProductActionBase`, action variants, `ProductActionTarget`, every `ProductCommand` variant, `ProductLaneItem`, `ProductLaneResponse`, and `WorkItemActionsResponse` reject unknown fields.
- All ids, labels, hrefs, command ids, and required reason fields are non-empty strings after trimming.
- `navigate` actions require `target` and must not include `command`.
- `command` actions require `command`.
- Command actions may also include `target` for a post-success link and cache invalidation target. Command actions never auto-navigate after execution.
- Command actions must include every id and version needed by the explicit Web hook. The Web must not infer missing command inputs from object ids, route params, or additional fetches.
- Every command action must carry `work_item_id` so Workbench and Work Item Detail can invalidate the Work Item cockpit and Work Item actions without deriving the Work Item from a Plan Revision or Execution Package.
- Command object identity must be internally consistent:
  - `generate_spec_draft.object_id === generate_spec_draft.spec_id`;
  - `generate_plan_draft.object_id === generate_plan_draft.plan_id`;
  - `generate_packages.object_id === generate_packages.plan_revision_id`;
  - `mark_package_ready.object_id === mark_package_ready.package_id`;
  - `run_package.object_id === run_package.package_id`.
- `disabled_reason` is required when `enabled === false`.
- Enabled actions must not carry `disabled_reason` or `blocked_reason`.
- `blocked_reason` is used when a valid next action exists but upstream state blocks it. Blocked actions must set `enabled: false`, must also carry `disabled_reason`, and enabled actions must not carry `blocked_reason`.
- Disabled navigate actions still require `target`. If the backend cannot produce a safe target href, it must omit the action and surface the condition through lane summary, item state, or the item's normal status/risk/gate fields instead.
- Manager lane must never return command actions.
- The backend is responsible for target hrefs. The Web must not infer object route paths from partial object ids or lane ids.
- Lane targets are allowed only for product-lane drill-downs. A lane target href must be exactly `/workbench/:laneId` plus optional supported query string, and `:laneId` must match `target.lane_id`.
- Every action in `ProductLaneResponse.items[].actions` must have `lane_id` equal to the enclosing `ProductLaneResponse.lane_id`.
- Every action in `WorkItemActionsResponse.actions` must have `lane_id` equal to the enclosing `WorkItemActionsResponse.lane_id`.
- `ProductAction.id` must be unique within each item action list and within each Work Item actions response.

`ProductHref` rules:

- hrefs are product UI routes, not API routes.
- hrefs must be same-origin relative paths starting with one `/`.
- hrefs may include query strings and anchors.
- hrefs are validated by parsing against a fixed same-origin base, then checking the normalized decoded pathname.
- href pathnames must match the product UI route allowlist by exact base match or descendant match: `pathname === base || pathname.startsWith(base + '/')`, where base is one of `/workbench`, `/work-items`, `/specs`, `/plans`, `/packages`, `/runs`, `/reviews`, `/releases`, or `/pipeline`.
- `/work-items/wi_1#replay` and `/workbench/bugs?project_id=p1` are valid; sibling paths such as `/workbench-old` are invalid.
- hrefs must reject empty strings, encoded path traversal, absolute URLs, protocol-relative URLs beginning with `//`, normalized or encoded `/query/*`, and mutating command endpoints such as `/execution-packages/:id/run`, `/execution-packages/:id/mark-ready`, `/specs/:id/generate-draft`, or `/plans/:id/generate-draft`.
- replay drill-downs must use product UI routes with anchors or query state, such as `/work-items/:id#replay`, not old `/query/replay/*` paths.

Allowed command action types are intentionally narrow:

- `generate_spec_draft`
- `generate_plan_draft`
- `generate_packages`
- `mark_package_ready`
- `run_package`

First-object boundary:

- `generate_spec_draft` is emitted only when a Spec record already exists and the command can include `spec_id`.
- If a Work Item has no Spec record yet, the backend emits a navigation action to the Work Item Spec / Plan flow, not a command action.
- `generate_plan_draft` is emitted only when a Plan record already exists, the command can include `plan_id`, and the Spec approval gates required by the current product flow are satisfied.
- If a Work Item has no Plan record yet, the backend emits a navigation action to the Work Item Spec / Plan flow, not a command action.
- `generate_packages` is emitted only when a Plan Revision exists and the command can include both `work_item_id` and `plan_revision_id`.
- This slice does not introduce `create_spec`, `create_plan`, or any command that silently creates missing lifecycle objects.

Complex actions are navigation-only in this slice:

- approve Spec / Plan;
- request Spec / Plan changes;
- approve or request changes on Review Packets;
- release submit / approve / override / request changes;
- release test acceptance;
- evidence attachment;
- initiative decomposition.

## API Contract

Replace the old role workbench query surface:

```http
GET /query/workbenches/:workbenchId
```

with:

```http
GET /query/product-lanes/:laneId
GET /query/work-items/:workItemId/actions?lane=:laneId
```

The old `/query/workbenches/:workbenchId` endpoint is removed in this slice. Web code and tests must migrate to the new API. No fallback endpoint is retained.

### Product Lane Query

`GET /query/product-lanes/:laneId` accepts this exact query shape. Unknown query keys return 400. Accepted keys that are user-visible but unsupported for the requested lane are returned in `unsupported_filters`.

```ts
type ProductLaneQuery = {
  project_id: string;
  actor_id?: string;
  owner_actor_id?: string;
  reviewer_actor_id?: string;
  qa_owner_actor_id?: string;
  release_owner_actor_id?: string;
  cursor?: string;
  limit?: number;
  kind?: 'initiative' | 'requirement' | 'bug' | 'tech_debt';
  phase?: string;
  status?: string;
  gate_state?: string;
  resolution?: string;
  risk?: string;
  blocked?: boolean;
  stale?: boolean;
};
```

Rules:

- `project_id` is required. Lane queues must never be implemented as unscoped cross-project queries.
- Query parsing is strict:
  - unknown query keys return 400 before query execution;
  - duplicate or array values return 400;
  - `project_id` must be a non-empty string;
  - supplied optional string filters must be non-empty strings;
  - empty supplied values such as `project_id=`, `actor_id=`, or `cursor=` return 400;
  - `blocked` and `stale` accept only `true` or `false`;
  - invalid booleans return 400;
  - `limit` must be an integer; values below 1 clamp to 1, values above 100 clamp to 100, and the default is 50.
- `cursor` advances pagination and produces `next_cursor`.
- Work Item type lanes apply their canonical kind. A conflicting `kind` query returns 400; for example, `/query/product-lanes/bugs?kind=requirement` is rejected rather than ignored or mixed.
- `actor_id` is a lane-specific shorthand for the actor role that owns the lane:
  - Work Item type lanes: Work Item owner.
  - `spec-approver`: approver / reviewer actor on the Spec or Plan approval surface.
  - `execution-owner`: Execution Package owner.
  - `reviewer`: Review Packet reviewer.
  - `qa-test-owner`: QA owner.
  - `release-owner`: Release owner.
  - `manager`: unsupported, because Manager is read-only health and must not become personal scoring.
- Applied filters compose with AND semantics.
- If `actor_id` and the lane's explicit actor filter are both supplied, they must be identical. If they differ, return 400 rather than an empty set.
- No accepted filter may be silently ignored if a product user would expect it to change the result set. In that case it appears in `unsupported_filters`.
- Supplied but unsupported filters do not affect `items` or `summary`; they are reported in `unsupported_filters`.
- `unsupported_filters` contains supplied unsupported query key names in `ProductLaneQuery` declaration order.
- Non-response-affecting keys are limited to absent values after query parsing. There is no broad ignore bucket.

Actor filter glossary:

- `actor_id`: shorthand for the actor dimension of the requested lane.
- `owner_actor_id` on Work Item type lanes: Work Item owner.
- `owner_actor_id` on `execution-owner`: Execution Package owner.
- `reviewer_actor_id` on `reviewer`: Review Packet reviewer.
- `qa_owner_actor_id` on `qa-test-owner`: QA owner on Work Item, Package, or Release test-acceptance context.
- `release_owner_actor_id` on `release-owner`: Release owner.
- `actor_id` on `spec-approver`: approver or review actor for Spec / Plan approval attention. There is no separate `approver_actor_id` filter in this slice.

Filter matrix:

| Lane | Applied filters | 400 conflicts | `unsupported_filters` |
| --- | --- | --- | --- |
| `requirements` | `project_id`, `cursor`, `limit`, canonical `kind=requirement`, `actor_id`, `owner_actor_id`, `phase`, `status`, `gate_state`, `risk`, `blocked`, `stale` | any explicit `kind` other than `requirement`; mismatched `actor_id` and `owner_actor_id` | `reviewer_actor_id`, `qa_owner_actor_id`, `release_owner_actor_id`, `resolution` |
| `bugs` | `project_id`, `cursor`, `limit`, canonical `kind=bug`, `actor_id`, `owner_actor_id`, `phase`, `status`, `gate_state`, `risk`, `blocked`, `stale` | any explicit `kind` other than `bug`; mismatched `actor_id` and `owner_actor_id` | `reviewer_actor_id`, `qa_owner_actor_id`, `release_owner_actor_id`, `resolution` |
| `tech-debt` | `project_id`, `cursor`, `limit`, canonical `kind=tech_debt`, `actor_id`, `owner_actor_id`, `phase`, `status`, `gate_state`, `risk`, `blocked`, `stale` | any explicit `kind` other than `tech_debt`; mismatched `actor_id` and `owner_actor_id` | `reviewer_actor_id`, `qa_owner_actor_id`, `release_owner_actor_id`, `resolution` |
| `initiatives` | `project_id`, `cursor`, `limit`, canonical `kind=initiative`, `actor_id`, `owner_actor_id`, `phase`, `status`, `gate_state`, `risk`, `blocked`, `stale` | any explicit `kind` other than `initiative`; mismatched `actor_id` and `owner_actor_id` | `reviewer_actor_id`, `qa_owner_actor_id`, `release_owner_actor_id`, `resolution` |
| `spec-approver` | `project_id`, `cursor`, `limit`, `actor_id`, `kind`, `phase`, `status`, `risk`, `blocked`, `stale` | none | `owner_actor_id`, `reviewer_actor_id`, `qa_owner_actor_id`, `release_owner_actor_id`, `gate_state`, `resolution` |
| `execution-owner` | `project_id`, `cursor`, `limit`, `actor_id`, `owner_actor_id`, `kind`, `phase`, `status`, `gate_state`, `resolution`, `risk`, `blocked`, `stale` | mismatched `actor_id` and `owner_actor_id` | `reviewer_actor_id`, `qa_owner_actor_id`, `release_owner_actor_id` |
| `reviewer` | `project_id`, `cursor`, `limit`, `actor_id`, `reviewer_actor_id`, `kind`, `status`, `resolution`, `risk`, `blocked`, `stale` | mismatched `actor_id` and `reviewer_actor_id` | `owner_actor_id`, `qa_owner_actor_id`, `release_owner_actor_id`, `phase`, `gate_state` |
| `qa-test-owner` | `project_id`, `cursor`, `limit`, `actor_id`, `qa_owner_actor_id`, `kind`, `phase`, `status`, `gate_state`, `risk`, `blocked`, `stale` | mismatched `actor_id` and `qa_owner_actor_id` | `owner_actor_id`, `reviewer_actor_id`, `release_owner_actor_id`, `resolution` |
| `release-owner` | `project_id`, `cursor`, `limit`, `actor_id`, `release_owner_actor_id`, `kind`, `phase`, `status`, `gate_state`, `resolution`, `risk`, `blocked`, `stale` | mismatched `actor_id` and `release_owner_actor_id` | `owner_actor_id`, `reviewer_actor_id`, `qa_owner_actor_id` |
| `manager` | `project_id`, `cursor`, `limit`, `kind`, `phase`, `status`, `gate_state`, `resolution`, `risk`, `blocked`, `stale` | none | `actor_id`, `owner_actor_id`, `reviewer_actor_id`, `qa_owner_actor_id`, `release_owner_actor_id` |

Filter subject rules:

- Every `ProductLaneItem` must expose normalized `kind`, `phase`, `status`, `gate_state`, `resolution`, and `risk` fields when the corresponding filter is applied by that lane.
- Filters are evaluated only against those normalized item fields and explicit actor subject fields, not by ad hoc inspection of nested objects in the Web.
- Work Item type lanes use the Work Item as the filter subject.
- `spec-approver` uses the Spec or Plan under approval as the primary subject, with `kind` inherited from its parent Work Item.
- `execution-owner` uses the Execution Package as the primary subject, with `kind` inherited from its parent Work Item.
- `reviewer` uses the Review Packet as the primary subject, with `kind` inherited from the parent Work Item of the reviewed package.
- `qa-test-owner` uses the object that creates the QA obligation as the subject: Work Item for strategy gaps, Execution Package for evidence gaps, Release for acceptance gates. `kind` is inherited from linked Work Items when singular; if a Release links multiple Work Item kinds, `kind` filtering uses any-match semantics.
- `release-owner` uses the Release as the primary subject. Work Item `kind` filters use any-match semantics across linked Work Items. If no linked Work Item matches, the Release item is excluded.
- `manager` recomputes lane summary aggregates from the filtered contribution set. `kind` uses any-match semantics across contributing Work Items; `phase`, `status`, `gate_state`, `resolution`, `risk`, `blocked`, and `stale` apply to contribution rows before aggregation. Manager filters never apply to personal actor ownership.
- Multi-link items are not duplicated for each linked Work Item in this slice. They remain one lane item and match if any linked Work Item satisfies a Work Item-derived filter.

### Product Lane Response

```ts
type ProductLaneResponse = {
  lane_id: ProductLaneId;
  label: string;
  description: string;
  items: ProductLaneItem[];
  unsupported_filters: string[];
  summary: {
    total: number;
    blocked: number;
    high_risk: number;
    stale: number;
  };
  next_cursor?: string;
};

type ProductLaneItem = {
  id: string;
  title: string;
  object:
    | {
        type: ProductObjectType;
        id: string;
      }
    | {
        type: 'lane_summary';
        id: string;
        lane_id: ProductLaneId;
      };
  parent?: {
    type: ProductObjectType;
    id: string;
    title?: string;
  };
  kind?: string;
  surface_type?: string;
  phase?: string;
  status?: string;
  gate_state?: string;
  resolution?: string;
  risk?: string;
  updated_at: string;
  actions: ProductAction[];
};
```

`ProductLaneItem.id` must be unique within the lane response. Summary counts apply to the full filtered result set before pagination, not only the current page.

### Work Item Actions Response

`GET /query/work-items/:workItemId/actions` accepts:

```ts
type WorkItemActionsQuery = {
  lane?: ProductLaneId;
};
```

`GET /query/work-items/:workItemId/actions` accepts only `lane`. Unknown query keys, duplicate values, array values, and empty supplied `lane` values return 400.

If `lane` is omitted, the backend derives the default lane from the Work Item kind and returns it as both `lane_id` and `default_lane_id`. If `lane` is supplied and unknown, the API returns 400. The Web must validate lane ids locally for Work Item Detail and must not fetch the actions endpoint with an unknown lane. If `lane` is supplied but not relevant to the Work Item, the API still returns a valid response with navigate or disabled actions explaining the state; it must not silently replace the requested lane.

```ts
type WorkItemActionsResponse = {
  work_item_id: string;
  lane_id: ProductLaneId;
  default_lane_id: ProductLaneId;
  actions: ProductAction[];
};
```

The Work Item action endpoint aggregates the current Work Item cockpit context and related objects:

- Work Item
- current Spec
- current Plan
- Execution Packages
- Run Sessions
- Review Packets
- Releases

It then emits lane-aware actions for the requested lane.

## Action Generation Rules

### Requirements Lane

Candidate objects:

- requirement Work Items;
- related Specs, Plans, Packages, Reviews, Releases when they drive the requirement forward.

Primary actions:

- open Work Item when brief or readiness is incomplete;
- navigate to the Work Item Spec / Plan flow when no Spec record exists yet;
- generate Spec draft only when a Spec record exists, has no current draft revision, and generation is available;
- open Spec / Plan approval targets when review is required;
- navigate to the Work Item Spec / Plan flow when no Plan record exists yet;
- generate Plan draft only when a Plan record exists, Spec approval gates are satisfied, and the Plan draft is missing;
- generate Packages when Plan is approved, a Plan Revision exists, and package drafts are missing;
- open Packages or Release when execution or release is the next bottleneck.

### Bugs Lane

Candidate objects:

- bug Work Items;
- linked package/review/release objects when they represent repair or regression work.

Primary actions:

- open Work Item for impact, repro, priority, and risk clarification;
- navigate to the Work Item Spec / Plan flow when the repair Spec does not exist yet;
- generate repair Spec draft where a Spec record already exists and existing Spec generation supports it;
- open Review Packet when changes were requested;
- open Package for rerun or blocker state;
- open Release or a concrete object replay anchor when bug evidence links to release risk. Replay actions are represented as normal `navigate` actions with `target.kind = 'object'`, `target.object_type` set to the replayed object, such as `work_item`, `execution_package`, `review_packet`, or `release`, and `target.href` including the timeline anchor when needed.

No incident object is introduced in this slice.

### Tech Debt Lane

Candidate objects:

- tech debt Work Items;
- package and validation blockers linked to debt work.

Primary actions:

- open Work Item for debt scope and risk clarification;
- navigate to the Work Item Spec / Plan flow when the refactor Spec does not exist yet;
- generate refactor Spec draft where a Spec record already exists and existing Spec generation supports it;
- open Plan or Package when boundary, path policy, or checks are incomplete;
- open validation evidence when review or QA is blocking progress.

### Initiatives Lane

Candidate objects:

- initiative Work Items.

Primary actions:

- open Work Item for goal, scope, priority, and success criteria clarification;
- navigate to related Requirements if already split;
- do not emit a decomposition ProductAction in this slice. Because no decomposition command exists, initiative breakdown remains a readiness signal and navigation-only guidance in copy or lane summary, not a disabled command-shaped action.

### Spec Approver Lane

Candidate objects:

- Specs and Plans in review;
- Specs and Plans with requested changes when approver attention is still relevant.

Primary actions:

- navigate to Spec or Plan detail for approve/request-changes decisions;
- drill into replay decisions and revision summaries.

Approval and request-changes commands are not inlined in Workbench or Work Item Detail.

### Execution Owner Lane

Candidate objects:

- Execution Packages.

Primary actions:

- mark package ready when the package satisfies backend readiness and version gates;
- run package when ready;
- open package when blocked, missing checks, missing policy, or requiring edit;
- open latest Run when execution is active or recently completed.

### Reviewer Lane

Candidate objects:

- Review Packets.

Primary actions:

- navigate to Review Packet detail for approve/request-changes decision;
- open Package or Run evidence when context is incomplete.

Review decisions are not inlined in Workbench or Work Item Detail.

### QA / Test Owner Lane

Candidate objects:

- Work Items with test strategy gaps;
- Packages with QA owner or evidence gaps;
- Releases requiring test acceptance.

Primary actions:

- open Spec / Plan / Package to address test strategy gaps;
- open Release test acceptance when release gates require QA acknowledgement;
- open evidence or replay context when validation is incomplete.

Test acceptance is not inlined in Work Item Detail.

### Release Owner Lane

Candidate objects:

- Releases;
- linked Work Items and Packages only when they block release readiness.

Primary actions:

- open Release to complete rollout, rollback, or observation plan;
- open Release blockers;
- open Release gate decisions;
- drill into linked Package / Review / QA evidence.

Release gate commands are not inlined in Workbench or Work Item Detail.

### Manager Lane

Candidate objects:

- `lane_summary` health and bottleneck projections;
- concrete high-risk, blocked, stale, or degraded objects when drill-down has a specific object target.

Primary actions:

- navigate to bottleneck lane with `target.kind = 'lane'` or to object detail with `target.kind = 'object'`;
- drill into high-risk, blocked, stale, or degraded objects.

Manager lane returns no command actions and no personal scoring or ranking.

## Web UX

### Workbench

The Workbench UI shows all lanes as clickable tabs or segmented navigation. No lane tab is disabled.

The page contains:

- lane header with label and description;
- a compact filter notice when `unsupported_filters` is non-empty, listing the filters that were not applied;
- summary metrics: total, blocked, high risk, stale;
- queue table with object, kind/surface, state, risk, updated age, and primary action;
- right ActionRail for the selected queue item;
- disabled ProductActions rendered with explicit disabled reason;
- blocked ProductActions rendered with blocked reason;
- empty states specific to the lane.

The UI must not expose backend names such as `intake`, `manager-health`, or old Workbench IDs.

Selection behavior:

- default selection is the first queue item after filtering and pagination;
- URL state may preserve selection, but it must use product object ids or lane item ids, not old workbench queue ids;
- if URL selection is implemented, use `selected=` as the query key;
- when filters, pagination, refresh, or command invalidation changes the current page, selection resolves in this order:
  - preserve the URL-selected item if it is still present in the current page;
  - otherwise select the first item in the current page;
  - if there are no items, clear selection and show the lane empty state;
- ActionRail must never render actions for an item that is no longer present in the current page.
- after command invalidation and refetch, selection is re-resolved against refreshed data using the same rules;
- keyboard users can move row focus and selection without losing the ActionRail context;
- mobile collapses the ActionRail below the selected row or into the page flow, never into a nested card.

Primary action ordering:

- ProductAction rendering is stable-sorted by `priority` (`primary`, `secondary`, `tertiary`), then backend order within the same priority. Enabled, blocked, and disabled state affects rendering only, not ordering.
- The queue table primary action is the first action after that sort.
- This intentionally allows a disabled or blocked `primary` action to remain the table CTA when it represents the real next bottleneck; it must render disabled with its reason rather than being replaced by a less important secondary action.
- Backend must not emit an enabled `primary` action alongside a disabled or blocked bottleneck `primary` action for the same item. If a disabled or blocked primary represents the bottleneck, other available actions for that item must be `secondary` or `tertiary`.
- Multiple enabled `primary` actions are allowed only when they represent distinct next steps; the first sorted action is used in the table and all actions remain visible in ActionRail.
- Disabled and blocked actions are never hidden solely because an enabled action exists.

### Work Item Detail

The Work Item detail ActionRail becomes `Next actions`.

Behavior:

- uses lane from query string when valid;
- if the query lane is absent, derives lane from Work Item kind;
- if the query lane is unknown, validates that locally, does not fetch the actions endpoint, and shows an unavailable state with a link to `/work-items/:workItemId?lane=<derivedDefaultLane>`;
- fetches `/query/work-items/:workItemId/actions?lane=:laneId`;
- shows lane-labeled loading, empty, and error states so an irrelevant-but-valid lane reads as "no actions for this lane" rather than a broken ActionRail;
- renders the same `ProductActionList` component used by Workbench;
- simple command actions execute inline through existing hooks;
- complex actions navigate to the owning object page.
- Work Item Detail may render the same lane navigation used by Workbench as compact context links, but lane switching must update `?lane=` and must not reintroduce role/workbench vocabulary.

Remove:

- `Update brief` placeholder button;
- `Attach evidence` placeholder button;
- generic "Available after a draft exists" copy.

The main Work Item content remains a cockpit summary. It should not duplicate Spec/Plan lifecycle forms, Review decision forms, Release gate forms, or QA acceptance forms.

## Frontend Component Boundaries

Create or revise the following bounded units:

- `product-lanes.ts`
  - lane metadata, route segments, labels, default lane selection, Work Item kind to lane mapping.
- `product-actions.ts`
  - action sorting, action view model mapping, command capability mapping.
- `ProductActionList`
  - shared renderer for navigation and command actions.
- `ProductLaneWorkbench`
  - lane route body for `/workbench/:laneId`.
- `WorkItemNextActions`
  - Work Item ActionRail component.

Existing components to remove or replace:

- `workItemOwnerRole`
- `workItemOwnerWorkbenchId`
- disabled `RoleSwitcher` behavior;
- old `RoleQueueActionViewModel` shape if it exists only to support `RoleWorkbenchAction`.

`ProductActionList` must not become a generic command executor. It maps the narrow command type union to explicit hooks:

- generate Spec draft;
- generate Plan draft;
- generate Packages;
- mark Package ready;
- run Package.

Command execution behavior:

- clicking an enabled command action runs its mapped hook and does not navigate automatically;
- when a command action includes `target`, the UI may show it as a post-success follow-up link, but opening that link is a separate user action;
- command failure never navigates;
- disabled command actions never run and never navigate;
- navigate actions always use `target.href` directly and never call command hooks.

Each command mapping consumes the concrete payload from `ProductCommand`:

- `generate_spec_draft` uses `spec_id` and invalidates the related `work_item_id` cockpit.
- `generate_plan_draft` uses `plan_id` and invalidates the related `work_item_id` cockpit.
- `generate_packages` uses `plan_revision_id` and invalidates the related `work_item_id` cockpit.
- `mark_package_ready` uses `package_id` and `expected_package_version`, then invalidates the related `work_item_id` cockpit.
- `run_package` uses `package_id` plus authenticated Web actor context, then invalidates the related `work_item_id` cockpit. ProductCommand must not carry a user-editable actor id.

After command success or failure, Web invalidates:

- all cached product-lane query variants for the current `project_id`;
- all cached Work Item actions query variants for `work_item_id`, including non-default lanes;
- the Work Item cockpit query for `work_item_id`;
- the command object query derived from `command.object_type` and `command.object_id`;
- the target object query when `target?.kind === 'object'` and it differs from the command object;
- the target lane query when `target?.kind === 'lane'`.

If the command is fired from Work Item Detail, the same invalidation rules apply even when the corresponding product lane page is not mounted. If the command is fired from Workbench, the selected item is re-resolved after the lane query refetches.

Unsupported command types must be a type error, not a runtime fallback. Missing command payload fields are backend contract failures and must be caught by contract tests.

## Backend Implementation Boundaries

Move role queue code to product lanes rather than extending old workbench names.

Expected backend shape:

- define `ProductLaneId`, `ProductAction`, `ProductHref`, and response schemas in contracts;
- replace `RoleWorkbenchAction` with `ProductAction`;
- create product lane query functions in `packages/db/src/queries`;
- add Work Item action projection query;
- expose new query endpoints from the control-plane query module;
- remove old workbench endpoint and stale role id mapping from product-facing contracts.

Both new query endpoints must validate outbound responses with the contract schemas before returning. Malformed projection output is a backend contract failure, not a best-effort Web concern. Tests must prove lane-id mismatch, Manager command actions, malformed hrefs, missing disabled reasons, command id mismatches, and extra legacy fields fail before response.

Final-state deletion rules:

- delete or rename `RoleWorkbenchAction`, `RoleWorkbenchResponse`, `RoleWorkbenchId`, `RoleWorkbenchFilters`, `RoleQueue*`, `RoleWorkbenchRoute`, `role-workbench`, `getRoleWorkbench`, `useWorkbenchQuery`, `workbenchIdForProductRole`, `productRoleToWorkbenchId`, `workItemOwnerRole`, and `workItemOwnerWorkbenchId` from active product code and tests;
- delete old `/query/workbenches/*` controller methods and tests in the same implementation slice that adds `/query/product-lanes/*`;
- delete product-facing `intake` and `manager-health` workbench ids; use `requirements` and `manager`;
- delete old role-workbench fixture keys and e2e route mocks;
- do not keep old modules as wrappers around the new implementation.

Internal logic may be reused only by extracting it into product-lane-named helpers first. The final code must not keep old role-workbench modules as active ownership boundaries.

## Implementation Sequence

This is a destructive migration. Do it in this order, with no temporary adapters, aliases, fallback endpoints, or double-read paths:

Green-state rule: the root workspace must compile and pass the relevant test gate at every committed checkpoint. If the contract removal temporarily breaks API or Web consumers, keep the contracts, DB, API, Web, and test migrations in one coordinated commit rather than committing a red intermediate state.

1. Contracts first:
   - add `ProductLaneId`, `ProductAction`, `ProductActionTarget`, `ProductCommand`, `ProductLaneResponse`, and `WorkItemActionsResponse`;
   - remove old role workbench contract exports in the same contract change;
   - run contract tests before touching Web call sites, but do not commit this step by itself if root typecheck is red.
2. DB product lane queries:
   - create product-lane-named query modules;
   - move or copy only the useful pure helper logic from old role workbench queries;
   - delete old role-workbench query exports after the new query tests cover the same product behavior.
3. API endpoints:
   - add `GET /query/product-lanes/:laneId` and `GET /query/work-items/:workItemId/actions`;
   - remove every `/query/workbenches/*` endpoint in the same API step;
   - add 400 tests for unknown lanes, unknown query keys, and conflicting Work Item type `kind` filters.
4. Web API layer:
   - replace old workbench query keys, hooks, and API helpers with product-lane equivalents;
   - update fixtures and e2e mocks to the new routes;
   - do not keep `useWorkbenchQuery` or role-to-workbench id mapping as deprecated wrappers.
5. Web routes and components:
   - route `/workbench` to `/workbench/requirements`;
   - implement `/workbench/:laneId`, `ProductActionList`, and `WorkItemNextActions`;
   - delete disabled role switcher behavior and placeholder Work Item actions.
6. No-legacy guard:
   - run guard tests after all product tests pass;
   - guard tests must fail on active product code or tests that retain old role-workbench vocabulary.
   - current implementation plan docs may include legacy terms only inside an explicit deletion checklist section; outside that section, the guard should treat them as drift.

## Error Handling

- Unknown Workbench lane:
  - API returns 400.
  - Web shows an unavailable state with a link to `/workbench/requirements`.
- Unknown Work Item Detail `?lane=`:
  - Web validates locally before fetching actions;
  - Web shows an unavailable state with a link to `/work-items/:workItemId?lane=<derivedDefaultLane>`;
  - API still returns 400 if called directly with the unknown lane.
- Missing action target:
  - backend omits the action and surfaces the condition through lane summary, item state, or existing gate/status/risk fields;
  - backend must not return a `navigate` action without `target`;
  - frontend must not invent target hrefs.
- Command action fails:
  - show error beside that action;
  - invalidate affected lane, Work Item actions, Work Item cockpit, command object, and target object queries.
- Complex action needs input:
  - return navigate action to the object page;
  - do not inline partial forms in Work Item Detail.
- Manager lane command:
  - treated as a backend contract violation and covered by tests.

## Testing Strategy

### Contract Tests

- `ProductLaneId` schema accepts the 10 canonical lane ids.
- Product schemas are strict and reject unknown fields, including old action-shape fields such as `method`, `path`, and `reason`.
- `ProductAction` schema validates navigate and command action requirements.
- `ProductAction` schema rejects navigate actions with `command` and command actions without `command`.
- enabled actions with `disabled_reason` or `blocked_reason` fail contract validation.
- response schemas reject actions whose `lane_id` does not match the enclosing `ProductLaneResponse.lane_id` or `WorkItemActionsResponse.lane_id`.
- `ProductActionTarget` schema accepts only object and lane targets; object targets require `object_type`, `object_id`, and `href`; lane targets require `lane_id` and `href`.
- lane targets require canonical hrefs that match `target.lane_id`.
- `ProductHref` accepts exact or descendant product UI routes with query strings or anchors, including `/work-items/wi_1#replay` and `/workbench/bugs?project_id=p1`, and rejects sibling paths such as `/workbench-old`, external URLs, protocol-relative URLs, encoded or normalized `/query/*`, old `/query/replay/*`, encoded path traversal, and mutating API endpoints.
- `ProductAction` command variants require their concrete payload fields, including `work_item_id`, `spec_id`, `plan_id`, `plan_revision_id`, `package_id`, and `expected_package_version`.
- empty action ids, object ids, command ids, labels, hrefs, disabled reasons, and blocked reasons fail contract validation.
- command fixtures with mismatched `object_id` and concrete id fields fail contract validation.
- command fixtures missing required `spec_id` or `plan_id` fields fail schema validation.
- disabled navigate actions still require target; targetless navigate actions are rejected by schema.
- duplicate `ProductLaneItem.id` and duplicate `ProductAction.id` within one action list fail response validation.
- Manager lane fixtures reject command actions.
- Old `RoleWorkbenchAction`, `RoleWorkbenchResponse`, and `RoleWorkbenchId` exports and old workbench response schemas are absent.

### API Tests

- `GET /query/product-lanes/:laneId` works for all 10 lanes.
- product lane queries require `project_id`, support `cursor` / `limit`, and produce `next_cursor` when paginated.
- product lane responses include `unsupported_filters` for lane-visible filters that were not applied, ordered by `ProductLaneQuery` declaration order.
- each lane follows the filter matrix for applied filters, 400 conflicts, and `unsupported_filters`.
- unknown product lane query keys return 400.
- duplicate query keys, array values, invalid booleans, and non-integer `limit` return 400.
- empty `project_id`, optional product lane string filters, and `cursor` return 400 when supplied.
- supplied-but-unsupported filters do not affect `items` or `summary`.
- filter subjects use normalized `ProductLaneItem` fields and multi-link any-match semantics defined by the spec.
- mismatched `actor_id` and lane-specific actor filters return 400.
- Work Item actions query rejects unknown keys and duplicate or array `lane` values.
- product lane summary counts represent the full filtered result set before pagination.
- conflicting `kind` filters on Work Item type lanes return 400.
- Unknown lane returns 400.
- Work Item type lanes filter by Work Item kind:
  - requirements -> requirement;
  - bugs -> bug;
  - tech-debt -> tech_debt;
  - initiatives -> initiative.
- Functional lanes return the expected object types and ProductActions:
  - Spec Approver -> Spec / Plan navigation decisions;
  - Execution Owner -> Package actions including mark-ready/run when valid;
  - Reviewer -> Review Packet navigation;
  - QA / Test Owner -> test strategy and acceptance drill-down;
  - Release Owner -> Release readiness actions;
  - Manager -> read-only drill-down.
- `GET /query/work-items/:workItemId/actions?lane=:laneId` derives action state from related Spec, Plan, Package, Run, Review, and Release objects.
- omitted `lane` returns `lane_id === default_lane_id` derived from Work Item kind.
- supplied-but-irrelevant valid `lane` returns `lane_id` equal to the requested lane while preserving the derived `default_lane_id`.
- empty Work Item actions `lane` returns 400 when supplied.
- Work Items without a Spec or Plan record return navigation actions to the Spec / Plan flow, not draft-generation command actions.
- Disabled and blocked actions include reasons.
- Old `/query/workbenches/:workbenchId` is not available.

### Web Tests

- `/workbench` redirects to `/workbench/requirements`.
- `/workbench?kind=bug` redirects to `/workbench/requirements` without preserving `kind`.
- unknown `/workbench/:laneId` shows an unavailable state with a link to `/workbench/requirements`.
- `/workbench/:laneId` requests `/query/product-lanes/:laneId`.
- lane requests include the current `project_id`.
- unsupported filter notices render when `unsupported_filters` is non-empty.
- all lane tabs are enabled and navigate to canonical lane routes.
- queue rows render primary ProductAction and state metadata.
- primary action sorting is deterministic for multiple primary, disabled, and blocked actions.
- a blocked primary action remains the queue CTA when it is the first backend-ordered primary, and backend fixtures do not emit enabled primary actions alongside a blocked primary for the same item.
- ActionRail renders navigate, command, disabled, and blocked actions.
- command actions with `target` do not auto-navigate on success; target is available only as a separate follow-up link.
- command failures and disabled commands never navigate.
- selection re-resolves after filters, pagination, refresh, and command invalidation on both desktop and mobile layouts.
- Work Item Detail derives default lane from Work Item kind.
- Work Item Detail respects `?lane=`.
- Work Item Detail shows an unavailable state for unknown `?lane=` and does not call the actions endpoint for the invalid lane.
- Work Item Detail no longer renders `Update brief`, `Attach evidence`, or old placeholder copy.
- Simple command actions call explicit existing hooks.
- Simple command actions invalidate all product-lane cache variants for the current `project_id`, all Work Item action variants for `work_item_id`, the Work Item cockpit, command object, and target object or target lane queries when present.
- Complex actions navigate to object pages.

### Guard Tests

Add no-legacy checks for product code and tests:

- `work-item-owner`
- `RoleWorkbenchAction`
- `RoleWorkbenchResponse`
- `RoleWorkbenchId`
- `RoleWorkbenchFilters`
- `RoleWorkbenchRoute`
- `RoleQueue`
- `role-workbench`
- `getRoleWorkbench`
- `useWorkbenchQuery`
- `workbenchIdForProductRole`
- `productRoleToWorkbenchId`
- `workItemOwnerRole`
- `workItemOwnerWorkbenchId`
- `RoleWorkbench*`
- `roleWorkbench*`
- product-facing `intake` workbench id
- product-facing `manager-health` workbench id
- `?role=`
- `/workbench/work-item-owner`
- route/query alias handling for old Workbench routes
- `Available after role queues are ready`
- `Update brief`
- `Attach evidence`
- old `/query/workbenches/` product usage
- disabled role tab copy

Allow references only inside the new guard test itself if needed to assert absence, inside this migration spec, inside historical docs that are not active implementation plans for this slice, and inside an explicit deletion checklist section of the current implementation plan. Active product code, product tests, fixtures, e2e mocks, and non-checklist implementation plan sections must be clean.

The `intake` guard is scoped to old Workbench ids, Product Lane ids, role mappings, query keys, endpoint paths, fixtures, and e2e mocks. It must not reject legitimate Work Item intake domain language or `PipelineStageId = 'intake'`.

## Migration Rules

- Do not add compatibility adapters.
- Do not keep old route/query aliases.
- Do not keep old action shape in type unions.
- Do not keep old role-workbench modules as active wrappers or implementation boundaries.
- Do not leave disabled role tabs.
- Do not leave Work Item Detail placeholder actions.
- Do not expose old backend lane names in UI copy.
- Do not fallback from old workbench endpoint to new product lane endpoint.
- Do not keep `intake` or `manager-health` as product-facing Workbench vocabulary.

## Acceptance Criteria

- Users can open each canonical Workbench lane route and see lane-specific queues.
- Work Item type lanes are not collapsed into Work Item Owner.
- Functional lanes are real product surfaces, not disabled tabs.
- Workbench and Work Item Detail consume the same ProductAction model.
- Work Item Detail shows lane-aware next actions and no placeholder buttons.
- Simple existing commands can be executed inline where the ProductAction permits.
- Complex decisions navigate to the owning object page.
- The old role workbench action contract is removed.
- Tests prove there is no retained legacy action/route naming in product surfaces.
