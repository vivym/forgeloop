import { describe, expect, it } from 'vitest';

import { deriveDeliveryRunReadiness, InMemoryDeliveryRepository } from '../../packages/db/src';
import {
  seedActiveGenerationProfile,
  seedActiveRunExecutionProfile,
  seedOnlineCodexWorkerWithDockerMismatch,
  seedOnlineCodexWorkerWithNetworkMismatch,
  seedOnlineCompatibleCodexWorker,
  seedReadyExecutionPackage,
  seedReadyLocalCodexExecutionPackage,
  seedSingleCredentialBinding,
} from '../helpers/delivery-runtime-fixtures';

const now = '2026-05-20T00:00:00.000Z';

const derive = (repository: InMemoryDeliveryRepository, executionPackage: Awaited<ReturnType<typeof seedReadyLocalCodexExecutionPackage>>) =>
  deriveDeliveryRunReadiness(repository, { executionPackage, now });

const expectPublicSafe = (response: unknown) => {
  const serialized = JSON.stringify(response);
  for (const unsafeText of [
    'profile-run-execution',
    'profile-run-execution-revision',
    'credential-binding',
    'credential-binding-version',
    'worker-',
    'lease-',
    'sha256:',
    '/workspace/',
    '.worktrees',
    'codex_config',
    'runtime_profile_digest',
    'credential_payload_digest',
    'docker_image_digest',
    'network_policy_digest',
  ]) {
    expect(serialized).not.toContain(unsafeText);
  }
};

describe('delivery runtime readiness query', () => {
  it('blocks when no run execution profile is active for the package scope', async () => {
    const repository = new InMemoryDeliveryRepository();
    const executionPackage = await seedReadyLocalCodexExecutionPackage(repository);

    const response = await derive(repository, executionPackage);

    expect(response).toMatchObject({
      executor_type: 'local_codex',
      target_kind: 'run_execution',
      state: 'blocked',
      blockers: [
        expect.objectContaining({
          code: 'runtime_profile_missing',
          severity: 'blocking',
          next_step_href: `/packages/${executionPackage.id}`,
        }),
      ],
    });
    expectPublicSafe(response);
  });

  it('blocks missing and ambiguous credential bindings without exposing credential ids', async () => {
    const missingRepository = new InMemoryDeliveryRepository();
    const missingPackage = await seedReadyLocalCodexExecutionPackage(missingRepository);
    const missingProfile = await seedActiveRunExecutionProfile(missingRepository, missingPackage);
    await seedOnlineCompatibleCodexWorker(missingRepository, missingProfile, missingPackage);

    expect((await derive(missingRepository, missingPackage)).blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'credential_binding_unconfigured' })]),
    );

    const ambiguousRepository = new InMemoryDeliveryRepository();
    const ambiguousPackage = await seedReadyLocalCodexExecutionPackage(ambiguousRepository);
    const ambiguousProfile = await seedActiveRunExecutionProfile(ambiguousRepository, ambiguousPackage);
    await seedSingleCredentialBinding(ambiguousRepository, ambiguousProfile, ambiguousPackage, 'one');
    await seedSingleCredentialBinding(ambiguousRepository, ambiguousProfile, ambiguousPackage, 'two');
    await seedOnlineCompatibleCodexWorker(ambiguousRepository, ambiguousProfile, ambiguousPackage);

    const ambiguousResponse = await derive(ambiguousRepository, ambiguousPackage);
    expect(ambiguousResponse.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'credential_binding_ambiguous' })]),
    );
    expectPublicSafe(ambiguousResponse);
  });

  it('returns ready when package policy, profile, credential, and worker diagnostics align', async () => {
    const repository = new InMemoryDeliveryRepository();
    const executionPackage = await seedReadyLocalCodexExecutionPackage(repository);
    const profile = await seedActiveRunExecutionProfile(repository, executionPackage);
    await seedSingleCredentialBinding(repository, profile, executionPackage);
    await seedOnlineCompatibleCodexWorker(repository, profile, executionPackage);

    const response = await derive(repository, executionPackage);

    expect(response).toEqual({
      executor_type: 'local_codex',
      target_kind: 'run_execution',
      state: 'ready',
      blockers: [],
      generated_at: now,
    });
    expectPublicSafe(response);
  });

  it('uses configured credential binding selection instead of treating credential rotation as ambiguous', async () => {
    const repository = new InMemoryDeliveryRepository();
    const executionPackage = await seedReadyLocalCodexExecutionPackage(repository);
    const profile = await seedActiveRunExecutionProfile(repository, executionPackage);
    const configuredBinding = await seedSingleCredentialBinding(repository, profile, executionPackage, 'configured');
    await seedSingleCredentialBinding(repository, profile, executionPackage, 'rotation');
    await seedOnlineCompatibleCodexWorker(repository, profile, executionPackage);

    const response = await deriveDeliveryRunReadiness(repository, {
      executionPackage,
      now,
      runtime_selection: { credential_binding_id: configuredBinding.bindingId },
    });

    expect(response).toEqual({
      executor_type: 'local_codex',
      target_kind: 'run_execution',
      state: 'ready',
      blockers: [],
      generated_at: now,
    });
    expectPublicSafe(response);
  });

  it('uses configured runtime profile selection instead of the newest active run profile', async () => {
    const repository = new InMemoryDeliveryRepository();
    const executionPackage = await seedReadyLocalCodexExecutionPackage(repository);
    const configuredProfile = await seedActiveRunExecutionProfile(repository, executionPackage, 'configured');
    const newestProfile = {
      ...configuredProfile,
      id: `profile-run-execution-revision-newest-${executionPackage.id}`,
      profile_id: `profile-run-execution-newest-${executionPackage.id}`,
      revision_number: 2,
      created_at: '2026-05-20T00:01:00.000Z',
    };
    await repository.createCodexRuntimeProfileWithRevision({
      profile: {
        id: newestProfile.profile_id,
        name: 'Newest run execution test profile',
        environment: newestProfile.environment,
        target_kind: newestProfile.target_kind,
        active_revision_id: newestProfile.id,
        created_by_actor_id: newestProfile.created_by_actor_id,
        created_at: newestProfile.created_at,
        updated_at: newestProfile.created_at,
      },
      revision: newestProfile,
    });
    await seedSingleCredentialBinding(repository, newestProfile, executionPackage, 'newest');
    await seedOnlineCompatibleCodexWorker(repository, newestProfile, executionPackage);

    const response = await deriveDeliveryRunReadiness(repository, {
      executionPackage,
      now,
      runtime_selection: { runtime_profile_id: configuredProfile.profile_id },
    });

    expect(response.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'credential_binding_unconfigured' })]),
    );
    expectPublicSafe(response);
  });

  it('blocks when a configured credential binding does not match the selected runtime profile', async () => {
    const repository = new InMemoryDeliveryRepository();
    const executionPackage = await seedReadyLocalCodexExecutionPackage(repository);
    const selectedProfile = await seedActiveRunExecutionProfile(repository, executionPackage, 'selected');
    const otherProfile = await seedActiveRunExecutionProfile(repository, executionPackage, 'other');
    const otherBinding = await seedSingleCredentialBinding(repository, otherProfile, executionPackage, 'other');
    await seedOnlineCompatibleCodexWorker(repository, selectedProfile, executionPackage);

    const response = await deriveDeliveryRunReadiness(repository, {
      executionPackage,
      now,
      runtime_selection: {
        runtime_profile_id: selectedProfile.profile_id,
        credential_binding_id: otherBinding.bindingId,
      },
    });

    expect(response.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'credential_binding_unconfigured' })]),
    );
    expectPublicSafe(response);
  });

  it('does not treat saturated worker launch capacity as a pre-run readiness blocker', async () => {
    const repository = new InMemoryDeliveryRepository();
    const executionPackage = await seedReadyLocalCodexExecutionPackage(repository);
    const profile = await seedActiveRunExecutionProfile(repository, executionPackage);
    await seedSingleCredentialBinding(repository, profile, executionPackage);
    await seedOnlineCompatibleCodexWorker(repository, profile, executionPackage, { activeLeaseCount: 2, maxConcurrency: 2 });

    const response = await derive(repository, executionPackage);

    expect(response).toEqual({
      executor_type: 'local_codex',
      target_kind: 'run_execution',
      state: 'ready',
      blockers: [],
      generated_at: now,
    });
  });

  it('distinguishes incompatible runtime profile and package policy targets', async () => {
    const profileRepository = new InMemoryDeliveryRepository();
    const profilePackage = await seedReadyLocalCodexExecutionPackage(profileRepository);
    await seedActiveGenerationProfile(profileRepository, profilePackage);

    expect((await derive(profileRepository, profilePackage)).blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'runtime_target_incompatible' })]),
    );

    const packageRepository = new InMemoryDeliveryRepository();
    const mockPolicyPackage = await seedReadyExecutionPackage(packageRepository);

    expect((await deriveDeliveryRunReadiness(packageRepository, { executionPackage: mockPolicyPackage, now })).blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'package_runtime_target_incompatible' })]),
    );
  });

  it('surfaces public worker diagnostic blockers without exposing worker capability details', async () => {
    const dockerRepository = new InMemoryDeliveryRepository();
    const dockerPackage = await seedReadyLocalCodexExecutionPackage(dockerRepository);
    const dockerProfile = await seedActiveRunExecutionProfile(dockerRepository, dockerPackage);
    await seedSingleCredentialBinding(dockerRepository, dockerProfile, dockerPackage);
    await seedOnlineCodexWorkerWithDockerMismatch(dockerRepository, dockerProfile, dockerPackage);

    expect((await derive(dockerRepository, dockerPackage)).blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'worker_docker_capability_mismatch' })]),
    );

    const networkRepository = new InMemoryDeliveryRepository();
    const networkPackage = await seedReadyLocalCodexExecutionPackage(networkRepository);
    const networkProfile = await seedActiveRunExecutionProfile(networkRepository, networkPackage);
    await seedSingleCredentialBinding(networkRepository, networkProfile, networkPackage);
    await seedOnlineCodexWorkerWithNetworkMismatch(networkRepository, networkProfile, networkPackage);

    const networkResponse = await derive(networkRepository, networkPackage);
    expect(networkResponse.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'worker_network_policy_mismatch' })]),
    );
    expectPublicSafe(networkResponse);
  });
});
