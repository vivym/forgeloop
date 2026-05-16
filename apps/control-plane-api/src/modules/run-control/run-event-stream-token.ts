import { createHmac, timingSafeEqual } from 'node:crypto';

export type RunEventStreamTokenPayload = {
  run_session_id: string;
  actor_id: string;
  expires_at: string;
  nonce: string;
};

const fallbackStreamTokenSecret = 'forgeloop-dev-auth-fallback';

const base64urlJson = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');

const sign = (encodedPayload: string, secret: string): string =>
  createHmac('sha256', secret).update(encodedPayload).digest('base64url');

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

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
