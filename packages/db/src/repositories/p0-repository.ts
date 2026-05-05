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

export interface P0Repository {
  saveProject(project: Project): Promise<void>;
  getProject(projectId: string): Promise<Project | undefined>;

  saveProjectRepo(projectRepo: ProjectRepo): Promise<void>;
  listProjectRepos(projectId: string): Promise<ProjectRepo[]>;

  saveWorkItem(workItem: WorkItem): Promise<void>;
  getWorkItem(workItemId: string): Promise<WorkItem | undefined>;
  listWorkItems(projectId?: string): Promise<WorkItem[]>;

  saveSpec(spec: Spec): Promise<void>;
  getSpec(specId: string): Promise<Spec | undefined>;
  saveSpecRevision(specRevision: SpecRevision): Promise<void>;
  listSpecRevisions(specId: string): Promise<SpecRevision[]>;

  savePlan(plan: Plan): Promise<void>;
  getPlan(planId: string): Promise<Plan | undefined>;
  savePlanRevision(planRevision: PlanRevision): Promise<void>;
  listPlanRevisions(planId: string): Promise<PlanRevision[]>;

  saveExecutionPackage(executionPackage: ExecutionPackage): Promise<void>;
  getExecutionPackage(executionPackageId: string): Promise<ExecutionPackage | undefined>;
  listExecutionPackagesForWorkItem(workItemId: string): Promise<ExecutionPackage[]>;
  saveExecutionPackageDependency(dependency: ExecutionPackageDependency): Promise<void>;
  listExecutionPackageDependencies(executionPackageId: string): Promise<ExecutionPackageDependency[]>;

  saveRunSession(runSession: RunSession): Promise<void>;
  getRunSession(runSessionId: string): Promise<RunSession | undefined>;
  listRunSessionsForPackage(executionPackageId: string): Promise<RunSession[]>;

  saveReviewPacket(reviewPacket: ReviewPacket): Promise<void>;
  getReviewPacket(reviewPacketId: string): Promise<ReviewPacket | undefined>;
  listReviewPacketsForPackage(executionPackageId: string): Promise<ReviewPacket[]>;
  findOpenReviewPacketForPackage(executionPackageId: string): Promise<ReviewPacket | undefined>;

  appendObjectEvent(objectEvent: ObjectEvent): Promise<void>;
  listObjectEvents(objectId: string, objectType?: string): Promise<ObjectEvent[]>;

  appendStatusHistory(statusHistory: StatusHistory): Promise<void>;
  listStatusHistory(objectId: string, objectType?: string): Promise<StatusHistory[]>;

  saveArtifact(artifact: Artifact): Promise<void>;
  listArtifactsForObject(objectType: string, objectId: string): Promise<Artifact[]>;

  saveDecision(decision: Decision): Promise<void>;
  listDecisionsForObject(objectType: string, objectId: string): Promise<Decision[]>;
}
