import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Attachment, WorkItem } from '@forgeloop/domain';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import type { InMemoryDeliveryRepository } from '../../packages/db/src';

const now = '2026-05-23T00:00:00.000Z';

const workItemFixture = (kind: WorkItem['kind'], id: string): WorkItem => ({
  id,
  project_id: 'project-1',
  kind,
  title: `${kind} narrative`,
  narrative_markdown: '',
  goal: 'Persist safe narrative Markdown.',
  success_criteria: ['Unsafe Markdown is rejected.'],
  priority: kind === 'bug' ? 'critical' : 'P1',
  risk: kind === 'bug' ? 'high' : 'medium',
  driver_actor_id: 'actor-product',
  intake_context:
    kind === 'bug'
      ? {
          type: 'bug',
          impact_summary: 'Unsafe evidence can leak.',
          observed_behavior: 'Narrative accepts unsafe links.',
          expected_behavior: 'Narrative rejects unsafe links.',
          reproduction_steps: ['Patch narrative'],
          affected_environment: 'control-plane API',
          verification_path: 'API test',
        }
      : {
          type: 'requirement',
          stakeholder_problem: 'Narrative evidence needs safe references.',
          desired_outcome: 'Attachment refs are resolved server-side.',
          acceptance_criteria: ['Only readable attachment refs persist.'],
          in_scope: ['Markdown validation'],
        },
  phase: 'draft',
  activity_state: 'idle',
  gate_state: 'none',
  resolution: 'none',
  created_at: now,
  updated_at: now,
});

describe('Markdown document API enforcement', () => {
  let app: INestApplication;
  let repository: InMemoryDeliveryRepository;

  const seedRequirement = async () => {
    await repository.saveWorkItem(workItemFixture('requirement', 'req-1'));
  };

  const seedAttachment = async () => {
    await seedRequirement();
    const attachment: Attachment = {
      id: 'att-1',
      owner_object_type: 'requirement',
      owner_object_id: 'req-1',
      linked_object_refs: [],
      filename: 'flow.png',
      content_type: 'image/png',
      size_bytes: 9,
      storage_uri: 'memory://attachments/att-1',
      checksum_sha256: 'b'.repeat(64),
      uploaded_by_actor_id: 'actor-product',
      created_at: now,
      evidence_category: 'image',
      alt_text: 'Checkout flow',
      visibility: 'object',
      safety_status: 'passed',
      reference_status: 'active',
    };
    await repository.saveAttachment(attachment);
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    repository = app.get(DELIVERY_REPOSITORY) as InMemoryDeliveryRepository;
  });

  afterEach(async () => {
    await app.close();
  });

  it('rejects unsafe Markdown on narrative write endpoints', async () => {
    await request(app.getHttpServer())
      .patch('/markdown-documents')
      .send({
        object_ref: { type: 'requirement', id: 'req-1', driver_actor_id: 'actor-product' },
        markdown: '![bad](data:image/png;base64,aaaa)',
        allowed_blocks: ['paragraph', 'image'],
        attachment_refs: [],
        validation_version: '2026-05-23',
      })
      .expect(400);
  });

  it('accepts safe attachment references resolved against metadata and persists narrative', async () => {
    await seedAttachment();

    const response = await request(app.getHttpServer())
      .patch('/requirements/req-1/narrative')
      .send({
        object_ref: { type: 'requirement', id: 'req-1', driver_actor_id: 'actor-product' },
        markdown: '![flow](attachment://att-1)',
        allowed_blocks: ['paragraph', 'image'],
        attachment_refs: [],
        validation_version: '2026-05-23',
      })
      .expect(200);

    expect(response.body).toMatchObject({ id: 'req-1', kind: 'requirement', narrative_markdown: '![flow](attachment://att-1)' });
    await expect(repository.getWorkItem('req-1')).resolves.toMatchObject({ narrative_markdown: '![flow](attachment://att-1)' });
  });

  it('rejects typed narrative writes when the stored Work Item kind does not match the route', async () => {
    await repository.saveWorkItem(workItemFixture('bug', 'bug-1'));

    await request(app.getHttpServer())
      .patch('/requirements/bug-1/narrative')
      .send({
        object_ref: { type: 'requirement', id: 'bug-1', driver_actor_id: 'actor-product' },
        markdown: 'Safe narrative',
        allowed_blocks: ['paragraph'],
        attachment_refs: [],
        validation_version: '2026-05-23',
      })
      .expect(400);
  });
});
