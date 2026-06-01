import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { DomainError, type DomainErrorCode } from '@forgeloop/domain';

const forbiddenDomainErrorCodes = new Set<DomainErrorCode>([
  'FORCE_RERUN_FORBIDDEN',
  'AUTOMATION_CAPABILITY_REJECTED',
  'workflow_actor_not_authorized',
]);

const conflictDomainErrorCodes = new Set<DomainErrorCode>([
  'workflow_legacy_entrypoint_disabled',
  'codex_session_lease_conflict',
  'codex_session_lease_expired',
  'codex_session_stale_terminalization',
  'codex_session_snapshot_stale',
  'codex_session_thread_binding_conflict',
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
      : conflictDomainErrorCodes.has(error.code)
        ? HttpStatus.CONFLICT
        : HttpStatus.BAD_REQUEST;

    response.status(statusCode).json({
      statusCode,
      message: error.message,
      error: statusCode === HttpStatus.FORBIDDEN ? 'Forbidden' : statusCode === HttpStatus.CONFLICT ? 'Conflict' : 'Bad Request',
      code: error.code,
      ...(error.details !== undefined ? { details: error.details } : {}),
    });
  }
}
