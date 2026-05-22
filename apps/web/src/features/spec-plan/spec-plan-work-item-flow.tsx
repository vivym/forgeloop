import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';

import {
  useCreatePlanMutation,
  useCreateSpecMutation,
  useGeneratePlanDraftMutation,
  useGenerateSpecDraftMutation,
  useWorkItemCockpitQuery,
} from '../../shared/api/hooks';
import { useActorContext } from '../../shared/context/actor-context';
import { ActionRail, DetailLayout, InlineActions, MetadataGrid, Metric, MetricGrid, PageHeader, Section } from '../../shared/layout';
import { Badge, Button, Drawer, DrawerClose, InlineNotice, StatusPill } from '../../shared/ui';
import { createWorkItemDetailViewModel, formatValue } from '../work-items/work-item-view-model';
import { isStrictlyApproved, SpecPlanLifecycleActions } from './spec-plan-lifecycle-actions';

export function SpecPlanWorkItemFlow() {
  const params = useParams();
  const { actorId } = useActorContext();
  const workItemId = params.workItemId;
  const cockpit = useWorkItemCockpitQuery(workItemId);
  const viewModel = createWorkItemDetailViewModel(cockpit.data, undefined);
  const [historyOpen, setHistoryOpen] = useState(false);
  const hasSpec = viewModel.spec !== null;
  const hasPlan = viewModel.plan !== null;
  const createSpec = useCreateSpecMutation(workItemId);
  const createPlan = useCreatePlanMutation(workItemId);
  const generateSpecDraft = useGenerateSpecDraftMutation({ workItemId, specId: viewModel.spec?.id });
  const generatePlanDraft = useGeneratePlanDraftMutation({ workItemId, planId: viewModel.plan?.id });
  const workItemTitle = viewModel.workItem?.title ?? 'Work item planning';
  const cockpitRefreshing = cockpit.isFetching && cockpit.status !== 'pending';
  const hasPlanningContext = cockpit.status === 'success' && !cockpit.isError && viewModel.workItem !== null;
  const specApprovedForPlan = isStrictlyApproved(viewModel.spec);
  const planApprovedForPackages = isStrictlyApproved(viewModel.plan);
  const revisionHistoryPendingReason = 'Revision history is available after work item planning data loads.';
  const createPlanBlockedReason = createPlanTitle({
    hasPlanningContext,
    cockpitRefreshing,
    hasSpec,
    hasPlan,
    specApprovedForPlan,
  });
  const handleHistoryOpenChange = (open: boolean) => {
    setHistoryOpen(hasPlanningContext ? open : false);
  };

  if (workItemId === undefined) {
    return (
      <DetailLayout header={<PageHeader subtitle="No work item route parameter was provided." title="Spec & Plan" />}>
        <Section title="Invalid route">
          <InlineNotice title="This Spec & Plan route is missing a work item." />
        </Section>
      </DetailLayout>
    );
  }

  return (
    <DetailLayout
      actionRail={
        <ActionRail title="Approval actions">
          {hasPlanningContext ? (
            <div className="grid gap-3">
              <SpecPlanLifecycleActions actorId={actorId} artifact={viewModel.spec} kind="spec" workItemId={workItemId} />
              <SpecPlanLifecycleActions actorId={actorId} artifact={viewModel.plan} kind="plan" workItemId={workItemId} />
            </div>
          ) : (
            <InlineNotice title="Approval actions load with the work item planning context." />
          )}
        </ActionRail>
      }
      header={
        <PageHeader
          actions={
            <InlineActions>
              <Button
                disabled={!hasPlanningContext || cockpitRefreshing || hasSpec || createSpec.isPending}
                onClick={() => createSpec.mutate()}
                title={createSpecTitle({ hasPlanningContext, cockpitRefreshing, hasSpec })}
                variant="primary"
              >
                {createSpec.isPending ? 'Creating spec...' : 'Create Spec'}
              </Button>
              <Button
                disabled={!hasPlanningContext || cockpitRefreshing || !specApprovedForPlan || hasPlan || createPlan.isPending}
                onClick={() => createPlan.mutate()}
                title={createPlanBlockedReason}
                variant="primary"
              >
                {createPlan.isPending ? 'Creating plan...' : 'Create Plan'}
              </Button>
              {hasPlanningContext && hasSpec && !hasPlan && !specApprovedForPlan ? (
                <InlineNotice title={createPlanBlockedReason} tone="warning" />
              ) : null}
              <Drawer
                content={
                  <div className="grid gap-3">
                    <RevisionStatus
                      available={Boolean(viewModel.spec?.current_revision_id)}
                      label="Spec"
                      status={viewModel.spec?.status}
                    />
                    <RevisionStatus
                      available={Boolean(viewModel.plan?.current_revision_id)}
                      label="Plan"
                      status={viewModel.plan?.status}
                    />
                    <DrawerClose label="Close revision history">Close</DrawerClose>
                  </div>
                }
                description="Revision availability and approval state for this work item."
                onOpenChange={handleHistoryOpenChange}
                open={hasPlanningContext && historyOpen}
                title="Revision history"
              >
                <Button
                  disabled={!hasPlanningContext}
                  onClick={() => {
                    if (hasPlanningContext) {
                      setHistoryOpen(true);
                    }
                  }}
                  title={hasPlanningContext ? undefined : revisionHistoryPendingReason}
                >
                  Open revision history
                </Button>
              </Drawer>
              {!hasPlanningContext ? <InlineNotice title={revisionHistoryPendingReason} tone="info" /> : null}
              <CommandFeedback
                messages={[
                  mutationFeedback(createSpec, 'Spec is being created.', 'Spec could not be created.'),
                  mutationFeedback(createPlan, 'Plan is being created.', 'Plan could not be created.'),
                ]}
              />
            </InlineActions>
          }
          eyebrow={workItemTitle}
          subtitle="Create, draft, and approve product planning artifacts from the work item context."
          title="Spec & Plan"
        />
      }
    >
      {cockpit.status === 'pending' ? (
        <Section title="Loading">
          <InlineNotice title="Loading Spec & Plan context." tone="info" />
        </Section>
      ) : null}
      {cockpit.isError ? (
        <Section title="Unavailable">
          <InlineNotice title="Spec & Plan data is temporarily unavailable." tone="danger" />
        </Section>
      ) : null}
      {cockpit.status !== 'pending' && !cockpit.isError && viewModel.workItem === null ? (
        <Section title="Empty">
          <InlineNotice title="No work item planning context is available." />
        </Section>
      ) : null}
      {cockpit.status !== 'pending' && !cockpit.isError && viewModel.workItem !== null ? (
        <>
          <Section title="Work item context">
            <MetricGrid>
              <Metric label="Kind" value={formatValue(viewModel.workItem.kind)} />
              <Metric label="Risk" value={formatValue(viewModel.workItem.risk)} />
              <Metric label="Driver" value={`${formatValue(viewModel.workItem.kind)} Driver`} />
              <Metric label="Phase" value={formatValue(viewModel.workItem.phase)} />
            </MetricGrid>
          </Section>
          <Section title="Spec">
            <ArtifactState
              action={
                hasSpec ? (
                  <div className="grid gap-3">
                    <Button
                      disabled={cockpitRefreshing || generateSpecDraft.isPending}
                      onClick={() => generateSpecDraft.mutate()}
                      title={
                        cockpitRefreshing
                          ? 'Available after planning artifacts refresh.'
                          : 'Generate a draft revision for this spec.'
                      }
                    >
                      {generateSpecDraft.isPending ? 'Generating spec draft...' : 'Generate spec draft'}
                    </Button>
                    <CommandFeedback
                      messages={[
                        mutationFeedback(
                          generateSpecDraft,
                          'Spec draft is being generated.',
                          'Spec draft could not be generated.',
                        ),
                      ]}
                    />
                  </div>
                ) : null
              }
              created={hasSpec}
              gate={viewModel.spec?.gate_state}
              status={viewModel.spec?.status}
            />
          </Section>
          <Section title="Plan">
            <ArtifactState
              action={
                hasPlan ? (
                  <div className="grid gap-3">
                    <Button
                      disabled={cockpitRefreshing || !specApprovedForPlan || generatePlanDraft.isPending}
                      onClick={() => generatePlanDraft.mutate()}
                      title={
                        cockpitRefreshing
                          ? 'Available after planning artifacts refresh.'
                          : !specApprovedForPlan
                            ? 'Generate Plan draft unlocks after the current Spec revision is approved.'
                          : 'Generate a draft revision for this plan.'
                      }
                    >
                      {generatePlanDraft.isPending ? 'Generating plan draft...' : 'Generate plan draft'}
                    </Button>
                    <CommandFeedback
                      messages={[
                        mutationFeedback(
                          generatePlanDraft,
                          'Plan draft is being generated.',
                          'Plan draft could not be generated.',
                        ),
                      ]}
                    />
                    <PlanPackageHandoff plan={viewModel.plan} />
                  </div>
                ) : null
              }
              created={hasPlan}
              gate={viewModel.plan?.gate_state}
              status={viewModel.plan?.status}
            />
          </Section>
          <Section title="Planning readiness">
            <InlineActions>
              <Badge tone={hasSpec ? 'success' : 'warning'}>{hasSpec ? 'Spec exists' : 'Spec needed'}</Badge>
              <Badge tone={hasPlan ? 'success' : 'warning'}>{hasPlan ? 'Plan exists' : 'Plan needed'}</Badge>
              <StatusPill tone={planApprovedForPackages ? 'success' : 'warning'}>
                {planApprovedForPackages ? 'Ready for packages' : 'Planning in progress'}
              </StatusPill>
            </InlineActions>
          </Section>
        </>
      ) : null}
    </DetailLayout>
  );
}

interface MutationState {
  isError: boolean;
  isPending: boolean;
}

function createSpecTitle(input: { hasPlanningContext: boolean; cockpitRefreshing: boolean; hasSpec: boolean }) {
  if (!input.hasPlanningContext) return 'Create Spec after work item planning data loads.';
  if (input.cockpitRefreshing) return 'Available after planning artifacts refresh.';
  if (input.hasSpec) return 'A spec already exists for this work item.';
  return 'Create a spec for this work item.';
}

function createPlanTitle(input: {
  hasPlanningContext: boolean;
  cockpitRefreshing: boolean;
  hasSpec: boolean;
  hasPlan: boolean;
  specApprovedForPlan: boolean;
}) {
  if (!input.hasPlanningContext) return 'Create Plan after work item planning data loads.';
  if (input.cockpitRefreshing) return 'Available after planning artifacts refresh.';
  if (!input.hasSpec) return 'Create a spec before creating a plan.';
  if (!input.specApprovedForPlan) return 'Create Plan unlocks after the current Spec revision is approved.';
  if (input.hasPlan) return 'A plan already exists for this work item.';
  return 'Create a plan for this work item.';
}

function mutationFeedback(mutation: MutationState, pendingMessage: string, errorMessage: string) {
  if (mutation.isPending) return pendingMessage;
  if (mutation.isError) return errorMessage;
  return null;
}

function CommandFeedback({ messages }: { messages: Array<string | null> }) {
  return (
    <>
      {messages
        .filter((message): message is string => message !== null)
        .map((message) => (
          <InlineNotice key={message} title={message} tone="info" />
        ))}
    </>
  );
}

function PlanPackageHandoff({
  plan,
}: {
  plan: { status?: string | undefined; approved_revision_id?: string | undefined } | null;
}) {
  if (plan?.status !== 'approved') {
    return null;
  }

  if (plan.approved_revision_id) {
    return (
      <Link className="inline-flex min-h-10 items-center justify-center rounded-md border border-primary bg-primary px-4 text-sm font-semibold text-white transition-colors duration-base ease-standard hover:bg-primary-hover" to={`/packages?plan_revision_id=${encodeURIComponent(plan.approved_revision_id)}`}>
        Continue to Packages
      </Link>
    );
  }

  return (
    <Link className="inline-flex min-h-10 items-center justify-center rounded-md border border-border bg-surface px-4 text-sm font-semibold text-text-primary transition-colors duration-base ease-standard hover:border-border-strong hover:bg-surface-muted" to="/packages">
      View package inventory
    </Link>
  );
}

function ArtifactState({
  action,
  created,
  gate,
  status,
}: {
  action: ReactNode | null;
  created: boolean;
  gate: string | undefined;
  status: string | undefined;
}) {
  return (
    <div className="grid gap-4">
      <MetricGrid>
        <Metric label="Status" value={created ? formatValue(status) : 'Not created'} />
        <Metric label="Gate" value={created ? formatValue(gate) : 'Waiting'} />
      </MetricGrid>
      {action === null ? null : <InlineActions>{action}</InlineActions>}
    </div>
  );
}

function RevisionStatus({ available, label, status }: { available: boolean; label: string; status: string | undefined }) {
  return (
    <MetadataGrid
      items={[
        {
          label,
          value: available ? `${formatValue(status)} revision available` : 'No revision yet',
        },
      ]}
    />
  );
}
