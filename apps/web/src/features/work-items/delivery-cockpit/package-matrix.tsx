import { Link } from 'react-router';

import { Section } from '../../../shared/layout';
import { StatusPill } from '../../../shared/ui';
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
        <p className="empty">No execution packages have been generated for this work item.</p>
      ) : (
        <div className="artifact-list">
          {packages.map((executionPackage) => (
            <article className="stack-form compact" key={executionPackage.id}>
              <div>
                <strong>{executionPackage.label}</strong>
                <StatusPill tone={executionPackage.stateTone}>{executionPackage.stateLabel}</StatusPill>
              </div>
              <dl className="state-grid">
                <div className="metric">
                  <dt>Owner</dt>
                  <dd>{executionPackage.owner}</dd>
                </div>
                <div className="metric">
                  <dt>Latest run</dt>
                  <dd>{executionPackage.latestRun}</dd>
                </div>
                {executionPackage.blockingReason === undefined ? null : (
                  <div className="metric">
                    <dt>Blocking reason</dt>
                    <dd>{executionPackage.blockingReason}</dd>
                  </div>
                )}
              </dl>
              <Link className="fl-button fl-button--secondary" to={executionPackage.href}>
                <span className="fl-button__label">Open package</span>
              </Link>
            </article>
          ))}
        </div>
      )}
    </Section>
  );
}
