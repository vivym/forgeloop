import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';

import {
  type P0Repository,
  getObjectReplayTimeline,
  getReleaseCockpit as getReleaseCockpitQuery,
  getWorkItemCockpit,
} from '@forgeloop/db';
import type { RunRuntimeMetadata } from '@forgeloop/domain';

import { P0_REPOSITORY, RUN_DURABILITY_MODE, type RunDurabilityMode } from '../../p0/p0.service';
import { serializePublicRunSession } from '../../p0/run-session-serialization';

@Injectable()
export class QueryService {
  constructor(
    @Inject(P0_REPOSITORY) private readonly repository: P0Repository,
    @Inject(RUN_DURABILITY_MODE) private readonly durabilityMode: RunDurabilityMode,
  ) {}

  async getWorkItemCockpit(workItemId: string) {
    const cockpit = await getWorkItemCockpit(this.repository, workItemId, {
      run_session_metadata_fallback: this.initialRuntimeMetadata(),
    });
    if (cockpit === undefined) {
      throw new NotFoundException(`WorkItem ${workItemId} not found`);
    }

    return {
      ...cockpit,
      run_sessions: cockpit.run_sessions.map(serializePublicRunSession),
    };
  }

  async getReleaseCockpit(releaseId: string) {
    const cockpit = await getReleaseCockpitQuery(this.repository, releaseId);
    if (cockpit === undefined) {
      throw new NotFoundException(`Release ${releaseId} not found`);
    }

    return cockpit;
  }

  async getReplay(objectType: string, objectId: string) {
    if (objectType !== 'work_item' && objectType !== 'release') {
      throw new BadRequestException(`Unsupported replay object type: ${objectType}`);
    }

    const timeline = await getObjectReplayTimeline(this.repository, objectType, objectId);
    if (timeline === undefined) {
      throw new NotFoundException(`Replay ${objectType} ${objectId} not found`);
    }

    return timeline;
  }

  private initialRuntimeMetadata(): RunRuntimeMetadata {
    return {
      durability_mode: this.durabilityMode,
      recovery_attempt_count: 0,
      effective_dangerous_mode: 'not_requested',
    };
  }
}
