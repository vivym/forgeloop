import { integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import type { ObjectRef } from '@forgeloop/contracts';

import { timestampColumn } from './_shared';

export const attachments = pgTable('attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerObjectType: text('owner_object_type').notNull(),
  ownerObjectId: text('owner_object_id').notNull(),
  linkedObjectRefs: jsonb('linked_object_refs').$type<ObjectRef[]>().notNull(),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  storageUri: text('storage_uri').notNull(),
  checksumSha256: text('checksum_sha256').notNull(),
  uploadedByActorId: text('uploaded_by_actor_id').notNull(),
  createdAt: timestampColumn('created_at').notNull(),
  evidenceCategory: text('evidence_category').notNull(),
  caption: text('caption'),
  altText: text('alt_text'),
  visibility: text('visibility').notNull(),
  safetyStatus: text('safety_status').notNull(),
  referenceStatus: text('reference_status').notNull(),
});
