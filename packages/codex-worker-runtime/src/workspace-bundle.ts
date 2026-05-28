import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, posix, relative, resolve } from 'node:path';

const workspaceBundleArchiveSchemaVersion = 'workspace_bundle_archive.v1';
const workspaceBundleManifestSchemaVersion = 'workspace_bundle.v1';

export type WorkspaceBundleArchiveEntryType =
  | 'file'
  | 'directory'
  | 'symlink'
  | 'character_device'
  | 'block_device'
  | 'fifo'
  | 'socket';

export interface WorkspaceBundleArchiveEntry {
  path: string;
  type: WorkspaceBundleArchiveEntryType;
  content_base64?: string;
  link_target?: string;
  mode?: number;
}

export interface WorkspaceBundleManifestEntry {
  path: string;
  type: 'file' | 'directory';
  digest: string;
  size_bytes: number;
  mode?: number;
}

export interface WorkspaceBundleManifest {
  schema_version: 'workspace_bundle.v1';
  bundle_id: string;
  created_at: string;
  allowed_paths: string[];
  forbidden_paths: string[];
  entries: WorkspaceBundleManifestEntry[];
}

export interface WorkspaceBundleFileInput {
  path: string;
  content: string | Uint8Array;
  mode?: number;
}

export interface WorkspaceBundleUnpackResult {
  jobRoot: string;
  workspacePath: string;
  manifest: WorkspaceBundleManifest;
  manifest_digest: string;
  archive_digest: string;
  mounted_workspace_digest: string;
  size_bytes: number;
}

const invalidBundle = (message: string): Error => new Error(`codex_workspace_bundle_invalid: ${message}`);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const sha256 = (bytes: Uint8Array | string): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

export const workspaceBundleArchiveDigest = (archiveBytes: Uint8Array): string => sha256(archiveBytes);

export const workspaceBundleManifestDigest = (manifest: unknown): string => {
  const encoded = JSON.stringify(manifest);
  if (encoded === undefined) {
    throw invalidBundle('manifest is not serializable');
  }
  return sha256(encoded);
};

const stableEntrySort = <T extends { path: string; type: string }>(left: T, right: T): number =>
  left.path.localeCompare(right.path) || left.type.localeCompare(right.type);

const byteContent = (content: string | Uint8Array): Buffer => (typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content));

const isInside = (root: string, child: string): boolean => {
  const childRelative = relative(resolve(root), resolve(child));
  return childRelative === '' || (!childRelative.startsWith('..') && !childRelative.startsWith('/'));
};

const normalizeBundlePath = (rawPath: unknown): string => {
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    throw invalidBundle('entry path is required');
  }
  if (rawPath.includes('\\') || rawPath.startsWith('/') || rawPath.startsWith('//') || /^[A-Za-z]:/.test(rawPath)) {
    throw invalidBundle('entry path must be relative');
  }
  const segments = rawPath.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw invalidBundle('entry path contains unsafe segments');
  }
  const normalized = posix.normalize(rawPath);
  if (normalized === '.' || normalized.startsWith('../') || normalized === '..' || posix.isAbsolute(normalized)) {
    throw invalidBundle('entry path escapes bundle root');
  }
  return normalized;
};

const escapeRegex = (value: string): string => value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');

const globMatches = (pattern: string, candidate: string): boolean => {
  const normalizedPattern = pattern.replaceAll('\\', '/');
  if (normalizedPattern === '**') {
    return true;
  }
  if (normalizedPattern.endsWith('/**')) {
    const prefix = normalizedPattern.slice(0, -3);
    if (candidate === prefix || candidate.startsWith(`${prefix}/`)) {
      return true;
    }
  }
  let regex = '^';
  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const char = normalizedPattern[index];
    const next = normalizedPattern[index + 1];
    if (char === '*' && next === '*') {
      regex += '.*';
      index += 1;
    } else if (char === '*') {
      regex += '[^/]*';
    } else {
      regex += escapeRegex(char ?? '');
    }
  }
  regex += '$';
  return new RegExp(regex).test(candidate);
};

const assertPathPolicy = (path: string, allowedPaths: readonly string[], forbiddenPaths: readonly string[]): void => {
  const normalized = normalizeBundlePath(path);
  if (allowedPaths.length > 0 && !allowedPaths.some((pattern) => globMatches(pattern, normalized))) {
    throw invalidBundle('entry path is outside allowed paths');
  }
  if (forbiddenPaths.some((pattern) => globMatches(pattern, normalized))) {
    throw invalidBundle('entry path is forbidden');
  }
};

const assertSafeGitIndirection = (path: string, bytes: Buffer): void => {
  if (path !== '.git' && !path.endsWith('/.git')) {
    return;
  }
  const content = bytes.toString('utf8');
  const match = content.match(/^gitdir:\s*(.+)\s*$/m);
  if (match === null) {
    return;
  }
  const target = match[1]!.trim();
  if (target.startsWith('/') || target.includes('\\') || /^[A-Za-z]:/.test(target)) {
    throw invalidBundle('.git indirection escapes bundle root');
  }
  const normalizedTarget = posix.normalize(target);
  if (normalizedTarget === '..' || normalizedTarget.startsWith('../')) {
    throw invalidBundle('.git indirection escapes bundle root');
  }
};

const parseArchive = (archiveBytes: Uint8Array): { manifest: WorkspaceBundleManifest; entries: WorkspaceBundleArchiveEntry[] } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(archiveBytes).toString('utf8'));
  } catch {
    throw invalidBundle('archive is not valid JSON');
  }
  if (!isRecord(parsed) || parsed.schema_version !== workspaceBundleArchiveSchemaVersion || !isRecord(parsed.manifest)) {
    throw invalidBundle('archive schema is invalid');
  }
  const entries = parsed.entries;
  if (!Array.isArray(entries)) {
    throw invalidBundle('archive entries are invalid');
  }
  return {
    manifest: validateWorkspaceBundleManifest(parsed.manifest),
    entries: entries.map((entry) => {
      if (!isRecord(entry)) {
        throw invalidBundle('archive entry is invalid');
      }
      const normalized = normalizeBundlePath(entry.path);
      const type = entry.type;
      if (type !== 'file' && type !== 'directory' && type !== 'symlink' && type !== 'character_device' && type !== 'block_device' && type !== 'fifo' && type !== 'socket') {
        throw invalidBundle('archive entry type is invalid');
      }
      return {
        path: normalized,
        type,
        ...(typeof entry.content_base64 === 'string' ? { content_base64: entry.content_base64 } : {}),
        ...(typeof entry.link_target === 'string' ? { link_target: entry.link_target } : {}),
        ...(typeof entry.mode === 'number' ? { mode: entry.mode } : {}),
      };
    }),
  };
};

export const validateWorkspaceBundleManifest = (manifest: unknown, expectedDigest?: string): WorkspaceBundleManifest => {
  if (!isRecord(manifest) || manifest.schema_version !== workspaceBundleManifestSchemaVersion) {
    throw invalidBundle('manifest schema is invalid');
  }
  if (typeof manifest.bundle_id !== 'string' || manifest.bundle_id.length === 0 || typeof manifest.created_at !== 'string') {
    throw invalidBundle('manifest identity is invalid');
  }
  if (!Array.isArray(manifest.allowed_paths) || !Array.isArray(manifest.forbidden_paths) || !Array.isArray(manifest.entries)) {
    throw invalidBundle('manifest path policy is invalid');
  }
  const allowedPaths = manifest.allowed_paths.map(String);
  const forbiddenPaths = manifest.forbidden_paths.map(String);
  const entries = manifest.entries.map((entry) => {
    if (!isRecord(entry)) {
      throw invalidBundle('manifest entry is invalid');
    }
    const path = normalizeBundlePath(entry.path);
    if (entry.type !== 'file' && entry.type !== 'directory') {
      throw invalidBundle('manifest entry type is invalid');
    }
    if (typeof entry.digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(entry.digest)) {
      throw invalidBundle('manifest entry digest is invalid');
    }
    if (typeof entry.size_bytes !== 'number' || !Number.isSafeInteger(entry.size_bytes) || entry.size_bytes < 0) {
      throw invalidBundle('manifest entry size is invalid');
    }
    assertPathPolicy(path, allowedPaths, forbiddenPaths);
    return {
      path,
      type: entry.type,
      digest: entry.digest,
      size_bytes: entry.size_bytes,
      ...(typeof entry.mode === 'number' ? { mode: entry.mode } : {}),
    } satisfies WorkspaceBundleManifestEntry;
  });
  const normalized: WorkspaceBundleManifest = {
    schema_version: workspaceBundleManifestSchemaVersion,
    bundle_id: manifest.bundle_id,
    created_at: manifest.created_at,
    allowed_paths: allowedPaths,
    forbidden_paths: forbiddenPaths,
    entries: entries.sort(stableEntrySort),
  };
  if (expectedDigest !== undefined && workspaceBundleManifestDigest(normalized) !== expectedDigest) {
    throw invalidBundle('manifest digest mismatch');
  }
  return normalized;
};

export const createWorkspaceBundleManifest = (input: {
  bundleId: string;
  createdAt: string;
  allowedPaths: readonly string[];
  forbiddenPaths: readonly string[];
  files: readonly WorkspaceBundleFileInput[];
}): WorkspaceBundleManifest => {
  const entries = input.files.map((file) => {
    const path = normalizeBundlePath(file.path);
    assertPathPolicy(path, input.allowedPaths, input.forbiddenPaths);
    const bytes = byteContent(file.content);
    return {
      path,
      type: 'file',
      digest: sha256(bytes),
      size_bytes: bytes.byteLength,
      ...(file.mode === undefined ? {} : { mode: file.mode }),
    } satisfies WorkspaceBundleManifestEntry;
  });
  return validateWorkspaceBundleManifest({
    schema_version: workspaceBundleManifestSchemaVersion,
    bundle_id: input.bundleId,
    created_at: input.createdAt,
    allowed_paths: [...input.allowedPaths],
    forbidden_paths: [...input.forbiddenPaths],
    entries: entries.sort(stableEntrySort),
  });
};

export const createWorkspaceBundleArchive = (input: {
  manifest: WorkspaceBundleManifest;
  files: readonly WorkspaceBundleFileInput[];
}): Buffer => {
  const manifest = validateWorkspaceBundleManifest(input.manifest);
  const expectedByPath = new Map(manifest.entries.map((entry) => [entry.path, entry]));
  const entries = input.files.map((file) => {
    const path = normalizeBundlePath(file.path);
    const expected = expectedByPath.get(path);
    const bytes = byteContent(file.content);
    if (expected === undefined || expected.type !== 'file' || expected.digest !== sha256(bytes) || expected.size_bytes !== bytes.byteLength) {
      throw invalidBundle('archive file does not match manifest');
    }
    return {
      path,
      type: 'file',
      content_base64: bytes.toString('base64'),
      ...(file.mode === undefined ? {} : { mode: file.mode }),
    } satisfies WorkspaceBundleArchiveEntry;
  });
  if (entries.length !== expectedByPath.size) {
    throw invalidBundle('archive file count does not match manifest');
  }
  return Buffer.from(
    JSON.stringify({
      schema_version: workspaceBundleArchiveSchemaVersion,
      manifest,
      entries: entries.sort(stableEntrySort),
    }),
    'utf8',
  );
};

export const verifyWorkspaceBundleArchiveDigest = (
  archiveBytes: Uint8Array,
  expectedDigest: string,
): { digest: string; size_bytes: number } => {
  const digest = workspaceBundleArchiveDigest(archiveBytes);
  if (digest !== expectedDigest) {
    throw invalidBundle('archive digest mismatch');
  }
  return {
    digest,
    size_bytes: archiveBytes.byteLength,
  };
};

export const computeMountedWorkspaceDigest = async (
  workspacePath: string,
  manifest: WorkspaceBundleManifest,
): Promise<string> => {
  const root = await realpath(workspacePath).catch(() => {
    throw invalidBundle('mounted workspace root is unavailable');
  });
  const expectedByPath = new Map(manifest.entries.map((entry) => [entry.path, entry]));
  const entries: WorkspaceBundleManifestEntry[] = [];

  const walk = async (directory: string): Promise<void> => {
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children) {
      const absolutePath = resolve(join(directory, child.name));
      if (!isInside(root, absolutePath)) {
        throw invalidBundle('mounted workspace entry escapes root');
      }
      const relativePath = normalizeBundlePath(relative(root, absolutePath).replaceAll('\\', '/'));
      assertPathPolicy(relativePath, manifest.allowed_paths, manifest.forbidden_paths);
      if (child.isSymbolicLink()) {
        throw invalidBundle('mounted workspace contains symlink');
      }
      if (child.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!child.isFile()) {
        throw invalidBundle('mounted workspace contains unsupported entry type');
      }
      const bytes = await readFile(absolutePath);
      const expected = expectedByPath.get(relativePath);
      entries.push({
        path: relativePath,
        type: 'file',
        digest: sha256(bytes),
        size_bytes: bytes.byteLength,
        ...(expected?.mode === undefined ? {} : { mode: expected.mode }),
      });
    }
  };

  await walk(root);
  for (const entry of manifest.entries) {
    if (entry.type !== 'directory') {
      continue;
    }
    const directoryPath = resolve(join(root, entry.path));
    const stat = await lstat(directoryPath).catch(() => undefined);
    if (stat?.isDirectory() === true) {
      entries.push(entry);
    }
  }

  return workspaceBundleManifestDigest({
    schema_version: workspaceBundleManifestSchemaVersion,
    bundle_id: manifest.bundle_id,
    created_at: manifest.created_at,
    allowed_paths: manifest.allowed_paths,
    forbidden_paths: manifest.forbidden_paths,
    entries: entries.sort(stableEntrySort),
  });
};

export const safeUnpackWorkspaceBundle = async (input: {
  archiveBytes: Uint8Array;
  expectedArchiveDigest: string;
  expectedManifestDigest?: string;
  tempRoot: string;
  runtimeJobId: string;
}): Promise<WorkspaceBundleUnpackResult> => {
  const archive = verifyWorkspaceBundleArchiveDigest(input.archiveBytes, input.expectedArchiveDigest);
  if (input.runtimeJobId.includes('/') || input.runtimeJobId.includes('\\') || input.runtimeJobId.length === 0) {
    throw invalidBundle('runtime job id is invalid');
  }
  const { manifest, entries } = parseArchive(input.archiveBytes);
  const manifestDigest = workspaceBundleManifestDigest(manifest);
  if (input.expectedManifestDigest !== undefined && manifestDigest !== input.expectedManifestDigest) {
    throw invalidBundle('manifest digest mismatch');
  }
  const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]));
  if (entriesByPath.size !== entries.length || entries.length !== manifest.entries.length) {
    throw invalidBundle('archive entries do not match manifest');
  }
  const manifestPaths = new Set(manifest.entries.map((entry) => entry.path));
  if (entries.some((entry) => !manifestPaths.has(entry.path))) {
    throw invalidBundle('archive contains entries outside manifest');
  }
  const root = await realpath(input.tempRoot).catch(() => {
    throw invalidBundle('temp root is unavailable');
  });
  const jobNamespace = resolve(join(root, input.runtimeJobId));
  if (!isInside(root, jobNamespace) || jobNamespace === root) {
    throw invalidBundle('runtime job id is invalid');
  }
  const existingJobNamespace = await lstat(jobNamespace).catch(() => undefined);
  if (existingJobNamespace === undefined) {
    await mkdir(jobNamespace, { recursive: false, mode: 0o700 });
  } else if (!existingJobNamespace.isDirectory() || existingJobNamespace.isSymbolicLink()) {
    throw invalidBundle('job temp root already exists');
  }
  const jobRoot = resolve(join(jobNamespace, randomUUID()));
  if (!isInside(jobNamespace, jobRoot)) {
    throw invalidBundle('runtime job id is invalid');
  }
  await mkdir(jobRoot, { recursive: false, mode: 0o700 });
  const workspacePath = resolve(join(jobRoot, 'workspace'));
  if (!isInside(root, workspacePath)) {
    throw invalidBundle('workspace path escapes temp root');
  }
  await mkdir(workspacePath, { recursive: false, mode: 0o700 });
  const realWorkspacePath = await realpath(workspacePath);
  if (!isInside(root, realWorkspacePath)) {
    throw invalidBundle('workspace path escapes real temp root');
  }
  for (const manifestEntry of manifest.entries) {
    const archiveEntry = entriesByPath.get(manifestEntry.path);
    if (archiveEntry === undefined || archiveEntry.type !== manifestEntry.type) {
      throw invalidBundle('archive entry does not match manifest');
    }
    if (archiveEntry.type !== 'file' && archiveEntry.type !== 'directory') {
      throw invalidBundle('archive entry type is not unpackable');
    }
    assertPathPolicy(manifestEntry.path, manifest.allowed_paths, manifest.forbidden_paths);
    const target = resolve(join(workspacePath, manifestEntry.path));
    if (!isInside(workspacePath, target)) {
      throw invalidBundle('entry target escapes workspace root');
    }
    if (archiveEntry.type === 'directory') {
      await mkdir(target, { recursive: true, mode: 0o700 });
      continue;
    }
    if (typeof archiveEntry.content_base64 !== 'string') {
      throw invalidBundle('archive file content is missing');
    }
    const bytes = Buffer.from(archiveEntry.content_base64, 'base64');
    if (bytes.byteLength !== manifestEntry.size_bytes || sha256(bytes) !== manifestEntry.digest) {
      throw invalidBundle('archive file content does not match manifest');
    }
    assertSafeGitIndirection(manifestEntry.path, bytes);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, bytes, { mode: 0o600, flag: 'wx' });
  }
  const mountedWorkspaceDigest = await computeMountedWorkspaceDigest(workspacePath, manifest);
  return {
    jobRoot,
    workspacePath,
    manifest,
    manifest_digest: manifestDigest,
    archive_digest: archive.digest,
    mounted_workspace_digest: mountedWorkspaceDigest,
    size_bytes: archive.size_bytes,
  };
};

export const collectWorkspaceBundleChangedFiles = (input: {
  changedFiles: readonly string[];
  allowedPaths: readonly string[];
  forbiddenPaths: readonly string[];
}): string[] => {
  const unique = new Set<string>();
  for (const changedFile of input.changedFiles) {
    const normalized = normalizeBundlePath(changedFile);
    assertPathPolicy(normalized, input.allowedPaths, input.forbiddenPaths);
    unique.add(normalized);
  }
  return [...unique].sort();
};

export const createWorkspaceBundlePatchArtifact = (input: {
  runtimeJobId: string;
  patch: string;
  changedFiles: readonly string[];
  allowedPaths: readonly string[];
  forbiddenPaths: readonly string[];
}): {
  content_type: 'text/x-diff';
  digest: string;
  internal_ref: string;
  size_bytes: number;
  changed_files: string[];
} => {
  const changedFiles = collectWorkspaceBundleChangedFiles(input);
  const patchBytes = Buffer.from(input.patch, 'utf8');
  const digest = sha256(patchBytes);
  return {
    content_type: 'text/x-diff',
    digest,
    internal_ref: `artifact://codex-runtime-jobs/${input.runtimeJobId}/artifacts/${digest.slice('sha256:'.length)}`,
    size_bytes: patchBytes.byteLength,
    changed_files: changedFiles,
  };
};
