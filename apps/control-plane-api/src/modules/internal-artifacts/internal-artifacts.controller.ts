import { Buffer } from 'node:buffer';

import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Head,
  Headers,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UnsupportedMediaTypeException,
  UseGuards,
} from '@nestjs/common';

import { TrustedAutomationActorGuard } from '../automation/trusted-automation-actor.guard';
import {
  INTERNAL_ARTIFACT_METADATA_HEADER_NAME,
  INTERNAL_ARTIFACTS_WIRE_PATH,
  INTERNAL_ARTIFACT_UPLOAD_ROUTE_PATH,
} from './internal-artifacts.constants';
import {
  internalArtifactResponse,
  parseInternalArtifactMetadataHeader,
  parseInternalArtifactQuery,
  parseInternalArtifactRefBody,
  parseInternalArtifactRefHeaders,
  parseInternalArtifactRefQuery,
  parseInternalArtifactRefRequestBody,
  type InternalArtifactRefHeaderDto,
  type InternalArtifactRefRequestDto,
} from './internal-artifacts.dto';
import { InternalArtifactsService } from './internal-artifacts.service';

type RawBodyRequest = {
  rawBody?: Buffer;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
};

type HeaderResponse = {
  setHeader(name: string, value: string): void;
};

const firstHeaderValue = (headers: Record<string, string | string[] | undefined>, name: string): string | undefined => {
  const direct = headers[name];
  if (direct !== undefined) {
    return Array.isArray(direct) ? direct[0] : direct;
  }

  const lowerName = name.toLowerCase();
  const found = Object.entries(headers).find(([headerName]) => headerName.toLowerCase() === lowerName)?.[1];
  return Array.isArray(found) ? found[0] : found;
};

const requestBytes = (request: RawBodyRequest): Buffer => {
  if (request.rawBody !== undefined) {
    return request.rawBody;
  }
  if (Buffer.isBuffer(request.body)) {
    return request.body;
  }
  throw new BadRequestException('Internal artifact octet-stream body is required');
};

const assertOctetStreamUpload = (request: RawBodyRequest): void => {
  const contentType = firstHeaderValue(request.headers, 'content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/octet-stream') {
    throw new UnsupportedMediaTypeException('Internal artifact upload requires application/octet-stream');
  }
};

const signedActorId = (request: RawBodyRequest): string =>
  firstHeaderValue(request.headers, 'X-Forgeloop-Actor-Id')?.trim() ?? 'automation-daemon';

const signedDaemonIdentity = (request: RawBodyRequest): string =>
  firstHeaderValue(request.headers, 'X-Forgeloop-Daemon-Identity')?.trim() ?? '';

const assertRequesterMatchesSignedActor = (request: RawBodyRequest, body: InternalArtifactRefRequestDto): void => {
  const matchesSignedContext =
    (body.requester_type === 'admin' && body.requester_id === signedActorId(request)) ||
    (body.requester_type === 'system' && body.requester_id === signedDaemonIdentity(request));
  if (!matchesSignedContext) {
    throw new ForbiddenException('Internal artifact requester must match the signed automation actor');
  }
};

const assertOptionalRequesterMatchesSignedActor = (
  request: RawBodyRequest,
  headers: InternalArtifactRefHeaderDto,
): void => {
  if (headers.requester_type === undefined && headers.requester_id === undefined) {
    return;
  }
  const matchesSignedContext =
    (headers.requester_type === 'admin' && headers.requester_id === signedActorId(request)) ||
    (headers.requester_type === 'system' && headers.requester_id === signedDaemonIdentity(request));
  if (!matchesSignedContext) {
    throw new ForbiddenException('Internal artifact requester must match the signed automation actor');
  }
};

@Controller()
@UseGuards(TrustedAutomationActorGuard)
export class InternalArtifactsController {
  constructor(private readonly service: InternalArtifactsService) {}

  @Post(INTERNAL_ARTIFACT_UPLOAD_ROUTE_PATH)
  async uploadArtifact(
    @Req() request: RawBodyRequest,
    @Headers(INTERNAL_ARTIFACT_METADATA_HEADER_NAME) metadataHeader: string | undefined,
  ) {
    assertOctetStreamUpload(request);
    const metadata = parseInternalArtifactMetadataHeader(metadataHeader);
    const artifact = await this.service.uploadObject({
      metadata,
      bytes: requestBytes(request),
      actorId: signedActorId(request),
    });
    return {
      schema_version: 'internal_artifact_upload_response.v1',
      artifact: internalArtifactResponse(artifact),
    };
  }

  @Head(INTERNAL_ARTIFACTS_WIRE_PATH)
  @HttpCode(200)
  async statArtifact(
    @Req() request: RawBodyRequest,
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    assertOptionalRequesterMatchesSignedActor(request, parseInternalArtifactRefHeaders(request.headers));
    const artifact = await this.service.statObject(parseInternalArtifactRefQuery(parseInternalArtifactQuery(query)));
    response.setHeader('x-forgeloop-artifact-ref', artifact.ref);
    response.setHeader('x-forgeloop-artifact-kind', artifact.kind);
    response.setHeader('x-forgeloop-artifact-digest', artifact.digest);
    response.setHeader('x-forgeloop-artifact-size-bytes', artifact.size_bytes);
    response.setHeader('content-type', artifact.content_type);
    response.setHeader('content-length', artifact.size_bytes);
  }

  @Get(INTERNAL_ARTIFACTS_WIRE_PATH)
  async downloadArtifact(
    @Req() request: RawBodyRequest,
    @Query() query: Record<string, unknown>,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    assertOptionalRequesterMatchesSignedActor(request, parseInternalArtifactRefHeaders(request.headers));
    const read = await this.service.getObject(parseInternalArtifactRefQuery(parseInternalArtifactQuery(query)));
    response.setHeader('x-forgeloop-artifact-ref', read.artifact.ref);
    response.setHeader('x-forgeloop-artifact-kind', read.artifact.kind);
    response.setHeader('x-forgeloop-artifact-digest', read.artifact.digest);
    response.setHeader('x-forgeloop-artifact-size-bytes', read.artifact.size_bytes);
    response.setHeader('content-type', read.artifact.content_type);
    response.setHeader('content-length', read.artifact.size_bytes);
    return new StreamableFile(Buffer.from(read.bytes));
  }

  @Delete(INTERNAL_ARTIFACTS_WIRE_PATH)
  @HttpCode(200)
  async deleteArtifact(
    @Req() request: RawBodyRequest,
    @Res({ passthrough: true }) response: HeaderResponse,
  ) {
    const body = parseInternalArtifactRefRequestBody(request.body);
    assertRequesterMatchesSignedActor(request, body);
    const artifact = await this.service.deleteObject(parseInternalArtifactRefBody(body));
    response.setHeader('x-forgeloop-artifact-ref', artifact.ref);
    return {
      schema_version: 'internal_artifact_delete_response.v1',
      artifact: internalArtifactResponse(artifact),
      deleted: true,
    };
  }
}
