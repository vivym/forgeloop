import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import {
  automationActorClassHeaderName,
  automationActorIdHeaderName,
  automationActorTimestampHeaderName,
  automationDaemonIdentityHeaderName,
  automationActorSignatureHeaderName,
  verifyAutomationRequestSignature,
} from '@forgeloop/automation';
import type { AutomationActorClass } from '@forgeloop/domain';
import { codexCredentialPayloadDigest } from '@forgeloop/domain';
import type { DeliveryRepository } from '@forgeloop/db';

import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';

type CodexSetupRequest = {
  method: string;
  originalUrl?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  rawBody?: Buffer;
  body?: unknown;
};

const trustedActorHeaderSecretEnv = 'FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET';
export const codexRuntimeSetupNonceHeaderName = 'X-Forgeloop-Setup-Nonce';
const replayWindowMs = 5 * 60 * 1000;

const allowedSetupActorClasses = new Set<AutomationActorClass>(['system_bootstrap', 'human_admin']);

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

const bodyActorIds = (body: unknown): string[] => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return [];
  }
  const record = body as Record<string, unknown>;
  const actorIds: string[] = [];
  if (typeof record.created_by_actor_id === 'string') {
    actorIds.push(record.created_by_actor_id);
  }
  if (typeof record.created_by === 'object' && record.created_by !== null && !Array.isArray(record.created_by)) {
    const createdBy = record.created_by as Record<string, unknown>;
    if (typeof createdBy.actor_id === 'string') {
      actorIds.push(createdBy.actor_id);
    }
  }
  for (const value of Object.values(record)) {
    actorIds.push(...bodyActorIds(value));
  }
  return actorIds;
};

const bodySetupNonce = (body: unknown): string | undefined => {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return undefined;
  }
  const value = (body as Record<string, unknown>).setup_nonce;
  return typeof value === 'string' ? value : undefined;
};

@Injectable()
export class TrustedCodexRuntimeSetupGuard implements CanActivate {
  constructor(@Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CodexSetupRequest>();
    const secret = process.env[trustedActorHeaderSecretEnv]?.trim();
    if (secret === undefined || secret.length === 0) {
      throw new UnauthorizedException(`${trustedActorHeaderSecretEnv} is required for Codex runtime setup routes`);
    }

    const setupNonce = firstHeaderValue(request.headers, codexRuntimeSetupNonceHeaderName)?.trim();
    if (setupNonce === undefined || setupNonce.length === 0) {
      throw new UnauthorizedException('Codex runtime setup nonce is required');
    }
    if (bodySetupNonce(request.body) !== setupNonce) {
      throw new UnauthorizedException('Codex runtime setup nonce must be bound to the signed request body');
    }

    const actorId = firstHeaderValue(request.headers, automationActorIdHeaderName)?.trim();
    const actorClass = firstHeaderValue(request.headers, automationActorClassHeaderName)?.trim();
    const daemonIdentity = firstHeaderValue(request.headers, automationDaemonIdentityHeaderName)?.trim();
    const timestamp = firstHeaderValue(request.headers, automationActorTimestampHeaderName)?.trim();
    const signature = firstHeaderValue(request.headers, automationActorSignatureHeaderName)?.trim();
    if (
      actorId === undefined ||
      actorId.length === 0 ||
      actorClass === undefined ||
      actorClass.length === 0 ||
      daemonIdentity === undefined ||
      daemonIdentity.length === 0 ||
      timestamp === undefined ||
      timestamp.length === 0 ||
      signature === undefined ||
      signature.length === 0
    ) {
      throw new UnauthorizedException('Codex runtime setup request signature is invalid');
    }

    if (request.rawBody === undefined || !requestDeclaresBody(request.headers)) {
      throw new UnauthorizedException('Codex runtime setup request body-bound signature is required');
    }

    const verification = verifyAutomationRequestSignature({
      method: request.method,
      pathAndQuery: request.originalUrl ?? request.url ?? '',
      rawBody: request.rawBody,
      actorId,
      actorClass: actorClass as AutomationActorClass,
      daemonIdentity,
      headers: request.headers,
      secret,
    });
    if (!verification.ok) {
      throw new UnauthorizedException('Codex runtime setup request signature is invalid');
    }

    if (!allowedSetupActorClasses.has(actorClass as AutomationActorClass)) {
      throw new ForbiddenException('Codex runtime setup requires a system bootstrap or human admin actor');
    }

    if (bodyActorIds(request.body).some((bodyActorId) => bodyActorId !== actorId)) {
      throw new ForbiddenException('Codex runtime setup body actor does not match signed actor');
    }

    const nowMs = Date.now();
    try {
      await this.repository.consumeCodexRuntimeSetupNonce({
        setup_nonce_hash: codexCredentialPayloadDigest(setupNonce),
        request_signature_hash: codexCredentialPayloadDigest(signature),
        actor_id: actorId,
        actor_class: actorClass,
        created_at: new Date(nowMs).toISOString(),
        expires_at: new Date(nowMs + replayWindowMs).toISOString(),
      });
    } catch {
      throw new UnauthorizedException('Codex runtime setup nonce was already used');
    }

    return true;
  }
}
