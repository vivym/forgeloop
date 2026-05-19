import type { CodexGenerationTaskKind } from './types.js';

export interface GenerationLease {
  lease_id: string;
  expires_at: string;
}

export interface CodexGenerationRuntimeSafety {
  readonly taskKind: CodexGenerationTaskKind;
  readonly actionRunId: string;
  readonly projectId: string;
  readonly repoIds: string[];
  readonly artifactRoot: string;
  readonly workspaceRoot?: string;
  readonly policyDigests: Record<string, string>;
  createGenerationLease(input: {
    promptDigest: string;
    contextDigest: string;
    outputSchemaVersion: string;
    now: string;
    expiresAt: string;
  }): Promise<GenerationLease>;
  consumeGenerationCommand(input: {
    lease: GenerationLease;
    method: string;
    commandDigest: string;
    nonce: string;
    now: string;
  }): Promise<void>;
}
