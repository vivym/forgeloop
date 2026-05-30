export interface PublicCodexAppServerTurnFailure {
  status: 422;
  code: 'codex_generation_turn_failed';
  failure_subcode: string;
  [key: string]: unknown;
}

export class PublicCodexAppServerTurnError extends Error {
  readonly publicResultJson: PublicCodexAppServerTurnFailure;

  constructor(failureSubcode: string) {
    super('codex_generation_turn_failed');
    this.name = 'PublicCodexAppServerTurnError';
    this.publicResultJson = {
      status: 422,
      code: 'codex_generation_turn_failed',
      failure_subcode: failureSubcode,
    };
  }
}

const codexErrorInfoSubcodes = new Map<string, string>([
  ['badRequest', 'app_server_bad_request'],
  ['unauthorized', 'app_server_unauthorized'],
  ['httpConnectionFailed', 'app_server_http_connection_failed'],
  ['responseStreamConnectionFailed', 'app_server_response_stream_connection_failed'],
  ['responseStreamDisconnected', 'app_server_response_stream_disconnected'],
  ['responseTooManyFailedAttempts', 'app_server_response_too_many_failed_attempts'],
  ['internalServerError', 'app_server_internal_server_error'],
  ['serverOverloaded', 'app_server_server_overloaded'],
  ['sandboxError', 'app_server_sandbox_error'],
  ['contextWindowExceeded', 'app_server_context_window_exceeded'],
  ['cyberPolicy', 'app_server_cyber_policy'],
  ['other', 'app_server_other_error'],
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const recordField = (value: unknown, key: string): Record<string, unknown> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const entry = value[key];
  return isRecord(entry) ? entry : undefined;
};

const codexErrorInfoName = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }
  if (isRecord(value)) {
    return Object.keys(value).at(0);
  }
  return undefined;
};

export const publicFailureSubcodeForCodexErrorInfo = (codexErrorInfo: unknown): string | undefined => {
  const name = codexErrorInfoName(codexErrorInfo);
  return name === undefined ? undefined : codexErrorInfoSubcodes.get(name);
};

export const publicFailureSubcodeFromAppServerErrorShape = (error: Record<string, unknown>): string | undefined => {
  const data = recordField(error, 'data');
  const nestedError = recordField(data, 'error') ?? recordField(error, 'error');
  return publicFailureSubcodeForCodexErrorInfo(
    nestedError?.codexErrorInfo ?? nestedError?.codex_error_info ?? data?.codexErrorInfo ?? data?.codex_error_info,
  );
};

export const publicTurnFailureFromSubcode = (failureSubcode: string): PublicCodexAppServerTurnFailure => ({
  status: 422,
  code: 'codex_generation_turn_failed',
  failure_subcode: failureSubcode,
});
