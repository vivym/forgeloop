import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import type { AutomationActorClass } from '@forgeloop/domain';

export const actorHeaderName = 'x-forgeloop-actor-id';
export const actorClassHeaderName = 'x-forgeloop-actor-class';
export const daemonIdentityHeaderName = 'x-forgeloop-daemon-identity';
export const actorTimestampHeaderName = 'x-forgeloop-actor-timestamp';
export const actorSignatureHeaderName = 'x-forgeloop-actor-signature';

export type ActorContext = {
  authenticatedActorId?: string;
  actorClass?: AutomationActorClass;
  daemonIdentity?: string;
};

export type RunEventStreamTokenPayload = {
  run_session_id: string;
  actor_id: string;
  expires_at: string;
  nonce: string;
};

const fallbackStreamTokenSecret = 'forgeloop-dev-auth-fallback';
const trustedActorHeaderSecretEnv = 'FORGELOOP_TRUSTED_ACTOR_HEADER_SECRET';
const trustedActorHeaderToleranceMs = 5 * 60 * 1000;

const base64urlJson = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

const sign = (encodedPayload: string, secret: string): string =>
  createHmac('sha256', secret).update(encodedPayload).digest('base64url');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const automationActorClasses = new Set<AutomationActorClass>([
  'human_admin',
  'human',
  'system_bootstrap',
  'migration',
  'automation_daemon',
  'source_adapter',
  'external_tracker',
  'repo_policy',
]);

const firstHeaderValue = (
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>,
  name: string,
): string | undefined => {
  const headerValue = headers[name] ?? Object.entries(headers).find(([headerName]) => headerName.toLowerCase() === name)?.[1];
  return Array.isArray(headerValue) ? headerValue[0] : headerValue;
};

const actorClassFromHeader = (value: string | undefined): AutomationActorClass | undefined => {
  const normalized = value?.trim();
  if (normalized === undefined || normalized.length === 0) {
    return undefined;
  }
  if (!automationActorClasses.has(normalized as AutomationActorClass)) {
    throw new BadRequestException(`Invalid ${actorClassHeaderName} value`);
  }
  return normalized as AutomationActorClass;
};

export const trustedActorHeaderSignature = (
  input: {
    actorId?: string;
    actorClass?: AutomationActorClass;
    daemonIdentity?: string;
    timestamp: string;
  },
  secret: string,
): string =>
  sign([input.actorId ?? '', input.actorClass ?? '', input.daemonIdentity ?? '', input.timestamp].join('\n'), secret);

const trustedActorHeaderSignatureRequired = (env: NodeJS.ProcessEnv): boolean =>
  env.NODE_ENV === 'production' || env.FORGELOOP_REQUIRE_TRUSTED_ACTOR_SIGNATURE === '1';

const trustedActorHeaderSecret = (env: NodeJS.ProcessEnv, required: boolean): string | undefined => {
  const configured = env[trustedActorHeaderSecretEnv]?.trim();
  if (configured !== undefined && configured.length > 0) {
    return configured;
  }
  if (required) {
    throw new UnauthorizedException(`${trustedActorHeaderSecretEnv} is required to trust actor headers`);
  }
  return undefined;
};

const verifyTrustedActorHeaders = (
  headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>,
  actor: {
    actorId?: string;
    actorClass?: AutomationActorClass;
    daemonIdentity?: string;
  },
  env: NodeJS.ProcessEnv,
): void => {
  const timestamp = firstHeaderValue(headers, actorTimestampHeaderName)?.trim();
  const signature = firstHeaderValue(headers, actorSignatureHeaderName)?.trim();
  const signatureRequired = trustedActorHeaderSignatureRequired(env);
  if (!signatureRequired && timestamp === undefined && signature === undefined) {
    return;
  }
  const secret = trustedActorHeaderSecret(env, signatureRequired || timestamp !== undefined || signature !== undefined);
  if (secret === undefined) {
    throw new UnauthorizedException(`${trustedActorHeaderSecretEnv} is required to trust actor headers`);
  }
  if (timestamp === undefined || timestamp.length === 0 || signature === undefined || signature.length === 0) {
    throw new UnauthorizedException('Trusted actor headers require timestamp and signature');
  }

  const timestampMs = Date.parse(timestamp);
  if (Number.isNaN(timestampMs) || Math.abs(Date.now() - timestampMs) > trustedActorHeaderToleranceMs) {
    throw new UnauthorizedException('Trusted actor header timestamp is invalid or expired');
  }

  const expectedSignature = trustedActorHeaderSignature(
    {
      ...(actor.actorId === undefined ? {} : { actorId: actor.actorId }),
      ...(actor.actorClass === undefined ? {} : { actorClass: actor.actorClass }),
      ...(actor.daemonIdentity === undefined ? {} : { daemonIdentity: actor.daemonIdentity }),
      timestamp,
    },
    secret,
  );
  const expected = Buffer.from(expectedSignature, 'base64url');
  const received = Buffer.from(signature, 'base64url');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new UnauthorizedException('Trusted actor header signature is invalid');
  }
};

export const actorContextFromHeaders = (headers: IncomingHttpHeaders | Record<string, string | string[] | undefined>): ActorContext => {
  const actorId = firstHeaderValue(headers, actorHeaderName);
  const normalized = actorId?.trim();
  const actorClass = actorClassFromHeader(firstHeaderValue(headers, actorClassHeaderName));
  const daemonIdentity = firstHeaderValue(headers, daemonIdentityHeaderName)?.trim();
  const actor = {
    ...(normalized === undefined || normalized.length === 0 ? {} : { actorId: normalized }),
    ...(actorClass === undefined ? {} : { actorClass }),
    ...(daemonIdentity === undefined || daemonIdentity.length === 0 ? {} : { daemonIdentity }),
  };
  if (Object.keys(actor).length > 0) {
    verifyTrustedActorHeaders(headers, actor, process.env);
  }

  return {
    ...(normalized === undefined || normalized.length === 0 ? {} : { authenticatedActorId: normalized }),
    ...(actorClass === undefined ? {} : { actorClass }),
    ...(daemonIdentity === undefined || daemonIdentity.length === 0 ? {} : { daemonIdentity }),
  };
};

export const resolveRunEventStreamTokenSecret = (env: NodeJS.ProcessEnv): string => {
  const configured = env.FORGELOOP_DEV_AUTH_SECRET?.trim();
  if (configured !== undefined && configured.length > 0) {
    return configured;
  }

  if (env.NODE_ENV !== 'production') {
    return fallbackStreamTokenSecret;
  }

  throw new Error('FORGELOOP_DEV_AUTH_SECRET is required to create run event stream tokens in production');
};

export const createRunEventStreamToken = (payload: RunEventStreamTokenPayload, secret: string): string => {
  const encodedPayload = base64urlJson(payload);
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
};

export const verifyRunEventStreamToken = (
  token: string,
  secret: string,
  now: number = Date.now(),
): RunEventStreamTokenPayload => {
  const [encodedPayload, encodedSignature, extra] = token.split('.');
  if (encodedPayload === undefined || encodedSignature === undefined || extra !== undefined) {
    throw new Error('Invalid run event stream token');
  }

  const expectedSignature = sign(encodedPayload, secret);
  const expected = Buffer.from(expectedSignature, 'base64url');
  const received = Buffer.from(encodedSignature, 'base64url');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new Error('Invalid run event stream token signature');
  }

  const parsed: unknown = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  if (
    !isRecord(parsed) ||
    typeof parsed.run_session_id !== 'string' ||
    typeof parsed.actor_id !== 'string' ||
    typeof parsed.expires_at !== 'string' ||
    typeof parsed.nonce !== 'string' ||
    parsed.run_session_id.trim().length === 0 ||
    parsed.actor_id.trim().length === 0 ||
    parsed.nonce.trim().length === 0 ||
    Number.isNaN(Date.parse(parsed.expires_at))
  ) {
    throw new Error('Invalid run event stream token payload');
  }

  if (Date.parse(parsed.expires_at) <= now) {
    throw new Error('Run event stream token expired');
  }

  return {
    run_session_id: parsed.run_session_id,
    actor_id: parsed.actor_id,
    expires_at: parsed.expires_at,
    nonce: parsed.nonce,
  };
};
