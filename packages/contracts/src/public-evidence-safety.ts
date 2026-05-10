import { z } from 'zod';

import { isLocalReferenceString } from './public-artifacts.js';

export const publicScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export type PublicScalar = z.infer<typeof publicScalarSchema>;

const unsafePublicEvidenceKeys = new Set([
  'raw_ref',
  'local_ref',
  'raw_metadata',
  'raw_payload',
  'raw_logs',
  'logs',
  'stdout',
  'stderr',
  'env',
  'environment_variables',
  'headers',
  'authorization',
  'auth_header',
  'cookie',
  'set_cookie',
  'api_key',
  'password',
  'credential',
  'credentials',
  'secret',
  'token',
  'access_token',
  'refresh_token',
  'client_secret',
  'private_key',
]);

const unsafePublicEvidenceKeySuffixes = [
  '_token',
  '_secret',
  '_password',
  '_credential',
  '_credentials',
  '_api_key',
  '_private_key',
];

const unsafePublicEvidenceKeyPrefixes = ['secret_', 'password_', 'credential_', 'credentials_'];

export const normalizePublicEvidenceKey = (key: string): string =>
  key
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

export const isUnsafePublicEvidenceKey = (key: string): boolean => {
  const normalizedKey = normalizePublicEvidenceKey(key);

  return (
    unsafePublicEvidenceKeys.has(normalizedKey) ||
    unsafePublicEvidenceKeySuffixes.some((suffix) => normalizedKey.endsWith(suffix)) ||
    unsafePublicEvidenceKeyPrefixes.some((prefix) => normalizedKey.startsWith(prefix))
  );
};

export const publicMetricsSchema = z.record(z.string(), publicScalarSchema).superRefine((metrics, ctx) => {
  Object.entries(metrics).forEach(([key, value]) => {
    if (isUnsafePublicEvidenceKey(key)) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `Public metric key is unsafe: ${key}`,
      });
    }

    if (typeof value === 'string' && isLocalReferenceString(value)) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `Public metric value is a local reference: ${key}`,
      });
    }
  });
});
export type PublicMetrics = z.infer<typeof publicMetricsSchema>;
