import type { ExecutionPackage } from '@forgeloop/domain';

export const executionPackageActorFields = (input: {
  assignee_actor_id: string;
  reviewer_actor_id: string;
  qa_owner_actor_id: string;
}): Pick<ExecutionPackage, 'owner_actor_id' | 'reviewer_actor_id' | 'qa_owner_actor_id'> => ({
  owner_actor_id: input.assignee_actor_id,
  reviewer_actor_id: input.reviewer_actor_id,
  qa_owner_actor_id: input.qa_owner_actor_id,
});
