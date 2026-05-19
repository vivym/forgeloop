import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import type { ArtifactKind, ArtifactRef } from '@forgeloop/contracts';

import { PathSafety, type PathSafetyRoots } from './path-safety.js';

export type ArtifactVisibility = 'internal' | 'public_safe';

export interface PublicSafeArtifactRedactionInput {
  kind: ArtifactKind;
  name: string;
  contentType: string;
  bytes: Uint8Array;
}

export type PublicSafeArtifactRedactor = (
  input: PublicSafeArtifactRedactionInput,
) => Promise<Uint8Array | null | undefined> | Uint8Array | null | undefined;

export interface ArtifactWriterPolicy {
  defaultVisibility: ArtifactVisibility;
  perArtifactByteLimit: number;
  perRunByteLimit: number;
  publicSafeKinds: readonly string[];
  publicSafeRedactor?: PublicSafeArtifactRedactor;
}

export interface ArtifactWriterInput {
  runSessionId: string;
  artifactRoot: string;
  repoRoot: string;
  worktreeRoot?: string;
  packageControlledPaths?: readonly string[];
  policy: ArtifactWriterPolicy;
}

export type ArtifactWriterErrorCode =
  | 'artifact_write_conflict'
  | 'artifact_root_overlap'
  | 'artifact_quota_exceeded'
  | 'artifact_visibility_denied';

export class ArtifactWriterError extends Error {
  constructor(
    readonly code: ArtifactWriterErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'ArtifactWriterError';
  }
}

const rawInternalKinds = new Set<string>(['check_output', 'logs', 'raw_metadata']);

const artifactWriterError = (
  code: ArtifactWriterErrorCode,
  message: string,
  details: Record<string, unknown> = {},
): ArtifactWriterError => new ArtifactWriterError(code, message, details);

const isContainedIn = (root: string, candidate: string): boolean => {
  const relativePath = relative(root, candidate);

  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
};

const pathsOverlap = (left: string, right: string): boolean => isContainedIn(left, right) || isContainedIn(right, left);

const maybeRealpath = async (path: string): Promise<string> => {
  try {
    return await realpath(path);
  } catch {
    return resolve(path);
  }
};

const safePathSegment = (value: string, fallback: string): string => {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/\.\.+/g, '-')
    .replace(/^\.+/, '')
    .replace(/^-+|-+$/g, '');

  return sanitized.length > 0 ? sanitized : fallback;
};

const digestFor = (bytes: Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

export class ArtifactWriter {
  readonly #runSessionSegment: string;
  readonly #pathSafety: PathSafety;
  readonly #policy: ArtifactWriterPolicy;
  #writtenBytes = 0;

  private constructor(input: {
    runSessionId: string;
    pathSafety: PathSafety;
    policy: ArtifactWriterPolicy;
  }) {
    this.#runSessionSegment = safePathSegment(input.runSessionId, 'run-session');
    this.#pathSafety = input.pathSafety;
    this.#policy = input.policy;
  }

  static async create(input: ArtifactWriterInput): Promise<ArtifactWriter> {
    const repoRoot = await realpath(input.repoRoot);
    const artifactRoot = await realpath(input.artifactRoot);
    const worktreeRoot = input.worktreeRoot === undefined ? undefined : await realpath(input.worktreeRoot);

    await assertArtifactRootDisjoint({
      artifactRoot,
      repoRoot,
      worktreeRoot,
      packageControlledPaths: input.packageControlledPaths ?? [],
    });

    const pathSafetyRoots: PathSafetyRoots = {
      repoRoot,
      artifactRoot,
    };
    if (worktreeRoot !== undefined) {
      pathSafetyRoots.worktreeRoot = worktreeRoot;
    }
    const pathSafety = await PathSafety.create(pathSafetyRoots);

    return new ArtifactWriter({
      runSessionId: input.runSessionId,
      pathSafety,
      policy: input.policy,
    });
  }

  async writeText(input: {
    kind: ArtifactKind;
    name: string;
    contentType: string;
    content: string;
    visibility?: ArtifactVisibility;
  }): Promise<ArtifactRef> {
    const writeInput = {
      kind: input.kind,
      name: input.name,
      contentType: input.contentType,
      bytes: Buffer.from(input.content, 'utf8'),
    };

    return input.visibility === undefined
      ? this.writeBytes(writeInput)
      : this.writeBytes({ ...writeInput, visibility: input.visibility });
  }

  async writeBytes(input: {
    kind: ArtifactKind;
    name: string;
    contentType: string;
    bytes: Uint8Array;
    visibility?: ArtifactVisibility;
  }): Promise<ArtifactRef> {
    const artifactName = safePathSegment(input.name, 'artifact');
    const artifactRelativePath = this.#artifactRelativePath(input.kind, artifactName);
    const visibility = this.#resolveVisibility(input.kind, input.visibility);
    const bytes =
      visibility === 'public_safe'
        ? await this.#redactPublicSafeBytes({
            kind: input.kind,
            name: artifactName,
            contentType: input.contentType,
            bytes: Buffer.from(input.bytes),
          })
        : Buffer.from(input.bytes);
    this.#assertQuota(bytes.byteLength, { kind: input.kind, name: input.name });
    let finalPath: string;
    try {
      finalPath = await this.#pathSafety.writeArtifactFile(artifactRelativePath, bytes);
    } catch (error) {
      if (isFileExistsError(error)) {
        throw artifactWriterError('artifact_write_conflict', 'Artifact path already exists.', {
          kind: input.kind,
          name: artifactName,
          artifactRelativePath,
        });
      }
      throw error;
    }

    this.#writtenBytes += bytes.byteLength;

    const baseArtifact = {
      kind: input.kind,
      name: artifactName,
      content_type: input.contentType,
      digest: digestFor(bytes),
    };

    if (visibility === 'public_safe') {
      return {
        ...baseArtifact,
        storage_uri: `artifacts/${artifactRelativePath}`,
      };
    }

    return {
      ...baseArtifact,
      local_ref: finalPath,
    };
  }

  async importSandboxOutput(input: {
    sandboxOutputRoot: string;
    relativePath: string;
    kind: ArtifactKind;
    name: string;
    contentType: string;
    visibility?: ArtifactVisibility;
  }): Promise<ArtifactRef> {
    const sandboxSafety = await PathSafety.create({ repoRoot: input.sandboxOutputRoot });
    const sourcePath = await sandboxSafety.resolveRepoRelativePath(input.relativePath);
    const bytes = await readFile(sourcePath);

    const writeInput = {
      kind: input.kind,
      name: input.name,
      contentType: input.contentType,
      bytes,
    };

    return input.visibility === undefined
      ? this.writeBytes(writeInput)
      : this.writeBytes({ ...writeInput, visibility: input.visibility });
  }

  #artifactRelativePath(kind: ArtifactKind, artifactName: string): string {
    return `${this.#runSessionSegment}-${safePathSegment(kind, 'artifact')}-${artifactName}`;
  }

  #assertQuota(byteLength: number, details: Record<string, unknown>): void {
    if (byteLength > this.#policy.perArtifactByteLimit) {
      throw artifactWriterError('artifact_quota_exceeded', 'Artifact exceeds the per-artifact byte limit.', {
        ...details,
        byteLength,
        perArtifactByteLimit: this.#policy.perArtifactByteLimit,
      });
    }
    if (this.#writtenBytes + byteLength > this.#policy.perRunByteLimit) {
      throw artifactWriterError('artifact_quota_exceeded', 'Artifact writes exceed the per-run byte limit.', {
        ...details,
        byteLength,
        writtenBytes: this.#writtenBytes,
        perRunByteLimit: this.#policy.perRunByteLimit,
      });
    }
  }

  #resolveVisibility(kind: ArtifactKind, requestedVisibility: ArtifactVisibility | undefined): ArtifactVisibility {
    const publicKindAllowed = this.#policy.publicSafeKinds.includes(kind);

    if (requestedVisibility === 'public_safe') {
      if (!publicKindAllowed) {
        throw artifactWriterError('artifact_visibility_denied', 'Artifact kind is not allowed for public-safe output.', {
          kind,
        });
      }

      return 'public_safe';
    }

    if (requestedVisibility === 'internal' || rawInternalKinds.has(kind)) {
      return 'internal';
    }

    return 'internal';
  }

  async #redactPublicSafeBytes(input: PublicSafeArtifactRedactionInput): Promise<Buffer> {
    const redactor = this.#policy.publicSafeRedactor;
    if (redactor === undefined) {
      throw artifactWriterError('artifact_visibility_denied', 'Public-safe artifact redaction is not configured.', {
        kind: input.kind,
        name: input.name,
      });
    }

    let redacted: Uint8Array | null | undefined;
    try {
      redacted = await redactor(input);
    } catch {
      throw artifactWriterError('artifact_visibility_denied', 'Public-safe artifact redaction failed.', {
        kind: input.kind,
        name: input.name,
      });
    }

    if (redacted === undefined || redacted === null) {
      throw artifactWriterError('artifact_visibility_denied', 'Public-safe artifact redaction denied publication.', {
        kind: input.kind,
        name: input.name,
      });
    }

    return Buffer.from(redacted);
  }
}

const assertArtifactRootDisjoint = async (input: {
  artifactRoot: string;
  repoRoot: string;
  worktreeRoot: string | undefined;
  packageControlledPaths: readonly string[];
}): Promise<void> => {
  const checkedRoots = [
    { label: 'repo root', path: input.repoRoot },
    { label: 'git directory', path: await maybeRealpath(join(input.repoRoot, '.git')) },
    { label: 'worktrees directory', path: await maybeRealpath(join(input.repoRoot, '.worktrees')) },
  ];

  if (input.worktreeRoot !== undefined) {
    checkedRoots.push({ label: 'worktree root', path: input.worktreeRoot });
  }

  const packagePathSafety = await PathSafety.create({ repoRoot: input.repoRoot });
  for (const packageControlledPath of input.packageControlledPaths) {
    const normalizedPath = packagePathSafety.normalizeRepoRelativePath(packageControlledPath.replace(/\/\*\*$/, ''));
    if (normalizedPath.length === 0) {
      checkedRoots.push({ label: 'package-controlled path', path: input.repoRoot });
      continue;
    }

    const packagePath = resolve(input.repoRoot, normalizedPath);
    checkedRoots.push({ label: 'package-controlled path', path: await maybeRealpath(packagePath) });
  }

  for (const checkedRoot of checkedRoots) {
    try {
      const stats = await lstat(checkedRoot.path);
      if (!stats.isDirectory() && checkedRoot.label !== 'git directory') {
        continue;
      }
    } catch {
      // Nonexistent reserved paths are still checked lexically.
    }

    if (pathsOverlap(input.artifactRoot, checkedRoot.path)) {
      throw artifactWriterError('artifact_root_overlap', `Artifact root overlaps ${checkedRoot.label}.`, {
        artifactRoot: input.artifactRoot,
        overlappingPath: checkedRoot.path,
        overlappingLabel: checkedRoot.label,
      });
    }
  }
};

const isFileExistsError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'EEXIST';
