import { Inject, Injectable } from '@nestjs/common';
import type { Decision, ObjectEvent, StatusHistory } from '@forgeloop/domain';
import type { DeliveryRepository, TraceArtifactRefRecord, TraceEventRecord, TraceLinkRecord } from '@forgeloop/db';

import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';

@Injectable()
export class AuditWriterService {
  constructor(@Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository) {}

  objectEvent(objectEvent: ObjectEvent, repository: DeliveryRepository = this.repository): Promise<void> {
    return repository.appendObjectEvent(objectEvent);
  }

  statusHistory(statusHistory: StatusHistory, repository: DeliveryRepository = this.repository): Promise<void> {
    return repository.appendStatusHistory(statusHistory);
  }

  decision(decision: Decision, repository: DeliveryRepository = this.repository): Promise<void> {
    return repository.saveDecision(decision);
  }

  traceLink(traceLink: TraceLinkRecord, repository: DeliveryRepository = this.repository): Promise<void> {
    return repository.saveTraceLink(traceLink);
  }

  traceEvent(traceEvent: TraceEventRecord, repository: DeliveryRepository = this.repository): Promise<void> {
    return repository.saveTraceEvent(traceEvent);
  }

  traceArtifactRef(
    traceArtifactRef: TraceArtifactRefRecord,
    repository: DeliveryRepository = this.repository,
  ): Promise<void> {
    return repository.saveTraceArtifactRef(traceArtifactRef);
  }
}
