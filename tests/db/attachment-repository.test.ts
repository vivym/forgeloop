import { describe, expect, it } from 'vitest';
import type { Attachment } from '@forgeloop/domain';

import {
  createDbClient,
  DrizzleDeliveryRepository,
  InMemoryDeliveryRepository,
  type DeliveryRepository,
  resetForgeloopDatabase,
} from '../../packages/db/src/index';

const now = '2026-05-23T00:00:00.000Z';
const later = '2026-05-23T00:05:00.000Z';

const attachmentFixture: Attachment = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  owner_object_type: 'requirement',
  owner_object_id: '33333333-3333-4333-8333-333333333331',
  linked_object_refs: [],
  filename: 'flow.png',
  content_type: 'image/png',
  size_bytes: 42,
  storage_uri: 'memory://attachments/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  checksum_sha256: 'c'.repeat(64),
  uploaded_by_actor_id: '11111111-1111-4111-8111-111111111112',
  created_at: now,
  evidence_category: 'image',
  visibility: 'object',
  safety_status: 'passed',
  reference_status: 'active',
};

const isResettable = (databaseUrl: string) => /localhost|127\.0\.0\.1|forgeloop.*test|test.*forgeloop/i.test(databaseUrl);

function runAttachmentRepositoryExamples(name: string, createRepository: () => DeliveryRepository): void {
  describe(name, () => {
    it('stores attachments with internal storage_uri and returns public refs without storage_uri', async () => {
      const repository = createRepository();

      await repository.saveAttachment(attachmentFixture);

      const attachment = await repository.getAttachment(attachmentFixture.id);
      expect(attachment?.storage_uri).toBe(attachmentFixture.storage_uri);

      const [attachmentRef] = await repository.listAttachmentsForObject(
        attachmentFixture.owner_object_type,
        attachmentFixture.owner_object_id,
      );
      const { storage_uri: _storageUri, ...publicRef } = attachmentRef ?? {};
      expect(publicRef).toEqual({
        id: attachmentFixture.id,
        owner_object_type: attachmentFixture.owner_object_type,
        owner_object_id: attachmentFixture.owner_object_id,
        linked_object_refs: [],
        filename: attachmentFixture.filename,
        content_type: attachmentFixture.content_type,
        size_bytes: attachmentFixture.size_bytes,
        checksum_sha256: attachmentFixture.checksum_sha256,
        uploaded_by_actor_id: attachmentFixture.uploaded_by_actor_id,
        created_at: attachmentFixture.created_at,
        evidence_category: attachmentFixture.evidence_category,
        visibility: attachmentFixture.visibility,
        safety_status: attachmentFixture.safety_status,
        reference_status: attachmentFixture.reference_status,
      });
    });

    it('archives referenced attachments instead of hard deleting them', async () => {
      const repository = createRepository();
      await repository.saveAttachment(attachmentFixture);

      await repository.linkAttachmentToObject(attachmentFixture.id, {
        type: 'task',
        id: '77777777-7777-4777-8777-777777777771',
      });
      await repository.archiveAttachment(attachmentFixture.id, later);

      expect(await repository.getAttachment(attachmentFixture.id)).toMatchObject({
        linked_object_refs: [{ type: 'task', id: '77777777-7777-4777-8777-777777777771' }],
        reference_status: 'archived',
      });
      expect(await repository.listAttachmentsForObject('task', '77777777-7777-4777-8777-777777777771')).toHaveLength(1);
    });
  });
}

runAttachmentRepositoryExamples('Attachment repository in-memory adapter', () => new InMemoryDeliveryRepository());

describe('Attachment repository Drizzle adapter contract', () => {
  const databaseUrl = process.env.FORGELOOP_TEST_DATABASE_URL ?? process.env.FORGELOOP_DATABASE_URL;

  if (databaseUrl === undefined) {
    it.skip('skips Attachment repository contract because no disposable database URL is configured', () => {});
  } else if (!isResettable(databaseUrl)) {
    it.skip('skips Attachment repository contract because configured database URL is not resettable', () => {});
  } else {
    it('satisfies the Attachment repository examples', async () => {
      await resetForgeloopDatabase(databaseUrl);
      const { db, pool } = createDbClient({ connectionString: databaseUrl });
      try {
        const repository = new DrizzleDeliveryRepository(db);
        await repository.saveAttachment(attachmentFixture);
        expect(await repository.getAttachment(attachmentFixture.id)).toMatchObject({
          id: attachmentFixture.id,
          storage_uri: attachmentFixture.storage_uri,
        });
        expect(
          await repository.listAttachmentsForObject(attachmentFixture.owner_object_type, attachmentFixture.owner_object_id),
        ).toHaveLength(1);
      } finally {
        await pool.end();
      }
    });
  }
});
