import { createHash } from 'node:crypto';
import type { ExecutionPackage, Release, WorkItem } from '@forgeloop/domain';
import { describe, expect, it } from 'vitest';

import {
  deriveWorkItemPreReleaseReadiness,
  preReleaseBlockerFingerprint,
  type DecisionLike,
  type ReleaseBlockerLike,
  type ReleaseTestAcceptanceEvidenceLike,
  type WorkItemPreReleaseReadinessInput,
} from '../../packages/db/src/queries/work-item-release-readiness';

const now = '2026-05-20T00:00:00.000Z';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

const scopeFingerprint = (
  release: Pick<Release, 'id'>,
  workItem: Pick<WorkItem, 'id'>,
  packages: readonly Pick<ExecutionPackage, 'id'>[],
): string =>
  `work-item-pre-release-scope:v1:sha256:${createHash('sha256')
    .update(
      stableJson({
        release_id: release.id,
        work_item_id: workItem.id,
        execution_package_ids: [...new Set(packages.map((item) => item.id))].sort(),
      }),
    )
    .digest('hex')}`;

const workItemFixture = (overrides: Partial<WorkItem> = {}): WorkItem => ({
  id: 'wi-1',
  project_id: 'project-1',
  kind: 'requirement',
  title: 'Ship the readiness slice',
  goal: 'Expose pre-release readiness.',
  success_criteria: ['Readiness is deterministic.'],
  priority: 'medium',
  risk: 'medium',
  owner_actor_id: 'actor-owner',
  phase: 'release',
  activity_state: 'idle',
  gate_state: 'none',
  resolution: 'none',
  current_spec_id: 'spec-1',
  current_spec_revision_id: 'spec-r1',
  current_plan_id: 'plan-1',
  current_plan_revision_id: 'plan-r1',
  created_at: now,
  updated_at: now,
  ...overrides,
});

const packageRef = (id = 'pkg-1', overrides: Partial<ExecutionPackage> = {}): ExecutionPackage => ({
  id,
  work_item_id: 'wi-1',
  spec_id: 'spec-1',
  spec_revision_id: 'spec-r1',
  plan_id: 'plan-1',
  plan_revision_id: 'plan-r1',
  project_id: 'project-1',
  repo_id: 'repo-1',
  objective: `Implement ${id}.`,
  owner_actor_id: 'actor-owner',
  reviewer_actor_id: 'actor-reviewer',
  qa_owner_actor_id: 'actor-qa',
  phase: 'release',
  activity_state: 'idle',
  gate_state: 'release_ready',
  resolution: 'none',
  required_checks: [],
  required_artifact_kinds: [],
  allowed_paths: [],
  forbidden_paths: [],
  source_mutation_policy: 'path_policy_scoped',
  version: 1,
  created_at: now,
  updated_at: now,
  ...overrides,
});

const releaseFixture = (overrides: Partial<Release> = {}): Release => ({
  id: 'rel-1',
  org_id: 'org-1',
  project_id: 'project-1',
  title: 'Readiness release',
  phase: 'candidate',
  activity_state: 'idle',
  gate_state: 'not_submitted',
  resolution: 'none',
  work_item_ids: ['wi-1'],
  execution_package_ids: ['pkg-1'],
  rollout_strategy: 'Roll out to the beta cohort.',
  rollback_plan: 'Revert the release branch.',
  observation_plan: 'Watch service metrics.',
  created_by_actor_id: 'actor-owner',
  created_at: now,
  updated_at: now,
  ...overrides,
});

const preReleaseBlocker = (overrides: Partial<ReleaseBlockerLike> = {}): ReleaseBlockerLike => ({
  code: 'missing_rollout_strategy',
  message: 'Rollout strategy is missing.',
  object_type: 'release',
  object_id: 'rel-1',
  overrideable: true,
  category: 'planning',
  ...overrides,
});

const releaseTestAcceptance = (
  overrides: Partial<ReleaseTestAcceptanceEvidenceLike> = {},
): ReleaseTestAcceptanceEvidenceLike => ({
  release_id: 'rel-1',
  gate_id: 'qa-ack',
  state: 'not_required',
  rationale: 'No release Test/Acceptance gate is required for this Work Item scope.',
  ...overrides,
});

const decisionFixture = (overrides: Partial<DecisionLike> = {}): DecisionLike => ({
  id: 'decision-1',
  object_type: 'release',
  object_id: 'rel-1',
  actor_id: 'actor-owner',
  decision_type: 'test_acceptance_acknowledged',
  decision: 'completed',
  outcome: 'completed',
  summary: 'Acknowledged.',
  created_at: now,
  ...overrides,
});

const releaseInput = (
  overrides: Partial<WorkItemPreReleaseReadinessInput> & {
    overrideFingerprint?: string;
  } = {},
): WorkItemPreReleaseReadinessInput => {
  const { overrideFingerprint, ...inputOverrides } = overrides;
  const workItem = inputOverrides.workItem ?? workItemFixture();
  const packages = inputOverrides.packages ?? [packageRef()];
  const releases = inputOverrides.releases ?? [releaseFixture()];
  const linkedRelease = releases[0];
  const defaultTestAcceptance =
    linkedRelease === undefined
      ? []
      : [
          releaseTestAcceptance({
            release_id: linkedRelease.id,
            scope_fingerprint: scopeFingerprint(linkedRelease, workItem, packages),
          }),
        ];
  const blockerSnapshot =
    overrideFingerprint === undefined
      ? undefined
      : {
          release_id: 'rel-1',
          generated_at: now,
          blocker_fingerprint: overrideFingerprint,
          blockers: [preReleaseBlocker()],
        };

  return {
    workItem,
    packages,
    releases,
    releaseBlockers: [],
    releaseTestAcceptance: defaultTestAcceptance,
    releaseEvidence: [],
    decisions:
      blockerSnapshot === undefined
        ? []
        : [
            decisionFixture({
              decision_type: 'manual_override',
              decision: 'override_approved',
              outcome: 'override_approved',
              evidence_refs: {
                blocker_snapshot: blockerSnapshot,
                ...(linkedRelease === undefined
                  ? {}
                  : { scope_fingerprint: scopeFingerprint(linkedRelease, workItem, packages) }),
              },
            }),
          ],
    qualityGatePassed: true,
    handoffExpected: false,
    ...inputOverrides,
  };
};

describe('Work Item pre-release readiness', () => {
  it('is missing when handoff is expected and no release is linked', () => {
    expect(deriveWorkItemPreReleaseReadiness(releaseInput({ handoffExpected: true, releases: [] }))).toMatchObject({
      state: 'missing',
      blockers: [expect.objectContaining({ code: 'missing_linked_release' })],
    });
  });

  it('blocks partial release scope', () => {
    expect(
      deriveWorkItemPreReleaseReadiness(
        releaseInput({
          packages: [packageRef('pkg-1'), packageRef('pkg-2')],
          releases: [releaseFixture({ execution_package_ids: ['pkg-1'] })],
        }),
      ),
    ).toMatchObject({ state: 'blocked', blockers: [expect.objectContaining({ code: 'partial_release_scope' })] });
  });

  it('blocks when the linked release omits the Work Item from release scope', () => {
    expect(
      deriveWorkItemPreReleaseReadiness(
        releaseInput({
          packages: [packageRef('pkg-1')],
          releases: [releaseFixture({ work_item_ids: [], execution_package_ids: ['pkg-1'] })],
        }),
      ),
    ).toMatchObject({ state: 'blocked', blockers: [expect.objectContaining({ code: 'partial_release_scope' })] });
  });

  it('excludes observation-only blockers from pre-release readiness', () => {
    expect(
      deriveWorkItemPreReleaseReadiness(
        releaseInput({
          releases: [releaseFixture({ execution_package_ids: ['pkg-1'] })],
          releaseBlockers: [
            preReleaseBlocker({
              code: 'missing_observation_plan',
              message: 'Observation needed.',
              object_type: 'release',
              object_id: 'rel-1',
            }),
          ],
        }),
      ).blockers,
    ).toEqual([]);
  });

  it('excludes post-release incident follow-up blockers from pre-release readiness', () => {
    expect(
      deriveWorkItemPreReleaseReadiness(
        releaseInput({
          releaseBlockers: [
            preReleaseBlocker({
              code: 'post_release_incident_follow_up',
              message: 'Incident follow-up is pending.',
              object_type: 'release',
              object_id: 'rel-1',
            }),
          ],
        }),
      ),
    ).toMatchObject({ state: 'ready', blockers: [] });
  });

  it('keeps whitelisted pre-release blockers even when their message mentions incidents', () => {
    expect(
      deriveWorkItemPreReleaseReadiness(
        releaseInput({
          releaseBlockers: [
            preReleaseBlocker({
              code: 'missing_rollback_plan',
              message: 'Incident rollback plan is missing.',
              object_type: 'release',
              object_id: 'rel-1',
            }),
          ],
        }),
      ),
    ).toMatchObject({ state: 'blocked', blockers: [expect.objectContaining({ code: 'missing_rollback_plan' })] });
  });

  it('excludes completed-close observation evidence backlink blockers from pre-release readiness', () => {
    expect(
      deriveWorkItemPreReleaseReadiness(
        releaseInput({
          releaseBlockers: [
            preReleaseBlocker({
              code: 'missing_required_evidence_backlink',
              category: 'evidence',
              message: 'Release requires current public observation evidence before completed close.',
              object_type: 'release',
              object_id: 'rel-1',
            }),
          ],
        }),
      ),
    ).toMatchObject({ state: 'ready', blockers: [] });
  });

  it('keeps pre-release incident-response evidence backlink blockers', () => {
    expect(
      deriveWorkItemPreReleaseReadiness(
        releaseInput({
          releaseBlockers: [
            preReleaseBlocker({
              code: 'missing_required_evidence_backlink',
              category: 'evidence',
              message: 'Rollback plan incident-response evidence is missing before release.',
              object_type: 'release',
              object_id: 'rel-1',
            }),
          ],
        }),
      ),
    ).toMatchObject({
      state: 'blocked',
      blockers: [expect.objectContaining({ code: 'missing_required_evidence_backlink' })],
    });
  });

  it('keeps standalone pre-release observation evidence backlink blockers', () => {
    expect(
      deriveWorkItemPreReleaseReadiness(
        releaseInput({
          releaseBlockers: [
            preReleaseBlocker({
              code: 'missing_required_evidence_backlink',
              category: 'evidence',
              message: 'Pre-release observation evidence is missing before release.',
              object_type: 'release',
              object_id: 'rel-1',
            }),
          ],
        }),
      ),
    ).toMatchObject({
      state: 'blocked',
      blockers: [expect.objectContaining({ code: 'missing_required_evidence_backlink' })],
    });
  });

  it('requires override fingerprints to match the pre-release blocker scope', () => {
    expect(
      deriveWorkItemPreReleaseReadiness(
        releaseInput({
          releases: [releaseFixture({ execution_package_ids: ['pkg-1'] })],
          releaseBlockers: [preReleaseBlocker()],
          overrideFingerprint: 'release-blockers:v1:sha256:stale',
        }),
      ),
    ).toMatchObject({ state: 'blocked', blockers: [expect.objectContaining({ code: 'missing_rollout_strategy' })] });
  });

  it('blocks when linked release Test/Acceptance evidence is missing or unacknowledged', () => {
    expect(
      deriveWorkItemPreReleaseReadiness(
        releaseInput({
          packages: [packageRef('pkg-1')],
          releases: [releaseFixture({ id: 'rel-1', execution_package_ids: ['pkg-1'] })],
          releaseTestAcceptance: [
            releaseTestAcceptance({ release_id: 'rel-1', state: 'missing', scope_fingerprint: 'scope-1' }),
          ],
          decisions: [],
        }),
      ),
    ).toMatchObject({
      state: 'blocked',
      blockers: [expect.objectContaining({ code: 'missing_release_test_acceptance' })],
    });
  });

  it('blocks linked release Test/Acceptance evidence scoped to a stale package set', () => {
    expect(
      deriveWorkItemPreReleaseReadiness(
        releaseInput({
          releaseTestAcceptance: [
            releaseTestAcceptance({
              state: 'passed',
              acknowledged: true,
              scope_fingerprint: 'work-item-pre-release-scope:v1:sha256:stale',
            }),
          ],
        }),
      ),
    ).toMatchObject({
      state: 'blocked',
      blockers: [expect.objectContaining({ code: 'missing_release_test_acceptance' })],
    });
  });

  it('is not applicable when no release is linked before quality gate handoff is expected', () => {
    expect(
      deriveWorkItemPreReleaseReadiness(
        releaseInput({ releases: [], handoffExpected: false, qualityGatePassed: false }),
      ),
    ).toMatchObject({
      state: 'not_applicable',
      blockers: [],
    });
  });

  it('is missing when quality gate passed and no release is linked', () => {
    expect(
      deriveWorkItemPreReleaseReadiness(
        releaseInput({ releases: [], handoffExpected: false, qualityGatePassed: true }),
      ),
    ).toMatchObject({
      state: 'missing',
      blockers: [expect.objectContaining({ code: 'missing_linked_release' })],
    });
  });

  it('blocks linked release readiness until the upstream quality gate passes', () => {
    expect(deriveWorkItemPreReleaseReadiness(releaseInput({ qualityGatePassed: false }))).toMatchObject({
      state: 'blocked',
      blockers: [expect.objectContaining({ code: 'quality_gate_not_passed' })],
    });
  });

  it('clears matching pre-release blockers with a matching manual override but not a stale override', () => {
    const blocker = preReleaseBlocker({ code: 'missing_rollback_plan', message: 'Rollback plan is missing.' });
    const matchingFingerprint = preReleaseBlockerFingerprint([blocker]);

    expect(
      deriveWorkItemPreReleaseReadiness(
        releaseInput({ releaseBlockers: [blocker], overrideFingerprint: 'release-blockers:v1:sha256:stale' }),
      ),
    ).toMatchObject({ state: 'blocked', blockers: [expect.objectContaining({ code: 'missing_rollback_plan' })] });

    expect(
      deriveWorkItemPreReleaseReadiness(
        releaseInput({ releaseBlockers: [blocker], overrideFingerprint: matchingFingerprint }),
      ),
    ).toMatchObject({ state: 'ready', blockers: [] });
  });

  it('requires manual overrides to match the current Work Item package scope fingerprint', () => {
    const blocker = preReleaseBlocker({ code: 'missing_rollback_plan', message: 'Rollback plan is missing.' });
    const blockerFingerprint = preReleaseBlockerFingerprint([blocker]);
    const base = releaseInput({ releaseBlockers: [blocker] });
    const currentScopeFingerprint = deriveWorkItemPreReleaseReadiness(base).scope_fingerprint;
    const scopedOverride = (scope_fingerprint: string | undefined): DecisionLike =>
      decisionFixture({
        decision_type: 'manual_override',
        decision: 'override_approved',
        outcome: 'override_approved',
        evidence_refs: {
          scope_fingerprint,
          blocker_snapshot: {
            release_id: 'rel-1',
            generated_at: now,
            blocker_fingerprint: blockerFingerprint,
            blockers: [blocker],
          },
        },
      });

    expect(
      deriveWorkItemPreReleaseReadiness({
        ...base,
        decisions: [scopedOverride('work-item-pre-release-scope:v1:sha256:stale')],
      }),
    ).toMatchObject({ state: 'blocked', blockers: [expect.objectContaining({ code: 'missing_rollback_plan' })] });

    expect(
      deriveWorkItemPreReleaseReadiness({
        ...base,
        decisions: [scopedOverride(currentScopeFingerprint)],
      }),
    ).toMatchObject({ state: 'ready', blockers: [] });
  });

  it('clears missing Test/Acceptance with a matching acknowledgement but not a stale acknowledgement', () => {
    const base = releaseInput({ releaseTestAcceptance: [releaseTestAcceptance({ state: 'missing' })] });
    const scopeFingerprint = deriveWorkItemPreReleaseReadiness(base).scope_fingerprint;

    expect(
      deriveWorkItemPreReleaseReadiness({
        ...base,
        decisions: [
          decisionFixture({
            evidence_refs: { release_id: 'rel-1', scope_fingerprint: 'work-item-pre-release-scope:v1:stale' },
          }),
        ],
      }),
    ).toMatchObject({
      state: 'blocked',
      blockers: [expect.objectContaining({ code: 'missing_release_test_acceptance' })],
    });

    expect(
      deriveWorkItemPreReleaseReadiness({
        ...base,
        decisions: [
          decisionFixture({
            evidence_refs: { release_id: 'rel-1', scope_fingerprint: scopeFingerprint },
          }),
        ],
      }),
    ).toMatchObject({ state: 'ready', blockers: [] });
  });

  it('is ready when scope is complete and Test/Acceptance is passed and acknowledged', () => {
    const scopeFingerprint = deriveWorkItemPreReleaseReadiness(releaseInput()).scope_fingerprint;

    expect(
      deriveWorkItemPreReleaseReadiness(
        releaseInput({
          releaseTestAcceptance: [
            releaseTestAcceptance({ state: 'passed', acknowledged: true, scope_fingerprint: scopeFingerprint }),
          ],
        }),
      ),
    ).toMatchObject({ state: 'ready', blockers: [] });
  });

  it.each(['passed', 'succeeded'] as const)(
    'is ready when exact-scope Test/Acceptance evidence is %s without acknowledgement metadata',
    (state) => {
      const scopeFingerprint = deriveWorkItemPreReleaseReadiness(releaseInput()).scope_fingerprint;

      expect(
        deriveWorkItemPreReleaseReadiness(
          releaseInput({
            releaseTestAcceptance: [releaseTestAcceptance({ state, scope_fingerprint: scopeFingerprint })],
          }),
        ),
      ).toMatchObject({ state: 'ready', blockers: [] });
    },
  );

  it('is ready when exact-scope Test/Acceptance evidence is acknowledged', () => {
    const scopeFingerprint = deriveWorkItemPreReleaseReadiness(releaseInput()).scope_fingerprint;

    expect(
      deriveWorkItemPreReleaseReadiness(
        releaseInput({
          releaseTestAcceptance: [releaseTestAcceptance({ state: 'acknowledged', scope_fingerprint: scopeFingerprint })],
        }),
      ),
    ).toMatchObject({ state: 'ready', blockers: [] });
  });

  it.each(['ready', 'approved', 'completed', 'not_applicable', 'skipped'] as const)(
    'blocks exact-scope Test/Acceptance evidence with unsupported state %s',
    (state) => {
      const scopeFingerprint = deriveWorkItemPreReleaseReadiness(releaseInput()).scope_fingerprint;

      expect(
        deriveWorkItemPreReleaseReadiness(
          releaseInput({
            releaseTestAcceptance: [
              releaseTestAcceptance({ state, acknowledged: true, scope_fingerprint: scopeFingerprint }),
            ],
          }),
        ),
      ).toMatchObject({
        state: 'blocked',
        blockers: [expect.objectContaining({ code: 'missing_release_test_acceptance' })],
      });
    },
  );

  it('is ready when Test/Acceptance is not required with rationale', () => {
    const input = releaseInput();
    const linkedRelease = input.releases[0] as Release;

    expect(
      deriveWorkItemPreReleaseReadiness(
        releaseInput({
          releaseTestAcceptance: [
            releaseTestAcceptance({
              scope_fingerprint: scopeFingerprint(linkedRelease, input.workItem, input.packages),
            }),
          ],
        }),
      ),
    ).toMatchObject({ state: 'ready', blockers: [] });
  });

  it('orders blockers and fingerprints deterministically without mutating inputs', () => {
    const blockers = [
      preReleaseBlocker({ code: 'missing_rollback_plan', message: 'Rollback plan is missing.' }),
      preReleaseBlocker({ code: 'missing_rollout_strategy', message: 'Rollout strategy is missing.' }),
    ] as const;
    const reversed = [...blockers].reverse();

    expect(preReleaseBlockerFingerprint(blockers)).toBe(preReleaseBlockerFingerprint(reversed));
    expect(preReleaseBlockerFingerprint(blockers.slice(0, 1))).toBe(
      preReleaseBlockerFingerprint([blockers[0] as ReleaseBlockerLike, blockers[0] as ReleaseBlockerLike]),
    );
    expect(
      preReleaseBlockerFingerprint([
        preReleaseBlocker({ category: 'planning', overrideable: true }),
        preReleaseBlocker({ category: 'evidence', overrideable: false }),
      ]),
    ).toBe(
      preReleaseBlockerFingerprint([
        preReleaseBlocker({ category: 'evidence', overrideable: false }),
        preReleaseBlocker({ category: 'planning', overrideable: true }),
      ]),
    );
    expect(
      deriveWorkItemPreReleaseReadiness(releaseInput({ releaseBlockers: reversed })).blockers.map(
        (blocker) => blocker.code,
      ),
    ).toEqual(['missing_rollback_plan', 'missing_rollout_strategy']);
    expect(reversed.map((blocker) => blocker.code)).toEqual(['missing_rollout_strategy', 'missing_rollback_plan']);
  });
});
