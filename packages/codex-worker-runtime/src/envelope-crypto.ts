import {
  codexCanonicalDigest,
  codexLaunchTokenEnvelopeDigest,
  type CodexLaunchTokenEnvelope,
} from '@forgeloop/domain';

const algorithm = 'x25519-hkdf-sha256-aes-256-gcm' as const;
const aesGcmNonceLength = 12;
const x25519PublicKeyLength = 32;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

interface X25519KeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

export type SealedEnvelope = Omit<CodexLaunchTokenEnvelope, 'status' | 'created_at'>;

export type CodexLaunchTokenEnvelopeAad = Record<string, string> & {
  worker_id: string;
  runtime_job_id: string;
  launch_lease_id: string;
  envelope_id: string;
  key_id: string;
  expires_at: string;
};

export interface GenerateCodexWorkerSessionKeyPairInput {
  testOnly?: {
    keyPair?: X25519KeyPair;
  };
}

export interface CodexWorkerSessionKeyPair {
  publicKeyMaterial: string;
  privateKeyHandle: CryptoKey;
  keyId: string;
}

export interface SealCodexLaunchTokenEnvelopeInput {
  plaintext_launch_token: string;
  runtime_job_id: string;
  launch_lease_id: string;
  envelope_id: string;
  worker_id: string;
  worker_public_key_material: string;
  key_id: string;
  expires_at: string;
  testOnly?: {
    nonceBytes?: Uint8Array;
    senderKeyPair?: X25519KeyPair;
  };
}

export interface DecryptCodexLaunchTokenEnvelopeInput {
  envelope: SealedEnvelope;
  privateKeyHandle: CryptoKey;
}

interface SealedCiphertextPayload {
  v: 1;
  sender_public_key_material: string;
  encrypted_launch_token: string;
}

export const probeCodexLaunchTokenEnvelopeCrypto = async (): Promise<void> => {
  const keyPair = await generateCodexWorkerSessionKeyPair({});
  const sealed = await sealCodexLaunchTokenEnvelope({
    plaintext_launch_token: 'probe',
    runtime_job_id: 'probe-runtime-job',
    launch_lease_id: 'probe-launch-lease',
    envelope_id: 'probe-envelope',
    worker_id: 'probe-worker',
    worker_public_key_material: keyPair.publicKeyMaterial,
    key_id: keyPair.keyId,
    expires_at: '1970-01-01T00:00:00.000Z',
  });
  const decrypted = await decryptCodexLaunchTokenEnvelope({
    envelope: sealed,
    privateKeyHandle: keyPair.privateKeyHandle,
  });

  if (decrypted !== 'probe') {
    throw new Error('Codex launch token envelope crypto probe failed.');
  }
};

export const generateCodexWorkerSessionKeyPair = async (
  input: GenerateCodexWorkerSessionKeyPairInput,
): Promise<CodexWorkerSessionKeyPair> => {
  const subtle = subtleCrypto();
  if (input.testOnly !== undefined) {
    assertTestOnlyCryptoHookAllowed();
  }
  const keyPair = input.testOnly?.keyPair ?? (await generateX25519KeyPair(subtle));
  const publicKeyMaterial = await exportX25519PublicKeyMaterial(subtle, keyPair.publicKey);

  return {
    publicKeyMaterial,
    privateKeyHandle: keyPair.privateKey,
    keyId: codexWorkerSessionKeyId(publicKeyMaterial),
  };
};

export const sealCodexLaunchTokenEnvelope = async (
  input: SealCodexLaunchTokenEnvelopeInput,
): Promise<SealedEnvelope> => {
  const subtle = subtleCrypto();
  if (input.testOnly !== undefined) {
    assertTestOnlyCryptoHookAllowed();
  }
  const aad_json = launchTokenEnvelopeAad(input);
  const aadBytes = canonicalJsonBytes(aad_json);
  const nonceBytes = input.testOnly?.nonceBytes ?? randomBytes(aesGcmNonceLength);
  if (nonceBytes.byteLength !== aesGcmNonceLength) {
    throw new Error('Codex launch token envelope nonce must be 96 bits.');
  }

  const workerPublicKey = await importX25519PublicKeyMaterial(subtle, input.worker_public_key_material);
  const senderKeyPair = input.testOnly?.senderKeyPair ?? (await generateX25519KeyPair(subtle));
  const aesKey = await deriveAesKey(subtle, senderKeyPair.privateKey, workerPublicKey, aadBytes);
  const encryptedLaunchToken = await subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(nonceBytes), additionalData: toArrayBuffer(aadBytes), tagLength: 128 },
    aesKey,
    textEncoder.encode(input.plaintext_launch_token),
  );
  const senderPublicKeyMaterial = await exportX25519PublicKeyMaterial(subtle, senderKeyPair.publicKey);
  const ciphertext = encodeJsonPayload({
    v: 1,
    sender_public_key_material: senderPublicKeyMaterial,
    encrypted_launch_token: base64UrlEncode(new Uint8Array(encryptedLaunchToken)),
  });
  const envelopeWithoutDigest = {
    id: input.envelope_id,
    runtime_job_id: input.runtime_job_id,
    launch_lease_id: input.launch_lease_id,
    worker_id: input.worker_id,
    key_id: input.key_id,
    algorithm,
    ciphertext,
    encryption_nonce: base64UrlEncode(nonceBytes),
    aad_json,
    aad_digest: codexLaunchTokenEnvelopeAadDigest(aad_json),
    expires_at: input.expires_at,
  } satisfies Omit<SealedEnvelope, 'envelope_digest'>;

  return {
    ...envelopeWithoutDigest,
    envelope_digest: codexLaunchTokenEnvelopeDigest(envelopeWithoutDigest),
  };
};

export const decryptCodexLaunchTokenEnvelope = async (
  input: DecryptCodexLaunchTokenEnvelopeInput,
): Promise<string> => {
  try {
    const subtle = subtleCrypto();
    assertEnvelopeMetadataMatchesAad(input.envelope);
    const aadBytes = canonicalJsonBytes(input.envelope.aad_json);
    if (input.envelope.aad_digest !== codexLaunchTokenEnvelopeAadDigest(input.envelope.aad_json)) {
      throw new Error('invalid aad digest');
    }
    if (input.envelope.envelope_digest !== codexLaunchTokenEnvelopeDigest(input.envelope)) {
      throw new Error('invalid envelope digest');
    }

    const payload = decodeJsonPayload(input.envelope.ciphertext);
    const nonceBytes = base64UrlDecode(input.envelope.encryption_nonce);
    if (nonceBytes.byteLength !== aesGcmNonceLength) {
      throw new Error('invalid envelope nonce');
    }
    const senderPublicKey = await importX25519PublicKeyMaterial(subtle, payload.sender_public_key_material);
    const aesKey = await deriveAesKey(subtle, input.privateKeyHandle, senderPublicKey, aadBytes);
    const plaintext = await subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(nonceBytes),
        additionalData: toArrayBuffer(aadBytes),
        tagLength: 128,
      },
      aesKey,
      toArrayBuffer(base64UrlDecode(payload.encrypted_launch_token)),
    );

    return textDecoder.decode(plaintext);
  } catch {
    throw new Error('Codex launch token envelope decrypt failed.');
  }
};

export const codexLaunchTokenEnvelopeAadDigest = (aad: Record<string, string>): string => codexCanonicalDigest(aad);

const launchTokenEnvelopeAad = (input: SealCodexLaunchTokenEnvelopeInput): CodexLaunchTokenEnvelopeAad => ({
  worker_id: input.worker_id,
  runtime_job_id: input.runtime_job_id,
  launch_lease_id: input.launch_lease_id,
  envelope_id: input.envelope_id,
  key_id: input.key_id,
  expires_at: input.expires_at,
});

const assertEnvelopeMetadataMatchesAad = (envelope: SealedEnvelope): void => {
  if (envelope.algorithm !== algorithm) {
    throw new Error('unsupported envelope algorithm');
  }

  const aad = envelope.aad_json;
  if (
    envelope.worker_id !== aad.worker_id ||
    envelope.runtime_job_id !== aad.runtime_job_id ||
    envelope.launch_lease_id !== aad.launch_lease_id ||
    envelope.id !== aad.envelope_id ||
    envelope.key_id !== aad.key_id ||
    envelope.expires_at !== aad.expires_at
  ) {
    throw new Error('envelope metadata does not match aad');
  }
};

const codexWorkerSessionKeyId = (publicKeyMaterial: string): string =>
  codexCanonicalDigest({
    algorithm,
    public_key_material: publicKeyMaterial,
  });

const subtleCrypto = (): SubtleCrypto => {
  const subtle = globalThis.crypto?.subtle;
  if (subtle === undefined) {
    throw new Error('Codex launch token envelope crypto is unavailable.');
  }
  return subtle;
};

const generateX25519KeyPair = async (subtle: SubtleCrypto): Promise<X25519KeyPair> =>
  subtle.generateKey({ name: 'X25519' }, false, ['deriveBits']) as unknown as Promise<X25519KeyPair>;

const assertTestOnlyCryptoHookAllowed = (): void => {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('Codex launch token envelope test-only crypto hooks are unavailable outside tests.');
  }
};

const exportX25519PublicKeyMaterial = async (subtle: SubtleCrypto, publicKey: CryptoKey): Promise<string> => {
  const raw = new Uint8Array(await subtle.exportKey('raw', publicKey));
  if (raw.byteLength !== x25519PublicKeyLength) {
    throw new Error('Codex launch token envelope public key material is invalid.');
  }
  return base64UrlEncode(raw);
};

const importX25519PublicKeyMaterial = async (subtle: SubtleCrypto, publicKeyMaterial: string): Promise<CryptoKey> => {
  const raw = base64UrlDecode(publicKeyMaterial);
  if (raw.byteLength !== x25519PublicKeyLength) {
    throw new Error('Codex launch token envelope public key material is invalid.');
  }
  return subtle.importKey('raw', toArrayBuffer(raw), { name: 'X25519' }, true, []);
};

const deriveAesKey = async (
  subtle: SubtleCrypto,
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  aadBytes: Uint8Array,
): Promise<CryptoKey> => {
  const sharedSecret = await subtle.deriveBits({ name: 'X25519', public: publicKey }, privateKey, 256);
  const hkdfKey = await subtle.importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new ArrayBuffer(32), info: toArrayBuffer(aadBytes) },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
};

const canonicalJsonBytes = (value: Record<string, string>): Uint8Array => textEncoder.encode(canonicalJsonString(value));

const canonicalJsonString = (value: Record<string, string>): string => {
  const sortedEntries = Object.entries(value).sort(([left], [right]) => compareCodeUnits(left, right));
  return JSON.stringify(Object.fromEntries(sortedEntries));
};

const encodeJsonPayload = (payload: SealedCiphertextPayload): string =>
  base64UrlEncode(textEncoder.encode(canonicalJsonString(payload as unknown as Record<string, string>)));

const decodeJsonPayload = (encoded: string): SealedCiphertextPayload => {
  const parsed = JSON.parse(textDecoder.decode(base64UrlDecode(encoded))) as Partial<SealedCiphertextPayload>;
  if (
    parsed.v !== 1 ||
    typeof parsed.sender_public_key_material !== 'string' ||
    typeof parsed.encrypted_launch_token !== 'string'
  ) {
    throw new Error('invalid ciphertext payload');
  }
  return parsed as SealedCiphertextPayload;
};

const randomBytes = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
};

const base64UrlEncode = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url');

const base64UrlDecode = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, 'base64url'));

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const compareCodeUnits = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);
