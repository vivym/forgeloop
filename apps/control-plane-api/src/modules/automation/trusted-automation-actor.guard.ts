import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import {
  automationActorClassHeaderName,
  automationActorIdHeaderName,
  automationDaemonIdentityHeaderName,
  verifyAutomationRequestSignature,
} from '@forgeloop/automation';
import type { AutomationActorClass } from '@forgeloop/domain';

import {
  INTERNAL_ARTIFACT_METADATA_HEADER_NAME,
  INTERNAL_ARTIFACT_UPLOAD_WIRE_PATH,
} from '../internal-artifacts/internal-artifacts.constants';

type AutomationRequest = {
  method: string;
  originalUrl?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  rawBody?: Buffer;
};

const trustedActorHeaderSecretEnv = 'FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET';

const firstHeaderValue = (headers: Record<string, string | string[] | undefined>, name: string): string | undefined => {
  const direct = headers[name];
  if (direct !== undefined) {
    return Array.isArray(direct) ? direct[0] : direct;
  }

  const lowerName = name.toLowerCase();
  const found = Object.entries(headers).find(([headerName]) => headerName.toLowerCase() === lowerName)?.[1];
  return Array.isArray(found) ? found[0] : found;
};

const requestDeclaresBody = (headers: Record<string, string | string[] | undefined>): boolean => {
  const contentLength = firstHeaderValue(headers, 'content-length')?.trim();
  if (contentLength !== undefined && contentLength.length > 0 && contentLength !== '0') {
    return true;
  }
  return firstHeaderValue(headers, 'transfer-encoding') !== undefined;
};

const signedHeadersForPath = (pathAndQuery: string): string[] | undefined => {
  const path = pathAndQuery.split('?')[0];
  return path === INTERNAL_ARTIFACT_UPLOAD_WIRE_PATH ? [INTERNAL_ARTIFACT_METADATA_HEADER_NAME] : undefined;
};

@Injectable()
export class TrustedAutomationActorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AutomationRequest>();
    const secret = process.env[trustedActorHeaderSecretEnv]?.trim();
    if (secret === undefined || secret.length === 0) {
      throw new UnauthorizedException(`${trustedActorHeaderSecretEnv} is required for internal automation routes`);
    }

    const actorId = firstHeaderValue(request.headers, automationActorIdHeaderName)?.trim();
    const actorClass = firstHeaderValue(request.headers, automationActorClassHeaderName)?.trim();
    const daemonIdentity = firstHeaderValue(request.headers, automationDaemonIdentityHeaderName)?.trim();
    if (
      actorId === undefined ||
      actorId.length === 0 ||
      actorClass === undefined ||
      actorClass.length === 0 ||
      daemonIdentity === undefined ||
      daemonIdentity.length === 0
    ) {
      throw new UnauthorizedException('Internal automation request signature is invalid');
    }

    if (request.rawBody === undefined && requestDeclaresBody(request.headers)) {
      throw new UnauthorizedException('Internal automation request raw body is required');
    }
    const rawBody = request.rawBody ?? Buffer.alloc(0);
    const pathAndQuery = request.originalUrl ?? request.url ?? '';
    const requiredSignedHeaders = signedHeadersForPath(pathAndQuery);
    const verification = verifyAutomationRequestSignature({
      method: request.method,
      pathAndQuery,
      rawBody,
      actorId,
      actorClass: actorClass as AutomationActorClass,
      daemonIdentity,
      headers: request.headers,
      secret,
      ...(requiredSignedHeaders === undefined ? {} : { requiredSignedHeaders }),
    });
    if (!verification.ok) {
      throw new UnauthorizedException('Internal automation request signature is invalid');
    }

    if (actorClass !== 'automation_daemon') {
      throw new ForbiddenException('Internal automation routes require an automation daemon actor');
    }

    return true;
  }
}
