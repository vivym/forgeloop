import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../apps/control-plane-api/src/app.module';
import { DELIVERY_REPOSITORY } from '../../apps/control-plane-api/src/modules/core/control-plane-tokens';
import {
  INTERNAL_ARTIFACT_METADATA_HEADER_NAME,
  INTERNAL_ARTIFACT_UPLOAD_MAX_BYTES,
  INTERNAL_ARTIFACT_UPLOAD_WIRE_PATH,
  registerInternalArtifactUploadMiddleware,
} from '../../apps/control-plane-api/src/modules/internal-artifacts/internal-artifacts.constants';
import { DELIVERY_RUN_WORKER } from '../../apps/control-plane-api/src/modules/run-control/run-worker.token';
import { signAutomationRequest } from '../../packages/automation/src/index';
import { InMemoryDeliveryRepository } from '../../packages/db/src/index';

const secret = 'test-secret';
const actorId = 'automation-daemon';
const daemonIdentity = 'internal-artifact-api-test';
const apps: INestApplication[] = [];
const artifactRoots: string[] = [];
const socketPaths: string[] = [];

const rawSha256 = (bytes: Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const seededSha256 = (seed: string): string => `sha256:${createHash('sha256').update(seed).digest('hex')}`;

const uploadSignedHeaders = (headers: Map<string, string>): Record<string, string> | undefined => {
  const metadata = headers.get(INTERNAL_ARTIFACT_METADATA_HEADER_NAME);
  return metadata === undefined ? undefined : { [INTERNAL_ARTIFACT_METADATA_HEADER_NAME]: metadata };
};

const bootApp = async (): Promise<INestApplication> => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DELIVERY_REPOSITORY)
    .useValue(new InMemoryDeliveryRepository())
    .overrideProvider(DELIVERY_RUN_WORKER)
    .useValue({ kick: () => undefined, drainOnce: async () => undefined })
    .compile();
  const app = moduleRef.createNestApplication({ bodyParser: false, rawBody: true });
  registerInternalArtifactUploadMiddleware(app.getHttpAdapter().getInstance());
  app.useBodyParser('json');
  app.useBodyParser('urlencoded', { extended: true });
  app.useLogger(false);
  await app.init();
  apps.push(app);
  return app;
};

const listenOnLocalSocket = async (app: INestApplication): Promise<string> => {
  const socketPath = join('/tmp', `flia-${process.pid}-${socketPaths.length + 1}.sock`);
  socketPaths.push(socketPath);
  await app.listen(socketPath);
  return socketPath;
};

const signedRequest = (app: INestApplication) => {
  const server = request(app.getHttpServer());

  const sign = (
    method: string,
    pathAndQuery: string,
    rawBody: Buffer | string,
    signedHeaders?: Record<string, string | string[] | undefined>,
  ) =>
    signAutomationRequest({
      method,
      pathAndQuery,
      rawBody,
      actorId,
      actorClass: 'automation_daemon',
      daemonIdentity,
      timestamp: new Date().toISOString(),
      secret,
      signedHeaders,
    });

  return {
    post: (pathAndQuery: string) => ({
      set: (name: string | Record<string, string>, value?: string) => {
        const headers = new Map<string, string>();
        if (typeof name === 'string') {
          headers.set(name, value ?? '');
        } else {
          for (const [headerName, headerValue] of Object.entries(name)) {
            headers.set(headerName, headerValue);
          }
        }
        return {
          set: (nextName: string, nextValue: string) => {
            headers.set(nextName, nextValue);
            return {
              send: (rawBody: Buffer | string) =>
                server
                  .post(pathAndQuery)
                  .set(sign('POST', pathAndQuery, rawBody, uploadSignedHeaders(headers)))
                  .set(Object.fromEntries(headers))
                  .send(rawBody),
            };
          },
          send: (rawBody: Buffer | string) =>
            server
              .post(pathAndQuery)
              .set(sign('POST', pathAndQuery, rawBody, uploadSignedHeaders(headers)))
              .set(Object.fromEntries(headers))
              .send(rawBody),
        };
      },
      send: (rawBody: Buffer | string) => server.post(pathAndQuery).set(sign('POST', pathAndQuery, rawBody)).send(rawBody),
    }),
    head: (pathAndQuery: string) => server.head(pathAndQuery).set(sign('HEAD', pathAndQuery, '')),
    get: (pathAndQuery: string) => server.get(pathAndQuery).set(sign('GET', pathAndQuery, '')),
    delete: (pathAndQuery: string) => ({
      send: (body: Record<string, unknown>) => {
        const rawBody = JSON.stringify(body);
        return server
          .delete(pathAndQuery)
          .set(sign('DELETE', pathAndQuery, rawBody))
          .set('Content-Type', 'application/json')
          .send(rawBody);
      },
    }),
  };
};

const uploadTestArtifact = async (
  app: INestApplication,
  options: { idempotencyKey?: string; bytes?: Buffer } = {},
): Promise<{ ref: string; refBase64: string; bytes: Buffer; digest: string }> => {
  const bytes = options.bytes ?? Buffer.from('hello internal artifact');
  const digest = rawSha256(bytes);
  const metadata = {
    schema_version: 'internal_artifact_upload.v1',
    owner_type: 'system',
    owner_id: 'system',
    kind: 'raw_metadata',
    visibility: 'internal',
    content_type: 'text/plain',
    declared_size_bytes: String(bytes.byteLength),
    declared_artifact_digest: digest,
    idempotency_key: options.idempotencyKey ?? 'artifact-upload-test-helper',
    metadata_json: { schema_version: 'test.v1' },
  };

  const upload = await signedRequest(app)
    .post(INTERNAL_ARTIFACT_UPLOAD_WIRE_PATH)
    .set('content-type', 'application/octet-stream')
    .set(INTERNAL_ARTIFACT_METADATA_HEADER_NAME, Buffer.from(JSON.stringify(metadata)).toString('base64url'))
    .send(bytes)
    .expect(201);

  return {
    ref: upload.body.artifact.ref,
    refBase64: Buffer.from(upload.body.artifact.ref, 'utf8').toString('base64url'),
    bytes,
    digest,
  };
};

describe('internal artifact API', () => {
  beforeEach(async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), 'forgeloop-internal-artifacts-api-'));
    artifactRoots.push(artifactRoot);
    vi.stubEnv('FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET', secret);
    vi.stubEnv('FORGELOOP_ARTIFACT_STORE_ROOT', artifactRoot);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(apps.splice(0).map((app) => app.close()));
    await Promise.all(socketPaths.splice(0).map((socketPath) => rm(socketPath, { force: true })));
    await Promise.all(artifactRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('uploads, stats, downloads, and deletes internal artifacts without leaking storage keys', async () => {
    const app = await bootApp();
    const bytes = Buffer.from('hello internal artifact');
    const digest = rawSha256(bytes);
    const metadata = {
      schema_version: 'internal_artifact_upload.v1',
      owner_type: 'system',
      owner_id: 'system',
      kind: 'raw_metadata',
      visibility: 'internal',
      content_type: 'text/plain',
      declared_size_bytes: String(bytes.byteLength),
      declared_artifact_digest: digest,
      idempotency_key: 'artifact-upload-1',
      metadata_json: { schema_version: 'test.v1' },
    };

    const upload = await signedRequest(app)
      .post(INTERNAL_ARTIFACT_UPLOAD_WIRE_PATH)
      .set('content-type', 'application/octet-stream')
      .set(INTERNAL_ARTIFACT_METADATA_HEADER_NAME, Buffer.from(JSON.stringify(metadata)).toString('base64url'))
      .send(bytes)
      .expect(201);

    expect(upload.body.artifact).toMatchObject({
      ref: expect.stringMatching(/^artifact:\/\/internal\/raw_metadata\/system\/system\//),
      kind: 'raw_metadata',
      size_bytes: String(bytes.byteLength),
      digest,
    });
    expect(JSON.stringify(upload.body)).not.toContain('storage_key');
    expect(upload.body.artifact).not.toHaveProperty('artifact_id');
    expect(upload.body.artifact).not.toHaveProperty('idempotency_key');
    expect(upload.body.artifact).not.toHaveProperty('request_digest');
    expect(upload.body.artifact).not.toHaveProperty('metadata_json');
    expect(upload.body.artifact).not.toHaveProperty('created_by_actor_id');

    const refBase64 = Buffer.from(upload.body.artifact.ref, 'utf8').toString('base64url');
    await signedRequest(app)
      .head(`/internal/artifacts?ref_base64url=${encodeURIComponent(refBase64)}`)
      .expect(200)
      .expect('x-forgeloop-artifact-digest', digest)
      .expect('x-forgeloop-artifact-kind', 'raw_metadata')
      .expect('x-forgeloop-artifact-size-bytes', String(bytes.byteLength));

    await signedRequest(app)
      .get(`/internal/artifacts?ref_base64url=${encodeURIComponent(refBase64)}`)
      .expect(200)
      .expect('x-forgeloop-artifact-ref', upload.body.artifact.ref)
      .expect('x-forgeloop-artifact-kind', 'raw_metadata')
      .expect(bytes.toString('utf8'));

    const deleted = await signedRequest(app)
      .delete('/internal/artifacts')
      .send({
        schema_version: 'internal_artifact_ref_request.v1',
        ref_base64url: refBase64,
        requester_type: 'admin',
        requester_id: 'automation-daemon',
        nonce: 'delete-nonce-1',
        nonce_timestamp: '2026-05-30T00:00:00.000Z',
        body_digest: seededSha256('delete-body'),
      })
      .expect(200);
    expect(deleted.body.deleted).toBe(true);
    expect(deleted.body.artifact).not.toHaveProperty('storage_key');
    expect(deleted.body.artifact).not.toHaveProperty('request_digest');

    await signedRequest(app).get(`/internal/artifacts?ref_base64url=${encodeURIComponent(refBase64)}`).expect(404);
  });

  it('rejects unauthenticated internal artifact calls', async () => {
    const app = await bootApp();
    const refBase64 = Buffer.from('artifact://internal/raw_metadata/system/system/artifact-1', 'utf8').toString('base64url');
    const pathAndQuery = `/internal/artifacts?ref_base64url=${encodeURIComponent(refBase64)}`;

    await request(app.getHttpServer())
      .post(INTERNAL_ARTIFACT_UPLOAD_WIRE_PATH)
      .set('content-type', 'application/octet-stream')
      .send(Buffer.from('hello'))
      .expect(401);
    await request(app.getHttpServer()).head(pathAndQuery).expect(401);
    await request(app.getHttpServer()).get(pathAndQuery).expect(401);
    await request(app.getHttpServer()).delete('/internal/artifacts').send({ ref_base64url: refBase64 }).expect(401);
  });

  it('rejects delete requests without the signed JSON body', async () => {
    const app = await bootApp();
    const refBase64 = Buffer.from('artifact://internal/raw_metadata/system/system/artifact-1', 'utf8').toString('base64url');
    const pathAndQuery = `/internal/artifacts?ref_base64url=${encodeURIComponent(refBase64)}`;
    const headers = signAutomationRequest({
      method: 'DELETE',
      pathAndQuery,
      rawBody: '',
      actorId,
      actorClass: 'automation_daemon',
      daemonIdentity,
      timestamp: new Date().toISOString(),
      secret,
    });

    await request(app.getHttpServer()).delete(pathAndQuery).set(headers).expect(400);
  });

  it('rejects delete requests whose requester does not match the signed actor', async () => {
    const app = await bootApp();
    const refBase64 = Buffer.from('artifact://internal/raw_metadata/system/system/artifact-1', 'utf8').toString('base64url');

    await signedRequest(app)
      .delete('/internal/artifacts')
      .send({
        schema_version: 'internal_artifact_ref_request.v1',
        ref_base64url: refBase64,
        requester_type: 'admin',
        requester_id: 'other-daemon',
      })
      .expect(403);
  });

  it('rejects client-supplied artifact ids on upload metadata', async () => {
    const app = await bootApp();
    const bytes = Buffer.from('hello internal artifact');
    const metadata = {
      schema_version: 'internal_artifact_upload.v1',
      artifact_id: 'client-chosen-artifact',
      owner_type: 'system',
      owner_id: 'system',
      kind: 'raw_metadata',
      visibility: 'internal',
      content_type: 'text/plain',
      declared_size_bytes: String(bytes.byteLength),
      declared_artifact_digest: rawSha256(bytes),
      idempotency_key: 'artifact-upload-client-id',
      metadata_json: { schema_version: 'test.v1' },
    };

    await signedRequest(app)
      .post(INTERNAL_ARTIFACT_UPLOAD_WIRE_PATH)
      .set('content-type', 'application/octet-stream')
      .set(INTERNAL_ARTIFACT_METADATA_HEADER_NAME, Buffer.from(JSON.stringify(metadata)).toString('base64url'))
      .send(bytes)
      .expect(400);
  });

  it('sanitizes internal artifact request validation errors', async () => {
    const app = await bootApp();
    const bytes = Buffer.from('hello internal artifact');
    const metadata = {
      schema_version: 'internal_artifact_upload.v1',
      owner_type: 'system',
      owner_id: 'system',
      kind: 'raw_metadata',
      visibility: 'internal',
      content_type: 'text/plain',
      declared_size_bytes: String(bytes.byteLength),
      declared_artifact_digest: rawSha256(bytes),
      idempotency_key: 'artifact-upload-storage-key-reject',
      metadata_json: { schema_version: 'test.v1' },
      storage_key: 'file:///tmp/forbidden',
    };

    const metadataResponse = await signedRequest(app)
      .post(INTERNAL_ARTIFACT_UPLOAD_WIRE_PATH)
      .set('content-type', 'application/octet-stream')
      .set(INTERNAL_ARTIFACT_METADATA_HEADER_NAME, Buffer.from(JSON.stringify(metadata)).toString('base64url'))
      .send(bytes)
      .expect(400);

    const refBase64 = Buffer.from('artifact://internal/raw_metadata/system/system/artifact-1', 'utf8').toString('base64url');
    const queryResponse = await signedRequest(app)
      .get(`/internal/artifacts?ref_base64url=${encodeURIComponent(refBase64)}&storage_key=file:///tmp/forbidden`)
      .expect(400);

    const badHeaderResponse = await signedRequest(app)
      .head(`/internal/artifacts?ref_base64url=${encodeURIComponent(refBase64)}`)
      .set('x-forgeloop-artifact-requester-type', 'admin')
      .set('x-forgeloop-artifact-storage-key', 'file:///tmp/forbidden')
      .expect(400);

    const deleteResponse = await signedRequest(app)
      .delete('/internal/artifacts')
      .send({
        schema_version: 'internal_artifact_ref_request.v1',
        ref_base64url: refBase64,
        requester_type: 'admin',
        requester_id: actorId,
        storage_key: 'file:///tmp/forbidden',
      })
      .expect(400);

    for (const response of [metadataResponse, queryResponse, badHeaderResponse, deleteResponse]) {
      const body = JSON.stringify(response.body);
      expect(body).not.toContain('storage_key');
      expect(body).not.toContain('internal_artifact');
      expect(body).not.toContain('unrecognized');
      expect(body).not.toContain('issues');
      expect(body).not.toContain(process.env.FORGELOOP_ARTIFACT_STORE_ROOT ?? '');
    }
  });

  it('rejects upload metadata header tampering after signing', async () => {
    const app = await bootApp();
    const bytes = Buffer.from('hello internal artifact');
    const digest = rawSha256(bytes);
    const metadata = {
      schema_version: 'internal_artifact_upload.v1',
      owner_type: 'system',
      owner_id: 'system',
      kind: 'raw_metadata',
      visibility: 'internal',
      content_type: 'text/plain',
      declared_size_bytes: String(bytes.byteLength),
      declared_artifact_digest: digest,
      idempotency_key: 'artifact-upload-tamper',
      metadata_json: { schema_version: 'test.v1' },
    };
    const signedMetadata = Buffer.from(JSON.stringify(metadata)).toString('base64url');
    const tamperedMetadata = Buffer.from(JSON.stringify({ ...metadata, visibility: 'private' })).toString('base64url');
    const headers = signAutomationRequest({
      method: 'POST',
      pathAndQuery: INTERNAL_ARTIFACT_UPLOAD_WIRE_PATH,
      rawBody: bytes,
      actorId,
      actorClass: 'automation_daemon',
      daemonIdentity,
      timestamp: new Date().toISOString(),
      secret,
      signedHeaders: {
        [INTERNAL_ARTIFACT_METADATA_HEADER_NAME]: signedMetadata,
      },
    });

    await request(app.getHttpServer())
      .post(INTERNAL_ARTIFACT_UPLOAD_WIRE_PATH)
      .set(headers)
      .set('content-type', 'application/octet-stream')
      .set(INTERNAL_ARTIFACT_METADATA_HEADER_NAME, tamperedMetadata)
      .send(bytes)
      .expect(401);
  });

  it('does not route upload requests through alternate colon path matches', async () => {
    const app = await bootApp();
    const bytes = Buffer.from('hello internal artifact');
    const digest = rawSha256(bytes);
    const metadata = {
      schema_version: 'internal_artifact_upload.v1',
      owner_type: 'system',
      owner_id: 'system',
      kind: 'raw_metadata',
      visibility: 'internal',
      content_type: 'text/plain',
      declared_size_bytes: String(bytes.byteLength),
      declared_artifact_digest: digest,
      idempotency_key: 'artifact-upload-alternate-route',
      metadata_json: { schema_version: 'test.v1' },
    };
    const metadataHeader = Buffer.from(JSON.stringify(metadata)).toString('base64url');
    const pathAndQuery = '/internal/artifactsXYZ';
    const headers = signAutomationRequest({
      method: 'POST',
      pathAndQuery,
      rawBody: bytes,
      actorId,
      actorClass: 'automation_daemon',
      daemonIdentity,
      timestamp: new Date().toISOString(),
      secret,
    });

    await request(app.getHttpServer())
      .post(pathAndQuery)
      .set(headers)
      .set('content-type', 'application/octet-stream')
      .set(INTERNAL_ARTIFACT_METADATA_HEADER_NAME, metadataHeader)
      .send(bytes)
      .expect(404);
  });

  it('accepts matching GET and HEAD requester headers with optional replay fields', async () => {
    const app = await bootApp();
    const artifact = await uploadTestArtifact(app, { idempotencyKey: 'artifact-upload-requester-headers' });
    const pathAndQuery = `/internal/artifacts?ref_base64url=${encodeURIComponent(artifact.refBase64)}`;

    await signedRequest(app)
      .head(pathAndQuery)
      .set('x-forgeloop-artifact-requester-type', 'system')
      .set('x-forgeloop-artifact-requester-id', daemonIdentity)
      .set('x-forgeloop-artifact-nonce', 'head-nonce-1')
      .set('x-forgeloop-artifact-nonce-timestamp', '2026-05-30T00:00:00.000Z')
      .set('x-forgeloop-artifact-body-digest', seededSha256('head-request'))
      .expect(200)
      .expect('x-forgeloop-artifact-kind', 'raw_metadata');

    await signedRequest(app)
      .get(pathAndQuery)
      .set('x-forgeloop-artifact-requester-type', 'admin')
      .set('x-forgeloop-artifact-requester-id', actorId)
      .set('x-forgeloop-artifact-nonce', 'get-nonce-1')
      .set('x-forgeloop-artifact-body-digest', seededSha256('get-request'))
      .expect(200)
      .expect('x-forgeloop-artifact-kind', 'raw_metadata')
      .expect(artifact.bytes.toString('utf8'));
  });

  it('rejects GET and HEAD requester headers when only one requester field is supplied', async () => {
    const app = await bootApp();
    const artifact = await uploadTestArtifact(app, { idempotencyKey: 'artifact-upload-partial-requester-headers' });
    const pathAndQuery = `/internal/artifacts?ref_base64url=${encodeURIComponent(artifact.refBase64)}`;

    await signedRequest(app).get(pathAndQuery).set('x-forgeloop-artifact-requester-type', 'admin').expect(400);

    await signedRequest(app).head(pathAndQuery).set('x-forgeloop-artifact-requester-id', actorId).expect(400);
  });

  it('rejects GET and HEAD requester headers that do not match the signed actor', async () => {
    const app = await bootApp();
    const artifact = await uploadTestArtifact(app, { idempotencyKey: 'artifact-upload-mismatched-requester-headers' });
    const pathAndQuery = `/internal/artifacts?ref_base64url=${encodeURIComponent(artifact.refBase64)}`;

    await signedRequest(app)
      .get(pathAndQuery)
      .set('x-forgeloop-artifact-requester-type', 'admin')
      .set('x-forgeloop-artifact-requester-id', 'other-actor')
      .expect(403);

    await signedRequest(app)
      .head(pathAndQuery)
      .set('x-forgeloop-artifact-requester-type', 'system')
      .set('x-forgeloop-artifact-requester-id', 'other-daemon')
      .expect(403);
  });

  it('rejects non-octet-stream uploads', async () => {
    const app = await bootApp();
    const body = JSON.stringify({ hello: 'world' });
    const metadata = Buffer.from(
      JSON.stringify({
        schema_version: 'internal_artifact_upload.v1',
        owner_type: 'system',
        owner_id: 'system',
        kind: 'raw_metadata',
        visibility: 'internal',
        content_type: 'application/json',
        declared_size_bytes: String(Buffer.byteLength(body)),
        declared_artifact_digest: rawSha256(Buffer.from(body)),
        idempotency_key: 'artifact-upload-json-reject',
        metadata_json: { schema_version: 'test.v1' },
      }),
    ).toString('base64url');
    const headers = signAutomationRequest({
      method: 'POST',
      pathAndQuery: INTERNAL_ARTIFACT_UPLOAD_WIRE_PATH,
      rawBody: body,
      actorId,
      actorClass: 'automation_daemon',
      daemonIdentity,
      timestamp: new Date().toISOString(),
      secret,
      signedHeaders: {
        [INTERNAL_ARTIFACT_METADATA_HEADER_NAME]: metadata,
      },
    });

    await request(app.getHttpServer())
      .post(INTERNAL_ARTIFACT_UPLOAD_WIRE_PATH)
      .set(headers)
      .set('content-type', 'application/json')
      .set(INTERNAL_ARTIFACT_METADATA_HEADER_NAME, metadata)
      .send(body)
      .expect(415);
  });

  it('rejects large JSON uploads through the upload middleware before JSON parsing', async () => {
    const app = await bootApp();
    const socketPath = await listenOnLocalSocket(app);

    const statusCode = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          socketPath,
          method: 'POST',
          path: INTERNAL_ARTIFACT_UPLOAD_WIRE_PATH,
          headers: {
            'content-type': 'application/json',
            'content-length': String(INTERNAL_ARTIFACT_UPLOAD_MAX_BYTES + 1),
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.end();
    });

    expect(statusCode).toBe(415);
  });

  it('rejects oversized upload content length before accepting the body', async () => {
    const app = await bootApp();
    const socketPath = await listenOnLocalSocket(app);

    const statusCode = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          socketPath,
          method: 'POST',
          path: INTERNAL_ARTIFACT_UPLOAD_WIRE_PATH,
          headers: {
            'content-type': 'application/octet-stream',
            'content-length': String(INTERNAL_ARTIFACT_UPLOAD_MAX_BYTES + 1),
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.end();
    });

    expect(statusCode).toBe(413);
  });

  it('sanitizes artifact upload validation errors', async () => {
    const app = await bootApp();
    const bytes = Buffer.from('hello internal artifact');
    const metadata = {
      schema_version: 'internal_artifact_upload.v1',
      owner_type: 'system',
      owner_id: 'system',
      kind: 'raw_metadata',
      visibility: 'internal',
      content_type: 'text/plain',
      declared_size_bytes: String(bytes.byteLength),
      declared_artifact_digest: rawSha256(Buffer.from('different bytes')),
      idempotency_key: 'artifact-upload-digest-mismatch',
      metadata_json: { schema_version: 'test.v1' },
    };

    const response = await signedRequest(app)
      .post(INTERNAL_ARTIFACT_UPLOAD_WIRE_PATH)
      .set('content-type', 'application/octet-stream')
      .set(INTERNAL_ARTIFACT_METADATA_HEADER_NAME, Buffer.from(JSON.stringify(metadata)).toString('base64url'))
      .send(bytes)
      .expect(400);

    const body = JSON.stringify(response.body);
    expect(body).not.toContain('internal_artifact');
    expect(body).not.toContain('storage_key');
    expect(body).not.toContain(process.env.FORGELOOP_ARTIFACT_STORE_ROOT ?? '');

    const sizeResponse = await signedRequest(app)
      .post(INTERNAL_ARTIFACT_UPLOAD_WIRE_PATH)
      .set('content-type', 'application/octet-stream')
      .set(
        INTERNAL_ARTIFACT_METADATA_HEADER_NAME,
        Buffer.from(
          JSON.stringify({
            ...metadata,
            declared_size_bytes: String(bytes.byteLength + 1),
            declared_artifact_digest: rawSha256(bytes),
            idempotency_key: 'artifact-upload-size-mismatch',
          }),
        ).toString('base64url'),
      )
      .send(bytes)
      .expect(400);

    const sizeBody = JSON.stringify(sizeResponse.body);
    expect(sizeBody).not.toContain('internal_artifact');
    expect(sizeBody).not.toContain('storage_key');
    expect(sizeBody).not.toContain(process.env.FORGELOOP_ARTIFACT_STORE_ROOT ?? '');
  });
});
