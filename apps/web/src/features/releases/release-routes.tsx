import { useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import {
  useAcknowledgeReleaseTestAcceptanceMutation,
  useApproveReleaseMutation,
  useCloseReleaseMutation,
  useCreateReleaseEvidenceMutation,
  useCreateReleaseMutation,
  useLinkReleaseExecutionPackageMutation,
  useLinkReleaseWorkItemMutation,
  usePackagesQuery,
  useOverrideApproveReleaseMutation,
  usePatchReleaseMutation,
  useProductWorkItemsQuery,
  useReleaseCockpitQuery,
  useReleaseReplayQuery,
  useReleasesQuery,
  useRequestReleaseChangesMutation,
  useStartReleaseObservingMutation,
  useSubmitReleaseMutation,
  useUnlinkReleaseExecutionPackageMutation,
  useUnlinkReleaseWorkItemMutation,
} from '../../shared/api/hooks';
import type {
  AcknowledgeReleaseTestAcceptanceBody,
  PatchReleaseBody,
  ProductListItem,
  ReleaseBlockerSnapshot,
  ReleaseCockpitResponse,
  ReleaseListResponse,
  TimelineEntry,
} from '../../shared/api/types';
import { useActorContext } from '../../shared/context/actor-context';
import { useProjectContext } from '../../shared/context/project-context';
import { ActionRail, DetailLayout, PageHeader, Section } from '../../shared/layout';
import { Button, DataTable, Drawer, Input, Select, StatusPill, Textarea, Timeline, type TimelineItem } from '../../shared/ui';

const supportedReleaseFilters = ['release_owner_actor_id', 'phase', 'gate_state', 'resolution', 'cursor', 'limit'];
type ReleaseFilters = {
  release_owner_actor_id?: string;
  phase?: string;
  gate_state?: string;
  resolution?: string;
  cursor?: string;
  limit?: number;
};

type CockpitWorkItem = ReleaseCockpitResponse['work_items'][number];
type CockpitPackage = ReleaseCockpitResponse['execution_packages'][number];
type CockpitEvidence = ReleaseCockpitResponse['evidences'][number];
type CockpitDecision = ReleaseCockpitResponse['decisions'][number];

export function ReleasesRegistry() {
  const { actorId } = useActorContext();
  const { projectId: contextProjectId } = useProjectContext();
  const [searchParams] = useSearchParams();
  const projectId = searchParams.get('project_id')?.trim() || contextProjectId;
  const filters = releaseFiltersFromSearch(searchParams);
  const unsupportedFilters = unsupportedReleaseFilters(searchParams);
  const query = useReleasesQuery({ project_id: projectId, ...filters, limit: filters.limit ?? 100 });
  const [showCreateRelease, setShowCreateRelease] = useState(false);

  return (
    <>
      <PageHeader
        actions={
          <Drawer
            content={<CreateReleaseForm actorId={actorId} onCreated={() => setShowCreateRelease(false)} projectId={projectId} />}
            description="Create a governed release for this project."
            onOpenChange={setShowCreateRelease}
            open={showCreateRelease}
            title="Create release"
          >
            <Button variant="primary">Create release</Button>
          </Drawer>
        }
        subtitle="Release readiness, scope, ownership, and gate state."
        title="Releases"
      />
      <Section
        description="Server-side filters are sent only for project, release owner, phase, gate state, resolution, cursor, and limit."
        title="Release inventory"
      >
        <RegistryState isError={query.isError} isPending={query.status === 'pending'} kind="releases" />
        <FilterSummary filters={filters} unsupportedFilters={unsupportedFilters} />
        {query.status !== 'pending' && !query.isError ? <ReleaseTable response={query.data} /> : null}
      </Section>
    </>
  );
}

export function ReleaseCockpit() {
  const { releaseId } = useParams();

  if (!releaseId) {
    return <InvalidDetail title="Release" message="This release route is missing a release id." />;
  }

  return <ReleaseCockpitView releaseId={releaseId} />;
}

function ReleaseCockpitView({ releaseId }: { releaseId: string }) {
  const { actorId } = useActorContext();
  const cockpitQuery = useReleaseCockpitQuery(releaseId);
  const replayQuery = useReleaseReplayQuery(releaseId);

  if (cockpitQuery.status === 'pending') {
    return <InvalidDetail title="Release" message="Loading release cockpit." />;
  }

  if (cockpitQuery.isError || cockpitQuery.data === undefined) {
    return <InvalidDetail title="Release" message="Release cockpit data is temporarily unavailable." />;
  }

  const cockpit = cockpitQuery.data;
  const release = cockpit.release;

  return (
    <DetailLayout
      actionRail={<ReleaseActionRail actorId={actorId} cockpit={cockpit} />}
      header={
        <PageHeader
          eyebrow={
            <span className="fl-inline-actions">
              <span>Release</span>
              <StatusPill tone={releaseStateTone(release.phase)}>{release.phase}</StatusPill>
              <StatusPill tone={releaseStateTone(release.gate_state)}>{release.gate_state}</StatusPill>
              <StatusPill tone={releaseStateTone(release.resolution)}>{release.resolution}</StatusPill>
            </span>
          }
          subtitle={`Owner ${release.release_owner_actor_id ?? 'unassigned'} / Blocker fingerprint ${cockpit.blocker_snapshot.blocker_fingerprint}`}
          title={release.title}
        />
      }
    >
      <Section title="Scope summary" description="Release scope, rollout, rollback, and observation planning.">
        <p>{release.scope_summary ?? 'Scope summary unavailable from release API.'}</p>
        <dl className="fl-metadata-grid">
          <Metadata label="Rollout strategy" value={release.rollout_strategy ?? 'not recorded'} />
          <Metadata label="Rollback plan" value={release.rollback_plan ?? 'not recorded'} />
          <Metadata label="Observation plan" value={release.observation_plan ?? 'not recorded'} />
          <Metadata label="Release type" value={release.release_type ?? 'unavailable'} />
        </dl>
      </Section>
      <Section title="Linked Work Items" description="Work Items in this release scope.">
        <ReleaseWorkItems releaseId={release.id} actorId={actorId} projectId={release.project_id} workItems={cockpit.work_items} />
      </Section>
      <Section title="Linked Execution Packages" description="Execution Packages included in this release.">
        <ReleaseExecutionPackages actorId={actorId} packages={cockpit.execution_packages} projectId={release.project_id} releaseId={release.id} />
      </Section>
      <Section title="Blockers" description="Current release blockers and override state.">
        <BlockerPanel cockpit={cockpit} />
      </Section>
      <Section title="Checklist" description="Release readiness checklist.">
        <PillList empty="No checklist items recorded." values={cockpit.checklist.map((item) => item.label)} />
      </Section>
      <Section title="Risk summary" description="Release risk and gate counts.">
        <RiskSummary cockpit={cockpit} />
      </Section>
      <Section title="Evidence" description="Release evidence linked to this cockpit.">
        <EvidenceList empty="No release evidence recorded." evidences={cockpit.evidences} />
      </Section>
      <Section title="Observations" description="Observation evidence captured during or after rollout.">
        <EvidenceList empty="No observation evidence recorded." evidences={cockpit.observations} />
      </Section>
      <Section title="Decisions" description="Governance decisions recorded for this release.">
        <DecisionList decisions={cockpit.decisions} />
      </Section>
      <Section title="Test Acceptance" description="QA acceptance is acknowledged with summary and artifact references.">
        <TestAcceptanceForm actorId={actorId} releaseId={release.id} />
      </Section>
      <Section title="Observation evidence" description="Submit governed release observations through summary and evidence fields.">
        <ObservationEvidenceForm actorId={actorId} releaseId={release.id} />
      </Section>
      <Section title="Timeline / Replay" description="Release replay timeline.">
        <ReplayState isError={replayQuery.isError} isPending={replayQuery.status === 'pending'} timeline={replayQuery.data ?? []} />
      </Section>
    </DetailLayout>
  );
}

function CreateReleaseForm({ actorId, onCreated, projectId }: { actorId: string; onCreated: () => void; projectId: string }) {
  const createRelease = useCreateReleaseMutation(projectId);
  const [title, setTitle] = useState('');
  const [scopeSummary, setScopeSummary] = useState('');
  const [releaseOwner, setReleaseOwner] = useState('');
  const [rolloutStrategy, setRolloutStrategy] = useState('');
  const [rollbackPlan, setRollbackPlan] = useState('');
  const [observationPlan, setObservationPlan] = useState('');

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    createRelease.mutate(
      {
        actor_id: actorId,
        project_id: projectId,
        title: title.trim(),
        release_owner_actor_id: releaseOwner.trim() || actorId,
        ...(scopeSummary.trim() ? { scope_summary: scopeSummary.trim() } : {}),
        ...(rolloutStrategy.trim() ? { rollout_strategy: rolloutStrategy.trim() } : {}),
        ...(rollbackPlan.trim() ? { rollback_plan: rollbackPlan.trim() } : {}),
        ...(observationPlan.trim() ? { observation_plan: observationPlan.trim() } : {}),
      },
      {
        onSuccess: () => {
          setTitle('');
          setScopeSummary('');
          onCreated();
        },
      },
    );
  }

  return (
    <form className="stack-form compact" onSubmit={onSubmit}>
      <label className="field">
        Release title
        <Input onChange={(event) => setTitle(event.currentTarget.value)} value={title} />
      </label>
      <label className="field">
        Scope summary
        <Textarea onChange={(event) => setScopeSummary(event.currentTarget.value)} rows={3} value={scopeSummary} />
      </label>
      <label className="field">
        Release owner
        <Input onChange={(event) => setReleaseOwner(event.currentTarget.value)} value={releaseOwner} />
      </label>
      <label className="field">
        Rollout strategy
        <Textarea onChange={(event) => setRolloutStrategy(event.currentTarget.value)} rows={2} value={rolloutStrategy} />
      </label>
      <label className="field">
        Rollback plan
        <Textarea onChange={(event) => setRollbackPlan(event.currentTarget.value)} rows={2} value={rollbackPlan} />
      </label>
      <label className="field">
        Observation plan
        <Textarea onChange={(event) => setObservationPlan(event.currentTarget.value)} rows={2} value={observationPlan} />
      </label>
      {createRelease.isError ? <p className="empty">Release creation is temporarily unavailable.</p> : null}
      <Button disabled={!title.trim()} loading={createRelease.isPending} type="submit" variant="primary">
        Submit release
      </Button>
    </form>
  );
}

function ReleaseTable({ response }: { response: ReleaseListResponse | undefined }) {
  const releases = response?.releases ?? [];

  return (
    <DataTable
      columns={[
        {
          key: 'title',
          header: 'Release',
          cell: (release) => (
            <div className="stack-form compact">
              {release.key ? <strong>{release.key}</strong> : null}
              <Link to={`/releases/${encodeURIComponent(release.id)}`}>{release.title}</Link>
            </div>
          ),
        },
        { key: 'phase', header: 'Phase', cell: (release) => <StatusPill>{release.phase}</StatusPill> },
        { key: 'gate', header: 'Gate state', cell: (release) => release.gate_state },
        { key: 'resolution', header: 'Resolution', cell: (release) => release.resolution },
        { key: 'owner', header: 'Owner', cell: (release) => release.release_owner_actor_id ?? 'unassigned' },
        {
          key: 'scope',
          header: 'Linked scope',
          cell: (release) => (
            <div className="stack-form compact">
              <span>Work Items: {release.work_item_ids.length}</span>
              <span>Packages: {release.execution_package_ids.length}</span>
            </div>
          ),
        },
        {
          key: 'completeness',
          header: 'Completeness',
          cell: (release) => (
            <div className="stack-form compact">
              <span>Rollout {release.rollout_strategy ? 'complete' : 'missing'}</span>
              <span>Rollback {release.rollback_plan ? 'complete' : 'missing'}</span>
              <span>Observation {release.observation_plan ? 'complete' : 'missing'}</span>
            </div>
          ),
        },
        { key: 'acceptance', header: 'Acceptance', cell: () => 'Acceptance summary unavailable from release list API.' },
        { key: 'updated', header: 'Updated', cell: (release) => formatAge(release.updated_at) },
      ]}
      emptyMessage="No releases are available for this project."
      getRowKey={(release) => release.id}
      rows={releases}
    />
  );
}

function ReleaseWorkItems({
  actorId,
  projectId,
  releaseId,
  workItems,
}: {
  actorId: string;
  projectId: string;
  releaseId: string;
  workItems: CockpitWorkItem[];
}) {
  const workItemsQuery = useProductWorkItemsQuery({ project_id: projectId, limit: 100 });
  const linkWorkItem = useLinkReleaseWorkItemMutation(releaseId);
  const unlinkWorkItem = useUnlinkReleaseWorkItemMutation(releaseId);
  const [selectedWorkItemId, setSelectedWorkItemId] = useState('');
  const linkedWorkItemIds = new Set(workItems.map((item) => item.id));
  const workItemOptions = (workItemsQuery.data?.items ?? [])
    .filter((item) => !linkedWorkItemIds.has(item.object.id))
    .map((item) => ({ label: workItemPickerLabel(item), value: item.object.id }));

  return (
    <div className="stack-form compact">
      <form
        className="fl-inline-actions"
        onSubmit={(event) => {
          event.preventDefault();
          if (!selectedWorkItemId) return;
          linkWorkItem.mutate(
            { workItemId: selectedWorkItemId, body: { actor_id: actorId } },
            { onSuccess: () => setSelectedWorkItemId('') },
          );
        }}
      >
        <label className="field">
          Work Item
          <Select
            disabled={workItemsQuery.status === 'pending' || workItemsQuery.isError || workItemOptions.length === 0}
            onChange={(event) => setSelectedWorkItemId(event.currentTarget.value)}
            options={workItemOptions}
            placeholder={pickerPlaceholder({
              empty: 'No available Work Items',
              isError: workItemsQuery.isError,
              isPending: workItemsQuery.status === 'pending',
              ready: 'Select a Work Item',
              unavailable: 'Work Item picker unavailable',
              valueCount: workItemOptions.length,
            })}
            required
            value={selectedWorkItemId}
          />
        </label>
        <Button disabled={!selectedWorkItemId} loading={linkWorkItem.isPending} type="submit" variant="secondary">
          Add Work Item
        </Button>
      </form>
      <DataTable
        columns={[
          { key: 'title', header: 'Work Item', cell: (item) => <Link to={`/work-items/${encodeURIComponent(item.id)}`}>{item.title}</Link> },
          { key: 'phase', header: 'Phase', cell: (item) => item.phase ?? 'unknown' },
          { key: 'risk', header: 'Risk', cell: (item) => item.risk ?? 'unknown' },
          {
            key: 'remove',
            header: 'Remove',
            cell: (item) => (
              <Button
                loading={unlinkWorkItem.isPending}
                onClick={() => unlinkWorkItem.mutate({ workItemId: item.id, body: { actor_id: actorId } })}
                variant="ghost"
              >
                Remove
              </Button>
            ),
          },
        ]}
        emptyMessage="No Work Items are linked to this release."
        getRowKey={(item) => item.id}
        rows={workItems}
      />
    </div>
  );
}

function ReleaseExecutionPackages({
  actorId,
  packages,
  projectId,
  releaseId,
}: {
  actorId: string;
  packages: CockpitPackage[];
  projectId: string;
  releaseId: string;
}) {
  const packagesQuery = usePackagesQuery({ project_id: projectId, limit: 100 });
  const linkPackage = useLinkReleaseExecutionPackageMutation(releaseId);
  const unlinkPackage = useUnlinkReleaseExecutionPackageMutation(releaseId);
  const [selectedPackageId, setSelectedPackageId] = useState('');
  const linkedPackageIds = new Set(packages.map((item) => item.id));
  const packageOptions = (packagesQuery.data?.items ?? [])
    .filter((item) => !linkedPackageIds.has(item.object.id))
    .map((item) => ({ label: packagePickerLabel(item), value: item.object.id }));

  return (
    <div className="stack-form compact">
      <form
        className="fl-inline-actions"
        onSubmit={(event) => {
          event.preventDefault();
          if (!selectedPackageId) return;
          linkPackage.mutate(
            { packageId: selectedPackageId, body: { actor_id: actorId } },
            { onSuccess: () => setSelectedPackageId('') },
          );
        }}
      >
        <label className="field">
          Execution Package
          <Select
            disabled={packagesQuery.status === 'pending' || packagesQuery.isError || packageOptions.length === 0}
            onChange={(event) => setSelectedPackageId(event.currentTarget.value)}
            options={packageOptions}
            placeholder={pickerPlaceholder({
              empty: 'No available Execution Packages',
              isError: packagesQuery.isError,
              isPending: packagesQuery.status === 'pending',
              ready: 'Select an Execution Package',
              unavailable: 'Execution Package picker unavailable',
              valueCount: packageOptions.length,
            })}
            required
            value={selectedPackageId}
          />
        </label>
        <Button disabled={!selectedPackageId} loading={linkPackage.isPending} type="submit" variant="secondary">
          Add Execution Package
        </Button>
      </form>
      <DataTable
        columns={[
          { key: 'objective', header: 'Package', cell: (item) => <Link to={`/packages/${encodeURIComponent(item.id)}`}>{item.objective}</Link> },
          { key: 'phase', header: 'Phase', cell: (item) => item.phase ?? 'unknown' },
          { key: 'owner', header: 'Owner', cell: () => 'Owner unavailable from release cockpit API.' },
          {
            key: 'remove',
            header: 'Remove',
            cell: (item) => (
              <Button
                loading={unlinkPackage.isPending}
                onClick={() => unlinkPackage.mutate({ packageId: item.id, body: { actor_id: actorId } })}
                variant="ghost"
              >
                Remove
              </Button>
            ),
          },
        ]}
        emptyMessage="No Execution Packages are linked to this release."
        getRowKey={(item) => item.id}
        rows={packages}
      />
    </div>
  );
}

function ReleaseActionRail({ actorId, cockpit }: { actorId: string; cockpit: ReleaseCockpitResponse }) {
  const releaseId = cockpit.release.id;
  const submit = useSubmitReleaseMutation(releaseId);
  const approve = useApproveReleaseMutation(releaseId);
  const overrideApprove = useOverrideApproveReleaseMutation(releaseId);
  const requestChanges = useRequestReleaseChangesMutation(releaseId);
  const startObserving = useStartReleaseObservingMutation(releaseId);
  const closeRelease = useCloseReleaseMutation(releaseId);
  const [showEditRelease, setShowEditRelease] = useState(false);
  const [approveRationale, setApproveRationale] = useState('');
  const [overrideRationale, setOverrideRationale] = useState('');
  const [changesRationale, setChangesRationale] = useState('');
  const [closeSummary, setCloseSummary] = useState('');
  const [closeConfirmation, setCloseConfirmation] = useState('');
  const [closeResolution, setCloseResolution] = useState<'completed' | 'rolled_back' | 'cancelled'>('completed');

  return (
    <ActionRail title="Release actions">
      <div className="stack-form compact">
        <Drawer
          content={
            <EditReleaseForm
              actorId={actorId}
              onSaved={() => setShowEditRelease(false)}
              release={cockpit.release}
            />
          }
          description="Update release title and planning details."
          onOpenChange={setShowEditRelease}
          open={showEditRelease}
          title="Edit release details"
        >
          <Button variant="secondary">Edit release</Button>
        </Drawer>
        <Button loading={submit.isPending} onClick={() => submit.mutate({ actor_id: actorId })} variant="primary">
          Submit
        </Button>
        <label className="field">
          Approval rationale
          <Textarea onChange={(event) => setApproveRationale(event.currentTarget.value)} rows={2} value={approveRationale} />
        </label>
        <Button
          loading={approve.isPending}
          onClick={() => approve.mutate({ actor_id: actorId, ...(approveRationale.trim() ? { rationale: approveRationale.trim() } : {}) })}
          variant="primary"
        >
          Approve
        </Button>
        <label className="field">
          Override rationale
          <Textarea onChange={(event) => setOverrideRationale(event.currentTarget.value)} rows={3} value={overrideRationale} />
        </label>
        <Button
          disabled={!overrideRationale.trim()}
          loading={overrideApprove.isPending}
          onClick={() =>
            overrideApprove.mutate({
              actor_id: actorId,
              rationale: overrideRationale.trim(),
              blocker_snapshot: cockpit.blocker_snapshot as ReleaseBlockerSnapshot,
            })
          }
          variant="danger"
        >
          Override approve
        </Button>
        <label className="field">
          Change request rationale
          <Textarea onChange={(event) => setChangesRationale(event.currentTarget.value)} rows={3} value={changesRationale} />
        </label>
        <Button
          disabled={!changesRationale.trim()}
          loading={requestChanges.isPending}
          onClick={() => requestChanges.mutate({ actor_id: actorId, rationale: changesRationale.trim() })}
          variant="secondary"
        >
          Request changes
        </Button>
        <Button loading={startObserving.isPending} onClick={() => startObserving.mutate({ actor_id: actorId })} variant="secondary">
          Start observing
        </Button>
        <label className="field">
          Close resolution
          <Select
            onChange={(event) => setCloseResolution(event.currentTarget.value as 'completed' | 'rolled_back' | 'cancelled')}
            options={[
              { label: 'Completed', value: 'completed' },
              { label: 'Rolled back', value: 'rolled_back' },
              { label: 'Cancelled', value: 'cancelled' },
            ]}
            value={closeResolution}
          />
        </label>
        <label className="field">
          Close summary
          <Textarea onChange={(event) => setCloseSummary(event.currentTarget.value)} rows={2} value={closeSummary} />
        </label>
        <label className="field">
          Close confirmation
          <Input onChange={(event) => setCloseConfirmation(event.currentTarget.value)} placeholder="Type close release" value={closeConfirmation} />
        </label>
        <Button
          disabled={closeConfirmation.trim().toLowerCase() !== 'close release'}
          loading={closeRelease.isPending}
          onClick={() =>
            closeRelease.mutate({
              actor_id: actorId,
              resolution: closeResolution,
              ...(closeSummary.trim() ? { summary: closeSummary.trim() } : {}),
              override_without_observation: false,
            })
          }
          variant="danger"
        >
          Close release
        </Button>
      </div>
    </ActionRail>
  );
}

function EditReleaseForm({
  actorId,
  onSaved,
  release,
}: {
  actorId: string;
  onSaved: () => void;
  release: ReleaseCockpitResponse['release'];
}) {
  const patchRelease = usePatchReleaseMutation(release.id);
  const [title, setTitle] = useState(release.title);
  const [scopeSummary, setScopeSummary] = useState(release.scope_summary ?? '');
  const [rolloutStrategy, setRolloutStrategy] = useState(release.rollout_strategy ?? '');
  const [rollbackPlan, setRollbackPlan] = useState(release.rollback_plan ?? '');
  const [observationPlan, setObservationPlan] = useState(release.observation_plan ?? '');

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const body = releasePatchBody({
      actorId,
      title,
      scopeSummary,
      rolloutStrategy,
      rollbackPlan,
      observationPlan,
    });
    if (body === undefined) return;
    patchRelease.mutate(body, { onSuccess: onSaved });
  }

  return (
    <form className="stack-form compact" onSubmit={onSubmit}>
      <label className="field">
        Release title
        <Input onChange={(event) => setTitle(event.currentTarget.value)} value={title} />
      </label>
      <label className="field">
        Scope summary
        <Textarea onChange={(event) => setScopeSummary(event.currentTarget.value)} rows={3} value={scopeSummary} />
      </label>
      <label className="field">
        Rollout strategy
        <Textarea onChange={(event) => setRolloutStrategy(event.currentTarget.value)} rows={2} value={rolloutStrategy} />
      </label>
      <label className="field">
        Rollback plan
        <Textarea onChange={(event) => setRollbackPlan(event.currentTarget.value)} rows={2} value={rollbackPlan} />
      </label>
      <label className="field">
        Observation plan
        <Textarea onChange={(event) => setObservationPlan(event.currentTarget.value)} rows={2} value={observationPlan} />
      </label>
      {patchRelease.isError ? <p className="empty">Release update is temporarily unavailable.</p> : null}
      <Button disabled={releasePatchBody({ actorId, title, scopeSummary, rolloutStrategy, rollbackPlan, observationPlan }) === undefined} loading={patchRelease.isPending} type="submit" variant="primary">
        Save release
      </Button>
    </form>
  );
}

function TestAcceptanceForm({ actorId, releaseId }: { actorId: string; releaseId: string }) {
  const acknowledge = useAcknowledgeReleaseTestAcceptanceMutation(releaseId);
  const [summary, setSummary] = useState('');
  const [evidenceRef, setEvidenceRef] = useState('');

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!summary.trim()) return;
    acknowledge.mutate({
      actor_id: actorId,
      summary: summary.trim(),
      evidence_refs: artifactRefsFromInput(evidenceRef),
    });
  }

  return (
    <form className="stack-form compact" onSubmit={onSubmit}>
      <label className="field">
        Test acceptance summary
        <Textarea onChange={(event) => setSummary(event.currentTarget.value)} rows={3} value={summary} />
      </label>
      <label className="field">
        Acceptance evidence reference
        <Input onChange={(event) => setEvidenceRef(event.currentTarget.value)} value={evidenceRef} />
      </label>
      <Button disabled={!summary.trim()} loading={acknowledge.isPending} type="submit" variant="primary">
        Acknowledge test acceptance
      </Button>
    </form>
  );
}

function ObservationEvidenceForm({ actorId, releaseId }: { actorId: string; releaseId: string }) {
  const createEvidence = useCreateReleaseEvidenceMutation(releaseId);
  const [summary, setSummary] = useState('');
  const [severity, setSeverity] = useState<'info' | 'warning' | 'failure'>('info');

  return (
    <form
      className="stack-form compact"
      onSubmit={(event) => {
        event.preventDefault();
        if (!summary.trim()) return;
        createEvidence.mutate({
          actor_id: actorId,
          evidence_type: 'observation_note',
          summary: summary.trim(),
          extra: {
            observation: {
              source: 'human',
              severity,
              summary: summary.trim(),
              observed_at: new Date().toISOString(),
              actor_id: actorId,
            },
          },
        });
      }}
    >
      <label className="field">
        Observation summary
        <Textarea onChange={(event) => setSummary(event.currentTarget.value)} rows={3} value={summary} />
      </label>
      <label className="field">
        Observation severity
        <Select
          onChange={(event) => setSeverity(event.currentTarget.value as 'info' | 'warning' | 'failure')}
          options={[
            { label: 'Info', value: 'info' },
            { label: 'Warning', value: 'warning' },
            { label: 'Failure', value: 'failure' },
          ]}
          value={severity}
        />
      </label>
      <Button disabled={!summary.trim()} loading={createEvidence.isPending} type="submit" variant="secondary">
        Submit observation evidence
      </Button>
    </form>
  );
}

function BlockerPanel({ cockpit }: { cockpit: ReleaseCockpitResponse }) {
  const blockers = cockpit.blockers.map((blocker) => `${blocker.code}: ${blocker.message}`);
  const overridden = cockpit.overridden_blockers.map((blocker) => `${blocker.code}: ${blocker.message}`);
  return (
    <div className="stack-form compact">
      <Metadata label="Blocker fingerprint" value={cockpit.blocker_snapshot.blocker_fingerprint} />
      <PillList empty="No active blockers." values={blockers} />
      <PillList empty="No overridden blockers." values={overridden} />
    </div>
  );
}

function RiskSummary({ cockpit }: { cockpit: ReleaseCockpitResponse }) {
  return (
    <dl className="fl-metadata-grid">
      {Object.entries(cockpit.risk_summary).map(([key, value]) => (
        <Metadata key={key} label={key.replaceAll('_', ' ')} value={String(value)} />
      ))}
    </dl>
  );
}

function EvidenceList({ empty, evidences }: { empty: string; evidences: CockpitEvidence[] }) {
  if (!evidences.length) return <p className="empty">{empty}</p>;
  return (
    <div className="stack-form compact">
      {evidences.map((evidence) => (
        <article className="fl-card" key={evidence.id}>
          <h3>{evidence.summary}</h3>
          <p>{evidence.evidence_type}</p>
          <p>{evidence.artifact?.name ?? evidence.artifact?.storage_uri ?? 'No public artifact reference.'}</p>
        </article>
      ))}
    </div>
  );
}

function DecisionList({ decisions }: { decisions: CockpitDecision[] }) {
  if (!decisions.length) return <p className="empty">No release decisions recorded.</p>;
  return (
    <div className="stack-form compact">
      {decisions.map((decision) => (
        <article className="fl-card" key={decision.id}>
          <h3>{decision.summary}</h3>
          <p>{decision.rationale ?? decision.decision}</p>
        </article>
      ))}
    </div>
  );
}

function RegistryState({ isError, isPending, kind }: { isError: boolean; isPending: boolean; kind: string }) {
  if (isPending) return <p className="empty">Loading {kind}.</p>;
  if (isError) return <p className="empty">The {kind} inventory is temporarily unavailable.</p>;
  return null;
}

function FilterSummary({ filters, unsupportedFilters }: { filters: ReleaseFilters; unsupportedFilters: string[] }) {
  const supported = Object.entries(filters)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${String(value)}`);

  return (
    <div className="stack-form compact">
      {supported.length ? <p>Applied filters: {supported.join(', ')}</p> : <p>No release filters applied.</p>}
      {unsupportedFilters.length ? <p className="empty">{formatList(unsupportedFilters)} are not applied to the release inventory yet.</p> : null}
    </div>
  );
}

function ReplayState({ isError, isPending, timeline }: { isError: boolean; isPending: boolean; timeline: TimelineEntry[] }) {
  if (isPending) return <p className="empty">Loading timeline.</p>;
  if (isError) return <p className="empty">Timeline is temporarily unavailable.</p>;
  if (!timeline.length) return <p className="empty">No timeline events recorded.</p>;
  return <Timeline items={timeline.map(timelineItem)} />;
}

function PillList({ empty, values }: { empty: string; values: string[] }) {
  if (!values.length) return <p className="empty">{empty}</p>;
  return (
    <ul className="fl-pill-list">
      {values.map((value) => (
        <li key={value}>{value}</li>
      ))}
    </ul>
  );
}

function Metadata({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function InvalidDetail({ message, title }: { message: string; title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <Section title="Unavailable">
        <p className="empty">{message}</p>
      </Section>
    </>
  );
}

function releaseFiltersFromSearch(searchParams: URLSearchParams): ReleaseFilters {
  const filters: ReleaseFilters = {};
  for (const key of supportedReleaseFilters) {
    const value = searchParams.get(key)?.trim();
    if (!value) continue;
    if (key === 'limit') {
      const parsed = Number(value);
      filters.limit = Number.isInteger(parsed) && parsed > 0 && parsed <= 100 ? parsed : 100;
    } else {
      filters[key as Exclude<keyof ReleaseFilters, 'limit'>] = value;
    }
  }
  return filters;
}

function unsupportedReleaseFilters(searchParams: URLSearchParams) {
  const unsupported = Array.from(searchParams.keys()).filter(
    (key) => key !== 'project_id' && !supportedReleaseFilters.includes(key),
  );
  const limit = searchParams.get('limit');
  if (limit !== null) {
    const parsed = Number(limit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
      unsupported.push('limit');
    }
  }
  return Array.from(new Set(unsupported));
}

function artifactRefsFromInput(value: string): AcknowledgeReleaseTestAcceptanceBody['evidence_refs'] {
  const trimmed = value.trim();
  if (!trimmed) return [];
  return [
    {
      kind: 'check_output',
      name: 'Test acceptance evidence',
      content_type: 'text/markdown',
      local_ref: trimmed,
    },
  ];
}

function releasePatchBody(input: {
  actorId: string;
  title: string;
  scopeSummary: string;
  rolloutStrategy: string;
  rollbackPlan: string;
  observationPlan: string;
}): PatchReleaseBody | undefined {
  const body = {
    actor_id: input.actorId,
    ...(input.title.trim() ? { title: input.title.trim() } : {}),
    ...(input.scopeSummary.trim() ? { scope_summary: input.scopeSummary.trim() } : {}),
    ...(input.rolloutStrategy.trim() ? { rollout_strategy: input.rolloutStrategy.trim() } : {}),
    ...(input.rollbackPlan.trim() ? { rollback_plan: input.rollbackPlan.trim() } : {}),
    ...(input.observationPlan.trim() ? { observation_plan: input.observationPlan.trim() } : {}),
  };

  return Object.keys(body).length > 1 ? body : undefined;
}

function workItemPickerLabel(item: ProductListItem) {
  return item.title;
}

function packagePickerLabel(item: ProductListItem) {
  return item.title;
}

function pickerPlaceholder({
  empty,
  isError,
  isPending,
  ready,
  unavailable,
  valueCount,
}: {
  empty: string;
  isError: boolean;
  isPending: boolean;
  ready: string;
  unavailable: string;
  valueCount: number;
}) {
  if (isPending) return 'Loading options';
  if (isError) return unavailable;
  if (valueCount === 0) return empty;
  return ready;
}

function timelineItem(entry: TimelineEntry): TimelineItem {
  return {
    id: entry.id,
    title: entry.summary,
    meta: entry.created_at,
  };
}

function formatList(values: string[]) {
  if (values.length <= 1) return values[0] ?? '';
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(', ')}, and ${values.at(-1)}`;
}

function formatAge(value: string | undefined) {
  if (!value) return 'unknown';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function releaseStateTone(value: string | undefined) {
  const normalized = value?.toLowerCase() ?? '';
  if (['approved', 'closed', 'completed', 'observing', 'released', 'resolved'].includes(normalized)) return 'success';
  if (['blocked', 'cancelled', 'failed', 'rejected', 'rolled_back'].includes(normalized)) return 'danger';
  if (['approval', 'open', 'pending', 'submitted'].includes(normalized)) return 'warning';
  return 'info';
}
