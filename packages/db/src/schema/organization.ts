import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

import { timestampColumn } from './_shared';

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdAt: timestampColumn('created_at').notNull(),
  updatedAt: timestampColumn('updated_at').notNull(),
});
