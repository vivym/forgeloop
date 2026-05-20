import { describe, expect, it } from 'vitest';

import {
  DomainError,
  codexCanonicalDigest,
  codexCredentialPayloadDigest,
  codexPublicBlockerCodes,
  codexRuntimeProfileRevisionDigest,
  codexRuntimeScopeMatches,
  redactCodexLaunchMaterialization,
  validateCodexDockerNetworkProxyConfig,
  validateCodexDockerRuntimeEvidence,
  validateCodexEffectiveConfigAssertions,
  validateCodexRuntimeProfileRevision,
  type CodexDockerNetworkProxyConfig,
  type CodexCredentialBinding,
  type CodexCredentialBindingPublic,
  type CodexCredentialBindingVersion,
  type CodexLaunchLease,
  type CodexLaunchLeaseWithToken,
  type CodexLaunchMaterialization,
  type CodexLaunchTarget,
  type CodexRuntimeProfile,
  type CodexRuntimeProfileRevision,
  type CodexRuntimeStatusProjection,
  type CodexWorkerBootstrapToken,
  type CodexWorkerRegistration,
  type ResolvedCodexCredential,
} from '../../packages/domain/src/index';

type ExportedCodexRuntimeContracts = {
  profile: CodexRuntimeProfile;
  profileRevision: CodexRuntimeProfileRevision;
  credentialBinding: CodexCredentialBinding;
  credentialBindingVersion: CodexCredentialBindingVersion;
  credentialBindingPublic: CodexCredentialBindingPublic;
  resolvedCredential: ResolvedCodexCredential;
  bootstrapToken: CodexWorkerBootstrapToken;
  workerRegistration: CodexWorkerRegistration;
  launchTarget: CodexLaunchTarget;
  launchLease: CodexLaunchLease;
  launchLeaseWithToken: CodexLaunchLeaseWithToken;
  launchMaterialization: CodexLaunchMaterialization;
  statusProjection: CodexRuntimeStatusProjection;
};

const assertCodexRuntimeTypeExports = <T extends ExportedCodexRuntimeContracts>() => undefined;

const digestA = `sha256:${'a'.repeat(64)}`;
const digestB = `sha256:${'b'.repeat(64)}`;
const digestC = `sha256:${'c'.repeat(64)}`;

class NonJsonFixture {
  constructor(readonly value: string) {}
}

const expectDomainErrorCode = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
    expect(codexPublicBlockerCodes).toContain(code);
    return;
  }

  throw new Error(`Expected DomainError ${code}`);
};

const modelProviderRule = {
  id: 'model-provider',
  protocol: 'https',
  host: 'api.openai.com',
  path_prefix: '/v1',
  purpose: 'model_provider',
} as const;

const baseRevision = (overrides: Partial<CodexRuntimeProfileRevision> = {}): CodexRuntimeProfileRevision => {
  const revision = {
    id: 'revision-1',
    profile_id: 'profile-1',
    revision_number: 1,
    status: 'active',
    environment: 'local_dogfood',
    docker_image: 'ghcr.io/forgeloop/codex-worker:2026-05-20',
    docker_image_digest: digestA,
    target_kind: 'generation',
    source_access_mode: 'artifact_only',
    codex_config_toml: 'approval_policy = "never"\nsandbox_mode = "read-only"\n',
    codex_config_digest: digestB,
    expected_effective_config_digest: digestC,
    effective_config_assertions: {
      target_kind: 'generation',
      approval_policy: 'never',
      source_access_mode: 'artifact_only',
      source_workspace_write_policy: 'none',
    },
    app_server_required: true,
    allowed_driver_kind: 'app_server',
    network_policy: {
      mode: 'host_firewall',
      egress: 'allowlist',
      allowlist: [modelProviderRule],
    },
    resource_limits: {
      cpu_ms: 120_000,
      memory_mb: 1024,
      pids: 64,
      fds: 256,
      workspace_bytes: 268_435_456,
      artifact_bytes: 134_217_728,
      timeout_ms: 120_000,
      output_limit_bytes: 1_000_000,
      run_output_limit_bytes: 5_000_000,
    },
    docker_policy: {
      network_disabled: false,
      app_server_only: true,
      rootless: true,
      read_only_rootfs: true,
      no_new_privileges: true,
      drop_capabilities: ['ALL'],
    },
    allowed_scopes: [{ project_id: 'project-1' }, { project_id: 'project-2', repo_id: 'repo-2' }],
    profile_digest: digestA,
    created_by_actor_id: 'actor-1',
    created_at: '2026-05-20T00:00:00.000Z',
    ...overrides,
  } satisfies CodexRuntimeProfileRevision;

  const withConfigDigest =
    overrides.codex_config_digest === undefined
      ? { ...revision, codex_config_digest: codexCanonicalDigest(revision.codex_config_toml) }
      : revision;

  return overrides.profile_digest === undefined
    ? { ...withConfigDigest, profile_digest: codexRuntimeProfileRevisionDigest(withConfigDigest) }
    : withConfigDigest;
};

const validDockerProxyConfig = (): CodexDockerNetworkProxyConfig => {
  const config = {
    proxy_image: 'ghcr.io/forgeloop/codex-network-proxy:2026-05-20',
    proxy_image_digest: digestA,
    self_test_image: 'ghcr.io/forgeloop/codex-network-self-test:2026-05-20',
    self_test_image_digest: digestB,
    provider_config_digest: digestC,
  };

  return {
    ...config,
    provider_config_digest: codexCanonicalDigest({
      proxy_image: config.proxy_image,
      proxy_image_digest: config.proxy_image_digest,
      self_test_image: config.self_test_image,
      self_test_image_digest: config.self_test_image_digest,
    }),
  };
};

describe('codex runtime domain contracts', () => {
  it('exports object model contracts for downstream packages', () => {
    expect(assertCodexRuntimeTypeExports()).toBeUndefined();
  });

  it('treats project-only scope as project-wide while repo scope is repo-specific', () => {
    expect(codexRuntimeScopeMatches([{ project_id: 'project-1' }], { project_id: 'project-1', repo_id: 'repo-1' })).toBe(true);
    expect(codexRuntimeScopeMatches([{ project_id: 'project-1', repo_id: 'repo-1' }], { project_id: 'project-1', repo_id: 'repo-1' })).toBe(
      true,
    );
    expect(codexRuntimeScopeMatches([{ project_id: 'project-1', repo_id: 'repo-1' }], { project_id: 'project-1', repo_id: 'repo-2' })).toBe(
      false,
    );
    expect(codexRuntimeScopeMatches([{ project_id: 'project-1' }], { project_id: 'project-2', repo_id: 'repo-1' })).toBe(false);
  });

  it('creates stable profile revision digests independent of object key order', () => {
    const left = baseRevision({
      network_policy: {
        mode: 'host_firewall',
        egress: 'allowlist',
        allowlist: [
          {
            id: 'model-provider',
            protocol: 'https',
            host: 'api.openai.com',
            path_prefix: '/v1',
            purpose: 'model_provider',
          },
        ],
      },
    });
    const right = baseRevision({
      network_policy: {
        allowlist: [
          {
            purpose: 'model_provider',
            path_prefix: '/v1',
            host: 'api.openai.com',
            protocol: 'https',
            id: 'model-provider',
          },
        ],
        egress: 'allowlist',
        mode: 'host_firewall',
      },
    });

    expect(codexRuntimeProfileRevisionDigest(left)).toBe(codexRuntimeProfileRevisionDigest(right));
  });

  it('excludes database timestamps from profile digests but changes when runtime config changes', () => {
    const original = baseRevision();
    const timestampOnlyChange = baseRevision({
      created_at: '2026-05-20T01:00:00.000Z',
      created_by_actor_id: 'actor-2',
      profile_digest: digestC,
    });
    const runtimeConfigChange = baseRevision({
      codex_config_digest: codexCanonicalDigest({ config: 'changed' }),
    });

    expect(codexRuntimeProfileRevisionDigest(original)).toBe(codexRuntimeProfileRevisionDigest(timestampOnlyChange));
    expect(codexRuntimeProfileRevisionDigest(original)).not.toBe(codexRuntimeProfileRevisionDigest(runtimeConfigChange));
  });

  it.each([
    ['top-level undefined', undefined],
    ['function values', () => 'not-json'],
    ['symbol values', Symbol('not-json')],
    ['class instances', new NonJsonFixture('not-json')],
    ['non-finite numbers', Number.NaN],
    ['unsupported array entries', [undefined]],
  ])('rejects %s when computing canonical digests', (_label, value) => {
    expect(() => codexCanonicalDigest(value)).toThrow(/JSON-compatible/);
  });

  it('validates self-consistent profile and Codex config digests', () => {
    expect(() => validateCodexRuntimeProfileRevision(baseRevision(), { strictRealDogfood: true })).not.toThrow();

    expectDomainErrorCode(
      () =>
        validateCodexRuntimeProfileRevision(baseRevision({ profile_digest: digestB }), {
          strictRealDogfood: true,
        }),
      'codex_runtime_profile_invalid',
    );

    expectDomainErrorCode(
      () =>
        validateCodexRuntimeProfileRevision(baseRevision({ codex_config_digest: digestB }), {
          strictRealDogfood: true,
        }),
      'codex_runtime_profile_invalid',
    );
  });

  it('rejects strict real dogfood egress allowlist profiles without a model provider rule', () => {
    const revision = baseRevision({
      network_policy: {
        mode: 'host_firewall',
        egress: 'allowlist',
        allowlist: [
          {
            id: 'registry',
            protocol: 'https',
            host: 'registry.npmjs.org',
            purpose: 'package_registry',
          },
        ],
      },
    });

    expect(() => validateCodexRuntimeProfileRevision(revision, { strictRealDogfood: true })).toThrow(
      /codex_worker_docker_policy_unavailable/,
    );
  });

  it.each([
    ['app_server_only', { app_server_only: false }],
    ['rootless', { rootless: false }],
    ['read_only_rootfs', { read_only_rootfs: false }],
    ['no_new_privileges', { no_new_privileges: false }],
    ['drop_capabilities', { drop_capabilities: [] }],
  ])('rejects strict Docker policy without %s', (_field, dockerPolicyPatch) => {
    const validRevision = baseRevision();

    expectDomainErrorCode(
      () =>
        validateCodexRuntimeProfileRevision(
          baseRevision({
            docker_policy: {
              ...validRevision.docker_policy,
              ...dockerPolicyPatch,
            },
          }),
          { strictRealDogfood: true },
        ),
      'codex_worker_docker_policy_unavailable',
    );
  });

  it.each(['secret_key = "x"', 'auth_token = "x"'])('rejects secret-looking Codex config key %s', (codexConfigToml) => {
    expectDomainErrorCode(
      () => validateCodexRuntimeProfileRevision(baseRevision({ codex_config_toml: codexConfigToml }), { strictRealDogfood: true }),
      'codex_runtime_profile_invalid',
    );
  });

  it('validates effective config assertions before prompt delivery', () => {
    const generationAssertions = baseRevision().effective_config_assertions;

    expect(validateCodexEffectiveConfigAssertions(generationAssertions, generationAssertions)).toBeUndefined();
    expect(validateCodexEffectiveConfigAssertions({ ...generationAssertions, approval_policy: 'on-request' }, generationAssertions)).toBe(
      'codex_app_server_effective_config_mismatch',
    );
    expect(codexPublicBlockerCodes).toContain('codex_app_server_effective_config_mismatch');
  });

  it('validates Docker network proxy config image pinning and provider digest', () => {
    expect(validateCodexDockerNetworkProxyConfig(validDockerProxyConfig())).toEqual(validDockerProxyConfig());

    expectDomainErrorCode(
      () =>
        validateCodexDockerNetworkProxyConfig({
          ...validDockerProxyConfig(),
          proxy_image_digest: 'latest',
        }),
      'codex_worker_docker_policy_unavailable',
    );
    expectDomainErrorCode(
      () =>
        validateCodexDockerNetworkProxyConfig({
          ...validDockerProxyConfig(),
          provider_config_digest: digestC,
        }),
      'codex_worker_docker_policy_unavailable',
    );
  });

  it('redacts launch materialization without leaking raw secret payloads', () => {
    const payload = { api_key: 'super-secret-key', token: 'raw-token' };
    const materialization = {
      launch_target: {
        target_type: 'execution_package',
        target_id: 'package-1',
        target_kind: 'run_execution',
        project_id: 'project-1',
        repo_id: 'repo-1',
      },
      profile_revision: baseRevision({ target_kind: 'run_execution', source_access_mode: 'path_policy_scoped' }),
      resolved_credentials: [
        {
          binding_id: 'credential-binding-1',
          binding_version_id: 'credential-version-1',
          payload,
          payload_digest: codexCredentialPayloadDigest(payload),
        },
      ],
      lease_id: 'lease-1',
      materialized_at: '2026-05-20T00:00:00.000Z',
    } satisfies CodexLaunchMaterialization;

    const redacted = redactCodexLaunchMaterialization(materialization);
    const serialized = JSON.stringify(redacted);

    expect(serialized).toContain(codexCredentialPayloadDigest(payload));
    expect(serialized).not.toContain('super-secret-key');
    expect(serialized).not.toContain('raw-token');
    expect(serialized).not.toContain('"payload"');
  });

  it('accepts only public-safe Docker runtime evidence', () => {
    expect(() =>
      validateCodexDockerRuntimeEvidence({
        runtime_profile_id: 'profile-1',
        runtime_profile_revision_id: 'revision-1',
        runtime_profile_digest: digestA,
        runtime_target_kind: 'run_execution',
        source_access_mode: 'path_policy_scoped',
        environment: 'local_dogfood',
        credential_binding_id: 'credential-binding-1',
        credential_binding_version_id: 'credential-version-1',
        credential_payload_digest: digestB,
        launch_lease_id: 'lease-1',
        docker_image_digest: digestA,
        container_id_digest: digestB,
        app_server_effective_config_digest: digestC,
        network_policy_digest: digestA,
        network_policy_self_test_digest: digestB,
        docker_policy_self_check_digest: digestC,
        workspace_isolation_digest: digestA,
      }),
    ).not.toThrow();

    expect(() =>
      validateCodexDockerRuntimeEvidence({
        runtime_profile_id: '550e8400-e29b-41d4-a716-446655440000',
        runtime_profile_revision_id: '018f2f9e-2bb0-72bc-9233-7f4fdf2f0dd0',
        credential_binding_id: 'credential-binding-550e8400-e29b-41d4-a716-446655440000',
        credential_binding_version_id: 'credential-version-018f2f9e-2bb0-72bc-9233-7f4fdf2f0dd0',
        launch_lease_id: 'lease-550e8400-e29b-41d4-a716-446655440000',
      }),
    ).not.toThrow();

    expectDomainErrorCode(
      () =>
        validateCodexDockerRuntimeEvidence({
          runtime_profile_id: 'profile-1',
          docker_image_digest: digestA,
          container_id: '4f1e2d3c',
          workspace_path: '/var/lib/forgeloop/workspaces/package-1',
          app_server_endpoint: 'http://127.0.0.1:4555',
          secret_token: 'raw-secret',
        }),
      'codex_docker_runtime_evidence_unsafe',
    );

    for (const unsafePublicId of ['/var/lib/forgeloop/workspaces/package-1', 'http://127.0.0.1:4555', '4f1e2d3c4f1e']) {
      expectDomainErrorCode(
        () =>
          validateCodexDockerRuntimeEvidence({
            runtime_profile_id: unsafePublicId,
            docker_image_digest: digestA,
          }),
        'codex_docker_runtime_evidence_unsafe',
      );
    }
  });
});
