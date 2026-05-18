import type { ArtifactRef, ChangedFile, RunSpec } from '@forgeloop/contracts';
import { resourceLimitDigest } from '@forgeloop/domain';
import type { PathSafety } from './path-safety.js';
import type {
  ResourceGovernor,
  ResourceGovernorReadinessInput,
  RunGovernorBindings,
  SandboxOutputImporter,
} from './resource-governor.js';
import {
  materializeSafeGitCommand,
  safeGitCommandSpec,
  structuredCommandDigest,
  type MaterializedStructuredCommand,
  type TrustedToolchainConfig,
} from './structured-command.js';

export type ChangedFilesUnavailableCode = 'changed_files_unavailable';

export interface AuthoritativeChangedFileCommandContext extends Omit<RunGovernorBindings, 'commandId' | 'commandDigest'> {
  trustedToolchains: TrustedToolchainConfig;
  tempRoot?: string;
  safeGitProfile: 'forgeloop_default';
}

export type CommandOutputRefReader = (ref: string) => Promise<string>;

export interface DeriveAuthoritativeChangedFilesInput {
  runSpec: RunSpec;
  workspaceRoot: string;
  baseCommit: string;
  runGovernor: ResourceGovernor;
  commandContext: AuthoritativeChangedFileCommandContext;
  pathSafety: PathSafety;
  readCommandOutputRef: CommandOutputRefReader;
  outputImporter?: SandboxOutputImporter;
  outputArtifactNamePrefix?: string;
  mockRunContext?: ResourceGovernorReadinessInput;
}

export interface AuthoritativeGitStdoutInput {
  workspaceRoot: string;
  commandId: string;
  args: readonly string[];
  runGovernor: ResourceGovernor;
  commandContext: AuthoritativeChangedFileCommandContext;
  readCommandOutputRef: CommandOutputRefReader;
  outputImporter?: SandboxOutputImporter;
  outputArtifactNamePrefix?: string;
  mockRunContext?: ResourceGovernorReadinessInput;
}

export interface AuthoritativeGitStdoutResult {
  stdout: string;
  diagnosticRefs: ArtifactRef[];
}

export type DeriveAuthoritativeChangedFilesResult =
  | { ok: true; changedFiles: ChangedFile[]; diagnosticRefs: ArtifactRef[] }
  | { ok: false; code: ChangedFilesUnavailableCode; summary: string; diagnosticRef?: ArtifactRef };

export async function deriveAuthoritativeChangedFiles(
  input: DeriveAuthoritativeChangedFilesInput,
): Promise<DeriveAuthoritativeChangedFilesResult> {
  try {
    const baseCommit = input.baseCommit.trim();
    if (baseCommit.length === 0) {
      return changedFilesUnavailable('Base commit is unavailable.');
    }

    const diffOutput = await runGitForStdout(input, 'authoritative-diff', [
      'diff',
      '--name-status',
      '-z',
      '--find-renames',
      '--no-ext-diff',
      '--no-textconv',
      '--diff-filter=ACDMRTUXB',
      baseCommit,
      '--',
    ]);
    const statusOutput = await runGitForStdout(input, 'authoritative-status', [
      'status',
      '--porcelain=v2',
      '-z',
      '--untracked-files=all',
      '--ignored=matching',
    ]);

    return {
      ok: true,
      changedFiles: uniqueChangedFiles([
        ...parseNameStatusDiff(diffOutput.stdout, input.runSpec.repo.repo_id, input.pathSafety),
        ...parsePorcelainV2Status(statusOutput.stdout, input.runSpec.repo.repo_id, input.pathSafety),
      ]),
      diagnosticRefs: [...diffOutput.diagnosticRefs, ...statusOutput.diagnosticRefs],
    };
  } catch (error) {
    return changedFilesUnavailable(error instanceof Error ? error.message : 'Authoritative changed-file derivation failed.');
  }
}

const runGitForStdout = async (
  input: DeriveAuthoritativeChangedFilesInput,
  commandId: string,
  args: string[],
): Promise<AuthoritativeGitStdoutResult> =>
  runAuthoritativeGitForStdout({
    workspaceRoot: input.workspaceRoot,
    commandId,
    args,
    runGovernor: input.runGovernor,
    commandContext: input.commandContext,
    readCommandOutputRef: input.readCommandOutputRef,
    ...(input.outputImporter === undefined ? {} : { outputImporter: input.outputImporter }),
    ...(input.outputArtifactNamePrefix === undefined ? {} : { outputArtifactNamePrefix: input.outputArtifactNamePrefix }),
    ...(input.mockRunContext === undefined ? {} : { mockRunContext: input.mockRunContext }),
  });

export const runAuthoritativeGitForStdout = async (
  input: AuthoritativeGitStdoutInput,
): Promise<AuthoritativeGitStdoutResult> => {
  const command = materializeSafeGitCommand({
    command: safeGitCommandSpec({
      args: [...input.args],
      cwd: 'workspace_root',
      timeout_ms: 30_000,
      output_limit_bytes: 1_000_000,
      source_write_policy: 'read_only',
      visibility: 'internal',
    }),
    toolchain: input.commandContext.trustedToolchains,
    workspaceRoot: input.workspaceRoot,
    artifactRoot: input.commandContext.artifactRoot,
    ...(input.commandContext.tempRoot === undefined ? {} : { tempRoot: input.commandContext.tempRoot }),
  });
  const commandDigest = digestCommand(command, input.commandContext);
  const artifactPrefix = safeArtifactName(input.outputArtifactNamePrefix ?? 'authoritative');
  const artifactCommandId = safeArtifactName(input.commandId);
  const result = await input.runGovernor.run({
    scope: 'run',
    command,
    bindings: {
      ...input.commandContext,
      commandId: input.commandId,
      commandDigest,
    },
    ...(input.outputImporter === undefined ? {} : { outputImporter: input.outputImporter }),
    ...(input.outputImporter === undefined
      ? {}
      : {
          sandboxOutputArtifacts: {
            stdout: { kind: 'logs', name: `${artifactPrefix}-${artifactCommandId}-stdout.txt`, visibility: 'internal' },
            stderr: { kind: 'logs', name: `${artifactPrefix}-${artifactCommandId}-stderr.txt`, visibility: 'internal' },
            diagnostic: { kind: 'logs', name: `${artifactPrefix}-${artifactCommandId}-diagnostic.txt`, visibility: 'internal' },
          },
        }),
    ...(input.mockRunContext === undefined ? {} : { mockRunContext: input.mockRunContext }),
  });
  if (result.timed_out || result.exit_code !== 0) {
    throw new Error(result.public_summary);
  }
  return {
    stdout: result.stdout_ref === undefined ? '' : await input.readCommandOutputRef(result.stdout_ref),
    diagnosticRefs: Object.values(result.output_artifacts ?? {}),
  };
};

const safeArtifactName = (value: string): string => {
  const sanitized = value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/\.\.+/g, '-')
    .replace(/^\.+/, '')
    .replace(/^-+|-+$/g, '');
  return sanitized.length > 0 ? sanitized : 'git';
};

const digestCommand = (
  command: MaterializedStructuredCommand,
  context: AuthoritativeChangedFileCommandContext,
): string => {
  const actualResourceDigest = resourceLimitDigest(context.resourceLimits);
  if (actualResourceDigest !== context.resourceLimitDigest) {
    throw new Error('Resource limit digest does not match authoritative changed-file context.');
  }
  return structuredCommandDigest({
    command,
    resource_limit_digest: context.resourceLimitDigest,
    run_id: context.runId,
    workspace_root: context.workspaceRoot,
    artifact_root: context.artifactRoot,
    sandbox_output_root_policy: context.sandboxOutputRootPolicy,
    artifact_quota_policy: context.artifactQuotaPolicy,
  });
};

const parseNameStatusDiff = (output: string, repoId: string, pathSafety: PathSafety): ChangedFile[] => {
  const tokens = strictNulTokens(output);
  const changedFiles: ChangedFile[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const status = tokens[index];
    if (status === undefined || status.length === 0) {
      throw new Error('Malformed git diff status.');
    }
    if (status.startsWith('R')) {
      const previousPath = tokens[index + 1];
      const nextPath = tokens[index + 2];
      if (previousPath === undefined || nextPath === undefined) {
        throw new Error('Malformed git rename status.');
      }
      changedFiles.push({
        repo_id: repoId,
        path: normalizeChangedPath(nextPath, pathSafety),
        change_kind: 'renamed',
        previous_path: normalizeChangedPath(previousPath, pathSafety),
      });
      index += 2;
      continue;
    }

    const path = tokens[index + 1];
    if (path === undefined) {
      throw new Error('Malformed git diff path.');
    }
    changedFiles.push({
      repo_id: repoId,
      path: normalizeChangedPath(path, pathSafety),
      change_kind: status[0] === 'A' ? 'added' : status[0] === 'D' ? 'deleted' : 'modified',
    });
    index += 1;
  }
  return changedFiles;
};

const parsePorcelainV2Status = (output: string, repoId: string, pathSafety: PathSafety): ChangedFile[] => {
  const tokens = strictNulTokens(output);
  const changedFiles: ChangedFile[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const record = tokens[index];
    if (record === undefined) {
      throw new Error('Malformed git status record.');
    }
    if (record.startsWith('? ') || record.startsWith('! ')) {
      const path = record.slice(2);
      if (record.startsWith('! ') && path.endsWith('/')) {
        throw new Error('Ignored directory was not enumerated by git status.');
      }
      changedFiles.push({ repo_id: repoId, path: normalizeChangedPath(path, pathSafety), change_kind: 'added' });
      continue;
    }
    if (record.startsWith('1 ')) {
      const path = porcelainPathAfterMetadata(record, 8);
      changedFiles.push({ repo_id: repoId, path: normalizeChangedPath(path, pathSafety), change_kind: 'modified' });
      continue;
    }
    if (record.startsWith('2 ')) {
      const path = porcelainPathAfterMetadata(record, 9);
      const previousPath = tokens[index + 1];
      if (previousPath === undefined) {
        throw new Error('Malformed porcelain rename record.');
      }
      changedFiles.push({
        repo_id: repoId,
        path: normalizeChangedPath(path, pathSafety),
        change_kind: 'renamed',
        previous_path: normalizeChangedPath(previousPath, pathSafety),
      });
      index += 1;
      continue;
    }
    throw new Error('Unsupported git porcelain record.');
  }
  return changedFiles;
};

const strictNulTokens = (output: string): string[] => {
  if (output.length === 0) {
    return [];
  }
  if (!output.endsWith('\0')) {
    throw new Error('Git output is not NUL-terminated.');
  }
  return output.slice(0, -1).split('\0');
};

const porcelainPathAfterMetadata = (record: string, metadataFields: number): string => {
  let field = 0;
  for (let index = 0; index < record.length; index += 1) {
    if (record[index] === ' ') {
      field += 1;
      if (field === metadataFields) {
        return record.slice(index + 1);
      }
    }
  }
  throw new Error('Malformed porcelain metadata.');
};

const normalizeChangedPath = (path: string, pathSafety: PathSafety): string => pathSafety.normalizeRepoRelativePath(path);

const uniqueChangedFiles = (changedFiles: ChangedFile[]): ChangedFile[] => {
  const seen = new Set<string>();
  const result: ChangedFile[] = [];
  for (const changedFile of changedFiles) {
    const key = `${changedFile.repo_id}\0${changedFile.change_kind}\0${changedFile.previous_path ?? ''}\0${changedFile.path}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(changedFile);
  }
  return result;
};

const changedFilesUnavailable = (summary: string): DeriveAuthoritativeChangedFilesResult => ({
  ok: false,
  code: 'changed_files_unavailable',
  summary,
});
