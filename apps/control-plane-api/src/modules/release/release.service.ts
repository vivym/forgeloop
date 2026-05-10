import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type {
  ApproveReleaseRequest,
  CloseReleaseRequest,
  CreateReleaseEvidenceRequest,
  CreateReleaseRequest,
  LinkReleaseObjectResponse,
  OverrideApproveReleaseRequest,
  PatchReleaseRequest,
  ReleaseControlResponse,
  ReleaseListQuery,
  ReleaseListResponse,
  ReleaseResourceQuery,
  ReleaseResourceResponse,
  RequestReleaseChangesRequest,
  StartReleaseObservingRequest,
  SubmitReleaseForApprovalRequest,
  UnlinkReleaseObjectRequest,
} from '@forgeloop/contracts';
import {
  releaseControlResponseSchema,
  releaseListResponseSchema,
  releaseResourceResponseSchema,
} from '@forgeloop/contracts';
import {
  createReleaseBlockerSnapshot,
  deriveReleaseBlockers,
  deriveReleaseNextActions,
  isReleaseBlockerSnapshotInternallyConsistent,
  transitionRelease,
  DomainError,
  type Decision,
  type ExecutionPackage,
  type ObjectEvent,
  type Release,
  type ReleaseBlocker,
  type ReleaseBlockerSnapshot,
  type ReleaseEvidence,
  type ReleaseGateContext,
  type ReleasePublicLinkVisibility,
  type ReleaseTransition,
  type ReleaseTransitionResult,
  type ReviewPacket,
  type RunSession,
  type StatusHistory,
  type WorkItem,
} from '@forgeloop/domain';
import type { P0Repository } from '@forgeloop/db';
import { serializePublicArtifactRef, serializePublicDecision } from '@forgeloop/db';

import { P0_REPOSITORY, RUN_DURABILITY_MODE, type RunDurabilityMode } from '../../p0/p0.service';
import {
  publicReleaseSummaryFor,
  resolveReleaseExecutionPackageLinks,
  resolveReleaseWorkItemLinks,
  resolvedReleaseExecutionPackages,
  resolvedReleaseWorkItems,
} from './release-serialization';

type ReleaseActorCommand = { actor_id: string };
type ReleaseMutationEventType =
  | 'release_created'
  | 'release_patched'
  | 'release_work_item_linked'
  | 'release_work_item_unlinked'
  | 'release_execution_package_linked'
  | 'release_execution_package_unlinked'
  | 'release_submitted_for_approval'
  | 'release_approved'
  | 'release_override_approved'
  | 'release_changes_requested'
  | 'release_evidence_created'
  | 'release_observing_started'
  | 'release_closed';

type EvidenceExtra = NonNullable<CreateReleaseEvidenceRequest['extra']>;
type DecisionPersistenceOptions = { reason?: string; summary?: string };
type DecisionPersistenceOptionsFor = (
  intent: ReleaseTransitionResult['decision_intents'][number],
) => DecisionPersistenceOptions | undefined;

const lifecycleFields: Array<keyof Release> = [
  'title',
  'scope_summary',
  'rollout_strategy',
  'rollback_plan',
  'observation_plan',
  'phase',
  'activity_state',
  'gate_state',
  'resolution',
  'work_item_ids',
  'execution_package_ids',
  'updated_by_actor_id',
  'closed_at',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

const valueForHistory = (value: unknown): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return Array.isArray(value) || isRecord(value) ? JSON.stringify(value) : String(value);
};

const sameValue = (left: unknown, right: unknown): boolean => valueForHistory(left) === valueForHistory(right);
const uuidBackedIdPrefixes = new Set(['release', 'release-evidence', 'decision']);

@Injectable()
export class ReleaseService {
  private idCounter = 0;
  private timeCounter = 0;
  private durableTimeMs = 0;
  private readonly durableInstanceId = randomUUID().replace(/-/g, '').slice(0, 12);

  constructor(
    @Inject(P0_REPOSITORY) private readonly repository: P0Repository,
    @Inject(RUN_DURABILITY_MODE) private readonly durabilityMode: RunDurabilityMode,
  ) {}

  async createRelease(body: CreateReleaseRequest): Promise<ReleaseControlResponse> {
    const project = await this.repository.getProject(body.project_id);
    if (project === undefined) {
      throw new NotFoundException(`Project ${body.project_id} not found`);
    }

    const at = this.now();
    const result = transitionRelease(undefined, {
      type: 'create',
      id: this.id('release'),
      org_id: project.org_id ?? 'org-1',
      project_id: project.id,
      title: body.title,
      ...(body.scope_summary !== undefined ? { scope_summary: body.scope_summary } : {}),
      release_owner_actor_id: body.release_owner_actor_id,
      release_type: body.release_type,
      created_by_actor_id: body.actor_id,
      updated_by_actor_id: body.actor_id,
      at,
    });
    const release: Release = {
      ...result.release,
      key: result.release.key ?? result.release.id,
      ...(body.rollout_strategy !== undefined ? { rollout_strategy: body.rollout_strategy } : {}),
      ...(body.rollback_plan !== undefined ? { rollback_plan: body.rollback_plan } : {}),
      ...(body.observation_plan !== undefined ? { observation_plan: body.observation_plan } : {}),
      updated_at: at,
    };

    await this.repository.saveRelease(release);
    await this.writeObjectEvent('release_created', release, body.actor_id, {});
    await this.writeStatusHistory(undefined, release, body.actor_id);
    return this.controlResponse(release, result.decision_intents, []);
  }

  async listReleases(query: ReleaseListQuery): Promise<ReleaseListResponse> {
    const releases = (await this.repository.listReleasesForProject(query.project_id))
      .filter((release) => release.release_owner_actor_id === (query.release_owner_actor_id ?? release.release_owner_actor_id))
      .filter((release) => release.phase === (query.phase ?? release.phase))
      .filter((release) => release.gate_state === (query.gate_state ?? release.gate_state))
      .filter((release) => release.resolution === (query.resolution ?? release.resolution))
      .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at) || right.id.localeCompare(left.id));

    const start = query.cursor === undefined ? 0 : releases.findIndex((release) => release.id === query.cursor) + 1;
    const pageStart = start <= 0 ? 0 : start;
    const page = releases.slice(pageStart, pageStart + query.limit);
    const hasMore = releases[pageStart + query.limit] !== undefined;
    const summaries = await Promise.all(page.map((release) => publicReleaseSummaryFor(this.repository, release)));

    return releaseListResponseSchema.parse({
      releases: summaries,
      ...(hasMore && page.length > 0 ? { next_cursor: page[page.length - 1]?.id } : {}),
    });
  }

  async getRelease(releaseId: string, query: ReleaseResourceQuery): Promise<ReleaseResourceResponse> {
    const release = await this.getReleaseForProject(releaseId, query.project_id);
    return releaseResourceResponseSchema.parse({ release: await publicReleaseSummaryFor(this.repository, release) });
  }

  async patchRelease(releaseId: string, body: PatchReleaseRequest): Promise<ReleaseControlResponse> {
    const existing = await this.requireRelease(releaseId);
    const result = this.applyTransition(existing, {
      type: 'patch',
      actor_id: body.actor_id,
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.scope_summary !== undefined ? { scope_summary: body.scope_summary } : {}),
      ...(body.rollout_strategy !== undefined ? { rollout_strategy: body.rollout_strategy } : {}),
      ...(body.rollback_plan !== undefined ? { rollback_plan: body.rollback_plan } : {}),
      ...(body.observation_plan !== undefined ? { observation_plan: body.observation_plan } : {}),
      at: this.now(),
    });
    await this.persistTransition(existing, result, body.actor_id, 'release_patched');
    return this.controlResponse(result.release, result.decision_intents, []);
  }

  async linkWorkItem(releaseId: string, workItemId: string, body: ReleaseActorCommand): Promise<LinkReleaseObjectResponse> {
    const release = await this.requireRelease(releaseId);
    const workItem = await this.requireLinkableWorkItem(release, workItemId);
    const result = this.applyTransition(release, {
      type: 'link_work_item',
      work_item_id: workItem.id,
      actor_id: body.actor_id,
      at: this.now(),
    });
    await this.persistTransition(release, result, body.actor_id, 'release_work_item_linked');
    return { release_id: releaseId, object_type: 'work_item', object_id: workItemId, linked: true };
  }

  async unlinkWorkItem(releaseId: string, workItemId: string, body: UnlinkReleaseObjectRequest): Promise<LinkReleaseObjectResponse> {
    const release = await this.requireRelease(releaseId);
    const result = this.applyTransition(release, {
      type: 'unlink_work_item',
      work_item_id: workItemId,
      actor_id: body.actor_id,
      at: this.now(),
    });
    await this.persistTransition(release, result, body.actor_id, 'release_work_item_unlinked');
    return { release_id: releaseId, object_type: 'work_item', object_id: workItemId, linked: false };
  }

  async linkExecutionPackage(releaseId: string, packageId: string, body: ReleaseActorCommand): Promise<LinkReleaseObjectResponse> {
    const release = await this.requireRelease(releaseId);
    const executionPackage = await this.requireLinkableExecutionPackage(release, packageId);
    const result = this.applyTransition(release, {
      type: 'link_execution_package',
      execution_package_id: executionPackage.id,
      actor_id: body.actor_id,
      at: this.now(),
    });
    await this.persistTransition(release, result, body.actor_id, 'release_execution_package_linked');
    return { release_id: releaseId, object_type: 'execution_package', object_id: packageId, linked: true };
  }

  async unlinkExecutionPackage(
    releaseId: string,
    packageId: string,
    body: UnlinkReleaseObjectRequest,
  ): Promise<LinkReleaseObjectResponse> {
    const release = await this.requireRelease(releaseId);
    const result = this.applyTransition(release, {
      type: 'unlink_execution_package',
      execution_package_id: packageId,
      actor_id: body.actor_id,
      at: this.now(),
    });
    await this.persistTransition(release, result, body.actor_id, 'release_execution_package_unlinked');
    return { release_id: releaseId, object_type: 'execution_package', object_id: packageId, linked: false };
  }

  async submitForApproval(releaseId: string, body: SubmitReleaseForApprovalRequest): Promise<ReleaseControlResponse> {
    const release = await this.requireRelease(releaseId);
    const context = await this.gateContext(release);
    const blockers = deriveReleaseBlockers(context);
    if (blockers.some((blocker) => !blocker.overrideable)) {
      throw new UnprocessableEntityException({ message: 'Release has non-overrideable blockers', blockers });
    }
    const result = this.applyTransition(release, {
      type: 'submit',
      gate_context: context,
      actor_id: body.actor_id,
      at: this.now(),
    });
    await this.persistTransition(release, result, body.actor_id, 'release_submitted_for_approval');
    return this.controlResponse(result.release, result.decision_intents, [], result.blocker_snapshot);
  }

  async approveRelease(releaseId: string, body: ApproveReleaseRequest): Promise<ReleaseControlResponse> {
    const release = await this.requireRelease(releaseId);
    const context = await this.gateContext(release);
    const blockers = deriveReleaseBlockers(context);
    if (blockers.length > 0) {
      throw new UnprocessableEntityException({ message: 'Release has blockers', blockers });
    }
    const result = this.applyTransition(release, {
      type: 'approve',
      approved_by_actor_id: body.actor_id,
      gate_context: context,
      at: this.now(),
    });
    await this.persistTransition(release, result, body.actor_id, 'release_approved', {
      payload: body.rationale === undefined ? {} : { rationale: body.rationale },
      decisionOptionsFor: (intent) =>
        intent.decision_type === 'release_approval' && body.rationale !== undefined ? { reason: body.rationale } : undefined,
    });
    return this.controlResponse(result.release, result.decision_intents, [], result.blocker_snapshot);
  }

  async overrideApproveRelease(releaseId: string, body: OverrideApproveReleaseRequest): Promise<ReleaseControlResponse> {
    const requestSnapshot = body.blocker_snapshot as unknown as ReleaseBlockerSnapshot;
    if (!isReleaseBlockerSnapshotInternallyConsistent(requestSnapshot)) {
      throw new ConflictException('Blocker snapshot is stale');
    }
    const release = await this.requireRelease(releaseId);
    const context = await this.gateContext(release);
    const blockers = deriveReleaseBlockers(context);
    const currentSnapshot = createReleaseBlockerSnapshot({
      release_id: release.id,
      generated_at: this.now(),
      blockers,
    });
    if (
      requestSnapshot.release_id !== currentSnapshot.release_id ||
      requestSnapshot.blocker_fingerprint !== currentSnapshot.blocker_fingerprint
    ) {
      throw new ConflictException('Blocker snapshot is stale');
    }
    if (blockers.length === 0 || blockers.some((blocker) => !blocker.overrideable)) {
      throw new UnprocessableEntityException({ message: 'Release blockers are not overrideable', blockers });
    }
    const result = this.applyTransition(
      release,
      {
        type: 'override_approve',
        approved_by_actor_id: body.actor_id,
        rationale: body.rationale,
        blocker_snapshot: requestSnapshot,
        gate_context: context,
        at: currentSnapshot.generated_at,
      },
      new ConflictException('Blocker snapshot is stale'),
    );
    await this.persistTransition(release, result, body.actor_id, 'release_override_approved');
    return this.controlResponse(result.release, result.decision_intents, result.blocker_snapshot?.blockers ?? [], result.blocker_snapshot);
  }

  async requestChanges(releaseId: string, body: RequestReleaseChangesRequest): Promise<ReleaseControlResponse> {
    const release = await this.requireRelease(releaseId);
    const result =
      release.phase === 'approval' && release.gate_state === 'changes_requested'
        ? { release: { ...release, updated_at: this.now(), updated_by_actor_id: body.actor_id }, decision_intents: [] }
        : this.applyTransition(release, {
            type: 'request_changes',
            actor_id: body.actor_id,
            rationale: body.rationale,
            at: this.now(),
          });
    await this.persistTransition(release, result, body.actor_id, 'release_changes_requested');
    if (result.decision_intents.length === 0) {
      await this.persistDecisionIntent({
        object_type: 'release',
        object_id: release.id,
        actor_id: body.actor_id,
        decision_type: 'release_changes_requested',
        outcome: 'changes_requested',
        reason: body.rationale,
      });
    }
    return this.controlResponse(result.release, result.decision_intents, []);
  }

  async createEvidence(releaseId: string, body: CreateReleaseEvidenceRequest): Promise<ReleaseControlResponse> {
    const release = await this.requireRelease(releaseId);
    this.validateEvidenceMinimum(body);
    const at = this.now();
    const extra = this.evidenceExtraWithActor(body.extra, body.actor_id);
    const evidence: ReleaseEvidence = {
      id: this.id('release-evidence'),
      org_id: release.org_id,
      project_id: release.project_id,
      release_id: release.id,
      evidence_type: body.evidence_type,
      summary: body.summary,
      ...(body.object_ref !== undefined ? { object_ref: body.object_ref } : {}),
      ...(body.artifact_id !== undefined ? { artifact_id: body.artifact_id } : {}),
      ...(extra !== undefined ? { extra } : {}),
      redacted: body.redacted,
      status: body.status,
      created_at: at,
      created_by_actor_id: body.actor_id,
      updated_at: at,
      updated_by_actor_id: body.actor_id,
    };
    await this.repository.saveReleaseEvidence(evidence);
    await this.writeObjectEvent('release_evidence_created', release, body.actor_id, {
      release_evidence_id: evidence.id,
      evidence_type: evidence.evidence_type,
    });
    return this.controlResponse(release, [], []);
  }

  async startObserving(releaseId: string, body: StartReleaseObservingRequest): Promise<ReleaseControlResponse> {
    const release = await this.requireRelease(releaseId);
    const result = this.applyTransition(
      release,
      {
        type: 'start_observing',
        actor_id: body.actor_id,
        at: this.now(),
      },
      new ConflictException('Release is not approved for observation'),
    );
    await this.persistTransition(release, result, body.actor_id, 'release_observing_started');
    return this.controlResponse(result.release, result.decision_intents, []);
  }

  async closeRelease(releaseId: string, body: CloseReleaseRequest): Promise<ReleaseControlResponse> {
    const release = await this.requireRelease(releaseId);
    const context = await this.gateContext(release);
    let event: ReleaseTransition;
    let overriddenBlockers: ReleaseBlocker[] = [];

    if (body.resolution === 'completed' && body.override_without_observation) {
      const blockers = deriveReleaseBlockers(context);
      const snapshot = createReleaseBlockerSnapshot({
        release_id: release.id,
        generated_at: this.now(),
        blockers,
      });
      event = {
        type: 'close_override',
        resolution: 'completed',
        actor_id: body.actor_id,
        rationale: body.override_rationale ?? 'Manual observation override',
        blocker_snapshot: snapshot,
        gate_context: context,
        at: snapshot.generated_at,
      };
      overriddenBlockers = snapshot.blockers;
    } else if (body.resolution === 'completed') {
      event = {
        type: 'close',
        resolution: 'completed',
        gate_context: context,
        actor_id: body.actor_id,
        at: this.now(),
      };
    } else {
      event = {
        type: 'close',
        resolution: body.resolution,
        actor_id: body.actor_id,
        at: this.now(),
      };
    }

    const result = this.applyTransition(
      release,
      event,
      body.resolution === 'completed'
        ? new UnprocessableEntityException('Release requires observation evidence before completed close')
        : new ConflictException('Release cannot be closed from its current state'),
    );
    await this.persistTransition(release, result, body.actor_id, 'release_closed', {
      payload: body.summary === undefined ? {} : { summary: body.summary },
      decisionOptionsFor: (intent) =>
        intent.decision_type === 'release_close' && body.summary !== undefined ? { summary: body.summary } : undefined,
    });
    return this.controlResponse(result.release, result.decision_intents, overriddenBlockers, result.blocker_snapshot);
  }

  private async controlResponse(
    release: Release,
    decisionIntents: ReleaseTransitionResult['decision_intents'],
    overriddenBlockers: ReleaseBlocker[],
    blockerSnapshot = undefined as ReleaseTransitionResult['blocker_snapshot'] | undefined,
  ): Promise<ReleaseControlResponse> {
    const context = await this.gateContext(release);
    const blockers = deriveReleaseBlockers(context);
    const snapshot =
      blockerSnapshot ??
      createReleaseBlockerSnapshot({
        release_id: release.id,
        generated_at: release.updated_at,
        blockers,
      });
    return releaseControlResponseSchema.parse({
      release: await publicReleaseSummaryFor(this.repository, release),
      blocker_snapshot: snapshot,
      blockers,
      overridden_blockers: overriddenBlockers,
      decision_intents: decisionIntents,
      next_actions: deriveReleaseNextActions(context),
    });
  }

  private async gateContext(release: Release): Promise<ReleaseGateContext> {
    const [workItemLinks, executionPackageLinks, evidence] = await Promise.all([
      resolveReleaseWorkItemLinks(this.repository, release),
      resolveReleaseExecutionPackageLinks(this.repository, release),
      this.repository.listReleaseEvidences(release.id),
    ]);
    const workItems = resolvedReleaseWorkItems(workItemLinks);
    const executionPackages = resolvedReleaseExecutionPackages(executionPackageLinks);
    const runSessions = (
      await Promise.all(executionPackages.map((executionPackage) => this.repository.listRunSessionsForPackage(executionPackage.id)))
    ).flat();
    const reviewPackets = (
      await Promise.all(executionPackages.map((executionPackage) => this.repository.listReviewPacketsForPackage(executionPackage.id)))
    ).flat();

    return {
      release,
      work_items: workItems,
      work_item_links: workItemLinks,
      execution_packages: executionPackages,
      execution_package_links: executionPackageLinks,
      run_sessions: runSessions,
      review_packets: reviewPackets,
      evidence,
      public_link_visibility: await this.publicLinkVisibility(release, workItems, executionPackages, runSessions, reviewPackets, evidence),
    };
  }

  private async publicLinkVisibility(
    release: Release,
    workItems: readonly WorkItem[],
    executionPackages: readonly ExecutionPackage[],
    runSessions: readonly RunSession[],
    reviewPackets: readonly ReviewPacket[],
    evidence: readonly ReleaseEvidence[],
  ): Promise<ReleasePublicLinkVisibility[]> {
    const workItemIds = new Set(workItems.map((item) => item.id));
    const packageIds = new Set(executionPackages.map((item) => item.id));
    const runSessionIds = new Set(runSessions.map((item) => item.id));
    const reviewPacketIds = new Set(reviewPackets.map((item) => item.id));
    const evidenceIds = new Set(evidence.map((item) => item.id));
    const decisionIds = new Set(
      (await this.repository.listDecisionsForObject('release', release.id)).flatMap((decision) => {
        try {
          return [serializePublicDecision(decision).id];
        } catch {
          return [];
        }
      }),
    );
    const publicArtifactIds = new Set(
      (
        await Promise.all(
          evidence.map(async (item) => {
            if (item.artifact_id === undefined) {
              return [];
            }
            const artifacts = await this.repository.listArtifactsForObject('release_evidence', item.id);
            const artifact = artifacts.find((candidate) => candidate.id === item.artifact_id) ?? artifacts[0];
            return artifact !== undefined && serializePublicArtifactRef(artifact.ref) !== undefined ? [item.artifact_id] : [];
          }),
        )
      ).flat(),
    );
    const visibility = new Map<string, ReleasePublicLinkVisibility>();

    for (const item of evidence) {
      const observation = isRecord(item.extra) ? item.extra.observation : undefined;
      const links = isRecord(observation) && Array.isArray(observation.links) ? observation.links : [];
      for (const link of links) {
        if (!isRecord(link) || !hasText(link.object_type) || !hasText(link.object_id)) {
          continue;
        }
        const isPublic =
          (link.object_type === 'release' && link.object_id === release.id) ||
          (link.object_type === 'work_item' && workItemIds.has(link.object_id)) ||
          (link.object_type === 'execution_package' && packageIds.has(link.object_id)) ||
          (link.object_type === 'run_session' && runSessionIds.has(link.object_id)) ||
          (link.object_type === 'review_packet' && reviewPacketIds.has(link.object_id)) ||
          (link.object_type === 'release_evidence' && evidenceIds.has(link.object_id)) ||
          (link.object_type === 'artifact' && publicArtifactIds.has(link.object_id)) ||
          (link.object_type === 'decision' && decisionIds.has(link.object_id));
        visibility.set(`${link.object_type}\0${link.object_id}`, {
          object_type: link.object_type,
          object_id: link.object_id,
          public: isPublic,
        });
      }
    }

    return [...visibility.values()];
  }

  private validateEvidenceMinimum(body: CreateReleaseEvidenceRequest): void {
    const extra = body.extra;
    const observation = extra?.observation;
    const hasArtifactEvidence = body.artifact_id !== undefined || body.object_ref?.object_type === 'artifact';
    switch (body.evidence_type) {
      case 'review_packet':
        if (body.object_ref?.object_type !== 'review_packet') {
          throw new BadRequestException('review_packet evidence requires object_ref.object_type=review_packet');
        }
        return;
      case 'test_report':
        if (!hasArtifactEvidence && (extra?.check_refs === undefined || extra.check_refs.length === 0)) {
          throw new BadRequestException('test_report evidence requires artifact_id or extra.check_refs');
        }
        return;
      case 'build': {
        const build = isRecord(extra?.build) ? extra.build : undefined;
        const hasIdentity =
          hasText(build?.build_id) || hasText(build?.version) || hasText(build?.commit_sha) || hasText(build?.source_branch);
        if (!hasArtifactEvidence && !(hasIdentity && hasText(build?.result))) {
          throw new BadRequestException('build evidence requires build identity/status or artifact_id');
        }
        return;
      }
      case 'deployment': {
        const deployment = isRecord(extra?.deployment) ? extra.deployment : undefined;
        if (!hasText(deployment?.environment) || !hasText(deployment?.result)) {
          throw new BadRequestException('deployment evidence requires environment and rollout status');
        }
        return;
      }
      case 'metric_snapshot':
        if (!isRecord(observation?.metrics) || Object.keys(observation.metrics).length === 0) {
          throw new BadRequestException('metric_snapshot evidence requires observation metrics');
        }
        return;
      case 'rollback_record':
        if (!isRecord(extra?.rollback) || Object.keys(extra.rollback).length === 0) {
          throw new BadRequestException('rollback_record evidence requires rollback metadata');
        }
        return;
      case 'observation_note':
        if (
          observation === undefined ||
          !hasText(observation.source) ||
          !hasText(observation.severity) ||
          !hasText(observation.observed_at) ||
          !hasText(observation.summary)
        ) {
          throw new BadRequestException('observation_note evidence requires source, severity, observed_at, and summary');
        }
        return;
    }
  }

  private evidenceExtraWithActor(extra: EvidenceExtra | undefined, actorId: string): Record<string, unknown> | undefined {
    if (extra === undefined) {
      return undefined;
    }
    if (extra.observation === undefined || extra.observation.actor_id !== undefined) {
      return extra;
    }
    return {
      ...extra,
      observation: {
        ...extra.observation,
        actor_id: actorId,
      },
    };
  }

  private async requireLinkableWorkItem(release: Release, workItemId: string): Promise<WorkItem> {
    const workItem = await this.repository.getWorkItem(workItemId);
    if (workItem === undefined) {
      throw new NotFoundException(`WorkItem ${workItemId} not found`);
    }
    if (workItem.project_id !== release.project_id) {
      throw new UnprocessableEntityException(`WorkItem ${workItemId} is not in the release project`);
    }
    if (workItem.archived_at !== undefined || workItem.deleted_at !== undefined) {
      throw new UnprocessableEntityException(`WorkItem ${workItemId} is not linkable`);
    }
    return workItem;
  }

  private async requireLinkableExecutionPackage(release: Release, packageId: string): Promise<ExecutionPackage> {
    const executionPackage = await this.repository.getExecutionPackage(packageId);
    if (executionPackage === undefined) {
      throw new NotFoundException(`ExecutionPackage ${packageId} not found`);
    }
    if (executionPackage.project_id !== release.project_id) {
      throw new UnprocessableEntityException(`ExecutionPackage ${packageId} is not in the release project`);
    }
    if (executionPackage.archived_at !== undefined || executionPackage.deleted_at !== undefined) {
      throw new UnprocessableEntityException(`ExecutionPackage ${packageId} is not linkable`);
    }
    return executionPackage;
  }

  private async getReleaseForProject(releaseId: string, projectId: string): Promise<Release> {
    const release = await this.repository.getRelease(releaseId);
    if (release === undefined || release.project_id !== projectId) {
      throw new NotFoundException(`Release ${releaseId} not found`);
    }
    return release;
  }

  private async requireRelease(releaseId: string): Promise<Release> {
    const release = await this.repository.getRelease(releaseId);
    if (release === undefined) {
      throw new NotFoundException(`Release ${releaseId} not found`);
    }
    return release;
  }

  private applyTransition(
    release: Release | undefined,
    event: ReleaseTransition,
    invalidTransitionException: Error = new ConflictException('Invalid release transition'),
  ): ReleaseTransitionResult {
    try {
      return transitionRelease(release, event);
    } catch (error) {
      if (error instanceof DomainError && error.code === 'INVALID_TRANSITION') {
        throw invalidTransitionException;
      }
      throw error;
    }
  }

  private async persistTransition(
    before: Release,
    result: Pick<ReleaseTransitionResult, 'release' | 'decision_intents'>,
    actorId: string,
    eventType: ReleaseMutationEventType,
    options: { payload?: Record<string, unknown>; decisionOptionsFor?: DecisionPersistenceOptionsFor } = {},
  ): Promise<void> {
    await this.repository.saveRelease(result.release);
    await this.writeObjectEvent(eventType, result.release, actorId, options.payload ?? {});
    await this.writeStatusHistory(before, result.release, actorId);
    await Promise.all(
      result.decision_intents.map((intent) => this.persistDecisionIntent(intent, options.decisionOptionsFor?.(intent))),
    );
  }

  private async persistDecisionIntent(
    intent: ReleaseTransitionResult['decision_intents'][number],
    options: DecisionPersistenceOptions = {},
  ): Promise<void> {
    const reason = options.reason ?? intent.reason;
    const decision: Decision = {
      id: this.id('decision'),
      object_type: intent.object_type,
      object_id: intent.object_id,
      actor_id: intent.actor_id,
      decided_by_actor_id: intent.actor_id,
      decision_type: intent.decision_type,
      outcome: intent.outcome,
      decision: intent.outcome,
      summary: options.summary ?? reason ?? intent.outcome,
      ...(reason !== undefined ? { rationale: reason } : {}),
      ...(intent.blocker_snapshot !== undefined ? { evidence_refs: { blocker_snapshot: intent.blocker_snapshot } } : {}),
      created_at: this.now(),
    };
    await this.repository.saveDecision(decision);
  }

  private async writeObjectEvent(
    eventType: ReleaseMutationEventType,
    release: Release,
    actorId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const event: ObjectEvent = {
      id: this.id('object-event'),
      object_type: 'release',
      object_id: release.id,
      event_type: eventType,
      actor_type: 'human',
      actor_id: actorId,
      metadata: {},
      payload,
      created_at: this.now(),
    };
    await this.repository.appendObjectEvent(event);
  }

  private async writeStatusHistory(before: Release | undefined, after: Release, actorId: string): Promise<void> {
    const entries: StatusHistory[] = lifecycleFields.flatMap((field) => {
      const beforeValue = before?.[field];
      const afterValue = after[field];
      if (before !== undefined && sameValue(beforeValue, afterValue)) {
        return [];
      }
      const toValue = valueForHistory(afterValue);
      if (toValue === undefined) {
        return [];
      }
      const fromValue = valueForHistory(beforeValue);
      const entry: StatusHistory = {
        id: this.id('status-history'),
        object_type: 'release',
        object_id: after.id,
        field_name: field,
        ...(fromValue !== undefined ? { from_value: fromValue } : {}),
        to_status: toValue,
        to_value: toValue,
        actor_type: 'human',
        actor_id: actorId,
        created_at: this.now(),
      };
      return [entry];
    });
    await Promise.all(entries.map((entry) => this.repository.appendStatusHistory(entry)));
  }

  private id(prefix: string): string {
    this.idCounter += 1;
    if (this.durabilityMode === 'durable' && uuidBackedIdPrefixes.has(prefix)) {
      return randomUUID();
    }
    if (this.durabilityMode === 'durable') {
      return `${prefix}-${this.durableInstanceId}-${this.idCounter}`;
    }
    return `${prefix}-${this.idCounter}`;
  }

  private now(): string {
    if (this.durabilityMode === 'durable') {
      const current = Date.now();
      this.durableTimeMs = current > this.durableTimeMs ? current : this.durableTimeMs + 1;
      return new Date(this.durableTimeMs).toISOString();
    }

    this.timeCounter += 1;
    return new Date(Date.UTC(2026, 4, 5, 0, 0, this.timeCounter)).toISOString();
  }
}
