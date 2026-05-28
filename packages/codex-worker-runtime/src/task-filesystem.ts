import { chmod, lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';

export interface PreparedCodexTaskFilesystem {
  leaseTempRoot: string;
  codexHomeHostPath: string;
  artifactHostPath: string;
  socketHostDir: string;
}

export interface PrepareCodexTaskFilesystemInput {
  workerTempRoot: string;
  workerId: string;
  launchLeaseId: string;
  codexConfigToml: string;
  authJson: unknown;
}

export const assertInsideWorkerTempRoot = (root: string, child: string): void => {
  const resolvedRoot = resolve(root);
  const resolvedChild = resolve(child);
  const childRelative = relative(resolvedRoot, resolvedChild);
  if (childRelative === '..' || childRelative.startsWith('../') || resolvedChild === resolvedRoot) {
    throw new Error('path is outside worker temp root');
  }
};

const assertNoSymlink = async (path: string): Promise<void> => {
  try {
    const existing = await lstat(path);
    if (existing.isSymbolicLink()) {
      throw new Error('codex task filesystem refuses symlinked paths');
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
};

const removeOwnedExistingLeaseRoot = async (input: {
  workerTempRoot: string;
  leaseTempRoot: string;
  workerId: string;
  launchLeaseId: string;
}): Promise<void> => {
  try {
    const existing = await lstat(input.leaseTempRoot);
    if (existing.isSymbolicLink()) {
      throw new Error('codex task filesystem refuses symlinked paths');
    }
    if (!existing.isDirectory()) {
      throw new Error('codex task filesystem refuses non-directory lease root');
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    throw error;
  }

  const metadataPath = join(input.leaseTempRoot, '.forgeloop-resource.json');
  assertInsideWorkerTempRoot(input.workerTempRoot, metadataPath);
  await assertNoSymlink(metadataPath);
  let metadata: unknown;
  try {
    metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  } catch {
    throw new Error('codex task filesystem refuses unowned existing lease root');
  }
  const owned =
    typeof metadata === 'object' &&
    metadata !== null &&
    'workerId' in metadata &&
    'launchLeaseId' in metadata &&
    metadata.workerId === input.workerId &&
    metadata.launchLeaseId === input.launchLeaseId;
  if (!owned) {
    throw new Error('codex task filesystem refuses existing lease root owned by another worker');
  }
  await rm(input.leaseTempRoot, { recursive: true, force: true });
};

export const writeCodexHomeConfigAndAuth = async (input: {
  codexHomeHostPath: string;
  codexConfigToml: string;
  authJson: unknown;
}): Promise<void> => {
  const configPath = join(input.codexHomeHostPath, 'config.toml');
  const authPath = join(input.codexHomeHostPath, 'auth.json');
  await writeFile(configPath, input.codexConfigToml, { mode: 0o600 });
  await chmod(configPath, 0o600);
  await writeFile(authPath, `${JSON.stringify(input.authJson, null, 2)}\n`, { mode: 0o600 });
  await chmod(authPath, 0o600);
};

export const prepareCodexTaskFilesystem = async (input: PrepareCodexTaskFilesystemInput): Promise<PreparedCodexTaskFilesystem> => {
  await assertNoSymlink(input.workerTempRoot);
  await mkdir(input.workerTempRoot, { recursive: true, mode: 0o700 });
  await chmod(input.workerTempRoot, 0o700);

  const leaseTempRoot = join(input.workerTempRoot, input.launchLeaseId);
  assertInsideWorkerTempRoot(input.workerTempRoot, leaseTempRoot);
  await removeOwnedExistingLeaseRoot({
    workerTempRoot: input.workerTempRoot,
    leaseTempRoot,
    workerId: input.workerId,
    launchLeaseId: input.launchLeaseId,
  });
  await mkdir(leaseTempRoot, { recursive: false, mode: 0o700 });
  await chmod(leaseTempRoot, 0o700);
  const metadataPath = join(leaseTempRoot, '.forgeloop-resource.json');
  await writeFile(metadataPath, `${JSON.stringify({ workerId: input.workerId, launchLeaseId: input.launchLeaseId })}\n`, {
    mode: 0o600,
  });
  await chmod(metadataPath, 0o600);

  const codexHomeHostPath = join(leaseTempRoot, 'codex-home');
  const artifactHostPath = join(leaseTempRoot, 'artifacts');
  const socketHostDir = join(leaseTempRoot, 'run');
  for (const path of [codexHomeHostPath, artifactHostPath, socketHostDir]) {
    assertInsideWorkerTempRoot(input.workerTempRoot, path);
    await mkdir(path, { recursive: false, mode: 0o700 });
    await chmod(path, 0o700);
  }
  await writeCodexHomeConfigAndAuth({
    codexHomeHostPath,
    codexConfigToml: input.codexConfigToml,
    authJson: input.authJson,
  });

  return { leaseTempRoot, codexHomeHostPath, artifactHostPath, socketHostDir };
};

export const cleanupCodexTaskFilesystem = async (input: { leaseTempRoot: string }): Promise<void> => {
  await rm(input.leaseTempRoot, { recursive: true, force: true });
};
