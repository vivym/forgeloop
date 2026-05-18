import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { link, lstat, open, realpath, rm, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, parse, relative, resolve, win32 } from 'node:path';

export type PathSafetyErrorCode =
  | 'workspace_path_escape'
  | 'workspace_symlink_escape'
  | 'workspace_equals_root'
  | 'path_contains_control_character'
  | 'path_not_repo_relative';

export class PathSafetyError extends Error {
  constructor(
    readonly code: PathSafetyErrorCode,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'PathSafetyError';
  }
}

export interface PathSafetyRoots {
  repoRoot: string;
  artifactRoot?: string;
  worktreeRoot?: string;
}

interface ResolveOptions {
  requireChild: boolean;
  rejectAnySymlink?: boolean;
}

interface RootPin {
  path: string;
  dev: number;
  ino: number;
}

interface FilePin extends RootPin {
  path: string;
}

export interface DestructiveChildPathOptions {
  beforeRemove?: (preparedPath: string) => Promise<void>;
  remove?: (preparedPath: string) => Promise<void>;
}

export interface ArtifactFileWriteOptions {
  beforeWrite?: (prepared: { finalPath: string; tempPath: string }) => Promise<void>;
  beforeRename?: (prepared: { finalPath: string; tempPath: string }) => Promise<void>;
}

const controlCharacterPattern = /[\x00-\x1f\x7f]/;

const isRootPath = (path: string): boolean => resolve(path) === parse(resolve(path)).root;

const isContainedIn = (root: string, candidate: string): boolean => {
  const relativePath = relative(root, candidate);

  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
};

const isMissingPathError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  ((error as { code?: unknown }).code === 'ENOENT' || (error as { code?: unknown }).code === 'ENOTDIR');

const pathSafetyError = (
  code: PathSafetyErrorCode,
  message: string,
  details: Record<string, unknown> = {},
): PathSafetyError => new PathSafetyError(code, message, details);

export class PathSafety {
  readonly #repoRoot: string;
  readonly #workspaceRoot: string;
  readonly #artifactRoot: string | undefined;
  readonly #repoRootPin: RootPin;
  readonly #workspaceRootPin: RootPin;
  readonly #artifactRootPin: RootPin | undefined;

  private constructor(input: { repoRoot: RootPin; workspaceRoot: RootPin; artifactRoot: RootPin | undefined }) {
    this.#repoRootPin = input.repoRoot;
    this.#workspaceRootPin = input.workspaceRoot;
    this.#artifactRootPin = input.artifactRoot;
    this.#repoRoot = input.repoRoot.path;
    this.#workspaceRoot = input.workspaceRoot.path;
    this.#artifactRoot = input.artifactRoot?.path;
  }

  static async create(roots: PathSafetyRoots): Promise<PathSafety> {
    const repoRoot = await realpath(roots.repoRoot);
    if (isRootPath(repoRoot)) {
      throw pathSafetyError('workspace_equals_root', 'Workspace root must not be the filesystem root.', { repoRoot });
    }

    let workspaceRoot = repoRoot;
    if (roots.worktreeRoot !== undefined) {
      const worktreeRoot = await realpath(roots.worktreeRoot);
      if (worktreeRoot === repoRoot) {
        throw pathSafetyError('workspace_equals_root', 'Worktree root must be a child of the repo root.', {
          repoRoot,
          worktreeRoot,
        });
      }
      if (!isContainedIn(repoRoot, worktreeRoot)) {
        const lexicalWorktreeRoot = resolve(roots.worktreeRoot);
        const code = isContainedIn(repoRoot, lexicalWorktreeRoot) ? 'workspace_symlink_escape' : 'workspace_path_escape';
        throw pathSafetyError(code, 'Worktree root escapes the repo root.', {
          repoRoot,
          worktreeRoot,
          lexicalWorktreeRoot,
        });
      }
      workspaceRoot = worktreeRoot;
    }

    let artifactRootPin: RootPin | undefined;
    if (roots.artifactRoot !== undefined) {
      const artifactRoot = await realpath(roots.artifactRoot);
      if (isRootPath(artifactRoot)) {
        throw pathSafetyError('workspace_equals_root', 'Artifact root must not be the filesystem root.', {
          artifactRoot,
        });
      }
      artifactRootPin = await pinRoot(artifactRoot, 'Artifact root');
    }

    return new PathSafety({
      repoRoot: await pinRoot(repoRoot, 'Workspace root'),
      workspaceRoot: await pinRoot(workspaceRoot, 'Worktree root'),
      artifactRoot: artifactRootPin,
    });
  }

  normalizeRepoRelativePath(input: string): string {
    if (controlCharacterPattern.test(input)) {
      throw pathSafetyError('path_contains_control_character', 'Path contains a control character.', { input });
    }
    if (
      input.length === 0 ||
      isAbsolute(input) ||
      win32.isAbsolute(input) ||
      input.includes('\\') ||
      /^[A-Za-z]:\//.test(input)
    ) {
      throw pathSafetyError('path_not_repo_relative', 'Path must be repo-relative.', { input });
    }

    const normalizedParts = input
      .split('/')
      .filter((part) => part.length > 0 && part !== '.');

    if (normalizedParts.some((part) => part === '..')) {
      throw pathSafetyError('path_not_repo_relative', 'Path must not contain parent traversal.', { input });
    }

    return normalizedParts.join('/');
  }

  async resolveRepoRelativePath(input: string): Promise<string> {
    return this.#resolveSafeRelativePath(this.#repoRoot, input, { requireChild: false });
  }

  async assertSafeChildPath(input: string): Promise<string> {
    return this.#resolveSafeRelativePath(this.#workspaceRoot, input, { requireChild: true });
  }

  async prepareDestructiveChildPath(input: string): Promise<string> {
    return this.#resolveSafeRelativePath(this.#workspaceRoot, input, {
      requireChild: true,
      rejectAnySymlink: true,
    });
  }

  async removeDestructiveChildPath(input: string, options: DestructiveChildPathOptions = {}): Promise<void> {
    this.#normalizeDirectChildOperationPath(input);
    const preparedPath = await this.prepareDestructiveChildPath(input);
    await options.beforeRemove?.(preparedPath);
    const revalidatedPath = await this.prepareDestructiveChildPath(input);
    await this.#assertRootStillPinned(this.#workspaceRootPin);
    await (options.remove ?? ((path) => rm(path, { recursive: true, force: true })))(revalidatedPath);
  }

  async artifactPath(input: string): Promise<string> {
    const artifactRoot = this.#requireArtifactRoot();

    return this.#resolveSafeRelativePath(artifactRoot, input, { requireChild: true });
  }

  async prepareArtifactWrite(input: string): Promise<{ finalPath: string; tempPath: string }> {
    const artifactRoot = this.#requireArtifactRoot();
    const normalizedPath = this.#normalizeDirectChildOperationPath(input);
    await this.#assertRootStillPinned(this.#requireArtifactRootPin());

    const finalPath = resolve(artifactRoot, normalizedPath);
    this.#assertContained(artifactRoot, finalPath, 'workspace_path_escape', { input, finalPath });

    const tempPath = join(artifactRoot, `.${basename(finalPath)}.${randomUUID()}.tmp`);
    this.#assertContained(artifactRoot, tempPath, 'workspace_path_escape', { input, tempPath });

    return { finalPath, tempPath };
  }

  async writeArtifactFile(input: string, bytes: Uint8Array, options: ArtifactFileWriteOptions = {}): Promise<string> {
    const prepared = await this.prepareArtifactWrite(input);
    await options.beforeWrite?.(prepared);
    let tempPin: FilePin | undefined;

    try {
      await this.#assertRootStillPinned(this.#requireArtifactRootPin());
      tempPin = await writeNoFollowNewFile(prepared.tempPath, bytes);
      await options.beforeRename?.(prepared);
      await this.#assertRootStillPinned(this.#requireArtifactRootPin());
      await installTempFileNoOverwrite(tempPin, prepared.finalPath);
    } catch (error) {
      await this.#removeArtifactTempFile(prepared.tempPath).catch(() => undefined);
      throw error;
    }

    return prepared.finalPath;
  }

  #normalizeDirectChildOperationPath(input: string): string {
    const normalizedPath = this.normalizeRepoRelativePath(input);
    if (normalizedPath.length === 0) {
      throw pathSafetyError('workspace_equals_root', 'Operation must target a direct child path.', { input });
    }
    if (normalizedPath.includes('/')) {
      throw pathSafetyError('workspace_path_escape', 'Operation-time helpers require a direct child path.', {
        input,
        normalizedPath,
      });
    }

    return normalizedPath;
  }

  #requireArtifactRoot(): string {
    if (this.#artifactRoot === undefined) {
      throw pathSafetyError('workspace_path_escape', 'Artifact root is not configured.');
    }

    return this.#artifactRoot;
  }

  #requireArtifactRootPin(): RootPin {
    if (this.#artifactRootPin === undefined) {
      throw pathSafetyError('workspace_path_escape', 'Artifact root is not configured.');
    }

    return this.#artifactRootPin;
  }

  async #resolveSafeRelativePath(root: string, input: string, options: ResolveOptions): Promise<string> {
    await this.#assertKnownRootStillPinned(root);
    const normalizedPath = this.normalizeRepoRelativePath(input);
    if (options.requireChild && normalizedPath.length === 0) {
      throw pathSafetyError('workspace_equals_root', 'Path must target a child of the workspace root.', { input, root });
    }

    const candidate = normalizedPath.length === 0 ? root : resolve(root, normalizedPath);
    this.#assertContained(root, candidate, 'workspace_path_escape', { input, root, candidate });

    if (normalizedPath.length === 0) {
      return root;
    }

    await this.#validateExistingSegments(root, normalizedPath, options);

    return candidate;
  }

  async #validateExistingSegments(root: string, normalizedPath: string, options: ResolveOptions): Promise<void> {
    let currentPath = root;
    const parts = normalizedPath.split('/');

    for (const [index, part] of parts.entries()) {
      const segmentPath = join(currentPath, part);
      let stats: Awaited<ReturnType<typeof lstat>>;

      try {
        stats = await lstat(segmentPath);
      } catch (error) {
        if (isMissingPathError(error)) {
          return;
        }
        throw error;
      }

      if (stats.isSymbolicLink()) {
        if (options.rejectAnySymlink === true) {
          throw pathSafetyError('workspace_symlink_escape', 'Path contains a symlink at operation time.', {
            root,
            segmentPath,
          });
        }

        let realSegmentPath: string;
        try {
          realSegmentPath = await realpath(segmentPath);
        } catch {
          throw pathSafetyError('workspace_symlink_escape', 'Path contains an unresolved symlink.', {
            root,
            segmentPath,
          });
        }
        if (!isContainedIn(root, realSegmentPath)) {
          throw pathSafetyError('workspace_symlink_escape', 'Symlink escapes the workspace root.', {
            root,
            segmentPath,
            realSegmentPath,
          });
        }
        if (index < parts.length - 1) {
          const realStats = await stat(realSegmentPath);
          if (!realStats.isDirectory()) {
            throw pathSafetyError('workspace_path_escape', 'Intermediate symlink target is not a directory.', {
              root,
              segmentPath,
              realSegmentPath,
            });
          }
        }
        currentPath = realSegmentPath;
        continue;
      }

      const realSegmentPath = await realpath(segmentPath);
      this.#assertContained(root, realSegmentPath, 'workspace_path_escape', {
        root,
        segmentPath,
        realSegmentPath,
      });

      if (index < parts.length - 1 && !stats.isDirectory()) {
        throw pathSafetyError('workspace_path_escape', 'Intermediate path segment is not a directory.', {
          root,
          segmentPath,
        });
      }

      currentPath = realSegmentPath;
    }
  }

  async #removeArtifactTempFile(tempPath: string): Promise<void> {
    const artifactRootPin = this.#requireArtifactRootPin();
    const artifactRoot = artifactRootPin.path;
    const relativeTempPath = relative(artifactRoot, tempPath);
    if (relativeTempPath.length === 0 || relativeTempPath.startsWith('..') || isAbsolute(relativeTempPath)) {
      return;
    }

    this.#normalizeDirectChildOperationPath(relativeTempPath);
    await this.#assertRootStillPinned(artifactRootPin);
    await rm(tempPath, { force: true });
  }

  async #assertKnownRootStillPinned(root: string): Promise<void> {
    if (root === this.#repoRootPin.path) {
      await this.#assertRootStillPinned(this.#repoRootPin);
      return;
    }
    if (root === this.#workspaceRootPin.path) {
      await this.#assertRootStillPinned(this.#workspaceRootPin);
      return;
    }
    if (this.#artifactRootPin !== undefined && root === this.#artifactRootPin.path) {
      await this.#assertRootStillPinned(this.#artifactRootPin);
    }
  }

  async #assertRootStillPinned(root: RootPin): Promise<void> {
    let stats: Awaited<ReturnType<typeof lstat>>;
    try {
      stats = await lstat(root.path);
    } catch (error) {
      if (isMissingPathError(error)) {
        throw pathSafetyError('workspace_path_escape', 'Configured root is no longer available.', { root: root.path });
      }
      throw error;
    }

    if (stats.isSymbolicLink()) {
      throw pathSafetyError('workspace_symlink_escape', 'Configured root was replaced by a symlink.', {
        root: root.path,
      });
    }
    if (!stats.isDirectory() || stats.dev !== root.dev || stats.ino !== root.ino) {
      throw pathSafetyError('workspace_path_escape', 'Configured root no longer matches its pinned directory.', {
        root: root.path,
      });
    }
  }

  #assertContained(
    root: string,
    candidate: string,
    code: Extract<PathSafetyErrorCode, 'workspace_path_escape' | 'workspace_symlink_escape'>,
    details: Record<string, unknown>,
  ): void {
    if (!isContainedIn(root, candidate)) {
      throw pathSafetyError(code, 'Resolved path escapes the configured root.', { ...details, root, candidate });
    }
  }
}

const pinRoot = async (path: string, label: string): Promise<RootPin> => {
  const stats = await lstat(path);
  if (stats.isSymbolicLink()) {
    throw pathSafetyError('workspace_symlink_escape', `${label} must not be a symlink.`, { path });
  }
  if (!stats.isDirectory()) {
    throw pathSafetyError('workspace_path_escape', `${label} must be a directory.`, { path });
  }

  return { path, dev: stats.dev, ino: stats.ino };
};

const assertPinnedRegularFile = async (pin: FilePin): Promise<void> => {
  const stats = await lstat(pin.path);
  if (stats.isSymbolicLink()) {
    throw pathSafetyError('workspace_symlink_escape', 'Pinned file path was replaced by a symlink.', {
      path: pin.path,
    });
  }
  if (!stats.isFile() || stats.dev !== pin.dev || stats.ino !== pin.ino) {
    throw pathSafetyError('workspace_path_escape', 'Pinned file path no longer matches its original file.', {
      path: pin.path,
    });
  }
};

const writeNoFollowNewFile = async (path: string, bytes: Uint8Array): Promise<FilePin> => {
  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(
      path,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      ((error as { code?: unknown }).code === 'ELOOP' || (error as { code?: unknown }).code === 'EEXIST')
    ) {
      const stats = await lstat(path).catch(() => undefined);
      if (stats?.isSymbolicLink() === true) {
        throw pathSafetyError('workspace_symlink_escape', 'Artifact temp path was replaced by a symlink.', { path });
      }
    }
    throw error;
  }

  try {
    await handle.writeFile(bytes);
    const stats = await handle.stat();
    if (!stats.isFile()) {
      throw pathSafetyError('workspace_path_escape', 'Artifact temp path is not a regular file.', { path });
    }
    return { path, dev: stats.dev, ino: stats.ino };
  } finally {
    await handle.close();
  }
};

const installTempFileNoOverwrite = async (tempPin: FilePin, finalPath: string): Promise<void> => {
  await assertPinnedRegularFile(tempPin);
  await link(tempPin.path, finalPath);
  try {
    await assertPinnedRegularFile({ ...tempPin, path: finalPath });
  } catch (error) {
    await rm(finalPath, { force: true }).catch(() => undefined);
    throw error;
  }
  await rm(tempPin.path, { force: true }).catch(() => undefined);
};
