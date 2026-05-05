import { jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import type { Project } from '@forgeloop/domain';

import { projectRepoStatus, timestampColumn } from './_shared';

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  repoIds: jsonb('repo_ids').$type<Project['repo_ids']>().notNull(),
  ownerActorId: text('owner_actor_id'),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
});

export const project_repos = pgTable('project_repos', {
  id: text('id').primaryKey(),
  repoId: text('repo_id').notNull(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  status: projectRepoStatus('status').notNull(),
  localPath: text('local_path').notNull(),
  defaultBranch: text('default_branch').notNull(),
  remoteUrl: text('remote_url'),
  baseCommitSha: text('base_commit_sha').notNull(),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
});
