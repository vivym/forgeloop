import { describe, expect, it } from 'vitest';

import { codexLaunchTokenEnvelopeDigest } from '@forgeloop/domain';

import {
  codexLaunchTokenEnvelopeAadDigest,
  decryptCodexLaunchTokenEnvelope,
  generateCodexWorkerSessionKeyPair,
  probeCodexLaunchTokenEnvelopeCrypto,
  sealCodexLaunchTokenEnvelope,
  type SealedEnvelope,
} from '../../packages/codex-worker-runtime/src/index';

const launchToken = 'codex-launch-token-secret';
const fixedNonce = new Uint8Array([1, 35, 69, 103, 137, 171, 205, 239, 16, 50, 84, 118]);
const textEncoder = new TextEncoder();

const createAad = (overrides: Record<string, string> = {}) => ({
  worker_id: 'worker-1',
  runtime_job_id: 'runtime-job-1',
  launch_lease_id: 'launch-lease-1',
  envelope_id: 'envelope-1',
  key_id: 'placeholder-key-id',
  expires_at: '2026-05-22T00:10:00.000Z',
  ...overrides,
});

const sealForGeneratedPair = async () => {
  const keyPair = await generateCodexWorkerSessionKeyPair({});
  const aad = createAad({ key_id: keyPair.keyId });
  const sealed = await sealCodexLaunchTokenEnvelope({
    plaintext_launch_token: launchToken,
    runtime_job_id: aad.runtime_job_id,
    launch_lease_id: aad.launch_lease_id,
    envelope_id: aad.envelope_id,
    worker_id: aad.worker_id,
    worker_public_key_material: keyPair.publicKeyMaterial,
    key_id: keyPair.keyId,
    expires_at: aad.expires_at,
    testOnly: {
      nonceBytes: fixedNonce,
    },
  });

  return { keyPair, aad, sealed };
};

const base64UrlEncode = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

const base64UrlDecode = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, 'base64url'));

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const canonicalJsonBytes = (value: Record<string, unknown>): Uint8Array =>
  textEncoder.encode(JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))));

const sealWithMalformedNonce = async (nonceBytes: Uint8Array): Promise<{ keyPair: Awaited<ReturnType<typeof generateCodexWorkerSessionKeyPair>>; envelope: SealedEnvelope }> => {
  const keyPair = await generateCodexWorkerSessionKeyPair({});
  const aad = createAad({ key_id: keyPair.keyId });
  const aadBytes = canonicalJsonBytes(aad);
  const subtle = globalThis.crypto.subtle;
  const workerPublicKey = await subtle.importKey('raw', toArrayBuffer(base64UrlDecode(keyPair.publicKeyMaterial)), { name: 'X25519' }, true, []);
  const senderKeyPair = (await subtle.generateKey({ name: 'X25519' }, false, ['deriveBits'])) as CryptoKeyPair;
  const sharedSecret = await subtle.deriveBits({ name: 'X25519', public: workerPublicKey }, senderKeyPair.privateKey, 256);
  const hkdfKey = await subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey']);
  const aesKey = await subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new ArrayBuffer(32), info: toArrayBuffer(aadBytes) },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const encrypted = await subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(nonceBytes), additionalData: toArrayBuffer(aadBytes), tagLength: 128 },
    aesKey,
    textEncoder.encode(launchToken),
  );
  const senderPublicKeyMaterial = base64UrlEncode(new Uint8Array(await subtle.exportKey('raw', senderKeyPair.publicKey)));
  const ciphertext = base64UrlEncode(
    canonicalJsonBytes({
      encrypted_launch_token: base64UrlEncode(new Uint8Array(encrypted)),
      sender_public_key_material: senderPublicKeyMaterial,
      v: 1,
    }),
  );
  const envelopeWithoutDigest = {
    id: aad.envelope_id,
    runtime_job_id: aad.runtime_job_id,
    launch_lease_id: aad.launch_lease_id,
    worker_id: aad.worker_id,
    key_id: aad.key_id,
    algorithm: 'x25519-hkdf-sha256-aes-256-gcm' as const,
    ciphertext,
    encryption_nonce: base64UrlEncode(nonceBytes),
    aad_json: aad,
    aad_digest: codexLaunchTokenEnvelopeAadDigest(aad),
    expires_at: aad.expires_at,
  };

  return {
    keyPair,
    envelope: {
      ...envelopeWithoutDigest,
      envelope_digest: codexLaunchTokenEnvelopeDigest(envelopeWithoutDigest),
    },
  };
};

describe('codex launch token envelope crypto', () => {
  it('probes X25519 envelope support at startup', async () => {
    await expect(probeCodexLaunchTokenEnvelopeCrypto()).resolves.toBeUndefined();
  });

  it('seals a launch token for a generated worker key pair and decrypts it with the private key handle', async () => {
    const { keyPair, sealed } = await sealForGeneratedPair();

    await expect(
      decryptCodexLaunchTokenEnvelope({
        envelope: sealed,
        privateKeyHandle: keyPair.privateKeyHandle,
      }),
    ).resolves.toBe(launchToken);
  });

  it('binds decrypt to worker id, runtime job id, launch lease id, envelope id, key id, and expiry AAD', async () => {
    const { keyPair, sealed } = await sealForGeneratedPair();

    for (const aadField of ['worker_id', 'runtime_job_id', 'launch_lease_id', 'envelope_id', 'key_id', 'expires_at'] as const) {
      await expect(
        decryptCodexLaunchTokenEnvelope({
          envelope: {
            ...sealed,
            aad_json: {
              ...sealed.aad_json,
              [aadField]: `${sealed.aad_json[aadField]}-changed`,
            },
            aad_digest: codexLaunchTokenEnvelopeAadDigest({
              ...sealed.aad_json,
              [aadField]: `${sealed.aad_json[aadField]}-changed`,
            }),
          },
          privateKeyHandle: keyPair.privateKeyHandle,
        }),
      ).rejects.toThrow(/decrypt/i);
    }
  });

  it('rejects changed ciphertext, nonce, key id, or private key without exposing plaintext', async () => {
    const { keyPair, sealed } = await sealForGeneratedPair();
    const otherKeyPair = await generateCodexWorkerSessionKeyPair({});

    await expect(
      decryptCodexLaunchTokenEnvelope({
        envelope: { ...sealed, ciphertext: `${sealed.ciphertext.slice(0, -1)}A` },
        privateKeyHandle: keyPair.privateKeyHandle,
      }),
    ).rejects.toThrow(/decrypt/i);
    await expect(
      decryptCodexLaunchTokenEnvelope({
        envelope: { ...sealed, encryption_nonce: `${sealed.encryption_nonce.slice(0, -1)}A` },
        privateKeyHandle: keyPair.privateKeyHandle,
      }),
    ).rejects.toThrow(/decrypt/i);
    await expect(
      decryptCodexLaunchTokenEnvelope({
        envelope: { ...sealed, key_id: 'different-key-id' },
        privateKeyHandle: keyPair.privateKeyHandle,
      }),
    ).rejects.toThrow(/decrypt/i);
    await expect(
      decryptCodexLaunchTokenEnvelope({
        envelope: sealed,
        privateKeyHandle: otherKeyPair.privateKeyHandle,
      }),
    ).rejects.toThrow(/decrypt/i);
  });

  it('keeps generated private key handles non-extractable', async () => {
    const keyPair = await generateCodexWorkerSessionKeyPair({});

    expect(keyPair.privateKeyHandle.extractable).toBe(false);
    await expect(globalThis.crypto.subtle.exportKey('pkcs8', keyPair.privateKeyHandle)).rejects.toThrow();
  });

  it('rejects deterministic test hooks outside test runtime', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const keyPair = await generateCodexWorkerSessionKeyPair({});

      await expect(
        sealCodexLaunchTokenEnvelope({
          plaintext_launch_token: launchToken,
          runtime_job_id: 'runtime-job-production-hook',
          launch_lease_id: 'launch-lease-production-hook',
          envelope_id: 'envelope-production-hook',
          worker_id: 'worker-production-hook',
          worker_public_key_material: keyPair.publicKeyMaterial,
          key_id: keyPair.keyId,
          expires_at: '2026-05-22T00:10:00.000Z',
          testOnly: {
            nonceBytes: fixedNonce,
          },
        }),
      ).rejects.toThrow(/test-only/i);
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    }
  });

  it('rejects non-96-bit envelope nonces even when the ciphertext authenticates', async () => {
    const { keyPair, envelope } = await sealWithMalformedNonce(new Uint8Array(16).fill(7));

    await expect(
      decryptCodexLaunchTokenEnvelope({
        envelope,
        privateKeyHandle: keyPair.privateKeyHandle,
      }),
    ).rejects.toThrow(/decrypt/i);
  });

  it('creates stable AAD and envelope digests while excluding envelope_digest itself', async () => {
    const { sealed } = await sealForGeneratedPair();
    const reorderedAad = {
      expires_at: sealed.aad_json.expires_at,
      key_id: sealed.aad_json.key_id,
      envelope_id: sealed.aad_json.envelope_id,
      launch_lease_id: sealed.aad_json.launch_lease_id,
      runtime_job_id: sealed.aad_json.runtime_job_id,
      worker_id: sealed.aad_json.worker_id,
    };

    expect(codexLaunchTokenEnvelopeAadDigest(sealed.aad_json)).toBe(codexLaunchTokenEnvelopeAadDigest(reorderedAad));
    expect(sealed.aad_digest).toBe(codexLaunchTokenEnvelopeAadDigest(sealed.aad_json));
    expect(sealed.envelope_digest).toBe(codexLaunchTokenEnvelopeDigest(sealed));
    expect(codexLaunchTokenEnvelopeDigest({ ...sealed, envelope_digest: `sha256:${'a'.repeat(64)}` })).toBe(
      sealed.envelope_digest,
    );
  });
});
