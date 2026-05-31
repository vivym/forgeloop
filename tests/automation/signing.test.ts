import { describe, expect, it } from 'vitest';

import {
  canonicalAutomationSignaturePayload,
  signAutomationRequest,
  sha256Hex,
  verifyAutomationRequestSignature,
  type SignAutomationRequestInput,
} from '../../packages/automation/src/index';

describe('automation request signing', () => {
  it('signs exact request bytes and verifies within the timestamp skew window', () => {
    const verifierNow = '2026-05-15T00:00:00.000Z';
    const signingInput = {
      method: 'POST',
      pathAndQuery: '/internal/automation/actions?x=1',
      rawBody: Buffer.from('{"a":1}'),
      actorId: 'daemon-actor',
      actorClass: 'automation_daemon',
      daemonIdentity: 'daemon-1',
      timestamp: verifierNow,
      secret: 'secret',
    } satisfies SignAutomationRequestInput;

    const signed = signAutomationRequest(signingInput);
    const expectedCanonicalPayload =
      'v1\n' +
      'POST\n' +
      '/internal/automation/actions?x=1\n' +
      '015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862\n' +
      'daemon-actor\n' +
      'automation_daemon\n' +
      'daemon-1\n' +
      '2026-05-15T00:00:00.000Z';

    expect(sha256Hex(signingInput.rawBody)).toBe('015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862');
    expect(canonicalAutomationSignaturePayload(signingInput)).toBe(expectedCanonicalPayload);
    expect(signed['X-Forgeloop-Actor-Body-SHA256']).toBe(
      '015abd7f5cc57a2dd94b7590f04ad8084273905ee33ec5cebeae62276a97f862',
    );
    expect(signed['X-Forgeloop-Actor-Signature']).toBe(
      'v1=ce793348144bea47251b66aab2af04cb19dde89b232990e475927d83c8ca30fb',
    );
    expect(verifyAutomationRequestSignature({ ...signingInput, headers: signed, now: verifierNow })).toEqual({ ok: true });
    expect(
      verifyAutomationRequestSignature({
        ...signingInput,
        rawBody: Buffer.from('{"a":2}'),
        headers: signed,
        now: verifierNow,
      }),
    ).toMatchObject({ ok: false });
    expect(
      verifyAutomationRequestSignature({
        ...signingInput,
        pathAndQuery: '/internal/automation/actions?x=2',
        headers: signed,
        now: verifierNow,
      }),
    ).toMatchObject({ ok: false });

    const insideWindow = signAutomationRequest({ ...signingInput, timestamp: '2026-05-14T23:55:01.000Z' });
    expect(verifyAutomationRequestSignature({ ...signingInput, headers: insideWindow, now: verifierNow })).toEqual({
      ok: true,
    });

    const expired = signAutomationRequest({ ...signingInput, timestamp: '2026-05-14T23:54:59.000Z' });
    expect(verifyAutomationRequestSignature({ ...signingInput, headers: expired, now: verifierNow })).toMatchObject({
      ok: false,
      reason: 'timestamp_skew',
    });
  });

  it('rejects signed non-ISO timestamps', () => {
    const verifierNow = '2026-05-15T00:00:00.000Z';
    const signingInput = {
      method: 'POST',
      pathAndQuery: '/internal/automation/actions?x=1',
      rawBody: Buffer.from('{"a":1}'),
      actorId: 'daemon-actor',
      actorClass: 'automation_daemon',
      daemonIdentity: 'daemon-1',
      timestamp: 'Fri, 15 May 2026 00:00:00 GMT',
      secret: 'secret',
    } satisfies SignAutomationRequestInput;
    const signed = signAutomationRequest(signingInput);

    expect(verifyAutomationRequestSignature({ ...signingInput, headers: signed, now: verifierNow })).toEqual({
      ok: false,
      reason: 'timestamp_invalid',
    });
  });

  it('optionally signs selected request headers without changing default signatures', () => {
    const verifierNow = '2026-05-15T00:00:00.000Z';
    const signingInput = {
      method: 'POST',
      pathAndQuery: '/internal/artifacts:upload',
      rawBody: Buffer.from('hello'),
      actorId: 'daemon-actor',
      actorClass: 'automation_daemon',
      daemonIdentity: 'daemon-1',
      timestamp: verifierNow,
      secret: 'secret',
      signedHeaders: {
        'x-forgeloop-artifact-metadata': 'metadata-v1',
      },
    } satisfies SignAutomationRequestInput;

    const signed = signAutomationRequest(signingInput);

    expect(canonicalAutomationSignaturePayload(signingInput)).toContain(
      '\nsigned_headers\nx-forgeloop-artifact-metadata:metadata-v1',
    );
    expect(
      verifyAutomationRequestSignature({
        ...signingInput,
        headers: {
          ...signed,
          'X-Forgeloop-Artifact-Metadata': 'metadata-v1',
        },
        now: verifierNow,
        requiredSignedHeaders: ['x-forgeloop-artifact-metadata'],
      }),
    ).toEqual({ ok: true });
    expect(
      verifyAutomationRequestSignature({
        ...signingInput,
        headers: {
          ...signed,
          'X-Forgeloop-Artifact-Metadata': 'metadata-v2',
        },
        now: verifierNow,
        requiredSignedHeaders: ['x-forgeloop-artifact-metadata'],
      }),
    ).toEqual({ ok: false, reason: 'signature_mismatch' });
    expect(
      verifyAutomationRequestSignature({
        ...signingInput,
        headers: signed,
        now: verifierNow,
        requiredSignedHeaders: ['x-forgeloop-artifact-metadata'],
      }),
    ).toEqual({ ok: false, reason: 'signed_header_mismatch' });
  });

  it('rejects non-string signed header values at signing time', () => {
    const signingInput = {
      method: 'POST',
      pathAndQuery: '/internal/artifacts:upload',
      rawBody: Buffer.from('hello'),
      actorId: 'daemon-actor',
      actorClass: 'automation_daemon',
      daemonIdentity: 'daemon-1',
      timestamp: '2026-05-15T00:00:00.000Z',
      secret: 'secret',
      signedHeaders: {
        'x-forgeloop-artifact-metadata': ['metadata-v1'],
      },
    } as unknown as SignAutomationRequestInput;

    expect(() => signAutomationRequest(signingInput)).toThrow(/signed header/i);
    expect(() => canonicalAutomationSignaturePayload(signingInput)).toThrow(/signed header/i);
  });
});
