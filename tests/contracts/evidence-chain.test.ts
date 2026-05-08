import { describe, expect, it } from 'vitest';

import {
  evidenceChainProjectionGapCodeSchema,
  evidenceChainRedactionReasonSchema,
  evidenceChainResponseSchema,
  evidenceChainRiskFlagSchema,
  evidenceChainTraceLinkRelationshipSchema,
} from '@forgeloop/contracts';

const timestamp = '2026-05-08T01:00:00.000Z';

describe('Evidence Chain contracts', () => {
  const validResponse = {
    work_item_id: 'work-item-1',
    generated_at: timestamp,
    focus: {
      selection: 'current',
      review_packet_ids: ['review-packet-1'],
    },
    projection: {
      source: 'mixed',
      version: 1,
      partial: true,
      gaps: ['missing_trace_events', 'missing_trace_artifact_refs'],
    },
    summary: {
      total_items: 2,
      run_count: 1,
      review_packet_count: 1,
      decision_count: 0,
      artifact_count: 1,
      risk_flags: ['redacted_evidence', 'projection_partial'],
      redacted_count: 1,
    },
    items: [
      {
        id: 'evidence-item-run-1',
        source: 'run_event',
        subject: {
          object_type: 'run_session',
          object_id: 'run-session-1',
          relationship: 'generated_by',
        },
        summary: 'Run succeeded.',
        created_at: timestamp,
        visibility: 'public',
        links: [
          {
            object_type: 'execution_package',
            object_id: 'package-1',
            relationship: 'belongs_to',
          },
          {
            object_type: 'review_packet',
            object_id: 'review-packet-1',
            relationship: 'supports',
          },
        ],
        risk_flags: [],
        redacted: false,
        details: {
          run_status: 'succeeded',
          required_check_ids: ['contracts-test'],
        },
      },
      {
        id: 'evidence-item-redacted-log-1',
        source: 'artifact',
        subject: {
          object_type: 'artifact',
          object_id: 'artifact-logs-1',
          relationship: 'redacted_from',
        },
        summary: 'Logs artifact redacted from public evidence.',
        created_at: timestamp,
        visibility: 'public',
        links: [
          {
            object_type: 'run_session',
            object_id: 'run-session-1',
            relationship: 'generated_by',
          },
        ],
        risk_flags: ['redacted_evidence'],
        redacted: true,
        details: {
          missing_artifact_kinds: ['logs'],
          redaction_reason: 'logs_artifact',
          projection_gap_codes: ['missing_trace_artifact_refs'],
        },
      },
    ],
  };

  it('parses an Evidence Chain response with focus, projection, summary, and items', () => {
    const parsed = evidenceChainResponseSchema.parse(validResponse);

    expect(parsed.focus.selection).toBe('current');
    expect(parsed.projection.version).toBe(1);
    expect(parsed.summary.total_items).toBe(2);
    expect(parsed.items).toHaveLength(2);
  });

  it('rejects Evidence Chain responses whose summary total does not match items', () => {
    expect(
      evidenceChainResponseSchema.safeParse({
        ...validResponse,
        summary: {
          ...validResponse.summary,
          total_items: 3,
        },
      }).success,
    ).toBe(false);
  });

  it('uses the canonical Evidence Chain risk flags', () => {
    expect(
      [
        'no_evidence',
        'missing_required_artifact',
        'redacted_evidence',
        'superseded_run',
        'stale_review_packet',
        'unapproved_review_packet',
        'failed_required_check',
        'changes_requested',
        'projection_partial',
      ].map((riskFlag) => evidenceChainRiskFlagSchema.parse(riskFlag)),
    ).toEqual([
      'no_evidence',
      'missing_required_artifact',
      'redacted_evidence',
      'superseded_run',
      'stale_review_packet',
      'unapproved_review_packet',
      'failed_required_check',
      'changes_requested',
      'projection_partial',
    ]);
    expect(evidenceChainRiskFlagSchema.safeParse('unknown_risk').success).toBe(false);
  });

  it('uses the canonical Evidence Chain redaction reasons', () => {
    expect(
      [
        'internal_event',
        'raw_ref',
        'logs_artifact',
        'raw_metadata_artifact',
        'local_ref_only',
        'internal_payload',
      ].map((reason) => evidenceChainRedactionReasonSchema.parse(reason)),
    ).toEqual([
      'internal_event',
      'raw_ref',
      'logs_artifact',
      'raw_metadata_artifact',
      'local_ref_only',
      'internal_payload',
    ]);
    expect(evidenceChainRedactionReasonSchema.safeParse('private_payload').success).toBe(false);
  });

  it('uses the canonical Evidence Chain projection gap codes', () => {
    expect(
      [
        'missing_supersession_links',
        'missing_last_run_session',
        'missing_trace_events',
        'missing_trace_artifact_refs',
      ].map((gapCode) => evidenceChainProjectionGapCodeSchema.parse(gapCode)),
    ).toEqual([
      'missing_supersession_links',
      'missing_last_run_session',
      'missing_trace_events',
      'missing_trace_artifact_refs',
    ]);
    expect(evidenceChainProjectionGapCodeSchema.safeParse('missing_unknown_projection').success).toBe(false);
  });

  it('restricts trace link relationships to the public relationship enum', () => {
    expect(
      ['belongs_to', 'generated_by', 'supports', 'supersedes', 'replaces', 'redacted_from'].map((relationship) =>
        evidenceChainTraceLinkRelationshipSchema.parse(relationship),
      ),
    ).toEqual(['belongs_to', 'generated_by', 'supports', 'supersedes', 'replaces', 'redacted_from']);
    expect(evidenceChainTraceLinkRelationshipSchema.safeParse('contains').success).toBe(false);
  });
});
