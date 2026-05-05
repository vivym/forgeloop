import {
  DomainError,
  type ExecutionPackage,
  type ExecutionPackageDependency,
  type Project,
  type ReviewPacket,
} from './types';

export interface ExecutionPackageValidationOptions {
  referenced_repo_ids?: readonly string[];
}

const hasText = (value: string) => value.trim().length > 0;

export const validateRepoBelongsToProject = (project: Project, repoId: string): void => {
  if (!project.repo_ids.includes(repoId)) {
    throw new DomainError('REPO_NOT_BOUND', `Repo ${repoId} is not bound to project ${project.id}`, {
      project_id: project.id,
      repo_id: repoId,
    });
  }
};

export const validateExecutionPackage = (
  project: Project,
  executionPackage: ExecutionPackage,
  options: ExecutionPackageValidationOptions = {},
): void => {
  if (executionPackage.project_id !== project.id) {
    throw new DomainError('PROJECT_MISMATCH', `Package ${executionPackage.id} belongs to project ${executionPackage.project_id}`, {
      execution_package_id: executionPackage.id,
      project_id: project.id,
      execution_package_project_id: executionPackage.project_id,
    });
  }

  validateRepoBelongsToProject(project, executionPackage.repo_id);

  const referencedRepoIds = new Set(options.referenced_repo_ids ?? [executionPackage.repo_id]);
  if (referencedRepoIds.size > 1 || !referencedRepoIds.has(executionPackage.repo_id)) {
    throw new DomainError('PACKAGE_MULTIPLE_REPOS', `Package ${executionPackage.id} must bind exactly one repo`, {
      execution_package_id: executionPackage.id,
      repo_ids: [...referencedRepoIds],
    });
  }

  for (const repoId of referencedRepoIds) {
    validateRepoBelongsToProject(project, repoId);
  }

  if (executionPackage.required_checks.length === 0) {
    throw new DomainError('REQUIRED_CHECK_MISSING', `Package ${executionPackage.id} must define required checks`, {
      execution_package_id: executionPackage.id,
    });
  }

  if (!hasText(executionPackage.owner_actor_id)) {
    throw new DomainError('OWNER_REQUIRED', `Package ${executionPackage.id} must have an owner`, {
      execution_package_id: executionPackage.id,
    });
  }

  if (!hasText(executionPackage.reviewer_actor_id)) {
    throw new DomainError('REVIEWER_REQUIRED', `Package ${executionPackage.id} must have a reviewer`, {
      execution_package_id: executionPackage.id,
    });
  }

  if (!hasText(executionPackage.qa_owner_actor_id)) {
    throw new DomainError('QA_OWNER_REQUIRED', `Package ${executionPackage.id} must have a QA owner`, {
      execution_package_id: executionPackage.id,
    });
  }

  if (!hasText(executionPackage.objective)) {
    throw new DomainError('EXECUTION_OBJECTIVE_REQUIRED', `Package ${executionPackage.id} must have an objective`, {
      execution_package_id: executionPackage.id,
    });
  }
};

export const validatePackageDependencyGraph = (
  packages: readonly ExecutionPackage[],
  dependencies: readonly ExecutionPackageDependency[],
): void => {
  const packageIds = new Set(packages.map((executionPackage) => executionPackage.id));
  const graph = new Map<string, string[]>();

  for (const packageId of packageIds) {
    graph.set(packageId, []);
  }

  for (const dependency of dependencies) {
    if (packageIds.has(dependency.package_id) && packageIds.has(dependency.depends_on_package_id)) {
      graph.get(dependency.package_id)?.push(dependency.depends_on_package_id);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (packageId: string, path: string[]): void => {
    if (visiting.has(packageId)) {
      throw new DomainError('DEPENDENCY_CYCLE', `Package dependency cycle detected: ${[...path, packageId].join(' -> ')}`, {
        package_id: packageId,
      });
    }

    if (visited.has(packageId)) {
      return;
    }

    visiting.add(packageId);
    for (const dependencyId of graph.get(packageId) ?? []) {
      visit(dependencyId, [...path, packageId]);
    }
    visiting.delete(packageId);
    visited.add(packageId);
  };

  for (const packageId of packageIds) {
    visit(packageId, []);
  }
};

export const validatePackageEditAllowed = (executionPackage: ExecutionPackage): void => {
  if (executionPackage.phase !== 'draft' && executionPackage.phase !== 'ready') {
    throw new DomainError('EDIT_NOT_ALLOWED', `Package ${executionPackage.id} cannot be edited while ${executionPackage.phase}`, {
      execution_package_id: executionPackage.id,
      phase: executionPackage.phase,
    });
  }
};

export const validateForceRerunAllowed = (
  executionPackage: ExecutionPackage,
  reviewPackets: readonly ReviewPacket[],
  actorId: string,
): void => {
  const packageReviewPackets = reviewPackets.filter(
    (reviewPacket) => reviewPacket.execution_package_id === executionPackage.id,
  );

  const hasOpenReviewPacket = packageReviewPackets.some(
    (reviewPacket) =>
      reviewPacket.decision === 'none' && (reviewPacket.status === 'ready' || reviewPacket.status === 'in_review'),
  );

  if (
    executionPackage.phase !== 'review' ||
    executionPackage.resolution !== 'none' ||
    executionPackage.owner_actor_id !== actorId ||
    !hasOpenReviewPacket
  ) {
    throw new DomainError('FORCE_RERUN_FORBIDDEN', `Actor ${actorId} cannot force-rerun package ${executionPackage.id}`, {
      execution_package_id: executionPackage.id,
      actor_id: actorId,
    });
  }
};
