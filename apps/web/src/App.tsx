import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import {
  api,
  queryApi,
  type ActorCommandBody,
  type ArtifactKind,
  type ArtifactRef,
  type CheckResult,
  type CockpitResponse,
  type CreateExecutionPackageBody,
  type CreateReleaseBody,
  type CreateReleaseEvidenceBody,
  type PatchExecutionPackageBody,
  type PatchReleaseBody,
  type CreatePlanRevisionBody,
  type CreateSpecRevisionBody,
  type CreateWorkItemBody,
  type EvidenceChainResponse,
  type ExecutionPackage,
  type ExecutorType,
  type PlanRevision,
  type RequestedChange,
  type ReleaseCockpitResponse,
  type ReleaseEvidenceObjectRef,
  type ReviewPacket,
  type RunEvent,
  type RunEventStream,
  type RunPackageBody,
  type RunSession,
  type SpecPlan,
  type SpecRevision,
  type TimelineEntry,
  type WorkItem,
  type WorkItemKind,
} from './api';
import {
  appendRunEvents,
  buildObservationEvidencePayload,
  evidenceChainDisplayItem,
  evidenceChainSummaryMetrics,
  groupReleaseBlockers,
  groupEvidenceChainItems,
  isActiveCockpit,
  latestContinuationNotice,
  latestPlanStep,
  renderableRunEvents,
  releaseNextActionLabel,
  runArtifactDisplayLabel,
  runArtifactsForDetail,
  visibleRunArtifacts,
  workerLeaseLabel,
} from './workbenchState';

const actorDefault = 'actor-owner';
const reviewerDefault = 'actor-reviewer';
const qaDefault = 'actor-qa';
const artifactKinds: ArtifactKind[] = ['diff', 'changed_files', 'check_output', 'execution_summary', 'self_review', 'review_packet'];

const emptyWorkItem: CreateWorkItemBody = {
  project_id: '',
  kind: 'requirement',
  title: '',
  goal: '',
  success_criteria: [],
  priority: 'P0',
  risk: 'medium',
  owner_actor_id: actorDefault,
};

const emptyPackage: CreateExecutionPackageBody = {
  repo_id: '',
  objective: '',
  owner_actor_id: actorDefault,
  reviewer_actor_id: reviewerDefault,
  qa_owner_actor_id: qaDefault,
  required_checks: [{ check_id: 'test', display_name: 'Tests', command: 'pnpm test', timeout_seconds: 600, blocks_review: true }],
  required_artifact_kinds: artifactKinds,
  allowed_paths: ['apps/web/**'],
  forbidden_paths: ['apps/control-plane-api/**', 'migrations/**'],
};

const emptyReleaseForm: CreateReleaseBody = {
  actor_id: actorDefault,
  project_id: '',
  title: '',
  scope_summary: '',
  rollout_strategy: '',
  rollback_plan: '',
  observation_plan: '',
};

const emptyReleasePatchForm: PatchReleaseBody = {
  actor_id: actorDefault,
  title: '',
  scope_summary: '',
  rollout_strategy: '',
  rollback_plan: '',
  observation_plan: '',
};

type SpecPlanMode = 'spec' | 'plan';

export function App() {
  const selectedWorkItemIdRef = useRef('');
  const refreshRequestIdRef = useRef(0);
  const runEventCursorRef = useRef<string | undefined>(undefined);
  const runStreamRef = useRef<RunEventStream | null>(null);
  const runStreamRetryRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [projectFilter, setProjectFilter] = useState('');
  const [manualWorkItemId, setManualWorkItemId] = useState('');
  const [selectedWorkItemId, setSelectedWorkItemId] = useState('');
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [cockpit, setCockpit] = useState<CockpitResponse>({});
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [evidenceChain, setEvidenceChain] = useState<EvidenceChainResponse | null>(null);
  const [specRevisions, setSpecRevisions] = useState<SpecRevision[]>([]);
  const [planRevisions, setPlanRevisions] = useState<PlanRevision[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState('');
  const [selectedRunId, setSelectedRunId] = useState('');
  const [selectedReviewId, setSelectedReviewId] = useState('');
  const [runDetail, setRunDetail] = useState<RunSession | null>(null);
  const [runEvents, setRunEvents] = useState<RunEvent[]>([]);
  const [runInput, setRunInput] = useState('');
  const [runStreamStatus, setRunStreamStatus] = useState<'idle' | 'connecting' | 'live' | 'retrying' | 'blocked'>('idle');
  const [runConsoleError, setRunConsoleError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [reviewDetail, setReviewDetail] = useState<ReviewPacket | null>(null);
  const [releaseId, setReleaseId] = useState('');
  const [releaseProjectId, setReleaseProjectId] = useState('');
  const [releaseCockpit, setReleaseCockpit] = useState<ReleaseCockpitResponse | null>(null);
  const [releaseReplay, setReleaseReplay] = useState<TimelineEntry[]>([]);
  const [releaseForm, setReleaseForm] = useState(emptyReleaseForm);
  const [releasePatchForm, setReleasePatchForm] = useState(emptyReleasePatchForm);
  const [releaseLinkForm, setReleaseLinkForm] = useState({
    actor_id: actorDefault,
    work_item_id: '',
    execution_package_id: '',
  });
  const [releaseDecisionForm, setReleaseDecisionForm] = useState({
    actor_id: reviewerDefault,
    rationale: '',
    close_resolution: 'completed' as 'completed' | 'rolled_back' | 'cancelled',
    close_summary: '',
    override_without_observation: false,
  });
  const [releaseEvidenceForm, setReleaseEvidenceForm] = useState({
    actor_id: actorDefault,
    summary: '',
    severity: 'info' as 'info' | 'warning' | 'failure',
    observed_at: '',
    links: 'release||observed',
    metrics: '',
    notes: '',
  });
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [workItemForm, setWorkItemForm] = useState(emptyWorkItem);
  const [specMode, setSpecMode] = useState<SpecPlanMode>('spec');
  const [revisionForm, setRevisionForm] = useState(defaultRevisionForm('spec'));
  const [packageForm, setPackageForm] = useState(toPackageForm(emptyPackage));
  const [runForm, setRunForm] = useState({ actor_id: actorDefault, executor_type: 'mock' as ExecutorType, workflow_only: true, force_reason: '' });
  const [reviewForm, setReviewForm] = useState({
    actor_id: reviewerDefault,
    summary: '',
    change_title: '',
    change_description: '',
    change_file_path: '',
    change_severity: 'major',
    suggested_validation: '',
  });

  const hasActiveCockpit = isActiveCockpit(cockpit, selectedWorkItemId);
  const selectedWorkItem = hasActiveCockpit ? cockpit.work_item : workItems.find((item) => item.id === selectedWorkItemId);
  const currentSpec = hasActiveCockpit ? (cockpit.current_spec ?? null) : null;
  const currentPlan = hasActiveCockpit ? (cockpit.current_plan ?? null) : null;
  const packages = hasActiveCockpit ? (cockpit.packages ?? []) : [];
  const runSessions = hasActiveCockpit ? (cockpit.run_sessions ?? []) : [];
  const reviewPackets = hasActiveCockpit ? (cockpit.review_packets ?? []) : [];
  const selectedPackage = packages.find((item) => item.id === selectedPackageId) ?? packages[0];
  const activeSelectedRunId = hasActiveCockpit && runSessions.some((run) => run.id === selectedRunId) ? selectedRunId : '';
  const activeSelectedReviewId =
    hasActiveCockpit && reviewPackets.some((packet) => packet.id === selectedReviewId) ? selectedReviewId : '';
  const activeRunDetail = activeSelectedRunId && runDetail?.id === activeSelectedRunId ? runDetail : null;
  const activeRunSummary = activeRunDetail ?? runSessions.find((run) => run.id === activeSelectedRunId) ?? null;
  const activeReviewDetail = activeSelectedReviewId && reviewDetail?.id === activeSelectedReviewId ? reviewDetail : null;
  const failedChecks = (activeRunDetail?.check_results ?? []).filter((check) => check.status !== 'succeeded' && check.blocks_review !== false);
  const nextActions = hasActiveCockpit ? (cockpit.next_actions ?? []) : [];
  const selectedRunActorId = runForm.actor_id.trim() || selectedPackage?.owner_actor_id || actorDefault;
  const release = releaseCockpit?.release ?? null;
  const releaseBlockerGroups = groupReleaseBlockers(releaseCockpit?.blockers ?? []);
  const releaseStateText = useMemo(
    () =>
      JSON.stringify(
        release
          ? {
              phase: release.phase,
              activity_state: release.activity_state,
              gate_state: release.gate_state,
              resolution: release.resolution,
              blocker_fingerprint: releaseCockpit?.blocker_snapshot.blocker_fingerprint,
            }
          : {},
        null,
        2,
      ),
    [release, releaseCockpit?.blocker_snapshot.blocker_fingerprint],
  );

  useEffect(() => {
    void loadWorkItems();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    selectedWorkItemIdRef.current = selectedWorkItemId;
    clearWorkbenchState();
    if (selectedWorkItemId) {
      void refreshWorkbench(selectedWorkItemId);
    }
  }, [selectedWorkItemId]);

  useEffect(() => {
    setRevisionForm(defaultRevisionForm(specMode));
  }, [specMode]);

  useEffect(() => {
    if (selectedPackage) {
      setPackageForm(toPackageForm(selectedPackage));
    }
  }, [selectedPackage]);

  useEffect(() => {
    if (!selectedRunId) {
      setRunDetail(null);
      return;
    }
    let cancelled = false;
    void runAction(`Loaded run ${selectedRunId}`, async () => {
      const detail = await api.getRunSession(selectedRunId);
      if (!cancelled) setRunDetail(detail);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedRunId]);

  useEffect(() => {
    if (!selectedReviewId) {
      setReviewDetail(null);
      return;
    }
    let cancelled = false;
    void runAction(`Loaded review ${selectedReviewId}`, async () => {
      const detail = await api.getReviewPacket(selectedReviewId);
      if (!cancelled) setReviewDetail(detail);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedReviewId]);

  useEffect(() => {
    runStreamRef.current?.close();
    runStreamRef.current = null;
    if (runStreamRetryRef.current !== undefined) {
      clearTimeout(runStreamRetryRef.current);
      runStreamRetryRef.current = undefined;
    }
    runEventCursorRef.current = undefined;
    setRunEvents([]);
    setRunConsoleError('');

    if (!activeSelectedRunId) {
      setRunStreamStatus('idle');
      return;
    }

    let stopped = false;
    const mergeRunEvents = (incoming: RunEvent[]) => {
      setRunEvents((current) => appendRunEvents(current, incoming));
    };
    const closeStream = () => {
      runStreamRef.current?.close();
      runStreamRef.current = null;
    };
    const scheduleReconnect = () => {
      if (stopped) return;
      setRunStreamStatus('retrying');
      setRunConsoleError('Run event stream disconnected; reconnecting.');
      closeStream();
      if (runStreamRetryRef.current !== undefined) clearTimeout(runStreamRetryRef.current);
      runStreamRetryRef.current = setTimeout(() => {
        runStreamRetryRef.current = undefined;
        void openStream(runEventCursorRef.current);
      }, 1500);
    };
    const openStream = async (after?: string) => {
      if (stopped) return;
      try {
        setRunStreamStatus('connecting');
        const stream = await api.openRunEventStream(
          activeSelectedRunId,
          { actorId: selectedRunActorId, ...(after === undefined ? {} : { after }) },
          {
            onEvent: (event) => {
              if (stopped) return;
              setRunStreamStatus('live');
              setRunConsoleError('');
              mergeRunEvents([event]);
              runEventCursorRef.current = event.cursor ?? runEventCursorRef.current;
            },
            onError: () => {
              scheduleReconnect();
            },
          },
        );
        if (stopped) {
          stream.close();
          return;
        }
        runStreamRef.current = stream;
        setRunStreamStatus('live');
      } catch (cause) {
        if (stopped) return;
        setRunStreamStatus('blocked');
        setRunConsoleError(cause instanceof Error ? cause.message : 'Unable to open run event stream');
      }
    };
    const start = async () => {
      setRunStreamStatus('connecting');
      try {
        const response = await api.listRunEvents(activeSelectedRunId, { actorId: selectedRunActorId });
        if (stopped) return;
        mergeRunEvents(response.events);
        runEventCursorRef.current = response.next_cursor;
        void openStream(response.next_cursor);
      } catch (cause) {
        if (stopped) return;
        setRunStreamStatus('blocked');
        setRunConsoleError(cause instanceof Error ? cause.message : 'Unable to load run events');
      }
    };

    void start();

    return () => {
      stopped = true;
      closeStream();
      if (runStreamRetryRef.current !== undefined) {
        clearTimeout(runStreamRetryRef.current);
        runStreamRetryRef.current = undefined;
      }
    };
  }, [activeSelectedRunId, selectedRunActorId]);

  const completionText = useMemo(
    () => JSON.stringify(hasActiveCockpit ? (cockpit.completion_state ?? {}) : {}, null, 2),
    [cockpit.completion_state, hasActiveCockpit],
  );

  async function runAction(success: string, action: () => Promise<void>) {
    setLoading(true);
    setError('');
    try {
      await action();
      setNotice(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }

  async function loadWorkItems() {
    await runAction('Loaded work items', async () => {
      const items = await api.listWorkItems(projectFilter.trim() || undefined);
      setWorkItems(items);
      if (!selectedWorkItemId && items[0]) setSelectedWorkItemId(items[0].id);
    });
  }

  function clearWorkbenchState() {
    refreshRequestIdRef.current += 1;
    setCockpit({});
    setTimeline([]);
    setEvidenceChain(null);
    setSpecRevisions([]);
    setPlanRevisions([]);
    setSelectedPackageId('');
    setSelectedRunId('');
    setSelectedReviewId('');
    setRunDetail(null);
    setRunEvents([]);
    setRunInput('');
    setRunStreamStatus('idle');
    setRunConsoleError('');
    setReviewDetail(null);
    setPackageForm(toPackageForm(emptyPackage));
  }

  async function refreshWorkbench(workItemId = selectedWorkItemId) {
    if (!workItemId) return;
    const requestId = ++refreshRequestIdRef.current;
    await runAction('Workbench refreshed', async () => {
      const evidenceChainRequest = api.getEvidenceChain(workItemId).catch(() => null);
      const [cockpitResponse, timelineResponse] = await Promise.all([
        queryApi.getWorkItemCockpit(workItemId),
        queryApi.getWorkItemReplay(workItemId),
      ]);
      if (requestId !== refreshRequestIdRef.current || selectedWorkItemIdRef.current !== workItemId) return;
      const spec = cockpitResponse.current_spec;
      const plan = cockpitResponse.current_plan;
      const [nextSpecRevisions, nextPlanRevisions] = await Promise.all([
        spec?.id ? api.listSpecRevisions(spec.id) : Promise.resolve([]),
        plan?.id ? api.listPlanRevisions(plan.id) : Promise.resolve([]),
      ]);
      if (requestId !== refreshRequestIdRef.current || selectedWorkItemIdRef.current !== workItemId) return;
      setCockpit(cockpitResponse);
      setTimeline(timelineResponse);
      setEvidenceChain(null);
      setSpecRevisions(nextSpecRevisions);
      setPlanRevisions(nextPlanRevisions);
      const pkg = cockpitResponse.packages?.[0];
      setSelectedPackageId((current) => (current && cockpitResponse.packages?.some((item) => item.id === current) ? current : (pkg?.id ?? '')));
      const run = cockpitResponse.run_sessions?.[0];
      setSelectedRunId((current) => (current && cockpitResponse.run_sessions?.some((item) => item.id === current) ? current : (run?.id ?? '')));
      const review = cockpitResponse.review_packets?.[0];
      setSelectedReviewId((current) => (current && cockpitResponse.review_packets?.some((item) => item.id === current) ? current : (review?.id ?? '')));
      void evidenceChainRequest.then((evidenceChainResponse) => {
        if (requestId !== refreshRequestIdRef.current || selectedWorkItemIdRef.current !== workItemId) return;
        setEvidenceChain(evidenceChainResponse);
      });
    });
  }

  function submitWorkItem(event: FormEvent) {
    event.preventDefault();
    void runAction('Created work item', async () => {
      const created = await api.createWorkItem(cleanWorkItem(workItemForm));
      const items = await api.listWorkItems(projectFilter.trim() || undefined);
      setWorkItems(items);
      setSelectedWorkItemId(created.id);
      setManualWorkItemId(created.id);
      setWorkItemForm(emptyWorkItem);
    });
  }

  function loadManualWorkItem(event: FormEvent) {
    event.preventDefault();
    const id = manualWorkItemId.trim();
    if (id) setSelectedWorkItemId(id);
  }

  function commandBody(): ActorCommandBody {
    const actorId = runForm.actor_id.trim();
    return actorId ? { actor_id: actorId } : {};
  }

  function submitRevision(event: FormEvent) {
    event.preventDefault();
    void runAction(`Created ${specMode} revision`, async () => {
      if (specMode === 'spec') {
        const spec = currentSpec ?? (await api.createSpec(requiredWorkItemId()));
        await api.createSpecRevision(spec.id, toSpecRevision(revisionForm));
      } else {
        const plan = currentPlan ?? (await api.createPlan(requiredWorkItemId()));
        await api.createPlanRevision(plan.id, toPlanRevision(revisionForm));
      }
      await refreshWorkbench();
    });
  }

  function specPlanCommand(label: string, command: () => Promise<unknown>) {
    void runAction(label, async () => {
      await command();
      await refreshWorkbench();
    });
  }

  function createManualPackage(event: FormEvent) {
    event.preventDefault();
    void runAction('Created execution package', async () => {
      await api.createExecutionPackage(requiredPlanRevisionId(), parsePackageForm(packageForm));
      await refreshWorkbench();
    });
  }

  function updateSelectedPackage() {
    if (!selectedPackage) return;
    void runAction('Updated execution package', async () => {
      await api.patchExecutionPackage(selectedPackage.id, parsePackagePatchForm(packageForm));
      await refreshWorkbench();
    });
  }

  function packageCommand(label: string, command: () => Promise<unknown>) {
    void runAction(label, async () => {
      await command();
      await refreshWorkbench();
    });
  }

  function runPackage(mode: 'run' | 'rerun' | 'force') {
    if (!selectedPackage) return;
    packageCommand(`${mode} accepted`, async () => {
      const body: RunPackageBody = {
        requested_by_actor_id: runForm.actor_id.trim() || actorDefault,
        executor_type: runForm.executor_type,
        workflow_only: runForm.workflow_only,
        ...(mode === 'force' ? { force: true, force_reason: runForm.force_reason.trim() || 'Operator requested force rerun.' } : {}),
        ...(mode === 'rerun' || mode === 'force' ? { previous_run_session_id: selectedRunId } : {}),
      };
      const response =
        mode === 'run'
          ? await api.runPackage(selectedPackage.id, body)
          : mode === 'rerun'
            ? await api.rerunPackage(selectedPackage.id, body)
            : await api.forceRerunPackage(selectedPackage.id, body);
      const runSessionId = typeof response.run_session_id === 'string' ? response.run_session_id : undefined;
      if (runSessionId) setSelectedRunId(runSessionId);
      const reviewPacketId = getNestedString(response, ['workflow_result', 'reviewPacketId']);
      if (reviewPacketId) setSelectedReviewId(reviewPacketId);
    });
  }

  function sendRunConsoleInput(event: FormEvent) {
    event.preventDefault();
    const message = runInput.trim();
    if (!activeSelectedRunId || !message) return;
    void runAction('Sent run input', async () => {
      await api.sendRunInput(activeSelectedRunId, selectedRunActorId, message, latestActiveTurnId(activeRunSummary, runEvents));
      setRunInput('');
    });
  }

  function runControlCommand(command: 'cancel' | 'resume') {
    if (!activeSelectedRunId) return;
    const reason = command === 'cancel' ? 'Operator requested cancellation from web console.' : 'Operator requested resume from web console.';
    void runAction(command === 'cancel' ? 'Cancel requested' : 'Resume requested', async () => {
      if (command === 'cancel') await api.cancelRun(activeSelectedRunId, selectedRunActorId, reason);
      else await api.resumeRun(activeSelectedRunId, selectedRunActorId, reason);
    });
  }

  function reviewDecision(decision: 'approve' | 'request_changes') {
    if (!activeSelectedReviewId) return;
    void runAction(decision === 'approve' ? 'Review approved' : 'Review changes requested', async () => {
      const reviewPacketId = activeSelectedReviewId;
      const body = {
        summary: reviewForm.summary.trim() || (decision === 'approve' ? 'Approved.' : 'Changes requested.'),
        reviewed_by_actor_id: reviewForm.actor_id.trim() || reviewerDefault,
        reviewed_at: new Date().toISOString(),
        ...(decision === 'request_changes' ? { requested_changes: [toRequestedChange(reviewForm)] } : {}),
      };
      if (decision === 'approve') await api.approveReviewPacket(reviewPacketId, body);
      else await api.requestReviewChanges(reviewPacketId, body);
      await refreshWorkbench();
      setReviewDetail(await api.getReviewPacket(reviewPacketId));
    });
  }

  function activeReleaseId() {
    const id = releaseId.trim() || release?.id;
    if (!id) throw new Error('Enter or create a release first.');
    return id;
  }

  async function refreshReleaseCockpit(reloadReplay = false) {
    const id = activeReleaseId();
    const [cockpitResponse, replayResponse] = await Promise.all([
      queryApi.getReleaseCockpit(id),
      reloadReplay ? queryApi.getReleaseReplay(id) : Promise.resolve(releaseReplay),
    ]);
    setReleaseCockpit(cockpitResponse);
    setReleaseId(cockpitResponse.release.id);
    setReleaseProjectId(cockpitResponse.release.project_id);
    setReleasePatchForm((current) => ({
      ...current,
      title: cockpitResponse.release.title,
      scope_summary: cockpitResponse.release.scope_summary ?? '',
      rollout_strategy: cockpitResponse.release.rollout_strategy ?? '',
      rollback_plan: cockpitResponse.release.rollback_plan ?? '',
      observation_plan: cockpitResponse.release.observation_plan ?? '',
    }));
    setReleaseReplay(reloadReplay ? replayResponse : []);
  }

  function loadReleaseCockpit(event?: FormEvent) {
    event?.preventDefault();
    void runAction('Loaded release cockpit', async () => refreshReleaseCockpit(false));
  }

  function loadReleaseReplay() {
    void runAction('Loaded release replay', async () => refreshReleaseCockpit(true));
  }

  function submitRelease(event: FormEvent) {
    event.preventDefault();
    void runAction('Created release', async () => {
      const created = await api.createRelease(cleanReleaseCreate(releaseForm));
      setReleaseId(created.release.id);
      setReleaseProjectId(created.release.project_id);
      setReleaseCockpit(await queryApi.getReleaseCockpit(created.release.id));
      setReleaseReplay([]);
    });
  }

  function patchRelease(event: FormEvent) {
    event.preventDefault();
    void runAction('Patched release', async () => {
      await api.patchRelease(activeReleaseId(), cleanReleasePatch(releasePatchForm));
      await refreshReleaseCockpit(false);
    });
  }

  function releaseScopeCommand(label: string, command: () => Promise<unknown>) {
    void runAction(label, async () => {
      await command();
      await refreshReleaseCockpit(false);
    });
  }

  function releaseCommand(label: string, command: () => Promise<unknown>) {
    void runAction(label, async () => {
      await command();
      await refreshReleaseCockpit(false);
    });
  }

  function submitObservationEvidence(event: FormEvent) {
    event.preventDefault();
    void runAction('Created observation evidence', async () => {
      await api.createReleaseEvidence(activeReleaseId(), toObservationEvidenceBody(releaseEvidenceForm, activeReleaseId()));
      await refreshReleaseCockpit(false);
    });
  }

  function requiredWorkItemId() {
    if (!hasActiveCockpit || !selectedWorkItemId) throw new Error('Load the selected work item cockpit first.');
    return selectedWorkItemId;
  }

  function requiredPlanRevisionId() {
    const revisionId = currentPlan?.current_revision_id ?? planRevisions[0]?.id;
    if (!revisionId) throw new Error('Create or generate a plan revision first.');
    return revisionId;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>ForgeLoop P0 Workbench</h1>
          <p>{selectedWorkItem ? `${selectedWorkItem.title} (${selectedWorkItem.id})` : 'No work item selected'}</p>
        </div>
        <div className="topbar-actions">
          <button onClick={() => void loadWorkItems()} disabled={loading}>Reload list</button>
          <button onClick={() => void refreshWorkbench()} disabled={loading || !selectedWorkItemId}>Refresh cockpit</button>
        </div>
      </header>

      {(notice || error) && (
        <div className={`banner ${error ? 'error' : 'ok'}`}>
          <span>{error || notice}</span>
          <button onClick={() => { setError(''); setNotice(''); }}>Clear</button>
        </div>
      )}

      <div className="workbench-grid">
        <section className="panel work-items">
          <SectionHeader title="Work Items" meta={workItems.length ? `${workItems.length} loaded` : 'empty'} />
          <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void loadWorkItems(); }}>
            <input value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} placeholder="project_id filter" />
            <button type="submit" disabled={loading}>List</button>
          </form>
          <form className="inline-form" onSubmit={loadManualWorkItem}>
            <input value={manualWorkItemId} onChange={(event) => setManualWorkItemId(event.target.value)} placeholder="work_item_id" />
            <button type="submit">Load</button>
          </form>
          <div className="list">
            {workItems.length === 0 && <EmptyState text="No work items loaded" />}
            {workItems.map((item) => (
              <button
                className={`list-row ${item.id === selectedWorkItemId ? 'selected' : ''}`}
                key={item.id}
                onClick={() => setSelectedWorkItemId(item.id)}
              >
                <strong>{item.title}</strong>
                <span>{item.kind} / {item.priority} / {item.risk}</span>
                <StatusLine item={item} />
              </button>
            ))}
          </div>
          <form className="stack-form" onSubmit={submitWorkItem}>
            <div className="form-grid two">
              <label>Project<input required value={workItemForm.project_id} onChange={(event) => setWorkItemForm({ ...workItemForm, project_id: event.target.value })} /></label>
              <label>Kind<select value={workItemForm.kind} onChange={(event) => setWorkItemForm({ ...workItemForm, kind: event.target.value as WorkItemKind })}>
                <option value="requirement">requirement</option><option value="bug">bug</option><option value="tech_debt">tech_debt</option>
              </select></label>
              <label>Priority<input value={workItemForm.priority} onChange={(event) => setWorkItemForm({ ...workItemForm, priority: event.target.value })} /></label>
              <label>Risk<input value={workItemForm.risk} onChange={(event) => setWorkItemForm({ ...workItemForm, risk: event.target.value })} /></label>
            </div>
            <label>Title<input required value={workItemForm.title} onChange={(event) => setWorkItemForm({ ...workItemForm, title: event.target.value })} /></label>
            <label>Goal<textarea required value={workItemForm.goal} onChange={(event) => setWorkItemForm({ ...workItemForm, goal: event.target.value })} /></label>
            <label>Success criteria<textarea value={workItemForm.success_criteria.join('\n')} onChange={(event) => setWorkItemForm({ ...workItemForm, success_criteria: lines(event.target.value) })} /></label>
            <label>Owner<input required value={workItemForm.owner_actor_id} onChange={(event) => setWorkItemForm({ ...workItemForm, owner_actor_id: event.target.value })} /></label>
            <button type="submit" disabled={loading}>Create Work Item</button>
          </form>
        </section>

        <section className="panel state-panel">
          <SectionHeader title="Operational State" meta={selectedWorkItem?.phase ?? 'none'} />
          {selectedWorkItem ? (
            <>
              <StatusLine item={selectedWorkItem} />
              <div className="state-grid">
                <Metric label="Spec" value={currentSpec?.gate_state ?? 'none'} />
                <Metric label="Plan" value={currentPlan?.gate_state ?? 'none'} />
                <Metric label="Packages" value={String(packages.length)} />
                <Metric label="Reviews" value={String(reviewPackets.length)} />
              </div>
              <h3>Next actions</h3>
              <PillList values={nextActions} empty="No next actions reported" />
              <h3>Completion</h3>
              <pre>{completionText}</pre>
            </>
          ) : <EmptyState text="Select a work item to load cockpit state" />}
        </section>

        <EvidenceChainPanel evidenceChain={hasActiveCockpit ? evidenceChain : null} />

        <section className="panel spec-plan">
          <SectionHeader title="Spec/Plan" meta={specMode} />
          <div className="segmented">
            <button className={specMode === 'spec' ? 'active' : ''} onClick={() => setSpecMode('spec')}>Spec</button>
            <button className={specMode === 'plan' ? 'active' : ''} onClick={() => setSpecMode('plan')}>Plan</button>
          </div>
          <EntitySummary title="Current spec" entity={currentSpec} revisions={specRevisions} />
          <EntitySummary title="Current plan" entity={currentPlan} revisions={planRevisions} />
          <div className="button-row">
            <button disabled={!hasActiveCockpit} onClick={() => specPlanCommand('Created spec', () => api.createSpec(requiredWorkItemId()))}>Create Spec</button>
            <button disabled={!currentSpec?.id} onClick={() => currentSpec && specPlanCommand('Generated spec draft', () => api.generateSpecDraft(currentSpec.id))}>Generate Spec</button>
            <button disabled={!currentSpec?.id} onClick={() => currentSpec && specPlanCommand('Submitted spec', () => api.submitSpecForApproval(currentSpec.id, commandBody()))}>Submit Spec</button>
            <button disabled={!currentSpec?.id} onClick={() => currentSpec && specPlanCommand('Approved spec', () => api.approveSpec(currentSpec.id, commandBody()))}>Approve Spec</button>
            <button disabled={!currentSpec?.id} onClick={() => currentSpec && specPlanCommand('Spec changes requested', () => api.requestSpecChanges(currentSpec.id, commandBody()))}>Request Spec Changes</button>
          </div>
          <div className="button-row">
            <button disabled={!hasActiveCockpit} onClick={() => specPlanCommand('Created plan', () => api.createPlan(requiredWorkItemId()))}>Create Plan</button>
            <button disabled={!currentPlan?.id} onClick={() => currentPlan && specPlanCommand('Generated plan draft', () => api.generatePlanDraft(currentPlan.id))}>Generate Plan</button>
            <button disabled={!currentPlan?.id} onClick={() => currentPlan && specPlanCommand('Submitted plan', () => api.submitPlanForApproval(currentPlan.id, commandBody()))}>Submit Plan</button>
            <button disabled={!currentPlan?.id} onClick={() => currentPlan && specPlanCommand('Approved plan', () => api.approvePlan(currentPlan.id, commandBody()))}>Approve Plan</button>
            <button disabled={!currentPlan?.id} onClick={() => currentPlan && specPlanCommand('Plan changes requested', () => api.requestPlanChanges(currentPlan.id, commandBody()))}>Request Plan Changes</button>
          </div>
          <form className="stack-form compact" onSubmit={submitRevision}>
            <div className="form-grid two">
              <label>Summary<input required value={revisionForm.summary} onChange={(event) => setRevisionForm({ ...revisionForm, summary: event.target.value })} /></label>
              <label>Actor<input value={revisionForm.actor} onChange={(event) => setRevisionForm({ ...revisionForm, actor: event.target.value })} /></label>
            </div>
            <label>Content<textarea required value={revisionForm.content} onChange={(event) => setRevisionForm({ ...revisionForm, content: event.target.value })} /></label>
            {specMode === 'spec' ? (
              <>
                <label>Background<textarea value={revisionForm.background} onChange={(event) => setRevisionForm({ ...revisionForm, background: event.target.value })} /></label>
                <label>Goals<textarea value={revisionForm.goals} onChange={(event) => setRevisionForm({ ...revisionForm, goals: event.target.value })} /></label>
                <label>Acceptance criteria<textarea value={revisionForm.acceptance} onChange={(event) => setRevisionForm({ ...revisionForm, acceptance: event.target.value })} /></label>
                <label>Test strategy<input value={revisionForm.testStrategy} onChange={(event) => setRevisionForm({ ...revisionForm, testStrategy: event.target.value })} /></label>
              </>
            ) : (
              <>
                <label>Implementation summary<textarea value={revisionForm.implementation} onChange={(event) => setRevisionForm({ ...revisionForm, implementation: event.target.value })} /></label>
                <label>Split strategy<input value={revisionForm.splitStrategy} onChange={(event) => setRevisionForm({ ...revisionForm, splitStrategy: event.target.value })} /></label>
                <label>Test matrix<textarea value={revisionForm.testMatrix} onChange={(event) => setRevisionForm({ ...revisionForm, testMatrix: event.target.value })} /></label>
                <label>Rollback notes<input value={revisionForm.rollback} onChange={(event) => setRevisionForm({ ...revisionForm, rollback: event.target.value })} /></label>
              </>
            )}
            <button type="submit" disabled={!hasActiveCockpit || loading}>Create {specMode} Revision</button>
          </form>
        </section>

        <section className="panel packages">
          <SectionHeader title="Packages" meta={selectedPackage?.phase ?? 'none'} />
          <div className="button-row">
            <button disabled={!currentPlan?.current_revision_id} onClick={() => packageCommand('Generated packages', () => api.generatePackages(requiredPlanRevisionId()))}>Generate Package</button>
            <button disabled={!selectedPackage} onClick={() => selectedPackage && packageCommand('Marked ready', () => api.markPackageReady(selectedPackage.id, commandBody()))}>Mark Ready</button>
          </div>
          <div className="list tight">
            {packages.length === 0 && <EmptyState text="No execution packages" />}
            {packages.map((pkg) => (
              <button className={`list-row ${pkg.id === selectedPackageId ? 'selected' : ''}`} key={pkg.id} onClick={() => setSelectedPackageId(pkg.id)}>
                <strong>{pkg.objective}</strong>
                <span>{pkg.id}</span>
                <StatusLine item={pkg} />
                {pkg.blocked_reason && <span className="danger-text">{pkg.blocked_reason}</span>}
                {pkg.last_failure_summary && <span className="danger-text">{pkg.last_failure_summary}</span>}
              </button>
            ))}
          </div>
          <form className="stack-form compact" onSubmit={createManualPackage}>
            <div className="form-grid two">
              <label>Repo<input required value={packageForm.repo_id} onChange={(event) => setPackageForm({ ...packageForm, repo_id: event.target.value })} /></label>
              <label>Owner<input value={packageForm.owner_actor_id} onChange={(event) => setPackageForm({ ...packageForm, owner_actor_id: event.target.value })} /></label>
              <label>Reviewer<input value={packageForm.reviewer_actor_id} onChange={(event) => setPackageForm({ ...packageForm, reviewer_actor_id: event.target.value })} /></label>
              <label>QA<input value={packageForm.qa_owner_actor_id} onChange={(event) => setPackageForm({ ...packageForm, qa_owner_actor_id: event.target.value })} /></label>
            </div>
            <label>Objective<textarea required value={packageForm.objective} onChange={(event) => setPackageForm({ ...packageForm, objective: event.target.value })} /></label>
            <label>Required checks<textarea value={packageForm.required_checks} onChange={(event) => setPackageForm({ ...packageForm, required_checks: event.target.value })} /></label>
            <label>Artifact kinds<textarea value={packageForm.required_artifact_kinds} onChange={(event) => setPackageForm({ ...packageForm, required_artifact_kinds: event.target.value })} /></label>
            <label>Allowed paths<textarea value={packageForm.allowed_paths} onChange={(event) => setPackageForm({ ...packageForm, allowed_paths: event.target.value })} /></label>
            <label>Forbidden paths<textarea value={packageForm.forbidden_paths} onChange={(event) => setPackageForm({ ...packageForm, forbidden_paths: event.target.value })} /></label>
            <div className="button-row">
              <button type="submit" disabled={!currentPlan?.current_revision_id || loading}>Create Manual Package</button>
              <button type="button" disabled={!selectedPackage || loading} onClick={updateSelectedPackage}>Update Selected Package</button>
            </div>
          </form>
        </section>

        <section className="panel run-review">
          <SectionHeader title="Run/Review" meta={activeRunDetail?.status ?? activeReviewDetail?.decision ?? 'none'} />
          <div className="form-grid two">
            <label>Run<select value={activeSelectedRunId} onChange={(event) => setSelectedRunId(event.target.value)}>
              <option value="">No run selected</option>
              {runSessions.map((run) => <option key={run.id} value={run.id}>{run.status} / {run.id}</option>)}
            </select></label>
            <label>Review<select value={activeSelectedReviewId} onChange={(event) => setSelectedReviewId(event.target.value)}>
              <option value="">No review selected</option>
              {reviewPackets.map((packet) => <option key={packet.id} value={packet.id}>{packet.decision} / {packet.id}</option>)}
            </select></label>
            <label>Actor<input value={runForm.actor_id} onChange={(event) => setRunForm({ ...runForm, actor_id: event.target.value })} /></label>
            <label>Executor<select value={runForm.executor_type} onChange={(event) => setRunForm({ ...runForm, executor_type: event.target.value as ExecutorType })}>
              <option value="mock">mock</option><option value="local_codex">local_codex</option>
            </select></label>
          </div>
          <label className="checkbox"><input type="checkbox" checked={runForm.workflow_only} onChange={(event) => setRunForm({ ...runForm, workflow_only: event.target.checked })} /> workflow only</label>
          <label>Force reason<input value={runForm.force_reason} onChange={(event) => setRunForm({ ...runForm, force_reason: event.target.value })} /></label>
          <div className="button-row">
            <button disabled={!selectedPackage} onClick={() => runPackage('run')}>Run</button>
            <button disabled={!selectedPackage || !activeSelectedRunId} onClick={() => runPackage('rerun')}>Rerun</button>
            <button disabled={!selectedPackage || !activeSelectedRunId} onClick={() => runPackage('force')}>Force Rerun</button>
          </div>
          <RunConsole
            actorId={selectedRunActorId}
            error={runConsoleError}
            events={runEvents}
            input={runInput}
            now={now}
            onCancel={() => runControlCommand('cancel')}
            onInputChange={setRunInput}
            onResume={() => runControlCommand('resume')}
            onSend={sendRunConsoleInput}
            run={activeRunSummary}
            streamStatus={runStreamStatus}
          />
          <RunDetail run={activeRunDetail} failedChecks={failedChecks} />
          <ReviewDetail review={activeReviewDetail} />
          <div className="review-controls">
            <div className="form-grid two">
              <label>Reviewer<input value={reviewForm.actor_id} onChange={(event) => setReviewForm({ ...reviewForm, actor_id: event.target.value })} /></label>
              <label>Summary<input value={reviewForm.summary} onChange={(event) => setReviewForm({ ...reviewForm, summary: event.target.value })} /></label>
              <label>Change title<input value={reviewForm.change_title} onChange={(event) => setReviewForm({ ...reviewForm, change_title: event.target.value })} /></label>
              <label>File path<input value={reviewForm.change_file_path} onChange={(event) => setReviewForm({ ...reviewForm, change_file_path: event.target.value })} /></label>
            </div>
            <label>Change description<textarea value={reviewForm.change_description} onChange={(event) => setReviewForm({ ...reviewForm, change_description: event.target.value })} /></label>
            <label>Suggested validation<input value={reviewForm.suggested_validation} onChange={(event) => setReviewForm({ ...reviewForm, suggested_validation: event.target.value })} /></label>
            <div className="button-row">
              <button disabled={!activeSelectedReviewId} onClick={() => reviewDecision('approve')}>Approve Review</button>
              <button disabled={!activeSelectedReviewId} onClick={() => reviewDecision('request_changes')}>Request Changes</button>
            </div>
          </div>
        </section>

        <section className="panel timeline">
          <SectionHeader title="Timeline" meta={`${timeline.length} entries`} />
          <div className="timeline-list">
            {timeline.length === 0 && <EmptyState text="No timeline entries" />}
            {timeline.map((entry) => (
              <article key={entry.id} className="timeline-entry">
                <time>{formatDate(entry.created_at)}</time>
                <strong>{entry.summary}</strong>
                <span>{entry.source} / {entry.object_type} / {entry.object_id}</span>
              </article>
            ))}
          </div>
        </section>

        <section className="panel release-owner">
          <SectionHeader title="Release Owner" meta={release?.gate_state ?? 'not loaded'} />
          <form className="release-load-row" onSubmit={loadReleaseCockpit}>
            <label>release_id<input value={releaseId} onChange={(event) => setReleaseId(event.target.value)} placeholder="release_id" /></label>
            <label>project_id<input value={releaseProjectId} onChange={(event) => setReleaseProjectId(event.target.value)} placeholder="project_id" /></label>
            <div className="button-row">
              <button type="submit" disabled={loading || !releaseId.trim()}>Load cockpit</button>
              <button type="button" disabled={loading || !releaseId.trim()} onClick={loadReleaseReplay}>Load replay</button>
            </div>
          </form>

          <div className="release-grid">
            <form className="stack-form compact release-form" onSubmit={submitRelease}>
              <h3>Create release</h3>
              <div className="form-grid two">
                <label>Actor<input required value={releaseForm.actor_id} onChange={(event) => setReleaseForm({ ...releaseForm, actor_id: event.target.value })} /></label>
                <label>Project id<input required value={releaseForm.project_id} onChange={(event) => setReleaseForm({ ...releaseForm, project_id: event.target.value })} /></label>
              </div>
              <label>Title<input required value={releaseForm.title} onChange={(event) => setReleaseForm({ ...releaseForm, title: event.target.value })} /></label>
              <label>Scope summary<textarea value={releaseForm.scope_summary ?? ''} onChange={(event) => setReleaseForm({ ...releaseForm, scope_summary: event.target.value })} /></label>
              <label>Rollout strategy<textarea value={releaseForm.rollout_strategy ?? ''} onChange={(event) => setReleaseForm({ ...releaseForm, rollout_strategy: event.target.value })} /></label>
              <label>Rollback plan<textarea value={releaseForm.rollback_plan ?? ''} onChange={(event) => setReleaseForm({ ...releaseForm, rollback_plan: event.target.value })} /></label>
              <label>Observation plan<textarea value={releaseForm.observation_plan ?? ''} onChange={(event) => setReleaseForm({ ...releaseForm, observation_plan: event.target.value })} /></label>
              <button type="submit" disabled={loading}>Create release</button>
            </form>

            <form className="stack-form compact release-form" onSubmit={patchRelease}>
              <h3>Patch release</h3>
              <label>Actor<input required value={releasePatchForm.actor_id} onChange={(event) => setReleasePatchForm({ ...releasePatchForm, actor_id: event.target.value })} /></label>
              <label>Title<input value={releasePatchForm.title ?? ''} onChange={(event) => setReleasePatchForm({ ...releasePatchForm, title: event.target.value })} /></label>
              <label>Scope summary<textarea value={releasePatchForm.scope_summary ?? ''} onChange={(event) => setReleasePatchForm({ ...releasePatchForm, scope_summary: event.target.value })} /></label>
              <label>Rollout strategy<textarea value={releasePatchForm.rollout_strategy ?? ''} onChange={(event) => setReleasePatchForm({ ...releasePatchForm, rollout_strategy: event.target.value })} /></label>
              <label>Rollback plan<textarea value={releasePatchForm.rollback_plan ?? ''} onChange={(event) => setReleasePatchForm({ ...releasePatchForm, rollback_plan: event.target.value })} /></label>
              <label>Observation plan<textarea value={releasePatchForm.observation_plan ?? ''} onChange={(event) => setReleasePatchForm({ ...releasePatchForm, observation_plan: event.target.value })} /></label>
              <button type="submit" disabled={loading || !releaseId.trim()}>Patch release</button>
            </form>

            <div className="detail-block release-state">
              <h3>State summary</h3>
              {release ? (
                <>
                  <StatusLine item={release} />
                  <span>{release.title}</span>
                  <span>{release.id} / {release.project_id}</span>
                  <pre>{releaseStateText}</pre>
                </>
              ) : <EmptyState text="Load a release cockpit" />}
            </div>
          </div>

          <div className="release-grid">
            <div className="detail-block">
              <h3>Linked WorkItems</h3>
              <ReleaseObjectList
                empty="No linked WorkItems"
                items={(releaseCockpit?.work_items ?? []).map((item) => ({
                  id: item.id,
                  title: item.title,
                  meta: `${item.phase} / ${item.gate_state} / ${item.resolution}`,
                }))}
              />
              <div className="inline-form">
                <input value={releaseLinkForm.work_item_id} onChange={(event) => setReleaseLinkForm({ ...releaseLinkForm, work_item_id: event.target.value })} placeholder="work_item_id" />
                <button type="button" disabled={!releaseLinkForm.work_item_id.trim()} onClick={() => releaseScopeCommand('Linked WorkItem', () => api.linkReleaseWorkItem(activeReleaseId(), releaseLinkForm.work_item_id.trim(), { actor_id: releaseLinkForm.actor_id }))}>Link WorkItem</button>
              </div>
              <div className="inline-form">
                <input value={releaseLinkForm.actor_id} onChange={(event) => setReleaseLinkForm({ ...releaseLinkForm, actor_id: event.target.value })} placeholder="actor_id" />
                <button type="button" disabled={!releaseLinkForm.work_item_id.trim()} onClick={() => releaseScopeCommand('Unlinked WorkItem', () => api.unlinkReleaseWorkItem(activeReleaseId(), releaseLinkForm.work_item_id.trim(), { actor_id: releaseLinkForm.actor_id }))}>Unlink WorkItem</button>
              </div>
            </div>

            <div className="detail-block">
              <h3>ExecutionPackages</h3>
              <ReleaseObjectList
                empty="No linked ExecutionPackages"
                items={(releaseCockpit?.execution_packages ?? []).map((item) => ({
                  id: item.id,
                  title: item.display_title ?? item.objective,
                  meta: `${item.phase} / ${item.gate_state} / ${item.resolution}`,
                }))}
              />
              <div className="inline-form">
                <input value={releaseLinkForm.execution_package_id} onChange={(event) => setReleaseLinkForm({ ...releaseLinkForm, execution_package_id: event.target.value })} placeholder="execution_package_id" />
                <button type="button" disabled={!releaseLinkForm.execution_package_id.trim()} onClick={() => releaseScopeCommand('Linked ExecutionPackage', () => api.linkReleaseExecutionPackage(activeReleaseId(), releaseLinkForm.execution_package_id.trim(), { actor_id: releaseLinkForm.actor_id }))}>Link ExecutionPackage</button>
              </div>
              <div className="inline-form">
                <input value={releaseLinkForm.actor_id} onChange={(event) => setReleaseLinkForm({ ...releaseLinkForm, actor_id: event.target.value })} placeholder="actor_id" />
                <button type="button" disabled={!releaseLinkForm.execution_package_id.trim()} onClick={() => releaseScopeCommand('Unlinked ExecutionPackage', () => api.unlinkReleaseExecutionPackage(activeReleaseId(), releaseLinkForm.execution_package_id.trim(), { actor_id: releaseLinkForm.actor_id }))}>Unlink ExecutionPackage</button>
              </div>
            </div>

            <div className="detail-block release-commands">
              <h3>Commands</h3>
              <div className="form-grid two">
                <label>Actor<input value={releaseDecisionForm.actor_id} onChange={(event) => setReleaseDecisionForm({ ...releaseDecisionForm, actor_id: event.target.value })} /></label>
                <label>Close resolution<select value={releaseDecisionForm.close_resolution} onChange={(event) => setReleaseDecisionForm({ ...releaseDecisionForm, close_resolution: event.target.value as typeof releaseDecisionForm.close_resolution })}>
                  <option value="completed">completed</option><option value="rolled_back">rolled_back</option><option value="cancelled">cancelled</option>
                </select></label>
              </div>
              <label>Rationale<textarea value={releaseDecisionForm.rationale} onChange={(event) => setReleaseDecisionForm({ ...releaseDecisionForm, rationale: event.target.value })} /></label>
              <label>Close summary<input value={releaseDecisionForm.close_summary} onChange={(event) => setReleaseDecisionForm({ ...releaseDecisionForm, close_summary: event.target.value })} /></label>
              <label className="checkbox"><input type="checkbox" checked={releaseDecisionForm.override_without_observation} onChange={(event) => setReleaseDecisionForm({ ...releaseDecisionForm, override_without_observation: event.target.checked })} /> override without observation</label>
              <div className="button-row">
                <button type="button" disabled={!releaseId.trim()} onClick={() => releaseCommand('Submitted release', () => api.submitReleaseForApproval(activeReleaseId(), { actor_id: releaseDecisionForm.actor_id }))}>Submit</button>
                <button type="button" disabled={!releaseId.trim()} onClick={() => releaseCommand('Approved release', () => api.approveRelease(activeReleaseId(), { actor_id: releaseDecisionForm.actor_id, rationale: optionalText(releaseDecisionForm.rationale) }))}>Approve</button>
                <button type="button" disabled={!releaseId.trim() || !releaseCockpit} onClick={() => releaseCommand('Override approved release', () => api.overrideApproveRelease(activeReleaseId(), { actor_id: releaseDecisionForm.actor_id, rationale: releaseDecisionForm.rationale.trim() || 'Release owner accepted overrideable blockers.', blocker_snapshot: releaseCockpit!.blocker_snapshot }))}>Override approve</button>
                <button type="button" disabled={!releaseId.trim()} onClick={() => releaseCommand('Requested release changes', () => api.requestReleaseChanges(activeReleaseId(), { actor_id: releaseDecisionForm.actor_id, rationale: releaseDecisionForm.rationale.trim() || 'Release owner requested changes.' }))}>Request changes</button>
                <button type="button" disabled={!releaseId.trim()} onClick={() => releaseCommand('Started observing release', () => api.startReleaseObserving(activeReleaseId(), { actor_id: releaseDecisionForm.actor_id }))}>Start observing</button>
                <button type="button" disabled={!releaseId.trim()} onClick={() => releaseCommand('Closed release', () => api.closeRelease(activeReleaseId(), cleanCloseReleaseBody(releaseDecisionForm)))}>Close release</button>
              </div>
            </div>
          </div>

          <div className="release-grid">
            <ReleaseBlockersPanel groups={releaseBlockerGroups} />
            <div className="detail-block">
              <h3>Checklist</h3>
              <ReleaseObjectList
                empty="No checklist reported"
                items={(releaseCockpit?.checklist ?? []).map((item) => ({
                  id: item.id,
                  title: `${item.label}: ${item.status}`,
                  meta: item.summary ?? item.blocker_codes.map(releaseNextActionLabel).join(', '),
                }))}
              />
            </div>
            <div className="detail-block">
              <h3>Risk summary</h3>
              <pre>{JSON.stringify(releaseCockpit?.risk_summary ?? {}, null, 2)}</pre>
            </div>
          </div>

          <div className="release-grid">
            <div className="detail-block">
              <h3>Evidence/observations</h3>
              <ReleaseObjectList
                empty="No evidence or observations"
                items={[...(releaseCockpit?.evidences ?? []), ...(releaseCockpit?.observations ?? [])].map((item) => ({
                  id: item.id,
                  title: `${item.evidence_type}: ${item.summary}`,
                  meta: `${item.status}${item.redacted ? ' / redacted' : ''}`,
                }))}
              />
            </div>
            <div className="detail-block">
              <h3>Decisions</h3>
              <ReleaseObjectList
                empty="No decisions"
                items={(releaseCockpit?.decisions ?? []).map((item) => ({
                  id: item.id,
                  title: `${item.decision_type ?? 'decision'}: ${item.decision}`,
                  meta: item.summary,
                }))}
              />
            </div>
            <div className="detail-block">
              <h3>Next actions</h3>
              <PillList values={(releaseCockpit?.next_actions ?? []).map(releaseNextActionLabel)} empty="No release next actions" />
              <h4>Replay</h4>
              <PillList values={releaseReplay.slice(0, 8).map((entry) => `${entry.source}: ${entry.summary}`)} empty="No release replay loaded" />
            </div>
          </div>

          <form className="stack-form compact release-evidence-form" onSubmit={submitObservationEvidence}>
            <h3>Observation evidence</h3>
            <div className="form-grid two">
              <label>Actor<input value={releaseEvidenceForm.actor_id} onChange={(event) => setReleaseEvidenceForm({ ...releaseEvidenceForm, actor_id: event.target.value })} /></label>
              <label>Severity<select value={releaseEvidenceForm.severity} onChange={(event) => setReleaseEvidenceForm({ ...releaseEvidenceForm, severity: event.target.value as typeof releaseEvidenceForm.severity })}>
                <option value="info">info</option><option value="warning">warning</option><option value="failure">failure</option>
              </select></label>
            </div>
            <label>Summary<input required value={releaseEvidenceForm.summary} onChange={(event) => setReleaseEvidenceForm({ ...releaseEvidenceForm, summary: event.target.value })} /></label>
            <label>Observed at<input value={releaseEvidenceForm.observed_at} onChange={(event) => setReleaseEvidenceForm({ ...releaseEvidenceForm, observed_at: event.target.value })} placeholder="ISO timestamp; blank uses now" /></label>
            <label>extra.observation.links<textarea value={releaseEvidenceForm.links} onChange={(event) => setReleaseEvidenceForm({ ...releaseEvidenceForm, links: event.target.value })} /></label>
            <label>Metrics JSON<textarea value={releaseEvidenceForm.metrics} onChange={(event) => setReleaseEvidenceForm({ ...releaseEvidenceForm, metrics: event.target.value })} /></label>
            <label>Notes<textarea value={releaseEvidenceForm.notes} onChange={(event) => setReleaseEvidenceForm({ ...releaseEvidenceForm, notes: event.target.value })} /></label>
            <button type="submit" disabled={loading || !releaseId.trim()}>Submit observation evidence</button>
          </form>
        </section>
      </div>
    </main>
  );
}

function SectionHeader({ title, meta }: { title: string; meta?: string }) {
  return <div className="section-header"><h2>{title}</h2>{meta && <span>{meta}</span>}</div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}

function StatusLine({ item }: { item: { phase?: string; gate_state?: string; activity_state?: string; resolution?: string } }) {
  return <span className="status-line">{item.phase ?? 'phase?'} / {item.gate_state ?? 'gate?'} / {item.activity_state ?? 'activity?'} / {item.resolution ?? 'resolution?'}</span>;
}

function SpecPlanStatusLine({ item }: { item: SpecPlan }) {
  return <span className="status-line">{item.status} / {item.editing_state} / {item.gate_state} / {item.resolution}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

function PillList({ values, empty }: { values: string[]; empty: string }) {
  if (values.length === 0) return <EmptyState text={empty} />;
  return <div className="pill-list">{values.map((value) => <span className="pill" key={value}>{value}</span>)}</div>;
}

function EntitySummary({ title, entity, revisions }: { title: string; entity: SpecPlan | null; revisions: Array<SpecRevision | PlanRevision> }) {
  return (
    <div className="entity-summary">
      <h3>{title}</h3>
      {entity ? <><SpecPlanStatusLine item={entity} /><span>{entity.id}</span><span>current revision: {entity.current_revision_id ?? 'none'}</span></> : <EmptyState text="Not created" />}
      <PillList values={revisions.map((revision) => `r${revision.revision_number}: ${revision.summary}`)} empty="No revisions" />
    </div>
  );
}

function EvidenceChainPanel({ evidenceChain }: { evidenceChain: EvidenceChainResponse | null }) {
  const groups = groupEvidenceChainItems(evidenceChain);

  return (
    <section className="panel evidence-chain" data-testid="evidence-chain">
      <SectionHeader title="Evidence Chain" meta={evidenceChain ? `${evidenceChain.summary.total_items} items` : 'none'} />
      {!evidenceChain ? (
        <EmptyState text="No evidence chain loaded" />
      ) : (
        <>
          <div className="state-grid evidence-metrics">
            {evidenceChainSummaryMetrics(evidenceChain).map((metric) => (
              <Metric key={metric.label} label={metric.label} value={metric.value} />
            ))}
          </div>
          <div className="evidence-meta">
            <span>{evidenceChain.focus.selection} focus</span>
            <span>{evidenceChain.projection.source} v{evidenceChain.projection.version}</span>
            {evidenceChain.projection.partial && <span>partial</span>}
          </div>
          <PillList values={evidenceChain.summary.risk_flags.map((flag) => flag.replace(/_/g, ' '))} empty="No risk flags" />
          <div className="evidence-group-list">
            {groups.length === 0 && <EmptyState text="No evidence items" />}
            {groups.map((group) => (
              <div className="evidence-group" data-testid={`evidence-group-${group.id}`} key={group.id}>
                <h3>{group.label}</h3>
                <div className="evidence-item-list">
                  {group.items.map((item) => (
                    <EvidenceChainRow item={item} key={item.id} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function EvidenceChainRow({ item }: { item: import('./api').EvidenceChainItem }) {
  const display = evidenceChainDisplayItem(item);
  return (
    <article className={`evidence-row ${item.redacted ? 'redacted' : ''}`}>
      <div className="evidence-row-main">
        <strong>{display.summary}</strong>
        <span>{display.sourceLabel} / {display.subjectLabel}</span>
      </div>
      <time>{formatDate(display.createdAt)}</time>
      {display.redactionLabel && <span className="redaction-marker">{display.redactionLabel}</span>}
      <PillList values={[...display.riskLabels, ...display.detailLabels]} empty="No item flags" />
      {display.linkLabels.length > 0 && <span className="evidence-links">{display.linkLabels.join(' | ')}</span>}
    </article>
  );
}

function RunConsole({
  actorId,
  error,
  events,
  input,
  now,
  onCancel,
  onInputChange,
  onResume,
  onSend,
  run,
  streamStatus,
}: {
  actorId: string;
  error: string;
  events: RunEvent[];
  input: string;
  now: number;
  onCancel: () => void;
  onInputChange: (value: string) => void;
  onResume: () => void;
  onSend: (event: FormEvent) => void;
  run: RunSession | null;
  streamStatus: string;
}) {
  const metadata = run?.runtime_metadata;
  const continuationNotice = latestContinuationNotice(events);
  const currentPlanStep = latestPlanStep(events);
  const activeTurnId = latestActiveTurnId(run, events);
  const threadId = metadata?.codex_thread_id ?? latestPayloadString(events, ['thread_id']);
  const lastEventAt = events.at(-1)?.created_at ?? metadata?.last_event_at ?? run?.updated_at;
  const displayEvents = renderableRunEvents(events);

  return (
    <div className="run-console" data-testid="run-console">
      <div className="run-console-head">
        <div>
          <h3>Run Console</h3>
          <span>{run ? run.id : 'No run selected'}</span>
        </div>
        <span className={`stream-pill ${streamStatus}`}>{streamStatus}</span>
      </div>
      <div className="run-console-grid">
        <Metric label="Status" value={run?.status ?? 'none'} />
        <Metric label="Driver" value={`${metadata?.driver_kind ?? run?.executor_type ?? 'unknown'} / ${metadata?.driver_status ?? 'unknown'}`} />
        <Metric label="Danger" value={metadata?.effective_dangerous_mode ?? 'unknown'} />
        <Metric label="Worker Lease" value={workerLeaseLabel(metadata, events)} />
        <Metric label="Thread" value={threadId ?? 'none'} />
        <Metric label="Turn" value={activeTurnId ?? 'none'} />
        <Metric label="Last Event" value={formatAge(lastEventAt, now)} />
        <Metric label="Plan Step" value={currentPlanStep ?? 'none'} />
      </div>
      {continuationNotice && <div className="run-console-notice">{continuationNotice}</div>}
      {error && <div className="run-console-error">{error}</div>}
      <div className="run-event-list" data-testid="run-console-events">
        {displayEvents.length === 0 && <EmptyState text={events.length === 0 ? 'No run events loaded' : 'No visible run events yet'} />}
        {displayEvents.map((event) => <RunEventRow event={event} key={event.id} />)}
      </div>
      <form className="run-input-row" onSubmit={onSend}>
        <label>
          Input as {actorId}
          <textarea
            data-testid="run-console-input"
            value={input}
            onChange={(event) => onInputChange(event.target.value)}
            placeholder="Send input to the active run"
          />
        </label>
        <div className="run-console-actions">
          <button type="submit" data-testid="run-console-send" disabled={!run || !input.trim()}>Send</button>
          <button type="button" data-testid="run-console-cancel" disabled={!run} onClick={onCancel}>Cancel</button>
          <button type="button" data-testid="run-console-resume" disabled={!run} onClick={onResume}>Resume</button>
        </div>
      </form>
    </div>
  );
}

function RunEventRow({ event }: { event: RunEvent }) {
  const type = event.event_type ?? 'event';
  const payload = event.payload ?? {};
  if (type === 'agent_message_delta' || type === 'agent_message_completed') {
    return (
      <article className="run-event-row agent" data-event-cursor={event.cursor}>
        <span>{event.source ?? 'agent'} / {type}</span>
        <p>{payloadText(payload, ['message', 'text', 'content']) || event.summary || 'No message text'}</p>
      </article>
    );
  }
  if (type === 'command_output_delta') {
    return (
      <article className="run-event-row terminal" data-event-cursor={event.cursor}>
        <span>{payloadText(payload, ['command']) || event.summary || 'Command output'}</span>
        <pre>{payloadText(payload, ['text', 'delta', 'output']) || event.summary || ''}</pre>
      </article>
    );
  }
  if (type.startsWith('tool_call') || type.startsWith('command_')) {
    return (
      <article className="run-event-row compact" data-event-cursor={event.cursor}>
        <strong>{type}</strong>
        <span>{payloadText(payload, ['tool', 'tool_name', 'command', 'status']) || event.summary || event.source || 'event'}</span>
      </article>
    );
  }
  return (
    <article className="run-event-row compact" data-event-cursor={event.cursor}>
      <strong>{type}</strong>
      <span>{event.summary || payloadText(payload, ['status', 'message', 'reason']) || event.source || 'event'}</span>
    </article>
  );
}

function RunDetail({ run, failedChecks }: { run: RunSession | null; failedChecks: CheckResult[] }) {
  if (!run) return <EmptyState text="No run detail loaded" />;
  return (
    <div className="detail-block">
      <h3>Run {run.status}</h3>
      <span>{run.id}</span>
      <p>{run.summary || run.failure_reason || 'No summary'}</p>
      <PillList values={(run.changed_files ?? []).map((file) => `${file.change_kind}: ${file.path}`)} empty="No changed files" />
      <h4>Failed checks</h4>
      <PillList values={failedChecks.map((check) => `${check.check_id}: ${check.status}`)} empty="No failed blocking checks" />
      <h4>Artifacts</h4>
      <ArtifactList artifacts={runArtifactsForDetail(run)} />
    </div>
  );
}

function ReviewDetail({ review }: { review: ReviewPacket | null }) {
  if (!review) return <EmptyState text="No review packet loaded" />;
  return (
    <div className="detail-block">
      <h3>Review {review.status} / {review.decision}</h3>
      <span>{review.id}</span>
      <p>{review.summary || review.check_result_summary || 'No review summary'}</p>
      {review.self_review && (
        <div className="self-review">
          <strong>{review.self_review.status}: {review.self_review.summary}</strong>
          <span>{review.self_review.test_assessment}</span>
        </div>
      )}
      <h4>Risk notes</h4>
      <PillList values={[...(review.risk_notes ?? []), ...(review.self_review?.risk_notes ?? [])]} empty="No risk notes" />
      <h4>Requested changes</h4>
      <PillList values={(review.requested_changes ?? []).map((change) => `${change.severity ?? 'change'}: ${change.title}`)} empty="No requested changes" />
    </div>
  );
}

function ArtifactList({ artifacts }: { artifacts: ArtifactRef[] }) {
  const visibleArtifacts = visibleRunArtifacts(artifacts);
  if (visibleArtifacts.length === 0) return <EmptyState text="No artifacts" />;
  return (
    <div className="artifact-list">
      {visibleArtifacts.map((artifact, index) => (
        <span key={`${artifact.name ?? artifact.kind ?? 'artifact'}-${index}`}>{runArtifactDisplayLabel(artifact)}</span>
      ))}
    </div>
  );
}

function ReleaseObjectList({ empty, items }: { empty: string; items: Array<{ id: string; title: string; meta?: string }> }) {
  if (items.length === 0) return <EmptyState text={empty} />;
  return (
    <div className="release-object-list">
      {items.map((item) => (
        <article className="release-object-row" key={item.id}>
          <strong>{item.title}</strong>
          <span>{item.id}</span>
          {item.meta && <span>{item.meta}</span>}
        </article>
      ))}
    </div>
  );
}

function ReleaseBlockersPanel({ groups }: { groups: ReturnType<typeof groupReleaseBlockers> }) {
  return (
    <div className="detail-block">
      <h3>Blockers</h3>
      {groups.length === 0 ? <EmptyState text="No blockers reported" /> : groups.map((group) => (
        <div className="release-blocker-group" key={group.id}>
          <h4>{group.label}</h4>
          <ReleaseObjectList
            empty="No blockers"
            items={group.blockers.map((blocker) => ({
              id: blocker.code,
              title: blocker.message,
              meta: `${blocker.overrideable ? 'overrideable' : 'blocking'}${blocker.object_id ? ` / ${blocker.object_type}:${blocker.object_id}` : ''}`,
            }))}
          />
        </div>
      ))}
    </div>
  );
}

function defaultRevisionForm(mode: SpecPlanMode) {
  return {
    summary: mode === 'spec' ? 'Minimum P0 workbench' : 'Implement workbench UI and API client',
    content: mode === 'spec' ? 'Single-screen operational browser workbench for the P0 delivery loop.' : 'Build a compact React workbench wired to the P0 control-plane API.',
    actor: actorDefault,
    background: 'Operators need one dense place to inspect and advance P0 objects.',
    goals: 'Create and inspect P0 objects\nTrigger workflow actions\nRender timeline and evidence',
    acceptance: 'Work item can be created\nSpec and plan can be approved\nPackage can be run and reviewed',
    testStrategy: 'pnpm --filter @forgeloop/web build',
    implementation: 'Add typed API client, stateful workbench screen, and compact CSS.',
    splitStrategy: 'Single package for P0 dogfood.',
    testMatrix: 'pnpm test tests/web/api.test.ts\npnpm --filter @forgeloop/web build',
    rollback: 'Revert the web app changes.',
  };
}

function toSpecRevision(form: ReturnType<typeof defaultRevisionForm>): CreateSpecRevisionBody {
  return {
    summary: form.summary,
    content: form.content,
    background: form.background || form.content,
    goals: lines(form.goals),
    scope_in: ['P0 browser workbench'],
    scope_out: ['Backend service changes'],
    acceptance_criteria: lines(form.acceptance),
    risk_notes: [],
    test_strategy_summary: form.testStrategy,
    ...(form.actor.trim() ? { author_actor_id: form.actor.trim() } : {}),
  };
}

function toPlanRevision(form: ReturnType<typeof defaultRevisionForm>): CreatePlanRevisionBody {
  return {
    summary: form.summary,
    content: form.content,
    implementation_summary: form.implementation,
    split_strategy: form.splitStrategy,
    dependency_order: [],
    test_matrix: lines(form.testMatrix),
    risk_mitigations: [],
    rollback_notes: form.rollback,
    ...(form.actor.trim() ? { author_actor_id: form.actor.trim() } : {}),
  };
}

function toPackageForm(body: CreateExecutionPackageBody) {
  return {
    ...body,
    required_checks: body.required_checks.map((check) => `${check.check_id}|${check.display_name}|${check.command}|${check.timeout_seconds}|${check.blocks_review}`).join('\n'),
    required_artifact_kinds: body.required_artifact_kinds.join('\n'),
    allowed_paths: body.allowed_paths.join('\n'),
    forbidden_paths: body.forbidden_paths.join('\n'),
  };
}

function parsePackageForm(form: ReturnType<typeof toPackageForm>): CreateExecutionPackageBody {
  return {
    repo_id: form.repo_id.trim(),
    objective: form.objective.trim(),
    owner_actor_id: form.owner_actor_id.trim(),
    reviewer_actor_id: form.reviewer_actor_id.trim(),
    qa_owner_actor_id: form.qa_owner_actor_id.trim(),
    required_checks: lines(form.required_checks).map((line) => {
      const [check_id, display_name, command, timeout_seconds, blocks_review] = line.split('|');
      return {
        check_id: check_id?.trim() || 'check',
        display_name: display_name?.trim() || check_id?.trim() || 'Check',
        command: command?.trim() || 'pnpm test',
        timeout_seconds: Number(timeout_seconds) || 600,
        blocks_review: blocks_review?.trim() !== 'false',
      };
    }),
    required_artifact_kinds: parseArtifactKinds(form.required_artifact_kinds),
    allowed_paths: lines(form.allowed_paths),
    forbidden_paths: lines(form.forbidden_paths),
  };
}

function parsePackagePatchForm(form: ReturnType<typeof toPackageForm>): PatchExecutionPackageBody {
  const body = parsePackageForm(form);
  return {
    objective: body.objective,
    owner_actor_id: body.owner_actor_id,
    reviewer_actor_id: body.reviewer_actor_id,
    qa_owner_actor_id: body.qa_owner_actor_id,
    required_checks: body.required_checks,
    required_artifact_kinds: body.required_artifact_kinds,
    allowed_paths: body.allowed_paths,
    forbidden_paths: body.forbidden_paths,
  };
}

function parseArtifactKinds(value: string): ArtifactKind[] {
  const allowed = new Set<ArtifactKind>(['diff', 'changed_files', 'check_output', 'logs', 'execution_summary', 'self_review', 'review_packet', 'raw_metadata']);
  const parsed = lines(value).filter((kind): kind is ArtifactKind => allowed.has(kind as ArtifactKind));
  return parsed.length > 0 ? parsed : artifactKinds;
}

function cleanWorkItem(body: CreateWorkItemBody): CreateWorkItemBody {
  return { ...body, success_criteria: body.success_criteria.filter(Boolean) };
}

function cleanReleaseCreate(form: CreateReleaseBody): CreateReleaseBody {
  return compactObject({
    ...form,
    actor_id: form.actor_id.trim(),
    project_id: form.project_id.trim(),
    title: form.title.trim(),
    scope_summary: form.scope_summary?.trim(),
    rollout_strategy: form.rollout_strategy?.trim(),
    rollback_plan: form.rollback_plan?.trim(),
    observation_plan: form.observation_plan?.trim(),
  });
}

function cleanReleasePatch(form: PatchReleaseBody): PatchReleaseBody {
  return compactObject({
    ...form,
    actor_id: form.actor_id.trim(),
    title: form.title?.trim(),
    scope_summary: form.scope_summary?.trim(),
    rollout_strategy: form.rollout_strategy?.trim(),
    rollback_plan: form.rollback_plan?.trim(),
    observation_plan: form.observation_plan?.trim(),
  });
}

function cleanCloseReleaseBody(form: typeof releaseDecisionFormTemplate) {
  return compactObject({
    actor_id: form.actor_id.trim(),
    resolution: form.close_resolution,
    summary: form.close_summary.trim(),
    override_without_observation: form.override_without_observation,
    override_rationale: form.override_without_observation ? form.rationale.trim() || 'Release owner override.' : undefined,
  });
}

function toObservationEvidenceBody(form: typeof releaseEvidenceFormTemplate, releaseId: string): CreateReleaseEvidenceBody {
  const metrics = parseOptionalJsonRecord(form.metrics);
  const notes = optionalText(form.notes);
  const input = {
    actorId: form.actor_id.trim() || actorDefault,
    summary: form.summary.trim(),
    severity: form.severity,
    observedAt: form.observed_at.trim() || new Date().toISOString(),
    links: parseReleaseObservationLinks(form.links, releaseId),
  };
  return buildObservationEvidencePayload({
    ...input,
    ...(metrics ? { metrics } : {}),
    ...(notes ? { notes } : {}),
  });
}

function parseReleaseObservationLinks(value: string, releaseId: string): ReleaseEvidenceObjectRef[] {
  const parsed = lines(value.replaceAll('||', `|${releaseId}|`)).map((line) => {
    const [object_type, object_id, relationship] = line.split('|').map((part) => part.trim());
    return { object_type, object_id, relationship };
  });
  return parsed.filter((link): link is ReleaseEvidenceObjectRef =>
    Boolean(link.object_type && link.object_id && link.relationship),
  );
}

function parseOptionalJsonRecord(value: string): Record<string, string | number | boolean | null> | undefined {
  if (!value.trim()) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Metrics JSON must be an object.');
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(parsed)) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' || item === null) output[key] = item;
  }
  return output;
}

function optionalText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== '')) as T;
}

function toRequestedChange(form: typeof reviewFormTemplate): RequestedChange {
  const change: RequestedChange = {
    title: form.change_title.trim() || 'Changes requested',
    description: form.change_description.trim() || form.summary.trim() || 'Please address the review feedback.',
  };
  if (form.change_severity) change.severity = form.change_severity as NonNullable<RequestedChange['severity']>;
  if (form.change_file_path.trim()) change.file_path = form.change_file_path.trim();
  if (form.suggested_validation.trim()) change.suggested_validation = form.suggested_validation.trim();
  return change;
}

const reviewFormTemplate = {
  actor_id: reviewerDefault,
  summary: '',
  change_title: '',
  change_description: '',
  change_file_path: '',
  change_severity: 'major',
  suggested_validation: '',
};

const releaseDecisionFormTemplate = {
  actor_id: reviewerDefault,
  rationale: '',
  close_resolution: 'completed' as 'completed' | 'rolled_back' | 'cancelled',
  close_summary: '',
  override_without_observation: false,
};

const releaseEvidenceFormTemplate = {
  actor_id: actorDefault,
  summary: '',
  severity: 'info' as 'info' | 'warning' | 'failure',
  observed_at: '',
  links: 'release||observed',
  metrics: '',
  notes: '',
};

function lines(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean);
}

function getNestedString(source: Record<string, unknown>, path: string[]) {
  let cursor: unknown = source;
  for (const key of path) {
    if (!cursor || typeof cursor !== 'object' || !(key in cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === 'string' ? cursor : undefined;
}

function payloadText(payload: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return undefined;
}

function latestPayloadString(events: RunEvent[], keys: string[]) {
  for (const event of [...events].reverse()) {
    const value = payloadText(event.payload ?? {}, keys);
    if (value) return value;
  }
  return undefined;
}

function latestActiveTurnId(run: RunSession | null, events: RunEvent[]) {
  return run?.runtime_metadata?.active_turn_id ?? latestPayloadString(events, ['active_turn_id', 'turn_id', 'turnId']);
}

function formatAge(value: string | undefined, now: number) {
  if (!value) return 'none';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const seconds = Math.max(0, Math.floor((now - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDate(value?: string) {
  if (!value) return 'unknown';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
