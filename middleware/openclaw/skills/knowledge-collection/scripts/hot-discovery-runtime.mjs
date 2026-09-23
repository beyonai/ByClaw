import { createHotRuntimeState, hotRequestIdentity } from '../references/online-search/references/hot_discovery/scripts/hot_runtime_state.mjs';

function parsedDocument(outcome) {
  if (outcome?.code !== 0) return null;
  try {
    const doc = JSON.parse(outcome.stdout);
    return doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : null;
  } catch { return null; }
}

// Only the parent constructs these flags. The runner never reads a delivery path or a
// caller-supplied cache file, and checkpoint recovery never retries a completed source.
export async function runHotDiscoveryWave(spec, runner, options = {}) {
  const args = Object.fromEntries(Array.from({ length: (spec.args.length - 2) / 2 }, (_, index) => [
    spec.args[2 + index * 2].slice(2), spec.args[3 + index * 2],
  ]));
  const state = await createHotRuntimeState({ directory: args['state-dir'], runId: args['run-id'],
    waveId: args['wave-id'], requestIdentity: hotRequestIdentity(args) });
  const previous = await state.loadCheckpoint();
  const recover = ['resume', 'skip'].includes(options.recovery) && previous
    && (previous.requiresUserAction || ['in_progress', 'process_interrupted'].includes(previous.stopReason));
  if (previous && !recover) {
    // A replay consumes durable evidence; it never repeats a finished source.
    const replay = { ...previous, replayedFromCheckpoint: true };
    if (replay.status !== 'complete') {
      replay.status = 'partial';
      replay.stopReason = replay.requiresUserAction ? 'requires_user_action'
        : replay.stopReason === 'budget_exhausted' ? 'budget_exhausted' : 'process_interrupted';
    }
    return { code: 0, stdout: JSON.stringify(replay), stderr: '' };
  }
  let outcome;
  try {
    outcome = await runner(recover ? { ...spec, args: [...spec.args, '--recovery', options.recovery] } : spec, options);
  }
  catch (error) {
    outcome = { code: 1, stdout: '', stderr: error.message,
      timedOut: /timeout after \d+ms/i.test(error.message) };
  }
  const document = parsedDocument(outcome);
  if (document) {
    await state.saveCheckpoint(document);
    return outcome;
  }
  const checkpoint = await state.loadCheckpoint();
  if (!checkpoint) return outcome;
  const recovered = { ...checkpoint, status: 'partial', recoveredFromCheckpoint: true,
    stopReason: checkpoint.requiresUserAction ? 'requires_user_action'
      : outcome.timedOut ? 'budget_exhausted' : 'process_interrupted',
    processDiagnostic: { exitCode: outcome.code, timedOut: Boolean(outcome.timedOut) },
  };
  return { ...outcome, code: 0, stdout: JSON.stringify(recovered) };
}
