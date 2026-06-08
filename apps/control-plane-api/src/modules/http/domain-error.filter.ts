import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { DomainError, type DomainErrorCode } from '@forgeloop/domain';

const forbiddenDomainErrorCodes = new Set<DomainErrorCode>([
  'FORCE_RERUN_FORBIDDEN',
  'AUTOMATION_CAPABILITY_REJECTED',
  'workflow_actor_not_authorized',
]);

const goneDomainErrorCodes = new Set<DomainErrorCode>([
  'legacy_execution_entrypoint_disabled',
]);

const conflictDomainErrorCodes = new Set<DomainErrorCode>([
  'workflow_legacy_entrypoint_disabled',
  'workflow_wave5_entrypoint_disabled',
  'workflow_action_already_pending',
  'workflow_action_not_runnable',
  'workflow_execution_readiness_blocked',
  'workflow_execution_recovery_required',
  'workflow_execution_not_ready_for_input',
  'workflow_execution_writer_still_active',
  'workflow_execution_cancel_pending',
  'workflow_evidence_not_current',
  'workflow_context_digest_mismatch',
  'workflow_capsule_digest_mismatch',
  'codex_session_lease_conflict',
  'codex_session_lease_expired',
  'codex_session_stale_terminalization',
  'codex_runtime_capsule_stale',
  'codex_session_thread_binding_conflict',
  'codex_session_thread_binding_stale',
  'codex_session_fork_invalid',
]);

@Catch(DomainError)
export class DomainErrorFilter implements ExceptionFilter<DomainError> {
  catch(error: DomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<{
      status: (statusCode: number) => { json: (body: Record<string, unknown>) => void };
    }>();
    const statusCode = forbiddenDomainErrorCodes.has(error.code)
      ? HttpStatus.FORBIDDEN
      : goneDomainErrorCodes.has(error.code)
        ? HttpStatus.GONE
        : conflictDomainErrorCodes.has(error.code)
          ? HttpStatus.CONFLICT
          : HttpStatus.BAD_REQUEST;

    response.status(statusCode).json({
      statusCode,
      message: error.message,
      error:
        statusCode === HttpStatus.FORBIDDEN
          ? 'Forbidden'
          : statusCode === HttpStatus.GONE
            ? 'Gone'
            : statusCode === HttpStatus.CONFLICT
              ? 'Conflict'
              : 'Bad Request',
      code: error.code,
      ...(error.details !== undefined ? { details: error.details } : {}),
    });
  }
}
