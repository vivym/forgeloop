import { randomUUID } from 'node:crypto';

import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DomainError } from '@forgeloop/domain';
import type { P0Repository } from '@forgeloop/db';

import { P0_REPOSITORY } from '../core/control-plane-tokens';
import type {
  AutomationActionResponseDto,
  BlockAutomationActionRunDto,
  ClaimNextAutomationActionRunDto,
  CompleteAutomationActionRunDto,
  CreateAutomationActionRunDto,
  FailAutomationActionRunDto,
  GatePendingAutomationActionRunDto,
} from './automation.dto';
import { toAutomationActionRunDto } from './automation.dto';

const defaultLeaseMs = 5 * 60 * 1000;

const commandIdempotencyConflictBody = {
  code: 'command_idempotency_conflict',
  message: 'Automation action idempotency identity changed.',
};

const claimConflictBody = {
  code: 'automation_action_claim_conflict',
  message: 'Automation action claim is not active.',
};

const conflict = (body: Record<string, string>): HttpException => new HttpException(body, HttpStatus.CONFLICT);

const normalizeIsoDateTime = (value: string): string => {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ISO timestamp: ${value}`);
  }
  return parsed.toISOString();
};

const currentIsoTime = (): string => {
  const testNow = process.env.NODE_ENV === 'test' ? process.env.FORGELOOP_AUTOMATION_TEST_NOW?.trim() : undefined;
  return testNow === undefined || testNow.length === 0 ? new Date().toISOString() : normalizeIsoDateTime(testNow);
};

const isAtOrBefore = (left: string, right: string): boolean => Date.parse(left) <= Date.parse(right);

const lockedUntilFor = (input: ClaimNextAutomationActionRunDto, now: string): string =>
  new Date(Date.parse(now) + (input.lease_ms ?? defaultLeaseMs)).toISOString();

@Injectable()
export class AutomationActionService {
  constructor(@Inject(P0_REPOSITORY) private readonly repository: P0Repository) {}

  async createOrReplayAction(input: CreateAutomationActionRunDto): Promise<AutomationActionResponseDto> {
    try {
      const action = await this.repository.createOrReplayAutomationActionRun({
        id: input.id ?? randomUUID(),
        action_type: input.action_type,
        target_object_type: input.target_object_type,
        target_object_id: input.target_object_id,
        ...(input.target_revision_id === undefined ? {} : { target_revision_id: input.target_revision_id }),
        ...(input.target_version === undefined ? {} : { target_version: input.target_version }),
        target_status: input.target_status,
        idempotency_key: input.idempotency_key,
        automation_scope: input.automation_scope,
        automation_settings_version: input.automation_settings_version,
        capability_fingerprint: input.capability_fingerprint,
        precondition_fingerprint: input.precondition_fingerprint,
        action_input_json: input.action_input_json,
        now: currentIsoTime(),
      });
      return { action: toAutomationActionRunDto(action) };
    } catch (error) {
      if (error instanceof DomainError && error.code === 'INVALID_TRANSITION') {
        throw conflict(commandIdempotencyConflictBody);
      }
      throw error;
    }
  }

  async claimNextAction(input: ClaimNextAutomationActionRunDto): Promise<AutomationActionResponseDto> {
    const now = currentIsoTime();
    const action = await this.repository.claimNextAutomationActionRun({
      now,
      claim_token: input.claim_token,
      locked_until: lockedUntilFor(input, now),
      limit: input.limit,
      ...(input.project_id === undefined ? {} : { project_id: input.project_id }),
      ...(input.repo_id === undefined ? {} : { repo_id: input.repo_id }),
      ...(input.automation_scope === undefined ? {} : { automation_scope: input.automation_scope }),
    });
    return { action: action === undefined ? null : toAutomationActionRunDto(action, { includeClaim: true }) };
  }

  async completeAction(id: string, input: CompleteAutomationActionRunDto): Promise<AutomationActionResponseDto> {
    const now = currentIsoTime();
    await this.assertActiveClaim(id, input.claim_token, input.idempotency_key, now);
    try {
      const action = await this.repository.completeAutomationActionRun({
        id,
        idempotency_key: input.idempotency_key,
        claim_token: input.claim_token,
        status: 'succeeded',
        ...(input.result_json === undefined ? {} : { result_json: input.result_json }),
        finished_at: now,
      });
      return { action: toAutomationActionRunDto(action) };
    } catch (error) {
      if (error instanceof DomainError) {
        throw conflict(claimConflictBody);
      }
      throw error;
    }
  }

  async gatePendingAction(id: string, input: GatePendingAutomationActionRunDto): Promise<AutomationActionResponseDto> {
    const now = currentIsoTime();
    await this.assertActiveClaim(id, input.claim_token, input.idempotency_key, now);
    try {
      const action = await this.repository.markAutomationActionGatePending({
        id,
        idempotency_key: input.idempotency_key,
        claim_token: input.claim_token,
        reason: input.reason,
        ...(input.result_json === undefined ? {} : { result_json: input.result_json }),
        ...(input.next_attempt_at === undefined ? {} : { next_attempt_at: input.next_attempt_at }),
        now,
      });
      return { action: toAutomationActionRunDto(action) };
    } catch (error) {
      if (error instanceof DomainError) {
        throw conflict(claimConflictBody);
      }
      throw error;
    }
  }

  async blockAction(id: string, input: BlockAutomationActionRunDto): Promise<AutomationActionResponseDto> {
    const now = currentIsoTime();
    await this.assertActiveClaim(id, input.claim_token, input.idempotency_key, now);
    try {
      const action = await this.repository.completeAutomationActionRun({
        id,
        idempotency_key: input.idempotency_key,
        claim_token: input.claim_token,
        status: 'blocked',
        retryable: input.retryable ?? false,
        ...(input.result_json === undefined ? {} : { result_json: input.result_json }),
        ...(input.next_attempt_at === undefined ? {} : { next_attempt_at: input.next_attempt_at }),
        finished_at: now,
      });
      return { action: toAutomationActionRunDto(action) };
    } catch (error) {
      if (error instanceof DomainError) {
        throw conflict(claimConflictBody);
      }
      throw error;
    }
  }

  async failAction(id: string, input: FailAutomationActionRunDto): Promise<AutomationActionResponseDto> {
    const now = currentIsoTime();
    await this.assertActiveClaim(id, input.claim_token, input.idempotency_key, now);
    try {
      const action = await this.repository.completeAutomationActionRun({
        id,
        idempotency_key: input.idempotency_key,
        claim_token: input.claim_token,
        status: 'failed',
        retryable: input.retryable,
        ...(input.result_json === undefined ? {} : { result_json: input.result_json }),
        ...(input.next_attempt_at === undefined ? {} : { next_attempt_at: input.next_attempt_at }),
        finished_at: now,
      });
      return { action: toAutomationActionRunDto(action) };
    } catch (error) {
      if (error instanceof DomainError) {
        throw conflict(claimConflictBody);
      }
      throw error;
    }
  }

  private async assertActiveClaim(id: string, claimToken: string, idempotencyKey: string, now: string): Promise<void> {
    try {
      const action = await this.repository.getClaimedAutomationActionRun({ id, claim_token: claimToken });
      if (action.idempotency_key !== idempotencyKey) {
        throw conflict(claimConflictBody);
      }
      if (action.locked_until === undefined || isAtOrBefore(action.locked_until, now)) {
        throw conflict(claimConflictBody);
      }
    } catch (error) {
      if (error instanceof DomainError) {
        throw conflict(claimConflictBody);
      }
      throw error;
    }
  }
}
