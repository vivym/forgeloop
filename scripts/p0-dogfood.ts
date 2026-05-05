import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

type JsonObject = Record<string, unknown>;

type DogfoodItem = {
  label: string;
  kind: 'feature' | 'bugfix' | 'test_refactor';
  title: string;
  goal: string;
  executorType: 'local_codex' | 'mock';
  workflowOnly: boolean;
  changesRequested: boolean;
};

type DogfoodResult = {
  label: string;
  workItemId?: string;
  packageId?: string;
  runSessionId?: string;
  reviewPacketId?: string;
  executorType: string;
  status: 'passed' | 'failed';
  notes: string[];
};

const apiUrl = (process.env.FORGELOOP_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const reportPath = resolve(process.env.FORGELOOP_REPORT_PATH ?? 'docs/superpowers/reports/p0-delivery-loop-verification.md');
const repoPath = resolve(process.env.FORGELOOP_REPO_PATH ?? process.cwd());
const repoId = process.env.FORGELOOP_REPO_ID ?? 'forgeloop';
const actorOwner = process.env.FORGELOOP_ACTOR_OWNER ?? 'actor-owner';
const actorReviewer = process.env.FORGELOOP_ACTOR_REVIEWER ?? 'actor-reviewer';
const actorQa = process.env.FORGELOOP_ACTOR_QA ?? 'actor-qa';

const dogfoodItems: DogfoodItem[] = [
  {
    label: 'feature-local-codex',
    kind: 'feature',
    title: 'Dogfood feature through local_codex',
    goal: 'Produce an approved P0 feature handoff with real local_codex evidence.',
    executorType: 'local_codex',
    workflowOnly: false,
    changesRequested: false,
  },
  {
    label: 'bugfix-local-codex',
    kind: 'bugfix',
    title: 'Dogfood bugfix through local_codex review loop',
    goal: 'Produce an approved P0 bugfix handoff after changes_requested and rerun.',
    executorType: 'local_codex',
    workflowOnly: false,
    changesRequested: true,
  },
  {
    label: 'test-refactor-mock',
    kind: 'test_refactor',
    title: 'Dogfood test refactor through mock executor',
    goal: 'Validate P0 fallback control flow with the workflow-only mock executor.',
    executorType: 'mock',
    workflowOnly: true,
    changesRequested: false,
  },
];

const requiredChecks = [
  {
    check_id: 'dogfood-required',
    display_name: 'Dogfood required check',
    command: 'pnpm smoke:p0',
    timeout_seconds: 600,
    blocks_review: true,
  },
];

const commandLog = [
  'pnpm test',
  'pnpm build',
  'pnpm smoke:p0',
  'pnpm dogfood:p0',
];

const isObject = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);

const stringField = (value: JsonObject, field: string): string => {
  const raw = value[field];
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new Error(`Expected ${field} in API response`);
  }
  return raw;
};

const arrayField = (value: JsonObject, field: string): unknown[] => {
  const raw = value[field];
  if (!Array.isArray(raw)) {
    throw new Error(`Expected ${field} array in API response`);
  }
  return raw;
};

const runGit = async (args: string[]): Promise<string> => {
  const { stdout } = await execFile('git', args, { cwd: repoPath });
  return stdout.trim();
};

const runCommand = async (command: string, args: string[], cwd = repoPath): Promise<string> => {
  const { stdout } = await execFile(command, args, { cwd });
  return stdout.trim();
};

const requestJson = async (path: string, options: { method?: string; body?: JsonObject } = {}): Promise<JsonObject> => {
  const response = await fetch(`${apiUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const payload = text.length === 0 ? {} : JSON.parse(text);

  if (!response.ok) {
    throw new Error(`${options.method ?? 'GET'} ${path} failed with ${response.status}: ${text}`);
  }
  if (!isObject(payload)) {
    throw new Error(`${options.method ?? 'GET'} ${path} returned a non-object response`);
  }

  return payload;
};

const getBaseCommit = async (): Promise<string> => process.env.FORGELOOP_BASE_COMMIT_SHA ?? (await runGit(['rev-parse', 'HEAD']));

const getDefaultBranch = async (): Promise<string> => {
  if (process.env.FORGELOOP_DEFAULT_BRANCH !== undefined) {
    return process.env.FORGELOOP_DEFAULT_BRANCH;
  }

  try {
    const branch = await runGit(['branch', '--show-current']);
    return branch.length > 0 ? branch : 'main';
  } catch {
    return 'main';
  }
};

const preflightLocalCodex = async (): Promise<{ ok: boolean; notes: string[]; baseCommit?: string; defaultBranch?: string }> => {
  const notes: string[] = [];
  let baseCommit: string | undefined;
  let defaultBranch: string | undefined;

  try {
    const inside = await runGit(['rev-parse', '--is-inside-work-tree']);
    if (inside !== 'true') {
      notes.push(`${repoPath} is not a git work tree.`);
    }
  } catch (error) {
    notes.push(`FORGELOOP_REPO_PATH is not a readable git repo: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    baseCommit = await getBaseCommit();
    await runGit(['cat-file', '-e', `${baseCommit}^{commit}`]);
  } catch (error) {
    notes.push(`Base commit is unavailable or invalid: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    defaultBranch = await getDefaultBranch();
  } catch {
    defaultBranch = 'main';
  }

  try {
    const version = await runCommand('codex', ['--version']);
    notes.push(`Codex CLI available: ${version || 'version command succeeded'}.`);
  } catch (error) {
    notes.push(`Codex CLI is required for local_codex dogfood acceptance: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { ok: notes.every((note) => !note.includes('required') && !note.includes('invalid') && !note.includes('not a')), notes, baseCommit, defaultBranch };
};

const createOrUseProject = async (): Promise<JsonObject> => {
  const existingProjectId = process.env.FORGELOOP_PROJECT_ID;
  if (existingProjectId !== undefined && existingProjectId.trim().length > 0) {
    return requestJson(`/projects/${encodeURIComponent(existingProjectId)}`);
  }

  return requestJson('/projects', {
    method: 'POST',
    body: { name: 'Forgeloop P0 dogfood', owner_actor_id: actorOwner },
  });
};

const bindRepo = async (projectId: string, baseCommit: string, defaultBranch: string): Promise<void> => {
  await requestJson(`/projects/${encodeURIComponent(projectId)}/repos`, {
    method: 'POST',
    body: {
      repo_id: repoId,
      name: repoId,
      local_path: repoPath,
      default_branch: defaultBranch,
      base_commit_sha: baseCommit,
    },
  });
};

const approveSpecAndPlan = async (workItemId: string): Promise<{ specRevisionId: string; planRevisionId: string }> => {
  const spec = await requestJson(`/work-items/${encodeURIComponent(workItemId)}/specs`, { method: 'POST', body: {} });
  const specId = stringField(spec, 'id');
  const specRevision = await requestJson(`/specs/${encodeURIComponent(specId)}/generate-draft`, { method: 'POST', body: {} });
  await requestJson(`/specs/${encodeURIComponent(specId)}/submit-for-approval`, { method: 'POST', body: { actor_id: actorOwner } });
  await requestJson(`/specs/${encodeURIComponent(specId)}/approve`, { method: 'POST', body: { actor_id: actorReviewer } });

  const plan = await requestJson(`/work-items/${encodeURIComponent(workItemId)}/plans`, { method: 'POST', body: {} });
  const planId = stringField(plan, 'id');
  const planRevision = await requestJson(`/plans/${encodeURIComponent(planId)}/generate-draft`, { method: 'POST', body: {} });
  await requestJson(`/plans/${encodeURIComponent(planId)}/submit-for-approval`, { method: 'POST', body: { actor_id: actorOwner } });
  await requestJson(`/plans/${encodeURIComponent(planId)}/approve`, { method: 'POST', body: { actor_id: actorReviewer } });

  return {
    specRevisionId: stringField(specRevision, 'id'),
    planRevisionId: stringField(planRevision, 'id'),
  };
};

const createReadyPackage = async (planRevisionId: string, item: DogfoodItem): Promise<JsonObject> => {
  const executionPackage = await requestJson(`/plan-revisions/${encodeURIComponent(planRevisionId)}/execution-packages`, {
    method: 'POST',
    body: {
      repo_id: repoId,
      objective: item.goal,
      owner_actor_id: actorOwner,
      reviewer_actor_id: actorReviewer,
      qa_owner_actor_id: actorQa,
      required_checks: requiredChecks,
      required_artifact_kinds: ['diff', 'changed_files', 'check_output', 'execution_summary'],
      allowed_paths: ['apps/**', 'packages/**', 'tests/**', 'scripts/**', 'docs/**', 'README.md', 'package.json'],
      forbidden_paths: ['.git/**', 'node_modules/**'],
    },
  });
  await requestJson(`/execution-packages/${encodeURIComponent(stringField(executionPackage, 'id'))}/mark-ready`, {
    method: 'POST',
    body: { actor_id: actorOwner },
  });
  return executionPackage;
};

const runExecutionPackage = async (
  packageId: string,
  item: DogfoodItem,
  mode: 'run' | 'rerun' = 'run',
  previousRunSessionId?: string,
): Promise<JsonObject> =>
  requestJson(`/execution-packages/${encodeURIComponent(packageId)}/${mode}`, {
    method: 'POST',
    body: {
      requested_by_actor_id: actorOwner,
      executor_type: item.executorType,
      workflow_only: item.workflowOnly,
      ...(previousRunSessionId === undefined ? {} : { previous_run_session_id: previousRunSessionId }),
    },
  });

const workflowReviewPacketId = (runResponse: JsonObject): string => {
  const workflowResult = runResponse.workflow_result;
  if (!isObject(workflowResult)) {
    throw new Error('Run response did not include workflow_result');
  }
  return stringField(workflowResult, 'reviewPacketId');
};

const requestChanges = async (reviewPacketId: string): Promise<void> => {
  await requestJson(`/review-packets/${encodeURIComponent(reviewPacketId)}/request-changes`, {
    method: 'POST',
    body: {
      summary: 'Dogfood review requires a replacement run before approval.',
      reviewed_by_actor_id: actorReviewer,
      reviewed_at: new Date().toISOString(),
      requested_changes: [
        {
          title: 'Regenerate dogfood evidence',
          description: 'Exercise changes_requested -> rerun -> approve before P0 handoff.',
          file_path: 'scripts/p0-dogfood.ts',
          severity: 'major',
          suggested_validation: 'pnpm dogfood:p0',
        },
      ],
    },
  });
};

const approveReview = async (reviewPacketId: string): Promise<void> => {
  await requestJson(`/review-packets/${encodeURIComponent(reviewPacketId)}/approve`, {
    method: 'POST',
    body: {
      summary: 'Dogfood review approved for P0 handoff.',
      reviewed_by_actor_id: actorReviewer,
      reviewed_at: new Date().toISOString(),
    },
  });
};

const hasArtifactKind = (runSession: JsonObject, kind: string): boolean =>
  arrayField(runSession, 'artifacts').some((artifact) => isObject(artifact) && artifact.kind === kind);

const hasRetainedLocalCodexReference = (runSession: JsonObject): boolean => {
  const executorResult = runSession.executor_result;
  if (!isObject(executorResult)) {
    return false;
  }
  const rawMetadata = executorResult.raw_metadata;
  if (isObject(rawMetadata) && typeof rawMetadata.workspace_path === 'string' && typeof rawMetadata.base_ref === 'string') {
    return true;
  }

  return [...arrayField(runSession, 'artifacts'), ...arrayField(runSession, 'log_refs')].some(
    (artifact) => isObject(artifact) && typeof artifact.local_ref === 'string' && artifact.local_ref.startsWith(repoPath),
  );
};

const assertApprovedEvidence = async (item: DogfoodItem, runSessionId: string, reviewPacketId: string): Promise<string[]> => {
  const notes: string[] = [];
  const runSession = await requestJson(`/run-sessions/${encodeURIComponent(runSessionId)}`);
  const reviewPacket = await requestJson(`/review-packets/${encodeURIComponent(reviewPacketId)}`);
  const executorResult = runSession.executor_result;
  const changedFiles = arrayField(runSession, 'changed_files');
  const checks = arrayField(runSession, 'check_results');

  if (!isObject(executorResult)) {
    notes.push('RunSession is missing executor_result.');
  } else {
    if (executorResult.executor_type !== item.executorType) {
      notes.push(`Executor type ${String(executorResult.executor_type)} did not match ${item.executorType}.`);
    }
    if (item.executorType === 'local_codex' && !hasRetainedLocalCodexReference(runSession)) {
      notes.push('local_codex run is missing retained workspace_path/base_ref evidence.');
    }
  }

  if (runSession.status !== 'succeeded') {
    notes.push(`RunSession status is ${String(runSession.status)}.`);
  }
  if (reviewPacket.decision !== 'approved' || reviewPacket.status !== 'completed') {
    notes.push(`ReviewPacket was not approved: ${String(reviewPacket.status)}/${String(reviewPacket.decision)}.`);
  }
  if (changedFiles.length === 0) {
    notes.push('RunSession has no changed_files.');
  }
  if (checks.length === 0) {
    notes.push('RunSession has no check_results.');
  }
  if (checks.some((check) => isObject(check) && check.blocks_review === true && check.status !== 'succeeded')) {
    notes.push('At least one blocking required check did not succeed.');
  }
  if (!hasArtifactKind(runSession, 'diff')) {
    notes.push('RunSession is missing a diff artifact.');
  }

  return notes;
};

const dogfoodOneItem = async (projectId: string, item: DogfoodItem): Promise<DogfoodResult> => {
  const notes: string[] = [];
  const workItem = await requestJson('/work-items', {
    method: 'POST',
    body: {
      project_id: projectId,
      kind: item.kind,
      title: item.title,
      goal: item.goal,
      success_criteria: [
        'Approved SpecRevision exists.',
        'Approved PlanRevision exists.',
        'Execution package produces run and review evidence.',
      ],
      priority: 'P0',
      risk: item.executorType === 'local_codex' ? 'high' : 'medium',
      owner_actor_id: actorOwner,
    },
  });
  const workItemId = stringField(workItem, 'id');
  const { planRevisionId } = await approveSpecAndPlan(workItemId);
  const executionPackage = await createReadyPackage(planRevisionId, item);
  const packageId = stringField(executionPackage, 'id');

  let run = await runExecutionPackage(packageId, item);
  let runSessionId = stringField(run, 'run_session_id');
  let reviewPacketId = workflowReviewPacketId(run);

  if (item.changesRequested) {
    await requestChanges(reviewPacketId);
    const rerun = await runExecutionPackage(packageId, item, 'rerun', runSessionId);
    const rerunSessionId = stringField(rerun, 'run_session_id');
    const rerunReviewPacketId = workflowReviewPacketId(rerun);
    if (rerunSessionId === runSessionId) {
      notes.push('Rerun did not create a new RunSession.');
    }
    if (rerunReviewPacketId === reviewPacketId) {
      notes.push('Rerun did not create a new ReviewPacket.');
    }
    run = rerun;
    runSessionId = rerunSessionId;
    reviewPacketId = rerunReviewPacketId;
  }

  await approveReview(reviewPacketId);
  notes.push(...(await assertApprovedEvidence(item, runSessionId, reviewPacketId)));

  return {
    label: item.label,
    workItemId,
    packageId,
    runSessionId,
    reviewPacketId,
    executorType: item.executorType,
    status: notes.length === 0 ? 'passed' : 'failed',
    notes,
  };
};

const renderReport = (data: {
  status: 'PASS' | 'FAIL' | 'NOT_RUN';
  preflightNotes: string[];
  results: DogfoodResult[];
  error?: string;
}): string => {
  const resultLines =
    data.results.length === 0
      ? ['- No dogfood work items completed in this run.']
      : data.results.map((result) =>
          [
            `- ${result.label}: ${result.status.toUpperCase()} (${result.executorType})`,
            `  - WorkItem: ${result.workItemId ?? 'n/a'}`,
            `  - Package: ${result.packageId ?? 'n/a'}`,
            `  - RunSession: ${result.runSessionId ?? 'n/a'}`,
            `  - ReviewPacket: ${result.reviewPacketId ?? 'n/a'}`,
            ...(result.notes.length === 0 ? ['  - Evidence checks passed.'] : result.notes.map((note) => `  - ${note}`)),
          ].join('\n'),
        );

  return [
    '# P0 Delivery Loop Verification',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Dogfood status: ${data.status}`,
    '',
    '## Commands',
    '',
    ...commandLog.map((command) => `- \`${command}\``),
    '',
    '## Expected Outcomes',
    '',
    '- `pnpm test`: all Vitest suites pass.',
    '- `pnpm build`: all workspace packages and apps compile.',
    '- `pnpm smoke:p0`: P0 smoke suite passes for straight approval, changes-requested rerun approval, and stale packet force-rerun.',
    '- `pnpm dogfood:p0`: exits 0 only when two local_codex dogfood items and one mock item complete with approved review evidence.',
    '',
    '## Dogfood Preconditions',
    '',
    `- API URL: ${apiUrl}`,
    `- Repo path: ${repoPath}`,
    `- Repo id: ${repoId}`,
    '- local_codex acceptance requires Codex CLI, a server-configured local repo checkout, changed files, required-check results, a diff artifact, and retained workspace/base-ref evidence.',
    '- Mock/control-flow validation does not replace the two required local_codex acceptance items.',
    '',
    '## Preflight',
    '',
    ...(data.preflightNotes.length === 0 ? ['- No preflight notes recorded.'] : data.preflightNotes.map((note) => `- ${note}`)),
    '',
    '## Dogfood Results',
    '',
    ...resultLines,
    '',
    '## Actual Results',
    '',
    data.error === undefined ? `- Last dogfood run finished with status ${data.status}.` : `- ${data.error}`,
    '',
  ].join('\n');
};

const writeReport = async (content: string): Promise<void> => {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, content);
};

const main = async (): Promise<number> => {
  const preflight = await preflightLocalCodex();
  if (!preflight.ok || preflight.baseCommit === undefined || preflight.defaultBranch === undefined) {
    await writeReport(renderReport({ status: 'FAIL', preflightNotes: preflight.notes, results: [], error: 'local_codex preflight failed.' }));
    return 1;
  }

  const results: DogfoodResult[] = [];
  try {
    const project = await createOrUseProject();
    const projectId = stringField(project, 'id');
    await bindRepo(projectId, preflight.baseCommit, preflight.defaultBranch);

    for (const item of dogfoodItems) {
      results.push(await dogfoodOneItem(projectId, item));
    }

    const failedResults = results.filter((result) => result.status === 'failed');
    const status = failedResults.length === 0 ? 'PASS' : 'FAIL';
    await writeReport(renderReport({ status, preflightNotes: preflight.notes, results }));
    return failedResults.length === 0 ? 0 : 1;
  } catch (error) {
    await writeReport(
      renderReport({
        status: 'FAIL',
        preflightNotes: preflight.notes,
        results,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return 1;
  }
};

process.exitCode = await main();
