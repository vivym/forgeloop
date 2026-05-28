# Product-Grade Visual System Projection Inventory

Task 3 requires presentation view models to use only existing product projections, deterministic derived fields, or truthful degraded states. No backend or API projection exceptions are planned for this closure slice.

| UX field | Existing or derived source | Required degraded fallback | Projection exception |
| --- | --- | --- | --- |
| Safe bulk action eligibility | Existing scoped ProductAction command metadata, selected-row object refs, and disabled reasons | Disabled bulk-action region with "No shared safe bulk action" | None planned |
| Source evidence status | Existing attachment, evidence, relationship, and unavailable/degraded source data | Evidence readiness unavailable/stale block | None planned |
| Execution PR/diff/test evidence | Existing execution evidence refs, changed-file summaries, check-result summaries, and lifecycle events where present | Compact "Evidence unavailable" state with recovery link if available | None planned |
| Release approvals and rollback disabled reasons | Existing release readiness/cockpit data plus command disabled reasons | Launch/rollback disabled with explicit missing approval or blocker reason | None planned |
| Report conclusions and suggested actions | Existing report groups, degraded source flags, generated timestamp, and report links as navigation metadata only | "Insufficient signal" conclusion and no enabled action | None planned |

## Adapter Ownership

| Adapter | Projection-sensitive fields | Source projection | Degraded behavior |
| --- | --- | --- | --- |
| `sourceObjectListViewModel` | Object label/type, current state, source evidence, source-to-plan next action | Source object detail/list fixtures with `evidence_refs`, `attachment_refs`, `relationship_refs`, and release/development-plan refs | Source evidence block reports unavailable when refs are absent; next action stays on Development Plan creation or review |
| `cockpitViewModel` | Overall state, gate progress, blockers, evidence summary, actor/role | Work Item cockpit response and `delivery_readiness` stages/blockers/evidence | Missing evidence remains unavailable; blockers remain explicit disabled/risk text |
| `myWorkQueueViewModel` | Role queue state, shared bulk action eligibility, role grouping | My Work queue rows plus optional bulk action metadata | Missing shared command metadata disables bulk action with "No shared safe bulk action" |
| `developmentPlanViewModel` | Source links, item count, blocked count, plan status | Development Plan list/detail fixture projections | Missing source links render as not linked, not as generated scope |
| `developmentPlanItemViewModel` | Boundary/spec/execution/review/QA gate progress | Development Plan Item detail/list row projections | Missing gate status remains unavailable in the gate list |
| `specPlanQueueViewModel` | Governance queue status, review actor, risk, next action | Specs and Execution Plans queue projection | Empty queue renders no pending governance action |
| `executionViewModel` | PR, diff, test evidence and recovery link | Execution detail/list projection refs plus lifecycle summaries | Missing refs render compact "Evidence unavailable" with item recovery link when present |
| `releaseViewModel` | Launch/rollback action enablement, approvals, blockers | Release cockpit/readiness projections and disabled reasons | Missing approval disables launch; missing rollback plan disables rollback |
| `reportViewModel` | Conclusion and suggested action | Report groups, degraded source flags, generated timestamp; report links are not per-report action evidence | Missing groups/signals render "Insufficient signal" and no suggested action |
