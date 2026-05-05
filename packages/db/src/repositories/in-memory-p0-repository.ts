import type {
  Artifact,
  Decision,
  ExecutionPackage,
  ExecutionPackageDependency,
  ObjectEvent,
  Plan,
  PlanRevision,
  Project,
  ProjectRepo,
  ReviewPacket,
  RunSession,
  Spec,
  SpecRevision,
  StatusHistory,
  WorkItem,
} from '@forgeloop/domain';

import type { P0Repository } from './p0-repository';

const clone = <T>(value: T): T => structuredClone(value);

const valuesFor = <T>(records: Map<string, T>): T[] => [...records.values()].map(clone);

const byCreatedAt = <T extends { created_at: string }>(left: T, right: T) => left.created_at.localeCompare(right.created_at);

export class InMemoryP0Repository implements P0Repository {
  private readonly projects = new Map<string, Project>();
  private readonly projectRepos = new Map<string, ProjectRepo>();
  private readonly workItems = new Map<string, WorkItem>();
  private readonly specs = new Map<string, Spec>();
  private readonly specRevisions = new Map<string, SpecRevision>();
  private readonly plans = new Map<string, Plan>();
  private readonly planRevisions = new Map<string, PlanRevision>();
  private readonly executionPackages = new Map<string, ExecutionPackage>();
  private readonly executionPackageDependencies = new Map<string, ExecutionPackageDependency>();
  private readonly runSessions = new Map<string, RunSession>();
  private readonly reviewPackets = new Map<string, ReviewPacket>();
  private readonly objectEvents = new Map<string, ObjectEvent>();
  private readonly statusHistories = new Map<string, StatusHistory>();
  private readonly artifacts = new Map<string, Artifact>();
  private readonly decisions = new Map<string, Decision>();

  async saveProject(project: Project): Promise<void> {
    this.projects.set(project.id, clone(project));
  }

  async getProject(projectId: string): Promise<Project | undefined> {
    return this.cloneMaybe(this.projects.get(projectId));
  }

  async saveProjectRepo(projectRepo: ProjectRepo): Promise<void> {
    this.projectRepos.set(projectRepo.id, clone(projectRepo));
  }

  async listProjectRepos(projectId: string): Promise<ProjectRepo[]> {
    return valuesFor(this.projectRepos).filter((projectRepo) => projectRepo.project_id === projectId);
  }

  async saveWorkItem(workItem: WorkItem): Promise<void> {
    this.workItems.set(workItem.id, clone(workItem));
  }

  async getWorkItem(workItemId: string): Promise<WorkItem | undefined> {
    return this.cloneMaybe(this.workItems.get(workItemId));
  }

  async listWorkItems(projectId?: string): Promise<WorkItem[]> {
    const workItems = valuesFor(this.workItems);
    return projectId === undefined ? workItems : workItems.filter((workItem) => workItem.project_id === projectId);
  }

  async saveSpec(spec: Spec): Promise<void> {
    this.specs.set(spec.id, clone(spec));
  }

  async getSpec(specId: string): Promise<Spec | undefined> {
    return this.cloneMaybe(this.specs.get(specId));
  }

  async saveSpecRevision(specRevision: SpecRevision): Promise<void> {
    this.specRevisions.set(specRevision.id, clone(specRevision));
  }

  async listSpecRevisions(specId: string): Promise<SpecRevision[]> {
    return valuesFor(this.specRevisions)
      .filter((specRevision) => specRevision.spec_id === specId)
      .sort((left, right) => left.revision_number - right.revision_number);
  }

  async savePlan(plan: Plan): Promise<void> {
    this.plans.set(plan.id, clone(plan));
  }

  async getPlan(planId: string): Promise<Plan | undefined> {
    return this.cloneMaybe(this.plans.get(planId));
  }

  async savePlanRevision(planRevision: PlanRevision): Promise<void> {
    this.planRevisions.set(planRevision.id, clone(planRevision));
  }

  async listPlanRevisions(planId: string): Promise<PlanRevision[]> {
    return valuesFor(this.planRevisions)
      .filter((planRevision) => planRevision.plan_id === planId)
      .sort((left, right) => left.revision_number - right.revision_number);
  }

  async saveExecutionPackage(executionPackage: ExecutionPackage): Promise<void> {
    this.executionPackages.set(executionPackage.id, clone(executionPackage));
  }

  async getExecutionPackage(executionPackageId: string): Promise<ExecutionPackage | undefined> {
    return this.cloneMaybe(this.executionPackages.get(executionPackageId));
  }

  async listExecutionPackagesForWorkItem(workItemId: string): Promise<ExecutionPackage[]> {
    return valuesFor(this.executionPackages).filter((executionPackage) => executionPackage.work_item_id === workItemId);
  }

  async saveExecutionPackageDependency(dependency: ExecutionPackageDependency): Promise<void> {
    this.executionPackageDependencies.set(this.dependencyKey(dependency), clone(dependency));
  }

  async listExecutionPackageDependencies(executionPackageId: string): Promise<ExecutionPackageDependency[]> {
    return valuesFor(this.executionPackageDependencies).filter(
      (dependency) => dependency.package_id === executionPackageId,
    );
  }

  async saveRunSession(runSession: RunSession): Promise<void> {
    this.runSessions.set(runSession.id, clone(runSession));
  }

  async getRunSession(runSessionId: string): Promise<RunSession | undefined> {
    return this.cloneMaybe(this.runSessions.get(runSessionId));
  }

  async listRunSessionsForPackage(executionPackageId: string): Promise<RunSession[]> {
    return valuesFor(this.runSessions)
      .filter((runSession) => runSession.execution_package_id === executionPackageId)
      .sort(byCreatedAt);
  }

  async saveReviewPacket(reviewPacket: ReviewPacket): Promise<void> {
    this.reviewPackets.set(reviewPacket.id, clone(reviewPacket));
  }

  async getReviewPacket(reviewPacketId: string): Promise<ReviewPacket | undefined> {
    return this.cloneMaybe(this.reviewPackets.get(reviewPacketId));
  }

  async listReviewPacketsForPackage(executionPackageId: string): Promise<ReviewPacket[]> {
    return valuesFor(this.reviewPackets)
      .filter((reviewPacket) => reviewPacket.execution_package_id === executionPackageId)
      .sort(byCreatedAt);
  }

  async findOpenReviewPacketForPackage(executionPackageId: string): Promise<ReviewPacket | undefined> {
    const openReviewPacket = valuesFor(this.reviewPackets)
      .filter(
        (reviewPacket) =>
          reviewPacket.execution_package_id === executionPackageId &&
          reviewPacket.status !== 'completed' &&
          reviewPacket.status !== 'archived',
      )
      .sort(byCreatedAt)[0];

    return this.cloneMaybe(openReviewPacket);
  }

  async appendObjectEvent(objectEvent: ObjectEvent): Promise<void> {
    if (!this.objectEvents.has(objectEvent.id)) {
      this.objectEvents.set(objectEvent.id, clone(objectEvent));
    }
  }

  async listObjectEvents(objectId: string, objectType?: string): Promise<ObjectEvent[]> {
    return valuesFor(this.objectEvents)
      .filter(
        (objectEvent) =>
          objectEvent.object_id === objectId && (objectType === undefined || objectEvent.object_type === objectType),
      )
      .sort(byCreatedAt);
  }

  async appendStatusHistory(statusHistory: StatusHistory): Promise<void> {
    if (!this.statusHistories.has(statusHistory.id)) {
      this.statusHistories.set(statusHistory.id, clone(statusHistory));
    }
  }

  async listStatusHistory(objectId: string, objectType?: string): Promise<StatusHistory[]> {
    return valuesFor(this.statusHistories)
      .filter(
        (statusHistory) =>
          statusHistory.object_id === objectId && (objectType === undefined || statusHistory.object_type === objectType),
      )
      .sort(byCreatedAt);
  }

  async saveArtifact(artifact: Artifact): Promise<void> {
    this.artifacts.set(artifact.id, clone(artifact));
  }

  async listArtifactsForObject(objectType: string, objectId: string): Promise<Artifact[]> {
    return valuesFor(this.artifacts)
      .filter((artifact) => artifact.object_type === objectType && artifact.object_id === objectId)
      .sort(byCreatedAt);
  }

  async saveDecision(decision: Decision): Promise<void> {
    this.decisions.set(decision.id, clone(decision));
  }

  async listDecisionsForObject(objectType: string, objectId: string): Promise<Decision[]> {
    return valuesFor(this.decisions)
      .filter((decision) => decision.object_type === objectType && decision.object_id === objectId)
      .sort(byCreatedAt);
  }

  private cloneMaybe<T>(value: T | undefined): T | undefined {
    return value === undefined ? undefined : clone(value);
  }

  private dependencyKey(dependency: ExecutionPackageDependency): string {
    return `${dependency.package_id}:${dependency.depends_on_package_id}`;
  }
}
