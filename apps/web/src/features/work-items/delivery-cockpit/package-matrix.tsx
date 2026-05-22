import { Link } from 'react-router';

import { Metric, MetricGrid, Section } from '../../../shared/layout';
import { InlineNotice, StatusPill } from '../../../shared/ui';
import { deliveryStageTargetId, type DeliveryPackageDisplayRow } from '../work-item-view-model';

export interface PackageMatrixProps {
  packages: readonly DeliveryPackageDisplayRow[];
}

export function PackageMatrix({ packages }: PackageMatrixProps) {
  return (
    <Section
      description="Package assignee, latest execution, and blocking context."
      id={deliveryStageTargetId({ id: 'packages' })}
      tabIndex={-1}
      title="Package matrix"
    >
      {packages.length === 0 ? (
        <InlineNotice title="No execution packages have been generated for this work item." />
      ) : (
        <div className="artifact-list">
          {packages.map((executionPackage) => (
            <article className="stack-form compact" key={executionPackage.id}>
              <div>
                <strong>{executionPackage.label}</strong>
                <StatusPill tone={executionPackage.stateTone}>{executionPackage.stateLabel}</StatusPill>
              </div>
              <MetricGrid>
                <Metric label="Owner" value={executionPackage.owner} />
                <Metric label="Latest run" value={executionPackage.latestRun} />
                {executionPackage.blockingReason === undefined ? null : (
                  <Metric label="Blocking reason" value={executionPackage.blockingReason} />
                )}
              </MetricGrid>
              <Link className={linkButtonClass('secondary')} to={executionPackage.href}>
                Open package
              </Link>
            </article>
          ))}
        </div>
      )}
    </Section>
  );
}

function linkButtonClass(variant: 'primary' | 'secondary') {
  const variantClass =
    variant === 'primary'
      ? 'border-primary bg-primary text-white hover:bg-primary-hover'
      : 'border-border bg-surface text-text-primary hover:border-border-strong hover:bg-surface-muted';

  return [
    'inline-flex min-h-10 min-w-0 items-center justify-center gap-2 rounded-md border px-4 text-sm font-semibold transition-colors duration-base ease-standard motion-reduce:transition-none',
    variantClass,
  ].join(' ');
}
