import { Injectable } from '@nestjs/common';
import type { DeliveryRunReadinessRuntimeSelection } from '@forgeloop/db';

const optionalEnv = (key: string): string | undefined => {
  const value = process.env[key]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
};

const requiredEnv = (key: string): string => {
  const value = optionalEnv(key);
  if (value === undefined) {
    throw new Error(`Missing required Codex runtime config: ${key}`);
  }
  return value;
};

@Injectable()
export class RunExecutionRuntimeConfigService {
  selection(): DeliveryRunReadinessRuntimeSelection | undefined {
    const runtimeProfileId = optionalEnv('FORGELOOP_CODEX_RUN_EXECUTION_RUNTIME_PROFILE_ID');
    const credentialBindingId = optionalEnv('FORGELOOP_CODEX_RUN_EXECUTION_CREDENTIAL_BINDING_ID');
    if (runtimeProfileId === undefined && credentialBindingId === undefined) {
      return undefined;
    }
    return {
      ...(runtimeProfileId === undefined ? {} : { runtime_profile_id: runtimeProfileId }),
      ...(credentialBindingId === undefined ? {} : { credential_binding_id: credentialBindingId }),
    };
  }

  launchSelection(): DeliveryRunReadinessRuntimeSelection & { credential_binding_id: string } {
    return {
      ...this.selection(),
      credential_binding_id: requiredEnv('FORGELOOP_CODEX_RUN_EXECUTION_CREDENTIAL_BINDING_ID'),
    };
  }
}
