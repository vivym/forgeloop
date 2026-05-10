import { z } from 'zod';

type ParsedPublicHttpsUrl = {
  protocol: string;
  hostname: string;
  username: string;
  password: string;
  pathname: string;
  search: string;
  hash: string;
};

type PublicUrlConstructor = new (input: string) => ParsedPublicHttpsUrl;

const localReferencePrefixes = [
  '/Users/',
  '/home/',
  '/tmp/',
  '/private/tmp/',
  '/var/',
  '/workspace/',
  '/workspaces/',
  '/opt/',
  '/mnt/',
  '/Volumes/',
];

const decodePercentEncoded = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const currentWorkingDirectory = (): string | undefined => {
  const globalProcess = (globalThis as { process?: { cwd?: () => string } }).process;

  if (!globalProcess?.cwd) {
    return undefined;
  }

  const cwd = globalProcess.cwd();

  return cwd.endsWith('/') ? cwd : `${cwd}/`;
};

const publicUrlConstructor = (): PublicUrlConstructor | undefined =>
  (globalThis as { URL?: PublicUrlConstructor }).URL;

export const isLocalReferenceString = (value: string): boolean => {
  const reference = decodePercentEncoded(value.trim());
  const normalizedAbsoluteReference = reference.replace(/^\/+/, '/');
  const repoRoot = currentWorkingDirectory();

  if (repoRoot && reference.includes(repoRoot)) {
    return true;
  }

  if (
    localReferencePrefixes.some(
      (prefix) => normalizedAbsoluteReference.startsWith(prefix) || reference.includes(prefix),
    )
  ) {
    return true;
  }

  if (/^[A-Za-z]:[\\/]/.test(reference) || reference.startsWith('\\\\')) {
    return true;
  }

  if (reference.startsWith('file://') || reference.startsWith('local://')) {
    return true;
  }

  return reference === 'artifacts' || reference.startsWith('artifacts/') || reference.startsWith('./artifacts/') || reference.startsWith('../artifacts/');
};

export const isPublicArtifactStorageUri = (storageUri: string): boolean => {
  const uri = storageUri.trim();

  if (
    !uri ||
    /^https:\/\/(?:\/|$)/i.test(uri) ||
    /[\s\x00-\x1f\x7f]/.test(uri) ||
    isLocalReferenceString(uri)
  ) {
    return false;
  }

  if (uri.includes('?') || uri.includes('#')) {
    return false;
  }

  if (uri.toLowerCase().startsWith('https://')) {
    const URLConstructor = publicUrlConstructor();

    if (!URLConstructor) {
      return false;
    }

    let parsedUri: ParsedPublicHttpsUrl;

    try {
      parsedUri = new URLConstructor(uri);
    } catch {
      return false;
    }

    if (
      parsedUri.protocol !== 'https:' ||
      !parsedUri.hostname ||
      parsedUri.username ||
      parsedUri.password ||
      parsedUri.search ||
      parsedUri.hash
    ) {
      return false;
    }

    return !isLocalReferenceString(decodePercentEncoded(parsedUri.pathname));
  }

  const schemeMatch = /^(s3|gs):\/\/(.+)$/i.exec(uri);

  if (!schemeMatch) {
    return false;
  }

  const rest = schemeMatch[2]!;
  const slashIndex = rest.indexOf('/');
  const authority = slashIndex === -1 ? rest : rest.slice(0, slashIndex);
  const path = slashIndex === -1 ? '' : rest.slice(slashIndex);

  if (!authority || authority.includes('@')) {
    return false;
  }

  const decodedPath = decodePercentEncoded(path);

  return !isLocalReferenceString(decodedPath);
};

export const publicArtifactKindSchema = z.enum([
  'diff',
  'changed_files',
  'check_output',
  'execution_summary',
  'self_review',
  'review_packet',
]);
export type PublicArtifactKind = z.infer<typeof publicArtifactKindSchema>;

export const publicArtifactRefSchema = z
  .object({
    kind: publicArtifactKindSchema,
    name: z.string().min(1),
    content_type: z.string().min(1),
    storage_uri: z.string().min(1),
    digest: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((artifact, ctx) => {
    if (!isPublicArtifactStorageUri(artifact.storage_uri)) {
      ctx.addIssue({
        code: 'custom',
        path: ['storage_uri'],
        message: 'PublicArtifactRef.storage_uri must be a public s3://, gs://, or https:// object URI',
      });
    }
  });
export type PublicArtifactRef = z.infer<typeof publicArtifactRefSchema>;
