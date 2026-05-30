import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import {
  codexCanonicalDigest,
  codexRuntimeGeneratedPayloadInlineMaxBytes,
  validateCodexRuntimeJobTerminalResult,
  type CodexDockerRuntimeEvidence,
  type CodexGenerationRuntimeJobResult,
} from '@forgeloop/domain';
import type { CodexGenerationResult } from '@forgeloop/codex-runtime';

const sha256 = (bytes: Uint8Array | string): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

export interface RuntimeJobArtifactUploadInput {
  artifact_idempotency_key: string;
  kind: string;
  name: string;
  content_type: string;
  digest: string;
  size_bytes: number;
  bytes: Uint8Array;
  metadata_json?: Record<string, unknown>;
}

export const jsonRuntimeJobArtifactUpload = (input: {
  kind: string;
  name: string;
  payload: unknown;
  metadata?: Record<string, unknown>;
}): RuntimeJobArtifactUploadInput => {
  const encoded = JSON.stringify(input.payload);
  if (encoded === undefined) {
    throw new Error('codex_runtime_job_artifact_payload_unserializable');
  }
  const bytes = Buffer.from(encoded, 'utf8');
  const generatedPayloadDigest = codexCanonicalDigest(input.payload);
  return {
    artifact_idempotency_key: codexCanonicalDigest({
      kind: input.kind,
      name: input.name,
      digest: generatedPayloadDigest,
    }),
    kind: input.kind,
    name: input.name,
    content_type: 'application/json',
    digest: sha256(bytes),
    size_bytes: bytes.byteLength,
    bytes,
    ...(input.metadata === undefined ? {} : { metadata_json: input.metadata }),
  };
};

export const generationRuntimeJobTerminalResult = (
  result: CodexGenerationResult<Record<string, unknown>>,
  uploadedArtifacts: Array<{
    kind: string;
    name: string;
    content_type: string;
    digest?: string;
    internal_ref?: string;
  }>,
  runtimeEvidence?: CodexDockerRuntimeEvidence,
): CodexGenerationRuntimeJobResult => {
  const generatedPayloadDigest = codexCanonicalDigest(result.generated);
  const generatedPayloadArtifact = uploadedArtifacts.find((artifact) => artifact.kind === 'generated_payload');
  const inlinePayload = Buffer.byteLength(JSON.stringify(result.generated), 'utf8') <= codexRuntimeGeneratedPayloadInlineMaxBytes;
  if (!inlinePayload && (generatedPayloadArtifact?.digest === undefined || generatedPayloadArtifact.internal_ref === undefined)) {
    throw new Error('codex_runtime_job_unavailable');
  }
  const oversizedPayloadArtifact =
    !inlinePayload && generatedPayloadArtifact?.digest !== undefined && generatedPayloadArtifact.internal_ref !== undefined
      ? generatedPayloadArtifact
      : undefined;
  const generatedPayload = inlinePayload
    ? result.generated
    : {
        schema_version: 'generated_payload_ref.v1',
        artifact: {
          kind: oversizedPayloadArtifact!.kind,
          name: oversizedPayloadArtifact!.name,
          content_type: oversizedPayloadArtifact!.content_type,
          digest: oversizedPayloadArtifact!.digest,
          internal_ref: oversizedPayloadArtifact!.internal_ref,
        },
      };
  const terminalResult: CodexGenerationRuntimeJobResult = {
    task_kind: result.taskKind,
    prompt_version: result.promptVersion,
    output_schema_version: result.outputSchemaVersion,
    generated_payload: generatedPayload,
    generated_payload_digest: generatedPayloadDigest,
    generation_artifacts: uploadedArtifacts,
    ...(runtimeEvidence === undefined ? {} : { runtime_evidence: runtimeEvidence }),
    public_summary: result.publicSummary,
  };
  validateCodexRuntimeJobTerminalResult(terminalResult);
  return terminalResult;
};
