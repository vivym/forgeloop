import {
  assertCodexRuntimeCapsulePublicReportSafe,
  codexCanonicalDigest,
  codexRuntimeCapsuleDiscoveryReportSchema,
  codexThreadLocatorRepairManifestDigest,
  codexThreadLocatorRepairManifestSchema,
} from '@forgeloop/domain';

import {
  assertSafeCodexHomePathEntry,
  classifyCodexHomePath,
  type CodexHomePathClassification,
  type CodexHomePathEntryKind,
} from './path-classifier.js';

export type CodexRuntimeCapsuleDiscoveryStatus = 'passed' | 'blocked';

export type CodexHomeMutationKind = 'created' | 'modified' | 'deleted';

export interface ObservedCodexHomePathMutation {
  relative_path: string;
  mutation_kind: CodexHomeMutationKind;
  entry_kind: CodexHomePathEntryKind;
  required_for_restore?: boolean;
}

export interface CodexThreadLocatorRepairManifest {
  schema_version: 'codex_thread_locator_repair_manifest.v1';
  codex_thread_id_digest: string;
  rollout_relative_path: string;
  rollout_digest: string;
  repair_strategy: 'minimal_state_index_upsert';
  required_state_tables?: Array<{
    table_name: string;
    allowed_columns: string[];
    row_digest: string;
  }>;
}

export type CodexThreadLocatorRepairStrategy =
  | { kind: 'minimal_state_index_upsert'; strategy_digest?: string }
  | { kind: 'copy_whole_sqlite_db'; relative_path: string };

export interface ObservedCodexHomeState {
  observed_path_mutations: ObservedCodexHomePathMutation[];
  locator_repair_manifest?: CodexThreadLocatorRepairManifest;
  locator_repair_strategy?: CodexThreadLocatorRepairStrategy;
  public_observations?: Record<string, unknown>;
  blocker_codes?: string[];
}

export interface CodexRuntimeCapsuleDiscoveryProbe {
  codexVersion(): Promise<string>;
  appServerProtocolDigest(): Promise<string>;
  runControlledScenario(input: { codexHomeRoot: string }): Promise<ObservedCodexHomeState>;
}

export interface CodexRuntimeCapsuleDiscoveryReport {
  schema_version: 'codex_runtime_capsule_discovery_report.v1';
  status: CodexRuntimeCapsuleDiscoveryStatus;
  codex_cli_version_digest: string;
  app_server_protocol_digest: string;
  path_mutation_counts: Record<CodexHomePathClassification, number>;
  observed_mutation_count: number;
  locator_repair_manifest_digest?: string;
  public_observations_digest?: string;
  blocker_codes: string[];
}

export interface CodexRuntimeCapsuleDiscoveryInput {
  codexHomeRoot: string;
  probe: CodexRuntimeCapsuleDiscoveryProbe;
}

const allClassifications: readonly CodexHomePathClassification[] = [
  'thread_state_allowed',
  'memory_state_allowed',
  'environment_component',
  'generated_environment',
  'forbidden',
  'forbidden_whole_db',
  'unknown',
];

const emptyPathMutationCounts = (): Record<CodexHomePathClassification, number> => ({
  thread_state_allowed: 0,
  memory_state_allowed: 0,
  environment_component: 0,
  generated_environment: 0,
  forbidden: 0,
  forbidden_whole_db: 0,
  unknown: 0,
});

const pushBlocker = (blockers: string[], code: string): void => {
  if (!blockers.includes(code)) {
    blockers.push(code);
  }
};

export const runCodexRuntimeCapsuleDiscovery = async (
  input: CodexRuntimeCapsuleDiscoveryInput,
): Promise<CodexRuntimeCapsuleDiscoveryReport> => {
  const codexVersion = await input.probe.codexVersion();
  const protocolDigest = await input.probe.appServerProtocolDigest();
  const observed = await input.probe.runControlledScenario({ codexHomeRoot: input.codexHomeRoot });
  const blockerCodes: string[] = [];
  const counts = emptyPathMutationCounts();
  for (const blockerCode of observed.blocker_codes ?? []) {
    pushBlocker(blockerCodes, blockerCode);
  }

  for (const mutation of observed.observed_path_mutations) {
    let classification: CodexHomePathClassification;
    try {
      classification = classifyCodexHomePath(mutation.relative_path).classification;
      if (
        mutation.entry_kind !== 'regular_file' ||
        (mutation.required_for_restore === true &&
          classification !== 'thread_state_allowed' &&
          classification !== 'memory_state_allowed' &&
          classification !== 'environment_component' &&
          classification !== 'generated_environment')
      ) {
        throw new Error('unsafe Codex home path entry');
      }
      if (
        mutation.required_for_restore === true ||
        classification === 'thread_state_allowed' ||
        classification === 'memory_state_allowed' ||
        classification === 'environment_component' ||
        classification === 'generated_environment'
      ) {
        assertSafeCodexHomePathEntry({
          relativePath: mutation.relative_path,
          entryKind: mutation.entry_kind,
        });
      }
    } catch {
      const pathClassification = safeClassifyCodexHomePath(mutation.relative_path);
      classification = pathClassification;
      if (pathClassification === 'unknown') {
        pushBlocker(blockerCodes, 'codex_runtime_capsule_discovery_unknown_path');
      } else {
        pushBlocker(blockerCodes, 'codex_runtime_capsule_discovery_unsafe_path_entry');
      }
    }
    counts[classification] += 1;
    if (classification === 'unknown') {
      pushBlocker(blockerCodes, 'codex_runtime_capsule_discovery_unknown_path');
    }
    if ((classification === 'forbidden' || classification === 'forbidden_whole_db') && mutation.required_for_restore === true) {
      pushBlocker(blockerCodes, 'codex_runtime_capsule_discovery_forbidden_required_path');
    }
  }

  if (observed.locator_repair_strategy?.kind === 'copy_whole_sqlite_db') {
    pushBlocker(blockerCodes, 'codex_runtime_capsule_discovery_whole_db_repair_forbidden');
  }

  let locatorRepairManifestDigest: string | undefined;
  if (observed.locator_repair_manifest === undefined) {
    pushBlocker(blockerCodes, 'codex_runtime_capsule_discovery_locator_repair_manifest_missing');
  } else {
    const locatorRepairManifestResult = codexThreadLocatorRepairManifestSchema.safeParse(observed.locator_repair_manifest);
    if (!locatorRepairManifestResult.success) {
      pushBlocker(blockerCodes, 'codex_runtime_capsule_discovery_locator_repair_manifest_invalid');
    } else {
      locatorRepairManifestDigest = codexThreadLocatorRepairManifestDigest(locatorRepairManifestResult.data);
    }
  }

  let publicObservationsDigest: string | undefined;
  if (observed.public_observations !== undefined) {
    assertCodexRuntimeCapsulePublicReportSafe(observed.public_observations);
    publicObservationsDigest = codexCanonicalDigest(observed.public_observations);
  }

  const report: CodexRuntimeCapsuleDiscoveryReport = {
    schema_version: 'codex_runtime_capsule_discovery_report.v1',
    status: blockerCodes.length === 0 ? 'passed' : 'blocked',
    codex_cli_version_digest: codexCanonicalDigest(codexVersion),
    app_server_protocol_digest: protocolDigest,
    path_mutation_counts: allClassifications.reduce(
      (acc, classification) => ({ ...acc, [classification]: counts[classification] }),
      {} as Record<CodexHomePathClassification, number>,
    ),
    observed_mutation_count: observed.observed_path_mutations.length,
    blocker_codes: blockerCodes,
  };
  if (locatorRepairManifestDigest !== undefined) {
    report.locator_repair_manifest_digest = locatorRepairManifestDigest;
  }
  if (publicObservationsDigest !== undefined) {
    report.public_observations_digest = publicObservationsDigest;
  }

  return codexRuntimeCapsuleDiscoveryReportSchema.parse(report) as unknown as CodexRuntimeCapsuleDiscoveryReport;
};

const safeClassifyCodexHomePath = (relativePath: string): CodexHomePathClassification => {
  try {
    return classifyCodexHomePath(relativePath).classification;
  } catch {
    return 'unknown';
  }
};
