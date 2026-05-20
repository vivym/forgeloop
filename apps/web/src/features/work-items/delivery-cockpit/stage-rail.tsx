import type { KeyboardEvent, MouseEvent } from 'react';

import type { DeliveryStage } from '../../../shared/api/types';
import { StatusPill } from '../../../shared/ui';
import { deliveryStageTargetId, deliveryStageTone, formatValue } from '../work-item-view-model';

export interface DeliveryStageRailProps {
  stages: readonly DeliveryStage[];
}

export function DeliveryStageRail({ stages }: DeliveryStageRailProps) {
  return (
    <nav aria-label="Delivery readiness stages" className="delivery-stage-rail" data-testid="delivery-stage-rail">
      <ol className="delivery-stage-rail__list">
        {stages.map((stage) => (
          <li className="delivery-stage-rail__item" key={stage.id}>
            <a
              aria-label={`${stage.label} ${formatValue(stage.state)}`}
              className="delivery-stage-rail__link"
              href={`#${deliveryStageTargetId(stage)}`}
              onClick={(event) => handleStageClick(event, stage)}
              onKeyDown={(event) => handleStageKeyDown(event, stage)}
            >
              <span>{stage.label}</span>
              <StatusPill tone={deliveryStageTone(stage.state)}>{formatValue(stage.state)}</StatusPill>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function handleStageKeyDown(event: KeyboardEvent<HTMLAnchorElement>, stage: DeliveryStage) {
  if (event.key !== ' ') return;

  event.preventDefault();
  const targetId = deliveryStageTargetId(stage);
  window.location.hash = targetId;
  focusStage(stage);
}

function handleStageClick(event: MouseEvent<HTMLAnchorElement>, stage: DeliveryStage) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;

  focusStageAfterNativeNavigation(stage);
}

function focusStageAfterNativeNavigation(stage: DeliveryStage) {
  window.setTimeout(() => focusStage(stage), 0);
}

function focusStage(stage: DeliveryStage) {
  const targetId = deliveryStageTargetId(stage);
  const target = document.getElementById(targetId);

  if (target === null) {
    return;
  }

  target.scrollIntoView({ block: 'start' });
  target.focus({ preventScroll: true });
}
