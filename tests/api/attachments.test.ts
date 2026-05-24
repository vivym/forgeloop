import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Attachment, WorkItem } from '@forgeloop/domain';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import type { InMemoryDeliveryRepository } from '../../packages/db/src';
import { seedApprovedExecutionPlan } from '../helpers/execution-supervision-fixtures';

const now = '2026-05-23T00:00:00.000Z';

const requirementFixture = (id = 'req-1'): WorkItem => ({
  id,
  project_id: 'project-1',
  kind: 'requirement',
  title: 'Checkout evidence',
  narrative_markdown: '',
  goal: 'Attach checkout evidence safely.',
  success_criteria: ['Evidence is stored through the attachment API.'],
  priority: 'P1',
  risk: 'medium',
  driver_actor_id: 'actor-product',
  intake_context: {
    type: 'requirement',
    stakeholder_problem: 'Checkout evidence is not available in context.',
    desired_outcome: 'Evidence can be reviewed from the requirement.',
    acceptance_criteria: ['Attachment references remain stable.'],
    in_scope: ['Attachment API'],
  },
  phase: 'draft',
  activity_state: 'idle',
  gate_state: 'none',
  resolution: 'none',
  created_at: now,
  updated_at: now,
});

describe('Attachment API safety', () => {
  let app: INestApplication;
  let repository: InMemoryDeliveryRepository;
  let attachmentStorageRoot: string;

  const seedRequirement = async () => {
    await repository.saveWorkItem(requirementFixture());
  };

  const uploadImage = async () => {
    await seedRequirement();
    return request(app.getHttpServer())
      .post('/attachments')
      .field(
        'metadata',
        JSON.stringify({
          object_type: 'requirement',
          object_id: 'req-1',
          evidence_category: 'image',
          alt_text: 'Checkout flow',
          visibility: 'object',
        }),
      )
      .attach('file', Buffer.from('png-bytes'), { filename: 'flow.png', contentType: 'image/png' })
      .expect(201);
  };

  const seedAttachment = async (overrides: Partial<Attachment> = {}) => {
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
      checksum_sha256: 'a'.repeat(64),
      uploaded_by_actor_id: 'actor-product',
      created_at: now,
      evidence_category: 'image',
      alt_text: 'Checkout flow',
      visibility: 'object',
      safety_status: 'passed',
      reference_status: 'active',
      ...overrides,
    };
    await repository.saveAttachment(attachment);
    return attachment;
  };

  beforeEach(async () => {
    attachmentStorageRoot = await mkdtemp(join(tmpdir(), 'forgeloop-attachment-api-'));
    vi.stubEnv('FORGELOOP_ATTACHMENT_STORAGE_ROOT', attachmentStorageRoot);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    repository = app.get(DELIVERY_REPOSITORY) as InMemoryDeliveryRepository;
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllEnvs();
    await rm(attachmentStorageRoot, { recursive: true, force: true });
  });

  it('rejects JSON/base64 attachment uploads', async () => {
    await request(app.getHttpServer())
      .post('/attachments')
      .send({
        object_type: 'requirement',
        object_id: 'req-1',
        evidence_category: 'image',
        file: 'data:image/png;base64,aaaa',
      })
      .expect(400);
  });

  it('accepts multipart uploads and returns AttachmentRef without storage_uri', async () => {
    const response = await uploadImage();

    expect(response.body).toMatchObject({
      owner_object_type: 'requirement',
      owner_object_id: 'req-1',
      filename: 'flow.png',
      content_type: 'image/png',
      evidence_category: 'image',
      alt_text: 'Checkout flow',
      visibility: 'object',
    });
    expect(response.body).not.toHaveProperty('storage_uri');
  });

  it('validates AI-native Execution Plan attachment owners against execution-plan storage', async () => {
    const { executionPlan, executionPlanRevision } = await seedApprovedExecutionPlan(app);

    const planUpload = await request(app.getHttpServer())
      .post('/attachments')
      .field(
        'metadata',
        JSON.stringify({
          object_type: 'execution_plan',
          object_id: executionPlan.id,
          evidence_category: 'document',
          caption: 'Execution Plan evidence',
          visibility: 'object',
        }),
      )
      .attach('file', Buffer.from('plan-bytes'), { filename: 'execution-plan.md', contentType: 'text/markdown' })
      .expect(201);
    expect(planUpload.body).toMatchObject({
      owner_object_type: 'execution_plan',
      owner_object_id: executionPlan.id,
      filename: 'execution-plan.md',
    });

    const revisionUpload = await request(app.getHttpServer())
      .post('/attachments')
      .field(
        'metadata',
        JSON.stringify({
          object_type: 'execution_plan_revision',
          object_id: executionPlanRevision.id,
          evidence_category: 'document',
          caption: 'Execution Plan revision evidence',
          visibility: 'object',
        }),
      )
      .attach('file', Buffer.from('revision-bytes'), { filename: 'execution-plan-revision.md', contentType: 'text/markdown' })
      .expect(201);
    expect(revisionUpload.body).toMatchObject({
      owner_object_type: 'execution_plan_revision',
      owner_object_id: executionPlanRevision.id,
      filename: 'execution-plan-revision.md',
    });
  });

  it('returns only opaque same-origin render urls', async () => {
    const upload = await uploadImage();
    const response = await request(app.getHttpServer())
      .post(`/attachments/${upload.body.id}/render-url`)
      .send({ disposition: 'inline' })
      .expect(201);

    expect(response.body.render_url).toMatch(new RegExp(`^/api/attachments/${upload.body.id}/render/[^/?#]+$`));
    expect(response.body.render_url).not.toMatch(/storage|bucket|s3|signature|https?:\/\//i);
    expect(JSON.stringify(response.body)).not.toContain('storage_uri');
  });

  it('rejects render urls for active metadata when binary content is unavailable', async () => {
    await seedAttachment();

    const response = await request(app.getHttpServer())
      .post('/attachments/att-1/render-url')
      .send({ disposition: 'inline' })
      .expect(404);

    expect(response.body).not.toHaveProperty('render_url');
    expect(JSON.stringify(response.body)).not.toContain('storage_uri');
    expect(JSON.stringify(response.body)).not.toContain('memory://');
  });

  it('serves binary content through the safe render url without exposing storage_uri', async () => {
    const upload = await uploadImage();
    const renderRef = await request(app.getHttpServer())
      .post(`/attachments/${upload.body.id}/render-url`)
      .send({ disposition: 'inline' })
      .expect(201);
    const binary = await request(app.getHttpServer()).get(renderRef.body.render_url.replace(/^\/api/, '')).expect(200);

    expect(binary.headers['content-type']).toContain('image/png');
    expect(binary.headers['content-disposition']).toContain('inline');
    expect(binary.text ?? JSON.stringify(binary.body)).not.toContain('storage_uri');
    expect(binary.text ?? JSON.stringify(binary.body)).not.toContain('memory://attachments');
  });

  it('serves uploaded attachment bytes after service restart when metadata is restored', async () => {
    const upload = await uploadImage();
    const storedMetadata = await repository.getAttachment(upload.body.id);
    expect(storedMetadata).toBeDefined();

    await app.close();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    await app.init();
    repository = app.get(DELIVERY_REPOSITORY) as InMemoryDeliveryRepository;
    await seedRequirement();
    await repository.saveAttachment(storedMetadata as Attachment);

    const renderRef = await request(app.getHttpServer())
      .post(`/attachments/${upload.body.id}/render-url`)
      .send({ disposition: 'inline' })
      .expect(201);
    const binary = await request(app.getHttpServer()).get(renderRef.body.render_url.replace(/^\/api/, '')).expect(200);

    expect(binary.headers['content-type']).toContain('image/png');
    expect(binary.body).toEqual(Buffer.from('png-bytes'));
  });

  it('fetches metadata and lists object attachments without exposing storage_uri', async () => {
    await seedAttachment();

    const metadata = await request(app.getHttpServer()).get('/attachments/att-1').expect(200);
    const list = await request(app.getHttpServer())
      .get('/attachments')
      .query({ object_type: 'requirement', object_id: 'req-1' })
      .expect(200);

    expect(metadata.body).toMatchObject({ id: 'att-1', owner_object_type: 'requirement' });
    expect(list.body).toEqual([expect.objectContaining({ id: 'att-1', owner_object_type: 'requirement' })]);
    expect(JSON.stringify(metadata.body)).not.toContain('storage_uri');
    expect(JSON.stringify(list.body)).not.toContain('storage_uri');
  });

  it('updates public metadata without replacing binary content', async () => {
    await seedAttachment();

    const response = await request(app.getHttpServer())
      .patch('/attachments/att-1')
      .send({ caption: 'Checkout failure', alt_text: 'Checkout modal error', visibility: 'project' })
      .expect(200);

    expect(response.body).toMatchObject({
      caption: 'Checkout failure',
      alt_text: 'Checkout modal error',
      visibility: 'project',
    });
    expect(response.body).not.toHaveProperty('storage_uri');
    await expect(repository.getAttachment('att-1')).resolves.toMatchObject({ storage_uri: 'memory://attachments/att-1' });
  });

  it('links reused evidence only through typed object refs', async () => {
    await seedAttachment();

    await request(app.getHttpServer())
      .post('/attachments/att-1/links')
      .send({ object_ref: { type: 'work_item', id: 'req-1', work_item_kind: 'requirement' } })
      .expect(400);

    const response = await request(app.getHttpServer())
      .post('/attachments/att-1/links')
      .send({ object_ref: { type: 'requirement', id: 'req-1' } })
      .expect(201);

    expect(response.body.linked_object_refs).toEqual(expect.arrayContaining([{ type: 'requirement', id: 'req-1' }]));
    expect(response.body).not.toHaveProperty('storage_uri');
  });

  it('archives referenced attachments instead of silently breaking Markdown references', async () => {
    const upload = await uploadImage();
    await request(app.getHttpServer())
      .patch('/requirements/req-1/narrative')
      .send({
        object_ref: { type: 'requirement', id: 'req-1', driver_actor_id: 'actor-product' },
        markdown: `![flow](attachment://${upload.body.id})`,
        allowed_blocks: ['paragraph', 'image'],
        attachment_refs: [],
        validation_version: '2026-05-23',
      })
      .expect(200);

    const response = await request(app.getHttpServer()).delete(`/attachments/${upload.body.id}`).expect(200);

    expect(response.body).toMatchObject({ id: upload.body.id, reference_status: 'archived' });
    expect(response.body).not.toHaveProperty('storage_uri');
  });
});
