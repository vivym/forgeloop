import { useMemo } from 'react';
import { Link } from 'react-router';
import type { AttachmentRef, EditableObjectRef } from '@forgeloop/contracts';

import { CompactMetadata, ObjectWorkspace, Section } from '../../shared/layout';
import { EvidenceAttachments, InlineNotice, StatusPill } from '../../shared/ui';

type EvidenceRef = {
  type?: string | undefined;
  id?: string | undefined;
  title?: string | undefined;
  development_plan_id?: string | undefined;
};

type RelationshipRef = EvidenceRef;

export interface SourceEvidenceDetail {
  id: string;
  ref: EditableObjectRef;
  title: string;
  status: string;
  priority?: string | undefined;
  risk?: string | undefined;
  driver_actor_id?: string | undefined;
  attachment_refs?: AttachmentRef[] | undefined;
  evidence_refs?: EvidenceRef[] | undefined;
  relationship_refs?: RelationshipRef[] | undefined;
  release_refs?: RelationshipRef[] | undefined;
}

export interface ObjectEvidenceRouteProps<T extends SourceEvidenceDetail> {
  detail: T | undefined;
  detailError?: Error | null;
  detailLoading: boolean;
  objectLabel: string;
  sourceHref: string | undefined;
}

type EvidenceReadiness = {
  relevant: EvidenceRef[];
  missing: EvidenceRef[];
  stale: EvidenceRef[];
  unavailable: EvidenceRef[];
};

export function ObjectEvidenceRoute<T extends SourceEvidenceDetail>({
  detail,
  detailError,
  detailLoading,
  objectLabel,
  sourceHref,
}: ObjectEvidenceRouteProps<T>) {
  const readiness = useMemo(() => evidenceReadiness(detail), [detail]);
  const heading = `${objectLabel} Evidence`;

  if (detailLoading) {
    return (
      <ObjectWorkspace
        blockerRisk="Evidence metadata is loading."
        family="evidence"
        heading={objectLabel}
        nextAction="Load evidence readiness before planning gates continue."
        roleResponsibility="Loading source object responsibility."
        state="Evidence loading"
      >
        <InlineNotice title={`${heading} is loading.`} tone="info" />
      </ObjectWorkspace>
    );
  }

  if (detailError || detail === undefined) {
    return (
      <ObjectWorkspace
        blockerRisk="Source object evidence cannot be verified until the object loads."
        family="evidence"
        heading={heading}
        nextAction="Reload the source object evidence workspace."
        roleResponsibility="Product owner should confirm the source object exists."
        state="Evidence unavailable"
      >
        <InlineNotice title={`${heading} was not found.`} tone="warning" />
      </ObjectWorkspace>
    );
  }

  const attachmentRefs = detail.attachment_refs ?? [];
  const relationshipRefs = detail.relationship_refs ?? [];
  const releaseRefs = detail.release_refs ?? [];
  const allEvidenceCount = readiness.relevant.length + readiness.missing.length + readiness.stale.length + readiness.unavailable.length;
  const needsAttention = readiness.missing.length > 0 || readiness.stale.length > 0 || readiness.unavailable.length > 0;
  const sourceLink = sourceHref ?? '#';

  return (
    <ObjectWorkspace
      blockerRisk={`Risk ${detail.risk ?? 'unscored'} / ${needsAttention ? 'Evidence needs attention' : 'No evidence blocker'}`}
      family="evidence"
      heading={heading}
      nextAction={
        <div className="grid gap-2">
          <span className="font-semibold text-text-primary">{needsAttention ? 'Resolve evidence gaps' : 'Evidence ready'}</span>
          <span className="text-sm text-text-secondary">
            Review source evidence readiness here; Spec and Execution Plan gates remain item-scoped.
          </span>
          <Link className="text-sm font-semibold text-primary hover:underline" to={sourceLink}>
            Open source object
          </Link>
        </div>
      }
      roleResponsibility={`${objectLabel} driver / ${detail.driver_actor_id ?? 'Unassigned'}`}
      state={needsAttention ? 'Evidence needs attention' : 'Evidence ready'}
      subtitle={`${detail.title} / ${statusLabel(detail.status)}`}
    >
      <Section
        aria-label="Evidence readiness summary"
        description="Readiness is derived from the source object detail and attachment safety metadata."
        title="Evidence readiness summary"
        variant="panel"
      >
        <div className="grid gap-3 md:grid-cols-4">
          <EvidenceStateCard count={readiness.relevant.length} label="Relevant evidence" tone="success" />
          <EvidenceStateCard count={readiness.missing.length} label="Missing evidence" tone={readiness.missing.length > 0 ? 'warning' : 'neutral'} />
          <EvidenceStateCard count={readiness.stale.length} label="Stale evidence" tone={readiness.stale.length > 0 ? 'warning' : 'neutral'} />
          <EvidenceStateCard count={readiness.unavailable.length} label="Unavailable evidence" tone={readiness.unavailable.length > 0 ? 'danger' : 'neutral'} />
        </div>
        <CompactMetadata
          items={[
            { label: 'Source object', value: `${objectLabel} ${detail.id}` },
            { label: 'Lifecycle', value: detail.status },
            { label: 'Attachments', value: String(attachmentRefs.length) },
            { label: 'Evidence refs', value: String(allEvidenceCount) },
          ]}
        />
      </Section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]">
        <Section
          aria-label="Evidence reference states"
          description="These references stay scoped to the source object and do not expose raw artifact browsers."
          title="Evidence states"
          variant="panel"
        >
          <div className="grid gap-3">
            <EvidenceRefList emptyText="No relevant evidence refs." label="Relevant evidence" refs={readiness.relevant} tone="success" />
            <EvidenceRefList emptyText="No missing evidence refs." label="Missing evidence" refs={readiness.missing} tone="warning" />
            <EvidenceRefList emptyText="No stale evidence refs." label="Stale evidence" refs={readiness.stale} tone="warning" />
            <EvidenceRefList emptyText="No unavailable evidence refs." label="Unavailable evidence" refs={readiness.unavailable} tone="danger" />
          </div>
        </Section>

        <div className="grid content-start gap-4">
          <Section aria-label="Scoped relationships" title="Scoped relationships" variant="subtle">
            <RelationshipLinks refs={[...relationshipRefs, ...releaseRefs]} />
          </Section>
          <Section aria-label="Scoped artifact references" title="Scoped artifact references" variant="subtle">
            <EvidenceRefList emptyText="No scoped evidence references." label="Evidence references" refs={sourceEvidenceRefs(detail)} tone="neutral" />
          </Section>
        </div>
      </div>

      <Section
        aria-label="Evidence attachments"
        description="Attachment previews use safe render references; unavailable attachments remain listed without raw storage URLs."
        title="Evidence attachments"
        variant="panel"
      >
        <EvidenceAttachments attachments={attachmentRefs} />
      </Section>
    </ObjectWorkspace>
  );
}

function EvidenceStateCard({
  count,
  label,
  tone,
}: {
  count: number;
  label: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  return (
    <div className="grid gap-2 rounded-card border border-border bg-surface p-3">
      <div className="text-xs font-semibold uppercase text-text-secondary">{label}</div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-2xl font-semibold text-text-primary">{count}</span>
        <StatusPill tone={tone}>{count === 0 ? 'Clear' : label}</StatusPill>
      </div>
    </div>
  );
}

function EvidenceRefList({
  emptyText,
  label,
  refs,
  tone,
}: {
  emptyText: string;
  label: string;
  refs: EvidenceRef[];
  tone: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  return (
    <section aria-label={label} className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-text-primary">{label}</h3>
        <StatusPill tone={tone}>{refs.length}</StatusPill>
      </div>
      {refs.length === 0 ? (
        <p className="text-sm text-text-secondary">{emptyText}</p>
      ) : (
        <ul className="grid gap-2 text-sm text-text-secondary">
          {refs.map((ref) => (
            <li className="rounded-md border border-border bg-surface-muted px-3 py-2" key={refKey(ref)}>
              {refLabel(ref)}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function RelationshipLinks({ refs }: { refs: RelationshipRef[] }) {
  if (refs.length === 0) {
    return <p className="text-sm text-text-secondary">No scoped relationships recorded.</p>;
  }

  return (
    <ul className="grid gap-2 text-sm">
      {refs.map((ref) => {
        const href = relationshipHref(ref);
        return (
          <li key={refKey(ref)}>
            {href === undefined ? (
              <span className="text-text-secondary">{refLabel(ref)}</span>
            ) : (
              <Link className="font-semibold text-primary hover:underline" to={href}>
                {refLabel(ref)}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function evidenceReadiness(detail: SourceEvidenceDetail | undefined): EvidenceReadiness {
  if (detail === undefined) {
    return emptyReadiness();
  }

  const evidenceRefs = sourceEvidenceRefs(detail);
  const attachments = detail.attachment_refs ?? [];
  const attachmentsById = new Map(attachments.map((attachment) => [attachment.id, attachment]));
  const referencedAttachmentIds = new Set(evidenceRefs.filter((ref) => ref.type === 'attachment' && ref.id !== undefined).map((ref) => ref.id as string));
  const readiness = emptyReadiness();

  for (const ref of evidenceRefs) {
    if (ref.type !== 'attachment') {
      readiness.relevant.push(ref);
      continue;
    }
    const attachment = ref.id === undefined ? undefined : attachmentsById.get(ref.id);
    if (attachment === undefined) {
      readiness.missing.push(ref);
    }
  }

  for (const attachment of attachments) {
    const ref = attachmentRefFor(attachment);
    if (attachment.reference_status !== 'active') {
      readiness.stale.push(ref);
    } else if (attachment.safety_status !== 'passed') {
      readiness.unavailable.push(ref);
    } else if (referencedAttachmentIds.size === 0 || referencedAttachmentIds.has(attachment.id)) {
      readiness.relevant.push(ref);
    }
  }

  if (evidenceRefs.length === 0 && attachments.length === 0) {
    readiness.missing.push({ type: detail.ref.type, id: detail.id, title: 'No source evidence recorded' });
  }

  return {
    relevant: uniqueRefs(readiness.relevant),
    missing: uniqueRefs(readiness.missing),
    stale: uniqueRefs(readiness.stale),
    unavailable: uniqueRefs(readiness.unavailable),
  };
}

function sourceEvidenceRefs(detail: SourceEvidenceDetail): EvidenceRef[] {
  return uniqueRefs(detail.evidence_refs ?? []);
}

function attachmentRefFor(attachment: AttachmentRef): EvidenceRef {
  return {
    type: 'attachment',
    id: attachment.id,
    title: attachment.caption ?? attachment.alt_text ?? attachment.filename,
  };
}

function uniqueRefs(refs: EvidenceRef[]): EvidenceRef[] {
  const seen = new Set<string>();
  const unique: EvidenceRef[] = [];
  for (const ref of refs) {
    const key = refKey(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(ref);
  }
  return unique;
}

function emptyReadiness(): EvidenceReadiness {
  return {
    relevant: [],
    missing: [],
    stale: [],
    unavailable: [],
  };
}

function relationshipHref(ref: RelationshipRef): string | undefined {
  if (ref.type === 'development_plan' && ref.id !== undefined) return `/development-plans/${encodeURIComponent(ref.id)}`;
  if (ref.type === 'development_plan_item' && ref.id !== undefined && ref.development_plan_id !== undefined) {
    return `/development-plans/${encodeURIComponent(ref.development_plan_id)}/items/${encodeURIComponent(ref.id)}`;
  }
  if (ref.type === 'requirement' && ref.id !== undefined) return `/requirements/${encodeURIComponent(ref.id)}`;
  if (ref.type === 'initiative' && ref.id !== undefined) return `/initiatives/${encodeURIComponent(ref.id)}`;
  if (ref.type === 'bug' && ref.id !== undefined) return `/bugs/${encodeURIComponent(ref.id)}`;
  if (ref.type === 'tech_debt' && ref.id !== undefined) return `/tech-debt/${encodeURIComponent(ref.id)}`;
  if (ref.type === 'release' && ref.id !== undefined) return `/releases/${encodeURIComponent(ref.id)}`;
  return undefined;
}

function refKey(ref: EvidenceRef): string {
  return `${ref.type ?? 'ref'}:${ref.id ?? ref.title ?? 'unknown'}`;
}

function refLabel(ref: EvidenceRef): string {
  const label = ref.title ?? ref.id ?? 'Untitled reference';
  return ref.type === undefined ? label : `${formatValue(ref.type)} / ${label}`;
}

function statusLabel(status: string): string {
  return status.replaceAll('/', ' / ');
}

function formatValue(value: string): string {
  return value.replaceAll('_', ' ').replaceAll('-', ' ').replace(/\b\w/g, (match) => match.toUpperCase());
}
