import { AutomationHttpClient } from '@forgeloop/automation';

import { AutomationDaemon } from './automation-daemon.js';
import { loadAutomationDaemonConfig } from './config.js';
import { loadDaemonWorkflowPolicyDigest } from './workflow-policy-loader.js';

const config = loadAutomationDaemonConfig();
const client = new AutomationHttpClient({
  baseUrl: config.controlPlaneUrl,
  actorId: config.actorId,
  daemonIdentity: config.daemonIdentity,
  secret: config.trustedActorHeaderSecret,
});
const daemon = new AutomationDaemon({
  client,
  actorId: config.actorId,
  daemonIdentity: config.daemonIdentity,
  allowedRepoRoots: config.allowedRepoRoots,
  policyParserVersion: config.policyParserVersion,
  policyLoader: loadDaemonWorkflowPolicyDigest,
  loopIntervalMs: config.loopIntervalMs,
  noClaimBackoffMs: config.noClaimBackoffMs,
  onIterationError: (error) => {
    console.error(error instanceof Error ? error.message : error);
  },
});

const stop = (): void => daemon.stop();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

void daemon.run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
