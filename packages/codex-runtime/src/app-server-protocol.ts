export type CodexSandboxConfig = { type: string } | string | null | undefined;

export interface CodexEffectiveConfig {
  approvalPolicy?: string | null | undefined;
  sandbox?: CodexSandboxConfig;
  sandboxPolicy?: CodexSandboxConfig;
  writableRoots?: string[];
}

export interface CodexAppServerTransport {
  initialize?(): Promise<void>;
  request(method: string, params: Record<string, unknown>): Promise<unknown>;
  notifications?(): AsyncIterable<unknown>;
  close?(): Promise<void>;
}

export const textInput = (message: string): Array<Record<string, unknown>> => [
  { type: 'text', text: message, text_elements: [] },
];

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const normalizeEffectiveConfig = (value: unknown): CodexEffectiveConfig | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  const approvalPolicy = value.approvalPolicy ?? value.approval_policy;
  const sandbox = value.sandbox;
  const sandboxPolicy = value.sandboxPolicy ?? value.sandbox_policy;
  const writableRoots = value.writableRoots ?? value.writable_roots;
  const hasConfig =
    approvalPolicy !== undefined || sandbox !== undefined || sandboxPolicy !== undefined || writableRoots !== undefined;
  if (!hasConfig) {
    return undefined;
  }

  const config: CodexEffectiveConfig = {};
  if (typeof approvalPolicy === 'string') {
    config.approvalPolicy = approvalPolicy;
  }
  if (sandbox !== undefined) {
    config.sandbox = sandbox as CodexSandboxConfig;
  }
  if (sandboxPolicy !== undefined) {
    config.sandboxPolicy = sandboxPolicy as CodexSandboxConfig;
  }
  if (Array.isArray(writableRoots)) {
    config.writableRoots = writableRoots.filter((entry): entry is string => typeof entry === 'string');
  }
  return config;
};

const responseRecord = (response: Record<string, unknown>, key: 'response' | 'result'): Record<string, unknown> | undefined =>
  isRecord(response[key]) ? response[key] : undefined;

export const effectiveConfigFromResponse = (response: unknown): CodexEffectiveConfig | undefined => {
  if (!isRecord(response)) {
    return undefined;
  }

  const directResponse = responseRecord(response, 'response');
  const resultResponse = responseRecord(response, 'result');
  return (
    normalizeEffectiveConfig(response.effectiveConfig) ??
    normalizeEffectiveConfig(response.effective_config) ??
    normalizeEffectiveConfig(directResponse?.effectiveConfig) ??
    normalizeEffectiveConfig(directResponse?.effective_config) ??
    normalizeEffectiveConfig(resultResponse?.effectiveConfig) ??
    normalizeEffectiveConfig(resultResponse?.effective_config) ??
    normalizeEffectiveConfig(response) ??
    normalizeEffectiveConfig(directResponse) ??
    normalizeEffectiveConfig(resultResponse)
  );
};

export const appServerResultFromResponse = (response: unknown): unknown => {
  if (!isRecord(response)) {
    return response;
  }
  if (isRecord(response.result)) {
    return response.result;
  }
  if (isRecord(response.response)) {
    return response.response;
  }
  return response;
};
