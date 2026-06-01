import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  DomainError,
  type CodexSessionLease,
  type CodexSessionSnapshot,
} from '@forgeloop/domain';
import { automationActorIdHeaderName } from '@forgeloop/automation';
import type { DeliveryRepository } from '@forgeloop/db';

import { DELIVERY_REPOSITORY } from '../core/control-plane-tokens';
import { ControlPlaneRuntimeService } from '../core/control-plane-runtime.service';
import type {
  ClaimCodexSessionLeaseDto,
  RenewCodexSessionLeaseDto,
  TerminalizeCodexSessionTurnDto,
} from './plan-item-workflow.dto';

const staleTerminalizationCodes = new Set([
  'codex_session_lease_conflict',
  'codex_session_lease_expired',
  'codex_session_stale_terminalization',
  'codex_session_snapshot_stale',
  'codex_session_thread_binding_stale',
]);

const hashLeaseToken = (token: string) => `sha256:${createHash('sha256').update(token).digest('hex')}`;

const firstHeaderValue = (headers: Record<string, string | string[] | undefined>, name: string) => {
  const direct = headers[name];
  if (direct !== undefined) return Array.isArray(direct) ? direct[0] : direct;
  const lowerName = name.toLowerCase();
  const found = Object.entries(headers).find(([headerName]) => headerName.toLowerCase() === lowerName)?.[1];
  return Array.isArray(found) ? found[0] : found;
};

type AutomationRequest = {
  headers: Record<string, string | string[] | undefined>;
};

const hasOutputSnapshot = (
  dto: TerminalizeCodexSessionTurnDto,
): dto is TerminalizeCodexSessionTurnDto & {
  output_snapshot_id: string;
  output_snapshot_sequence: number;
  output_snapshot_artifact_ref: string;
  output_snapshot_digest: string;
  output_snapshot_size_bytes: string;
  output_snapshot_manifest_digest: string;
  runtime_profile_revision_id: string;
} =>
  dto.output_snapshot_id !== undefined &&
  dto.output_snapshot_sequence !== undefined &&
  dto.output_snapshot_artifact_ref !== undefined &&
  dto.output_snapshot_digest !== undefined &&
  dto.output_snapshot_size_bytes !== undefined &&
  dto.output_snapshot_manifest_digest !== undefined &&
  dto.runtime_profile_revision_id !== undefined;

@Injectable()
export class CodexSessionLeaseService {
  constructor(
    @Inject(DELIVERY_REPOSITORY) private readonly repository: DeliveryRepository,
    private readonly controlPlaneRuntime: ControlPlaneRuntimeService,
  ) {}

  async claim(sessionId: string, dto: ClaimCodexSessionLeaseDto) {
    const input = {
      session_id: sessionId,
      workflow_id: dto.workflow_id,
      lease_id: this.controlPlaneRuntime.id('codex-session-lease'),
      lease_token_hash: hashLeaseToken(dto.lease_token),
      worker_id: dto.worker_id,
      worker_session_digest: dto.worker_session_digest,
      now: this.now(),
      expires_at: dto.expires_at,
    };
    const claimed = await this.repository.claimCodexSessionLease({
      ...input,
      ...(dto.expected_previous_snapshot_digest === null ? {} : { expected_previous_snapshot_digest: dto.expected_previous_snapshot_digest }),
    });
    return this.toLeaseResponse(claimed.lease);
  }

  async renew(sessionId: string, leaseId: string, dto: RenewCodexSessionLeaseDto) {
    const lease = await this.repository.renewCodexSessionLease({
      session_id: sessionId,
      lease_id: leaseId,
      lease_token_hash: hashLeaseToken(dto.lease_token),
      worker_id: dto.worker_id,
      worker_session_digest: dto.worker_session_digest,
      lease_epoch: dto.lease_epoch,
      now: this.now(),
      expires_at: dto.expires_at,
    });
    return this.toLeaseResponse(lease);
  }

  async terminalize(sessionId: string, turnId: string, dto: TerminalizeCodexSessionTurnDto, request: AutomationRequest) {
    const trustedActorId = this.requireTrustedActorId(request);
    const outputSnapshot: CodexSessionSnapshot | undefined = hasOutputSnapshot(dto)
      ? {
          id: dto.output_snapshot_id,
          codex_session_id: sessionId,
          sequence: dto.output_snapshot_sequence,
          artifact_ref: dto.output_snapshot_artifact_ref,
          digest: dto.output_snapshot_digest,
          size_bytes: dto.output_snapshot_size_bytes,
          manifest_digest: dto.output_snapshot_manifest_digest,
          ...(dto.codex_thread_id_digest === undefined ? {} : { codex_thread_id_digest: dto.codex_thread_id_digest }),
          runtime_profile_revision_id: dto.runtime_profile_revision_id,
          created_from_turn_id: turnId,
          created_by_actor_id: trustedActorId,
          created_at: this.now(),
        }
      : undefined;

    try {
      const input = {
        session_id: sessionId,
        turn_id: turnId,
        lease_id: dto.lease_id,
        lease_token_hash: hashLeaseToken(dto.lease_token),
        lease_epoch: dto.lease_epoch,
        worker_id: dto.worker_id,
        worker_session_digest: dto.worker_session_digest,
        status: dto.status,
        ...(outputSnapshot === undefined ? {} : { output_snapshot: outputSnapshot }),
        ...(dto.codex_thread_id === undefined ? {} : { codex_thread_id: dto.codex_thread_id }),
        ...(dto.codex_thread_id_digest === undefined ? {} : { codex_thread_id_digest: dto.codex_thread_id_digest }),
        ...(dto.failure_code === undefined ? {} : { failure_code: dto.failure_code }),
        now: this.now(),
      };
      const result = await this.repository.terminalizeCodexSessionTurn({
        ...input,
        ...(dto.expected_previous_snapshot_digest === null ? {} : { expected_previous_snapshot_digest: dto.expected_previous_snapshot_digest }),
      });
      return { session_id: result.session.id, turn_id: result.turn.id, status: result.turn.status };
    } catch (error) {
      if (!(error instanceof DomainError) || !staleTerminalizationCodes.has(error.code)) throw error;
      await this.repository.withObjectLock(`codex-session:${sessionId}`, (lockedRepository) =>
        lockedRepository.withDeliveryTransaction((repository) =>
          this.recordStaleTerminalizationAttempt(repository, sessionId, turnId, dto, error.code),
        ),
      );
      throw error;
    }
  }

  private async recordStaleTerminalizationAttempt(
    repository: DeliveryRepository,
    sessionId: string,
    turnId: string,
    dto: TerminalizeCodexSessionTurnDto,
    failureCode: string,
  ) {
    const now = this.now();
    const turn = await repository.getCodexSessionTurn(turnId);
    const safeTurn = turn !== undefined && turn.codex_session_id === sessionId ? turn : undefined;
    const attempt = {
      id: this.controlPlaneRuntime.id('codex-session-stale-terminalization'),
      codex_session_id: sessionId,
      ...(safeTurn === undefined ? {} : { codex_session_turn_id: safeTurn.id }),
      lease_id: dto.lease_id,
      lease_epoch: dto.lease_epoch,
      worker_id: dto.worker_id,
      worker_session_digest: dto.worker_session_digest,
      ...(dto.output_snapshot_digest === undefined ? {} : { attempted_output_snapshot_digest: dto.output_snapshot_digest }),
      ...(dto.codex_thread_id_digest === undefined ? {} : { attempted_codex_thread_id_digest: dto.codex_thread_id_digest }),
      failure_code: failureCode,
      created_at: now,
    };
    await repository.saveStaleCodexSessionTerminalizationAttempt({
      ...attempt,
      ...(dto.expected_previous_snapshot_digest === null ? {} : { expected_previous_snapshot_digest: dto.expected_previous_snapshot_digest }),
    });
    if (safeTurn !== undefined && failureCode !== 'codex_session_thread_binding_stale') {
      await repository.markCodexSessionTurnStale({ session_id: sessionId, turn_id: safeTurn.id, now });
    }
  }

  private toLeaseResponse(lease: CodexSessionLease) {
    return {
      id: lease.id,
      session_id: lease.codex_session_id,
      lease_epoch: lease.lease_epoch,
      status: lease.status,
      expires_at: lease.expires_at,
    };
  }

  private requireTrustedActorId(request: AutomationRequest) {
    const value = firstHeaderValue(request.headers, automationActorIdHeaderName)?.trim();
    if (value === undefined || value.length === 0) {
      throw new DomainError('workflow_actor_not_authorized', 'Trusted automation actor id is required for snapshot attribution');
    }
    return value;
  }

  private now() {
    return this.controlPlaneRuntime.now();
  }
}
