import {
  codexRuntimeCapsuleManifestDigest,
  codexRuntimeCapsuleManifestSchema,
} from '@forgeloop/domain';
import type { z } from 'zod';

import { writeCodexHomeConfigAndAuth } from '../task-filesystem.js';
import {
  materializeCodexEnvironmentState,
  type CapsuleComponentArtifactReader,
  type CodexEnvironmentManifest,
  type CodexEnvironmentMaterializationResult,
} from './environment-state.js';

export type CodexRuntimeCapsuleManifest = z.infer<typeof codexRuntimeCapsuleManifestSchema>;

export interface CodexRuntimeCapsuleMaterializerInput {
  codexHomeRoot: string;
  capsuleManifest: unknown;
  environmentManifest?: unknown;
  runtimeProfileMaterialization: {
    codexConfigToml: string;
  };
  credentialBindingMaterialization: {
    authJson: unknown;
  };
}

export interface CodexRuntimeCapsuleMaterializationResult {
  capsuleManifest: CodexRuntimeCapsuleManifest;
  capsuleManifestDigest: string;
  environmentMaterialization?: CodexEnvironmentMaterializationResult;
  copiedCapsuleFiles: readonly string[];
}

export class CodexRuntimeCapsuleMaterializer {
  constructor(private readonly dependencies: { artifactReader: CapsuleComponentArtifactReader }) {}

  async materialize(input: CodexRuntimeCapsuleMaterializerInput): Promise<CodexRuntimeCapsuleMaterializationResult> {
    const capsuleManifest = codexRuntimeCapsuleManifestSchema.parse(input.capsuleManifest);
    let environmentMaterialization: CodexEnvironmentMaterializationResult | undefined;
    if (input.environmentManifest !== undefined) {
      environmentMaterialization = await materializeCodexEnvironmentState({
        targetCodexHomeRoot: input.codexHomeRoot,
        environmentManifest: input.environmentManifest as CodexEnvironmentManifest,
        artifactReader: this.dependencies.artifactReader,
      });
      if (environmentMaterialization.environmentManifestDigest !== capsuleManifest.environment_manifest.digest) {
        throw new Error('capsule environment manifest digest mismatch');
      }
    }

    await writeCodexHomeConfigAndAuth({
      codexHomeHostPath: input.codexHomeRoot,
      codexConfigToml: input.runtimeProfileMaterialization.codexConfigToml,
      authJson: input.credentialBindingMaterialization.authJson,
    });

    return {
      capsuleManifest,
      capsuleManifestDigest: codexRuntimeCapsuleManifestDigest(capsuleManifest),
      ...(environmentMaterialization === undefined ? {} : { environmentMaterialization }),
      copiedCapsuleFiles: capsuleManifest.included_files.filter((relativePath) => relativePath !== 'auth.json' && relativePath !== 'config.toml'),
    };
  }
}
