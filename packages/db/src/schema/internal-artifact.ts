import { bigint, index, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type {
  InternalArtifactKind,
  InternalArtifactObject,
  InternalArtifactOwnerType,
  InternalArtifactVisibility,
} from '@forgeloop/domain';

import { timestampColumn } from './_shared';

export const internal_artifact_objects = pgTable(
  'internal_artifact_objects',
  {
    id: uuid('id').primaryKey(),
    artifactId: text('artifact_id').notNull(),
    ref: text('ref').notNull(),
    storageKey: text('storage_key').notNull(),
    kind: text('kind').$type<InternalArtifactKind>().notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'bigint' }).notNull(),
    digest: text('digest').notNull(),
    visibility: text('visibility').$type<InternalArtifactVisibility>().notNull(),
    ownerType: text('owner_type').$type<InternalArtifactOwnerType>().notNull(),
    ownerId: text('owner_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    requestDigest: text('request_digest').notNull(),
    metadataJson: jsonb('metadata_json').$type<InternalArtifactObject['metadata_json']>().notNull(),
    createdByActorType: text('created_by_actor_type').$type<InternalArtifactObject['created_by_actor_type']>().notNull(),
    createdByActorId: text('created_by_actor_id').notNull(),
    createdAt: timestampColumn('created_at').notNull(),
    deletedAt: timestampColumn('deleted_at'),
  },
  (table) => [
    uniqueIndex('internal_artifact_objects_ref_idx').on(table.ref),
    uniqueIndex('internal_artifact_objects_owner_idempotency_idx').on(table.ownerType, table.ownerId, table.idempotencyKey),
    uniqueIndex('internal_artifact_objects_owner_kind_artifact_idx').on(table.ownerType, table.ownerId, table.kind, table.artifactId),
    index('internal_artifact_objects_owner_kind_created_idx').on(table.ownerType, table.ownerId, table.kind, table.createdAt),
    index('internal_artifact_objects_storage_key_idx').on(table.storageKey),
    index('internal_artifact_objects_digest_content_type_idx').on(table.digest, table.contentType),
  ],
);
