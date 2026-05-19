import { AppServerGenerationDriver } from './app-server-generation-driver.js';
import { CodexAppServerEndpointTransport } from './app-server-endpoint-transport.js';
import { createCodexGenerationRuntimeSafety } from './generation-safety-factory.js';
import type { CodexGenerationTaskKind } from './types.js';

export const createAppServerGenerationDriver = (input: {
  endpoint: string | undefined;
  taskKind: CodexGenerationTaskKind;
  actionRunId: string;
  projectId: string;
  repoIds: string[];
  artifactRoot: string | undefined;
  workspaceRoot?: string;
  policyDigests: Record<string, string>;
}): AppServerGenerationDriver =>
  new AppServerGenerationDriver({
    transport: new CodexAppServerEndpointTransport(input.endpoint ?? ''),
    runtimeSafety: createCodexGenerationRuntimeSafety(input),
  });
