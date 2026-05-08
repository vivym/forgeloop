import { describe, expect, it } from 'vitest';

import type { EvidenceChainItem, EvidenceChainResponse } from '../../apps/web/src/api';
import {
  evidenceChainDisplayItem,
  evidenceChainSummaryMetrics,
  groupEvidenceChainItems,
} from '../../apps/web/src/workbenchState';

describe('evidence chain state helpers', () => {
  it('derives compact summary metrics from the response counts', () => {
    const response = evidenceResponse([
      evidenceItem({ id: 'current-review', source: 'review_packet', objectType: 'review_packet', objectId: 'review-current' }),
      evidenceItem({ id: 'current-run', source: 'run_event', objectType: 'run_session', objectId: 'run-current' }),
      evidenceItem({ id: 'superseded-run', source: 'run_event', objectType: 'run_session', objectId: 'run-old' }),
    ]);

    expect(evidenceChainSummaryMetrics(response)).toEqual([
      { label: 'Items', value: '3' },
      { label: 'Runs', value: '2' },
      { label: 'Reviews', value: '1' },
      { label: 'Decisions', value: '1' },
      { label: 'Artifacts', value: '0' },
      { label: 'Redacted', value: '1' },
    ]);
  });

  it('groups current focus evidence before superseded history', () => {
    const response = evidenceResponse([
      evidenceItem({
        id: 'superseded-run',
        source: 'run_event',
        objectType: 'run_session',
        objectId: 'run-old',
        riskFlags: ['superseded_run'],
      }),
      evidenceItem({
        id: 'current-review',
        source: 'review_packet',
        objectType: 'review_packet',
        objectId: 'review-current',
        links: [{ object_type: 'run_session', object_id: 'run-current', relationship: 'generated_by' }],
      }),
      evidenceItem({
        id: 'current-run',
        source: 'run_event',
        objectType: 'run_session',
        objectId: 'run-current',
        links: [{ object_type: 'execution_package', object_id: 'package-current', relationship: 'belongs_to' }],
      }),
      evidenceItem({
        id: 'current-artifact',
        source: 'artifact',
        objectType: 'artifact',
        objectId: 'artifact-current',
        links: [{ object_type: 'run_session', object_id: 'run-current', relationship: 'generated_by' }],
      }),
    ]);

    const groups = groupEvidenceChainItems(response);

    expect(groups.map((group) => group.label)).toEqual(['Current focus', 'Superseded / history']);
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['current-review', 'current-run', 'current-artifact']);
    expect(groups[1]?.items.map((item) => item.id)).toEqual(['superseded-run']);
  });

  it('uses redaction markers without exposing raw refs, local refs, or internal payloads', () => {
    const display = evidenceChainDisplayItem(
      evidenceItem({
        id: 'redacted-log',
        source: 'artifact',
        objectType: 'artifact',
        objectId: 'artifact-1',
        redacted: true,
        summary: 'Logs artifact redacted from public evidence.',
        details: {
          redaction_reason: 'logs_artifact',
          raw_ref: 'local://raw-codex.jsonl',
          local_ref: 'artifacts/run/raw-codex.jsonl',
          payload: { text: 'secret command output' },
        } as never,
      }),
    );

    expect(display.redactionLabel).toBe('Redacted: logs artifact');
    const rendered = JSON.stringify(display);
    expect(rendered).not.toContain('raw-codex');
    expect(rendered).not.toContain('local://');
    expect(rendered).not.toContain('raw_ref');
    expect(rendered).not.toContain('local_ref');
    expect(rendered).not.toContain('secret command output');
  });
});

function evidenceResponse(items: EvidenceChainItem[]): EvidenceChainResponse {
  return {
    work_item_id: 'work-item-1',
    generated_at: '2026-05-08T00:00:00.000Z',
    focus: { selection: 'current', review_packet_ids: ['review-current'] },
    projection: { source: 'trace_events', version: 1, partial: false, gaps: [] },
    summary: {
      total_items: items.length,
      run_count: 2,
      review_packet_count: 1,
      decision_count: 1,
      artifact_count: 0,
      risk_flags: ['redacted_evidence'],
      redacted_count: 1,
    },
    items,
  };
}

function evidenceItem(input: {
  id: string;
  source: EvidenceChainItem['source'];
  objectType: EvidenceChainItem['subject']['object_type'];
  objectId: string;
  riskFlags?: EvidenceChainItem['risk_flags'];
  links?: EvidenceChainItem['links'];
  redacted?: boolean;
  summary?: string;
  details?: EvidenceChainItem['details'];
}): EvidenceChainItem {
  return {
    id: input.id,
    source: input.source,
    subject: { object_type: input.objectType, object_id: input.objectId },
    summary: input.summary ?? input.id,
    created_at: '2026-05-08T00:00:00.000Z',
    visibility: 'public',
    links: input.links ?? [],
    risk_flags: input.riskFlags ?? [],
    redacted: input.redacted ?? false,
    ...(input.details === undefined ? {} : { details: input.details }),
  };
}
