import type {
  ExecutionPackage,
  Release,
  ReleaseBlocker,
  ReleaseBlockerCategory,
  ReleaseBlockerCode,
  ReleaseBlockerSnapshot,
  ReleaseEvidence,
  ReviewPacket,
  RunSession,
  WorkItem,
} from './types.js';
import { releaseBlockerCodes } from './types.js';

export { releaseBlockerCodes };

export type ReleaseResolvedLinkStatus = 'resolved' | 'missing' | 'archived' | 'deleted' | 'unauthorized';

export interface ReleaseResolvedWorkItemLink {
  object_id: string;
  status: ReleaseResolvedLinkStatus;
  reason?: string;
  work_item?: WorkItem;
}

export interface ReleaseResolvedExecutionPackageLink {
  object_id: string;
  status: ReleaseResolvedLinkStatus;
  reason?: string;
  execution_package?: ExecutionPackage;
}

export interface ReleaseGateContext {
  release?: Release;
  work_items?: readonly WorkItem[];
  work_item_links?: readonly ReleaseResolvedWorkItemLink[];
  execution_packages?: readonly ExecutionPackage[];
  execution_package_links?: readonly ReleaseResolvedExecutionPackageLink[];
  run_sessions?: readonly RunSession[];
  review_packets?: readonly ReviewPacket[];
  evidence?: readonly ReleaseEvidence[];
  public_link_visibility?: readonly ReleasePublicLinkVisibility[];
}

export interface ReleasePublicLinkVisibility {
  object_type: string;
  object_id: string;
  public: boolean;
}

export interface ReleaseBlockerTruthTableEntry {
  code: ReleaseBlockerCode;
  category: ReleaseBlockerCategory;
  overrideable: boolean;
  blocks_submit: boolean;
  blocks_plain_approval: boolean;
  blocks_override_approval: boolean;
}

export type ReleaseBlockerTruthTable = Record<ReleaseBlockerCode, ReleaseBlockerTruthTableEntry>;

const overrideableCodes = new Set<ReleaseBlockerCode>([
  'work_item_not_complete',
  'package_not_release_ready',
  'missing_approved_review_packet',
  'failed_required_check',
  'missing_required_artifact',
  'evidence_redacted',
  'stale_or_superseded_evidence',
  'missing_required_evidence_backlink',
  'unsafe_or_redacted_evidence_backlink',
  'missing_rollout_strategy',
  'missing_rollback_plan',
  'missing_observation_plan',
]);

const categoryByCode: Record<ReleaseBlockerCode, ReleaseBlockerCategory> = {
  missing_work_item: 'structural',
  missing_execution_package: 'structural',
  empty_work_item_scope: 'structural',
  empty_execution_package_scope: 'structural',
  work_item_not_complete: 'risk',
  package_not_release_ready: 'risk',
  missing_approved_review_packet: 'evidence',
  failed_required_check: 'evidence',
  missing_required_artifact: 'evidence',
  evidence_redacted: 'evidence',
  stale_or_superseded_evidence: 'evidence',
  missing_required_evidence_backlink: 'evidence',
  unsafe_or_redacted_evidence_backlink: 'evidence',
  missing_rollout_strategy: 'planning',
  missing_rollback_plan: 'planning',
  missing_observation_plan: 'planning',
};

export const isReleaseBlockerOverrideable = (code: ReleaseBlockerCode): boolean => overrideableCodes.has(code);

export const releaseBlockerTruthTable = (): ReleaseBlockerTruthTable =>
  Object.fromEntries(
    releaseBlockerCodes.map((code) => {
      const overrideable = isReleaseBlockerOverrideable(code);
      return [
        code,
        {
          code,
          category: categoryByCode[code],
          overrideable,
          blocks_submit: !overrideable,
          blocks_plain_approval: true,
          blocks_override_approval: !overrideable,
        },
      ];
    }),
  ) as ReleaseBlockerTruthTable;

const blocker = (code: ReleaseBlockerCode, message: string, object?: { type: string; id: string }): ReleaseBlocker => ({
  code,
  category: categoryByCode[code],
  overrideable: isReleaseBlockerOverrideable(code),
  message,
  ...(object !== undefined ? { object_type: object.type, object_id: object.id } : {}),
});

const hasText = (value: string | undefined): value is string => value !== undefined && value.trim().length > 0;

const isVisible = (object: { archived_at?: string; deleted_at?: string }): boolean =>
  object.archived_at === undefined && object.deleted_at === undefined;

const sortNewestFirst = <T extends { created_at: string }>(items: readonly T[]): T[] =>
  [...items].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));

const stableBlockerValue = (blocker: ReleaseBlocker) => ({
  category: blocker.category,
  code: blocker.code,
  message: blocker.message,
  object_id: blocker.object_id ?? '',
  object_type: blocker.object_type ?? '',
  overrideable: blocker.overrideable,
});

const sha256Constants = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

const rotateRight = (value: number, bits: number): number => (value >>> bits) | (value << (32 - bits));

const encodeUtf8 = (value: string): number[] => {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.charCodeAt(index);
    if (codePoint >= 0xd800 && codePoint <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        codePoint = 0x10000 + ((codePoint - 0xd800) << 10) + (next - 0xdc00);
        index += 1;
      }
    }

    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(0xe0 | (codePoint >>> 12), 0x80 | ((codePoint >>> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18),
        0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return bytes;
};

const sha256Hex = (value: string): string => {
  const bytes = encodeUtf8(value);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) {
    bytes.push(0);
  }
  for (let shift = 56; shift >= 0; shift -= 8) {
    bytes.push(Math.floor(bitLength / 2 ** shift) & 0xff);
  }

  const hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const words = new Array<number>(64);

  for (let chunkStart = 0; chunkStart < bytes.length; chunkStart += 64) {
    for (let index = 0; index < 16; index += 1) {
      const offset = chunkStart + index * 4;
      words[index] =
        ((bytes[offset] ?? 0) << 24) |
        ((bytes[offset + 1] ?? 0) << 16) |
        ((bytes[offset + 2] ?? 0) << 8) |
        (bytes[offset + 3] ?? 0);
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rotateRight(words[index - 15] ?? 0, 7) ^ rotateRight(words[index - 15] ?? 0, 18) ^ ((words[index - 15] ?? 0) >>> 3);
      const s1 = rotateRight(words[index - 2] ?? 0, 17) ^ rotateRight(words[index - 2] ?? 0, 19) ^ ((words[index - 2] ?? 0) >>> 10);
      words[index] = (((words[index - 16] ?? 0) + s0 + (words[index - 7] ?? 0) + s1) >>> 0);
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e ?? 0, 6) ^ rotateRight(e ?? 0, 11) ^ rotateRight(e ?? 0, 25);
      const choice = ((e ?? 0) & (f ?? 0)) ^ (~(e ?? 0) & (g ?? 0));
      const temp1 = ((h ?? 0) + s1 + choice + (sha256Constants[index] ?? 0) + (words[index] ?? 0)) >>> 0;
      const s0 = rotateRight(a ?? 0, 2) ^ rotateRight(a ?? 0, 13) ^ rotateRight(a ?? 0, 22);
      const majority = ((a ?? 0) & (b ?? 0)) ^ ((a ?? 0) & (c ?? 0)) ^ ((b ?? 0) & (c ?? 0));
      const temp2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = ((d ?? 0) + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = ((hash[0] ?? 0) + (a ?? 0)) >>> 0;
    hash[1] = ((hash[1] ?? 0) + (b ?? 0)) >>> 0;
    hash[2] = ((hash[2] ?? 0) + (c ?? 0)) >>> 0;
    hash[3] = ((hash[3] ?? 0) + (d ?? 0)) >>> 0;
    hash[4] = ((hash[4] ?? 0) + (e ?? 0)) >>> 0;
    hash[5] = ((hash[5] ?? 0) + (f ?? 0)) >>> 0;
    hash[6] = ((hash[6] ?? 0) + (g ?? 0)) >>> 0;
    hash[7] = ((hash[7] ?? 0) + (h ?? 0)) >>> 0;
  }

  return hash.map((word) => word.toString(16).padStart(8, '0')).join('');
};

export const fingerprintReleaseBlockers = (blockers: readonly ReleaseBlocker[]): string => {
  const stableJson = JSON.stringify(
    blockers
      .map(stableBlockerValue)
      .sort((left, right) =>
        `${left.code}\0${left.object_type}\0${left.object_id}\0${left.message}`.localeCompare(
          `${right.code}\0${right.object_type}\0${right.object_id}\0${right.message}`,
        ),
      ),
  );
  return `release-blockers:v1:sha256:${sha256Hex(stableJson)}`;
};

export const createReleaseBlockerSnapshot = (input: {
  release_id: string;
  generated_at: string;
  blockers: readonly ReleaseBlocker[];
}): ReleaseBlockerSnapshot => ({
  release_id: input.release_id,
  generated_at: input.generated_at,
  blocker_fingerprint: fingerprintReleaseBlockers(input.blockers),
  blockers: input.blockers.map((item) => ({ ...item })),
});

export const isReleaseBlockerSnapshotInternallyConsistent = (snapshot: ReleaseBlockerSnapshot): boolean =>
  snapshot.blocker_fingerprint === fingerprintReleaseBlockers(snapshot.blockers);

export const selectReleaseReviewPacket = (
  release: Pick<Release, 'current_review_packet_ids' | 'current_run_session_ids'>,
  executionPackage: Pick<ExecutionPackage, 'id' | 'last_run_session_id'>,
  reviewPackets: readonly ReviewPacket[],
): ReviewPacket | undefined => {
  const packagePackets = reviewPackets.filter(
    (reviewPacket) => reviewPacket.execution_package_id === executionPackage.id && reviewPacket.status !== 'archived',
  );

  const currentReviewPacket = packagePackets.find(
    (reviewPacket) => release.current_review_packet_ids?.includes(reviewPacket.id) === true,
  );
  if (currentReviewPacket !== undefined) {
    return currentReviewPacket;
  }

  const currentRunReviewPacket = sortNewestFirst(packagePackets).find(
    (reviewPacket) => release.current_run_session_ids?.includes(reviewPacket.run_session_id) === true,
  );
  if (currentRunReviewPacket !== undefined) {
    return currentRunReviewPacket;
  }

  if (executionPackage.last_run_session_id !== undefined) {
    const lastRunPacket = sortNewestFirst(packagePackets).find(
      (reviewPacket) => reviewPacket.run_session_id === executionPackage.last_run_session_id,
    );
    if (lastRunPacket !== undefined) {
      return lastRunPacket;
    }
  }

  return sortNewestFirst(packagePackets)[0];
};

const runForReviewPacket = (reviewPacket: ReviewPacket | undefined, runSessions: readonly RunSession[]) =>
  reviewPacket === undefined ? undefined : runSessions.find((runSession) => runSession.id === reviewPacket.run_session_id);

const missingRequiredArtifactKinds = (
  executionPackage: Pick<ExecutionPackage, 'required_artifact_kinds'>,
  runSession: Pick<RunSession, 'artifacts' | 'log_refs'> | undefined,
): string[] => {
  if (runSession === undefined) {
    return [...executionPackage.required_artifact_kinds];
  }

  const artifactKinds = new Set(runSession.artifacts.map((artifact) => artifact.kind));
  const logKinds = new Set(runSession.log_refs.map((artifact) => artifact.kind));
  return executionPackage.required_artifact_kinds.filter((kind) =>
    kind === 'logs' ? !logKinds.has(kind) : !artifactKinds.has(kind),
  );
};

const hasFailedOrMissingRequiredCheck = (
  executionPackage: Pick<ExecutionPackage, 'required_checks'>,
  runSession: Pick<RunSession, 'check_results'> | undefined,
): boolean => {
  if (runSession === undefined) {
    return executionPackage.required_checks.length > 0;
  }

  const checkResultsById = new Map(runSession.check_results.map((check) => [check.check_id, check]));
  return executionPackage.required_checks.some((requiredCheck) => {
    const result = checkResultsById.get(requiredCheck.check_id);
    return result === undefined || result.status !== 'succeeded';
  });
};

interface ObservationLink {
  object_type: string;
  object_id: string;
  relationship?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const observationLinksFor = (evidence: ReleaseEvidence): ObservationLink[] => {
  const observation = isRecord(evidence.extra) ? evidence.extra.observation : undefined;
  if (!isRecord(observation) || !Array.isArray(observation.links)) {
    return [];
  }

  return observation.links.filter((link): link is ObservationLink => {
    if (!isRecord(link)) {
      return false;
    }
    return typeof link.object_type === 'string' && typeof link.object_id === 'string';
  });
};

const visibilityKey = (objectType: string, objectId: string): string => `${objectType}\0${objectId}`;

const hasUnsafePublicObservationLink = (
  links: readonly ObservationLink[],
  publicLinkVisibility: readonly ReleasePublicLinkVisibility[] | undefined,
): boolean => {
  if (publicLinkVisibility === undefined) {
    return false;
  }

  const visibilityByRef = new Map(
    publicLinkVisibility.map((item) => [visibilityKey(item.object_type, item.object_id), item.public]),
  );

  return links.some((link) => visibilityByRef.get(visibilityKey(link.object_type, link.object_id)) !== true);
};

const isObservationEvidenceType = (evidenceType: ReleaseEvidence['evidence_type']): boolean =>
  evidenceType === 'observation_note' || evidenceType === 'metric_snapshot';

const isPublicObservationLink = (
  link: ObservationLink,
  publicLinkVisibility: readonly ReleasePublicLinkVisibility[] | undefined,
): boolean => {
  if (publicLinkVisibility === undefined) {
    return true;
  }

  return publicLinkVisibility.some(
    (item) => item.object_type === link.object_type && item.object_id === link.object_id && item.public,
  );
};

const hasPublicReleaseBacklink = (
  links: readonly ObservationLink[],
  release: Release,
  publicLinkVisibility: readonly ReleasePublicLinkVisibility[] | undefined,
): boolean =>
  links.some(
    (link) =>
      link.object_type === 'release' &&
      link.object_id === release.id &&
      isPublicObservationLink(link, publicLinkVisibility),
  );

const hasPublicScopedBacklink = (
  links: readonly ObservationLink[],
  release: Release,
  publicLinkVisibility: readonly ReleasePublicLinkVisibility[] | undefined,
): boolean => {
  const scopedWorkItemIds = new Set(release.work_item_ids);
  const scopedExecutionPackageIds = new Set(release.execution_package_ids);
  if (scopedWorkItemIds.size === 0 && scopedExecutionPackageIds.size === 0) {
    return true;
  }

  return links.some(
    (link) =>
      ((link.object_type === 'work_item' && scopedWorkItemIds.has(link.object_id)) ||
        (link.object_type === 'execution_package' && scopedExecutionPackageIds.has(link.object_id))) &&
      isPublicObservationLink(link, publicLinkVisibility),
  );
};

const hasRequiredObservationBacklinks = (
  evidence: ReleaseEvidence,
  release: Release,
  publicLinkVisibility: readonly ReleasePublicLinkVisibility[] | undefined,
): boolean => {
  const links = observationLinksFor(evidence);
  return hasPublicReleaseBacklink(links, release, publicLinkVisibility) && hasPublicScopedBacklink(links, release, publicLinkVisibility);
};

export const isCompletedCloseObservationEvidence = (evidence: ReleaseEvidence, context: ReleaseGateContext): boolean => {
  const release = context.release;
  if (
    release === undefined ||
    evidence.release_id !== release.id ||
    !isObservationEvidenceType(evidence.evidence_type) ||
    evidence.redacted ||
    evidence.status !== 'current'
  ) {
    return false;
  }

  const observation = isRecord(evidence.extra) ? evidence.extra.observation : undefined;
  if (!isRecord(observation)) {
    return false;
  }

  const severity = observation.severity;
  if (severity === 'failure') {
    return false;
  }

  return hasRequiredObservationBacklinks(evidence, release, context.public_link_visibility);
};

const resolveWorkItemLinks = (
  release: Release,
  workItems: readonly WorkItem[],
  explicitLinks: readonly ReleaseResolvedWorkItemLink[] | undefined,
): ReleaseResolvedWorkItemLink[] => {
  if (explicitLinks !== undefined) {
    return release.work_item_ids.map((workItemId) => {
      const explicit = explicitLinks.find((link) => link.object_id === workItemId);
      if (explicit !== undefined) {
        return explicit;
      }

      return { object_id: workItemId, status: 'missing' };
    });
  }

  return release.work_item_ids.map((workItemId) => {
    const item = workItems.find((workItem) => workItem.id === workItemId);
    if (item === undefined) {
      return { object_id: workItemId, status: 'missing' };
    }
    if (item.archived_at !== undefined) {
      return { object_id: workItemId, status: 'archived', work_item: item };
    }
    if (item.deleted_at !== undefined) {
      return { object_id: workItemId, status: 'deleted', work_item: item };
    }

    return { object_id: workItemId, status: 'resolved', work_item: item };
  });
};

const resolveExecutionPackageLinks = (
  release: Release,
  executionPackages: readonly ExecutionPackage[],
  explicitLinks: readonly ReleaseResolvedExecutionPackageLink[] | undefined,
): ReleaseResolvedExecutionPackageLink[] => {
  if (explicitLinks !== undefined) {
    return release.execution_package_ids.map((executionPackageId) => {
      const explicit = explicitLinks.find((link) => link.object_id === executionPackageId);
      if (explicit !== undefined) {
        return explicit;
      }

      return { object_id: executionPackageId, status: 'missing' };
    });
  }

  return release.execution_package_ids.map((executionPackageId) => {
    const item = executionPackages.find((executionPackage) => executionPackage.id === executionPackageId);
    if (item === undefined) {
      return { object_id: executionPackageId, status: 'missing' };
    }
    if (item.archived_at !== undefined) {
      return { object_id: executionPackageId, status: 'archived', execution_package: item };
    }
    if (item.deleted_at !== undefined) {
      return { object_id: executionPackageId, status: 'deleted', execution_package: item };
    }

    return { object_id: executionPackageId, status: 'resolved', execution_package: item };
  });
};

export const deriveReleaseBlockers = (context: ReleaseGateContext): ReleaseBlocker[] => {
  const release = context.release;
  const workItems = context.work_items ?? [];
  const executionPackages = context.execution_packages ?? [];
  const runSessions = context.run_sessions ?? [];
  const reviewPackets = context.review_packets ?? [];
  const evidence = context.evidence ?? [];
  const blockers: ReleaseBlocker[] = [];

  if (release === undefined) {
    return blockers;
  }

  const validWorkItems = resolveWorkItemLinks(release, workItems, context.work_item_links)
    .map((link) => {
      if (link.status !== 'resolved' || link.work_item === undefined || !isVisible(link.work_item)) {
        blockers.push(blocker('missing_work_item', `Release is missing valid work item ${link.object_id}.`, {
          type: 'work_item',
          id: link.object_id,
        }));
        return undefined;
      }
      return link.work_item;
    })
    .filter((workItem): workItem is WorkItem => workItem !== undefined);

  const validExecutionPackages = resolveExecutionPackageLinks(
    release,
    executionPackages,
    context.execution_package_links,
  )
    .map((link) => {
      if (link.status !== 'resolved' || link.execution_package === undefined || !isVisible(link.execution_package)) {
        blockers.push(
          blocker('missing_execution_package', `Release is missing valid execution package ${link.object_id}.`, {
            type: 'execution_package',
            id: link.object_id,
          }),
        );
        return undefined;
      }
      return link.execution_package;
    })
    .filter((executionPackage): executionPackage is ExecutionPackage => executionPackage !== undefined);

  if (validWorkItems.length === 0) {
    blockers.push(blocker('empty_work_item_scope', 'Release requires at least one valid work item.', {
      type: 'work_item_scope',
      id: release.id,
    }));
  }

  if (validExecutionPackages.length === 0) {
    blockers.push(blocker('empty_execution_package_scope', 'Release requires at least one valid execution package.', {
      type: 'execution_package_scope',
      id: release.id,
    }));
  }

  for (const workItem of validWorkItems) {
    if (workItem.resolution !== 'completed') {
      blockers.push(blocker('work_item_not_complete', `Work item ${workItem.id} is not complete.`, {
        type: 'work_item',
        id: workItem.id,
      }));
    }
  }

  for (const executionPackage of validExecutionPackages) {
    if (executionPackage.gate_state !== 'release_ready' && executionPackage.gate_state !== 'released') {
      blockers.push(blocker('package_not_release_ready', `Execution package ${executionPackage.id} is not release-ready.`, {
        type: 'execution_package',
        id: executionPackage.id,
      }));
    }

    const selectedReviewPacket = selectReleaseReviewPacket(release, executionPackage, reviewPackets);
    if (
      selectedReviewPacket === undefined ||
      selectedReviewPacket.status !== 'completed' ||
      selectedReviewPacket.decision !== 'approved'
    ) {
      blockers.push(
        blocker('missing_approved_review_packet', `Execution package ${executionPackage.id} has no approved review packet.`, {
          type: 'execution_package',
          id: executionPackage.id,
        }),
      );
    }

    const selectedRunSession = runForReviewPacket(selectedReviewPacket, runSessions);
    if (
      hasFailedOrMissingRequiredCheck(executionPackage, selectedRunSession) ||
      selectedRunSession?.check_results.some((check) => check.blocks_review && check.status !== 'succeeded') === true
    ) {
      blockers.push(blocker('failed_required_check', `Execution package ${executionPackage.id} has a failed required check.`, {
        type: 'execution_package',
        id: executionPackage.id,
      }));
    }

    if (missingRequiredArtifactKinds(executionPackage, selectedRunSession).length > 0) {
      blockers.push(
        blocker('missing_required_artifact', `Execution package ${executionPackage.id} is missing required artifacts.`, {
          type: 'execution_package',
          id: executionPackage.id,
        }),
      );
    }
  }

  for (const item of evidence) {
    if (item.release_id !== release.id) {
      continue;
    }
    if (item.redacted) {
      blockers.push(blocker('evidence_redacted', `Release evidence ${item.id} is redacted.`, {
        type: 'release_evidence',
        id: item.id,
      }));
    }
    if (item.status !== 'current') {
      blockers.push(blocker('stale_or_superseded_evidence', `Release evidence ${item.id} is stale or superseded.`, {
        type: 'release_evidence',
        id: item.id,
      }));
    }
    if (isObservationEvidenceType(item.evidence_type) && isRecord(isRecord(item.extra) ? item.extra.observation : undefined)) {
      const links = observationLinksFor(item);
      if (!hasRequiredObservationBacklinks(item, release, context.public_link_visibility)) {
        blockers.push(
          blocker('missing_required_evidence_backlink', `Observation evidence ${item.id} is missing required public release or scoped backlinks.`, {
            type: 'release_evidence',
            id: item.id,
          }),
        );
      }
      if (hasUnsafePublicObservationLink(links, context.public_link_visibility)) {
        blockers.push(
          blocker(
            'unsafe_or_redacted_evidence_backlink',
            `Observation evidence ${item.id} has a backlink that cannot be publicly projected.`,
            {
              type: 'release_evidence',
              id: item.id,
            },
          ),
        );
      }
    }
  }

  if (
    release.phase === 'observing' &&
    release.gate_state === 'rollout_succeeded' &&
    !evidence.some((item) => isCompletedCloseObservationEvidence(item, context)) &&
    !blockers.some((item) => item.code === 'missing_required_evidence_backlink')
  ) {
    blockers.push(
      blocker(
        'missing_required_evidence_backlink',
        'Release requires current public observation evidence before completed close.',
        {
          type: 'release',
          id: release.id,
        },
      ),
    );
  }

  if (!hasText(release.rollout_strategy)) {
    blockers.push(blocker('missing_rollout_strategy', 'Release is missing a rollout strategy.'));
  }
  if (!hasText(release.rollback_plan)) {
    blockers.push(blocker('missing_rollback_plan', 'Release is missing a rollback plan.'));
  }
  if (!hasText(release.observation_plan)) {
    blockers.push(blocker('missing_observation_plan', 'Release is missing an observation plan.'));
  }

  return blockers;
};

export interface ReleaseRiskSummary {
  structural_blocker_count: number;
  risk_blocker_count: number;
  evidence_blocker_count: number;
  planning_blocker_count: number;
  redacted_or_stale_evidence_count: number;
  failed_or_missing_check_count: number;
  packages_not_ready_count: number;
  release_can_proceed_without_override: boolean;
  release_can_proceed_with_override: boolean;
  release_cannot_proceed: boolean;
}

export interface ReleaseChecklistItem {
  id: string;
  label: string;
  status: 'passed' | 'blocked' | 'warning' | 'pending';
  blocker_codes: ReleaseBlockerCode[];
  summary?: string;
}

const releaseChecklistGroups: readonly {
  id: string;
  label: string;
  categories: readonly ReleaseBlockerCategory[];
  passedSummary: string;
}[] = [
  {
    id: 'scope',
    label: 'Release scope',
    categories: ['structural'],
    passedSummary: 'Release has valid work item and execution package scope.',
  },
  {
    id: 'readiness',
    label: 'Implementation readiness',
    categories: ['risk'],
    passedSummary: 'Scoped work items and execution packages are release-ready.',
  },
  {
    id: 'evidence',
    label: 'Release evidence',
    categories: ['evidence'],
    passedSummary: 'Required review, checks, artifacts, and evidence backlinks are present.',
  },
  {
    id: 'planning',
    label: 'Release planning',
    categories: ['planning'],
    passedSummary: 'Rollout, rollback, and observation plans are present.',
  },
];

export const deriveReleaseRiskSummary = (context: ReleaseGateContext): ReleaseRiskSummary => {
  const blockers = deriveReleaseBlockers(context);
  const counts = blockers.reduce<Record<ReleaseBlockerCategory, number>>(
    (summary, item) => ({ ...summary, [item.category]: summary[item.category] + 1 }),
    { structural: 0, risk: 0, evidence: 0, planning: 0 },
  );
  const hasNonOverrideableBlockers = blockers.some((item) => !item.overrideable);

  return {
    structural_blocker_count: counts.structural,
    risk_blocker_count: counts.risk,
    evidence_blocker_count: counts.evidence,
    planning_blocker_count: counts.planning,
    redacted_or_stale_evidence_count: blockers.filter(
      (item) => item.code === 'evidence_redacted' || item.code === 'stale_or_superseded_evidence',
    ).length,
    failed_or_missing_check_count: blockers.filter((item) => item.code === 'failed_required_check').length,
    packages_not_ready_count: blockers.filter((item) => item.code === 'package_not_release_ready').length,
    release_can_proceed_without_override: blockers.length === 0,
    release_can_proceed_with_override: blockers.length > 0 && !hasNonOverrideableBlockers,
    release_cannot_proceed: hasNonOverrideableBlockers,
  };
};

export const deriveReleaseChecklist = (context: ReleaseGateContext): ReleaseChecklistItem[] => {
  const blockers = deriveReleaseBlockers(context);

  return releaseChecklistGroups.map((group) => {
    const groupBlockers = blockers.filter((item) => group.categories.includes(item.category));
    const blockerCodes = [...new Set(groupBlockers.map((item) => item.code))];
    return {
      id: group.id,
      label: group.label,
      status: groupBlockers.length > 0 ? 'blocked' : 'passed',
      blocker_codes: blockerCodes,
      summary:
        groupBlockers.length > 0
          ? `${group.label} has ${groupBlockers.length} blocker(s).`
          : group.passedSummary,
    };
  });
};

export const deriveReleaseNextActions = (context: ReleaseGateContext): string[] => {
  const blockers = deriveReleaseBlockers(context);
  if (blockers.length === 0) {
    return ['Submit release for approval or approve with the current evidence packet.'];
  }

  return blockers.map((item) =>
    item.overrideable
      ? `Resolve or explicitly override ${item.code}.`
      : `Resolve non-overrideable blocker ${item.code}.`,
  );
};
