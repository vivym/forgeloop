import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import type { AutomationActorClass } from '@forgeloop/domain';

export const automationActorIdHeaderName = 'X-Forgeloop-Actor-Id';
export const automationActorClassHeaderName = 'X-Forgeloop-Actor-Class';
export const automationDaemonIdentityHeaderName = 'X-Forgeloop-Daemon-Identity';
export const automationActorTimestampHeaderName = 'X-Forgeloop-Actor-Timestamp';
export const automationActorBodySha256HeaderName = 'X-Forgeloop-Actor-Body-SHA256';
export const automationActorSignatureHeaderName = 'X-Forgeloop-Actor-Signature';

export interface SignAutomationRequestInput {
  method: string;
  pathAndQuery: string;
  rawBody: Buffer | string;
  actorId: string;
  actorClass: AutomationActorClass;
  daemonIdentity: string;
  timestamp: string;
  secret: string | Buffer;
  signedHeaders?: SignedAutomationHeaderValuesInput;
}

export interface AutomationRequestSignatureHeaders {
  [automationActorIdHeaderName]: string;
  [automationActorClassHeaderName]: string;
  [automationDaemonIdentityHeaderName]: string;
  [automationActorTimestampHeaderName]: string;
  [automationActorBodySha256HeaderName]: string;
  [automationActorSignatureHeaderName]: string;
}

export type AutomationRequestHeaderInput = Record<string, string | string[] | undefined>;
export type SignedAutomationHeaderValuesInput = Record<string, string | undefined>;

export type AutomationSignatureFailureReason =
  | 'missing_header'
  | 'actor_mismatch'
  | 'body_sha_mismatch'
  | 'signed_header_mismatch'
  | 'timestamp_invalid'
  | 'timestamp_skew'
  | 'signature_format'
  | 'signature_mismatch';

export type AutomationSignatureVerificationResult =
  | { ok: true }
  | { ok: false; reason: AutomationSignatureFailureReason };

export interface VerifyAutomationRequestSignatureInput extends Omit<SignAutomationRequestInput, 'timestamp' | 'signedHeaders'> {
  headers: AutomationRequestHeaderInput;
  requiredSignedHeaders?: string[];
  now?: string | number | Date;
  skewToleranceMs?: number;
}

const signatureVersion = 'v1';
const defaultSkewToleranceMs = 5 * 60 * 1000;
const utcIsoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const sha256Hex = (rawBody: Buffer | string): string => createHash('sha256').update(rawBody).digest('hex');

const signedHeaderName = (name: string): string => name.trim().toLowerCase();

const signedHeaderEntries = (headers: SignedAutomationHeaderValuesInput | undefined): Array<[string, string]> => {
  if (headers === undefined) {
    return [];
  }

  const values = new Map<string, string>();
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = signedHeaderName(rawName);
    if (name.length === 0 || rawValue === undefined) {
      continue;
    }
    if (typeof rawValue !== 'string') {
      throw new TypeError('Signed header values must be strings');
    }
    values.set(name, rawValue.trim());
  }
  return [...values.entries()].sort(([left], [right]) => left.localeCompare(right));
};

const signedHeaderBlock = (headers: SignedAutomationHeaderValuesInput | undefined): string[] => {
  const entries = signedHeaderEntries(headers);
  if (entries.length === 0) {
    return [];
  }
  return ['signed_headers', ...entries.map(([name, value]) => `${name}:${value}`)];
};

export const canonicalAutomationSignaturePayload = (input: Omit<SignAutomationRequestInput, 'secret'>): string =>
  [
    signatureVersion,
    input.method.toUpperCase(),
    input.pathAndQuery,
    sha256Hex(input.rawBody),
    input.actorId,
    input.actorClass,
    input.daemonIdentity,
    input.timestamp,
    ...signedHeaderBlock(input.signedHeaders),
  ].join('\n');

export const signAutomationRequest = (input: SignAutomationRequestInput): AutomationRequestSignatureHeaders => {
  const signaturePayload = canonicalAutomationSignaturePayload(input);
  const signature = createHmac('sha256', input.secret).update(signaturePayload).digest('hex');

  return {
    [automationActorIdHeaderName]: input.actorId,
    [automationActorClassHeaderName]: input.actorClass,
    [automationDaemonIdentityHeaderName]: input.daemonIdentity,
    [automationActorTimestampHeaderName]: input.timestamp,
    [automationActorBodySha256HeaderName]: sha256Hex(input.rawBody),
    [automationActorSignatureHeaderName]: `${signatureVersion}=${signature}`,
  };
};

const firstHeaderValue = (headers: AutomationRequestHeaderInput, name: string): string | undefined => {
  const direct = headers[name];
  if (direct !== undefined) {
    return Array.isArray(direct) ? direct[0] : direct;
  }

  const lowerName = name.toLowerCase();
  const found = Object.entries(headers).find(([headerName]) => headerName.toLowerCase() === lowerName)?.[1];
  return Array.isArray(found) ? found[0] : found;
};

const uniqueHeaderValue = (headers: AutomationRequestHeaderInput, name: string): string | undefined => {
  const lowerName = name.toLowerCase();
  const matches = Object.entries(headers).filter(([headerName]) => headerName.toLowerCase() === lowerName);
  if (matches.length !== 1) {
    return undefined;
  }
  const value = matches[0]?.[1];
  return typeof value === 'string' ? value : undefined;
};

const signedHeadersForVerification = (
  requiredHeaders: string[] | undefined,
  requestHeaders: AutomationRequestHeaderInput,
): SignedAutomationHeaderValuesInput | undefined => {
  const required = [...new Set((requiredHeaders ?? []).map(signedHeaderName).filter((name) => name.length > 0))].sort();
  if (required.length === 0) {
    return undefined;
  }

  const signedHeaders: Record<string, string> = {};
  for (const name of required) {
    const value = uniqueHeaderValue(requestHeaders, name);
    if (value === undefined || value.trim().length === 0) {
      return undefined;
    }
    signedHeaders[name] = value.trim();
  }
  return signedHeaders;
};

const headerValues = (headers: AutomationRequestHeaderInput) => {
  const actorId = firstHeaderValue(headers, automationActorIdHeaderName)?.trim();
  const actorClass = firstHeaderValue(headers, automationActorClassHeaderName)?.trim();
  const daemonIdentity = firstHeaderValue(headers, automationDaemonIdentityHeaderName)?.trim();
  const timestamp = firstHeaderValue(headers, automationActorTimestampHeaderName)?.trim();
  const bodySha256 = firstHeaderValue(headers, automationActorBodySha256HeaderName)?.trim();
  const signature = firstHeaderValue(headers, automationActorSignatureHeaderName)?.trim();

  if (
    actorId === undefined ||
    actorClass === undefined ||
    daemonIdentity === undefined ||
    timestamp === undefined ||
    bodySha256 === undefined ||
    signature === undefined ||
    actorId.length === 0 ||
    actorClass.length === 0 ||
    daemonIdentity.length === 0 ||
    timestamp.length === 0 ||
    bodySha256.length === 0 ||
    signature.length === 0
  ) {
    return undefined;
  }

  return { actorId, actorClass, daemonIdentity, timestamp, bodySha256, signature };
};

const dateMs = (value: string | number | Date): number => {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === 'number') {
    return value;
  }
  return Date.parse(value);
};

const verifiedUtcIsoTimestampMs = (timestamp: string): number | undefined => {
  if (!utcIsoTimestampPattern.test(timestamp)) {
    return undefined;
  }

  const timestampMs = Date.parse(timestamp);
  if (Number.isNaN(timestampMs) || new Date(timestampMs).toISOString() !== timestamp) {
    return undefined;
  }

  return timestampMs;
};

const safeHexEquals = (expectedHex: string, receivedHex: string): boolean => {
  const expected = Buffer.from(expectedHex, 'hex');
  const received = Buffer.from(receivedHex, 'hex');
  return expected.length === received.length && timingSafeEqual(expected, received);
};

export const verifyAutomationRequestSignature = (
  input: VerifyAutomationRequestSignatureInput,
): AutomationSignatureVerificationResult => {
  const headers = headerValues(input.headers);
  if (headers === undefined) {
    return { ok: false, reason: 'missing_header' };
  }

  if (
    headers.actorId !== input.actorId ||
    headers.actorClass !== input.actorClass ||
    headers.daemonIdentity !== input.daemonIdentity
  ) {
    return { ok: false, reason: 'actor_mismatch' };
  }

  const bodySha256 = sha256Hex(input.rawBody);
  if (headers.bodySha256 !== bodySha256) {
    return { ok: false, reason: 'body_sha_mismatch' };
  }

  const signedHeaders = signedHeadersForVerification(input.requiredSignedHeaders, input.headers);
  if (input.requiredSignedHeaders !== undefined && signedHeaders === undefined) {
    return { ok: false, reason: 'signed_header_mismatch' };
  }

  const timestampMs = verifiedUtcIsoTimestampMs(headers.timestamp);
  const nowMs = input.now === undefined ? Date.now() : dateMs(input.now);
  if (timestampMs === undefined || Number.isNaN(nowMs)) {
    return { ok: false, reason: 'timestamp_invalid' };
  }
  if (Math.abs(nowMs - timestampMs) > (input.skewToleranceMs ?? defaultSkewToleranceMs)) {
    return { ok: false, reason: 'timestamp_skew' };
  }

  const signatureMatch = /^v1=([0-9a-f]{64})$/.exec(headers.signature);
  if (signatureMatch === null) {
    return { ok: false, reason: 'signature_format' };
  }
  const receivedSignature = signatureMatch[1];
  if (receivedSignature === undefined) {
    return { ok: false, reason: 'signature_format' };
  }

  const expectedPayload = canonicalAutomationSignaturePayload({
    method: input.method,
    pathAndQuery: input.pathAndQuery,
    rawBody: input.rawBody,
    actorId: headers.actorId,
    actorClass: headers.actorClass as AutomationActorClass,
    daemonIdentity: headers.daemonIdentity,
    timestamp: headers.timestamp,
    ...(signedHeaders === undefined ? {} : { signedHeaders }),
  });
  const expectedSignature = createHmac('sha256', input.secret).update(expectedPayload).digest('hex');

  return safeHexEquals(expectedSignature, receivedSignature)
    ? { ok: true }
    : { ok: false, reason: 'signature_mismatch' };
};
