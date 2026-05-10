import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { actorType, timestampColumn } from './_shared';
import { organizations } from './organization';

export const actors = pgTable('actors', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id')
    .notNull()
    .references(() => organizations.id),
  actorType: actorType('actor_type').notNull(),
  displayName: text('display_name').notNull(),
  email: text('email'),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
});
