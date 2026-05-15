import { describe, expect, it } from 'vitest';

import {
  signAutomationRequest,
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

    expect(signed['X-Forgeloop-Actor-Body-SHA256']).toHaveLength(64);
    expect(signed['X-Forgeloop-Actor-Signature']).toMatch(/^v1=[0-9a-f]{64}$/);
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
});
