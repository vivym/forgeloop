import { Buffer } from 'node:buffer';

import {
  codexCanonicalDigest,
  codexRuntimeGeneratedPayloadInlineMaxBytes,
  validateCodexRuntimeJobTerminalResult,
  type CodexGenerationRuntimeJobResult,
} from '@forgeloop/domain';
import type { CodexGenerationResult } from '@forgeloop/codex-runtime';

export interface RuntimeJobArtifactUploadInput {
  artifact_idempotency_key: string;
  kind: string;
  name: string;
  content_type: string;
  digest: string;
  size_bytes: number;
  metadata_json?: Record<string, unknown>;
}

export const jsonRuntimeJobArtifactUpload = (input: {
  kind: string;
  name: string;
  payload: unknown;
  metadata?: Record<string, unknown>;
}): RuntimeJobArtifactUploadInput => {
  const encoded = JSON.stringify(input.payload);
  return {
    artifact_idempotency_key: codexCanonicalDigest({
      kind: input.kind,
      name: input.name,
      digest: codexCanonicalDigest(input.payload),
    }),
    kind: input.kind,
    name: input.name,
    content_type: 'application/json',
    digest: codexCanonicalDigest(input.payload),
    size_bytes: Buffer.byteLength(encoded, 'utf8'),
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
    public_summary: result.publicSummary,
  };
  validateCodexRuntimeJobTerminalResult(terminalResult);
  return terminalResult;
};
