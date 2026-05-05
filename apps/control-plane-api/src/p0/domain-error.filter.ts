import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import { DomainError, type DomainErrorCode } from '@forgeloop/domain';

const forbiddenDomainErrorCodes = new Set<DomainErrorCode>(['FORCE_RERUN_FORBIDDEN']);

@Catch(DomainError)
export class DomainErrorFilter implements ExceptionFilter<DomainError> {
  catch(error: DomainError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<{
      status: (statusCode: number) => { json: (body: Record<string, unknown>) => void };
    }>();
    const statusCode = forbiddenDomainErrorCodes.has(error.code) ? HttpStatus.FORBIDDEN : HttpStatus.BAD_REQUEST;

    response.status(statusCode).json({
      statusCode,
      message: error.message,
      error: statusCode === HttpStatus.FORBIDDEN ? 'Forbidden' : 'Bad Request',
      code: error.code,
      ...(error.details !== undefined ? { details: error.details } : {}),
    });
  }
}
