import type { DeliveryRepository } from '../../db/src/index.js';
import type { RunCommand, RunRuntimeMetadata } from '../../domain/src/index.js';
import type { CodexSessionDriver } from '../../executor/src/index.js';

interface ApplyPendingRunCommandsInput {
  repository: DeliveryRepository;
  runSessionId: string;
  workerId: string;
  leaseToken: string;
  driver: CodexSessionDriver;
  runtimeMetadata: RunRuntimeMetadata;
  now?: () => string;
  reclaimClaimedBefore?: string;
  requestResume?: () => Promise<void> | void;
}

const nowIso = () => new Date().toISOString();

const textPayload = (command: RunCommand): string => {
  const message = command.payload.message ?? command.payload.text;
  if (typeof message !== 'string' || message.trim().length === 0) {
    throw new Error(`Run command ${command.id} input payload requires message`);
  }

  return message;
};

const sanitizeContinuity = (ack: Record<string, unknown>): Record<string, unknown> => {
  const continuity = ack.continuity;
  if (continuity === 'resume_fallback') {
    const threadId = scalarField(ack, ['thread_id', 'threadId']);
    return {
      fallback: 'resume_fallback',
      ...(threadId === undefined ? {} : { thread_id: threadId }),
    };
  }
  if (continuity === 'thread_continuation') {
    const threadId = scalarField(ack, ['thread_id', 'threadId']);
    const turnId = scalarField(ack, ['turn_id', 'turnId']);
    return {
      ...(threadId === undefined ? {} : { thread_id: threadId }),
      ...(turnId === undefined ? {} : { turn_id: turnId }),
    };
  }
  if (continuity === undefined || continuity === null || typeof continuity !== 'object' || Array.isArray(continuity)) {
    return {};
  }

  const record = continuity as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  const threadId = scalarField(record, ['thread_id']);
  const turnId = scalarField(record, ['turn_id']);
  const fallback = scalarField(record, ['fallback']);
  if (threadId !== undefined) {
    sanitized.thread_id = threadId;
  }
  if (turnId !== undefined) {
    sanitized.turn_id = turnId;
  }
  if (fallback !== undefined) {
    sanitized.fallback = fallback;
  }

  return sanitized;
};

const scalarField = (record: Record<string, unknown>, keys: string[]): string | number | boolean | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
  }
  return undefined;
};

const appendDeliveryEvent = async (
  repository: DeliveryRepository,
  command: RunCommand,
  lease: { workerId: string; leaseToken: string },
  ack: Record<string, unknown>,
  at: string,
): Promise<void> => {
  await repository.appendWorkerRunEvent(
    {
      id: `run-event:${command.id}:user-input`,
      run_session_id: command.run_session_id,
      event_type: 'user_input',
      source: 'user',
      visibility: 'public',
      summary: 'User input delivered.',
      payload: {
        command_id: command.id,
        continuity: sanitizeContinuity(ack),
      },
      created_at: at,
    },
    lease,
  );
};

const appendWarning = async (
  repository: DeliveryRepository,
  command: RunCommand,
  lease: { workerId: string; leaseToken: string },
  reason: string,
  at: string,
): Promise<void> => {
  await repository.appendWorkerRunEvent(
    {
      id: `run-event:${command.id}:${reason}`,
      run_session_id: command.run_session_id,
      event_type: 'codex_warning',
      source: 'worker',
      visibility: 'public',
      summary: 'Run command delivery state is unknown.',
      payload: { command_id: command.id, reason },
      created_at: at,
    },
    lease,
  );
};

const applyInputCommand = async (
  input: ApplyPendingRunCommandsInput,
  command: RunCommand,
  reclaimed: boolean,
  at: string,
): Promise<void> => {
  const lease = { workerId: input.workerId, leaseToken: input.leaseToken };

  if (reclaimed && command.driver_ack !== undefined) {
    await appendDeliveryEvent(input.repository, command, lease, command.driver_ack, at);
    await input.repository.markRunCommandApplied(command.id, lease, at, command.driver_ack);
    return;
  }

  if (reclaimed) {
    const reason = 'delivery_unknown_after_worker_crash';
    await input.repository.markRunCommandFailed(command.id, lease, reason, at);
    await appendWarning(input.repository, command, lease, reason, at);
    return;
  }

  const targetTurnId = command.target_turn_id ?? input.runtimeMetadata.active_turn_id;
  let ack: Record<string, unknown>;
  try {
    ack = await input.driver.sendInput({
      message: textPayload(command),
      runtimeMetadata: input.runtimeMetadata,
      ...(targetTurnId === undefined ? {} : { targetTurnId }),
    });
    await input.repository.recordRunCommandDriverAck(command.id, lease, ack, at);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await input.repository.markRunCommandFailed(command.id, lease, reason, at);
    await appendWarning(input.repository, command, lease, 'driver_rejected_command', at);
    return;
  }

  await appendDeliveryEvent(input.repository, command, lease, ack, at);
  await input.repository.markRunCommandApplied(command.id, lease, at, ack);
};

const applyCancelCommand = async (
  input: ApplyPendingRunCommandsInput,
  command: RunCommand,
  at: string,
): Promise<void> => {
  const lease = { workerId: input.workerId, leaseToken: input.leaseToken };
  const ack = await input.driver.cancelRun({ runtimeMetadata: input.runtimeMetadata });
  await input.repository.supersedePendingRunCommandsForWorker(input.runSessionId, ['input'], lease, at);
  await input.repository.markRunCommandApplied(command.id, lease, at, ack);
};

const applyResumeCommand = async (
  input: ApplyPendingRunCommandsInput,
  command: RunCommand,
  at: string,
): Promise<void> => {
  await input.requestResume?.();
  await input.repository.markRunCommandApplied(
    command.id,
    { workerId: input.workerId, leaseToken: input.leaseToken },
    at,
    { resume_requested: true },
  );
};

export const applyPendingRunCommands = async (input: ApplyPendingRunCommandsInput): Promise<void> => {
  const now = input.now ?? nowIso;

  for (;;) {
    const at = now();
    const claimed = await input.repository.claimNextRunCommand(
      input.runSessionId,
      input.workerId,
      input.leaseToken,
      at,
      input.reclaimClaimedBefore === undefined ? undefined : { reclaim_claimed_before: input.reclaimClaimedBefore },
    );

    if (claimed === undefined) {
      return;
    }

    switch (claimed.command.command_type) {
      case 'input':
        await applyInputCommand(input, claimed.command, claimed.reclaimed, at);
        break;
      case 'cancel':
        await applyCancelCommand(input, claimed.command, at);
        break;
      case 'resume':
        await applyResumeCommand(input, claimed.command, at);
        break;
    }
  }
};
