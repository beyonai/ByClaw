type Playback = {
  key: string;
  owners: number;
  controller: AbortController;
  run: (signal: AbortSignal) => Promise<void>;
};
const consumed = new Set<string>();
const pending: Playback[] = [];
let current: Playback | undefined;
let epoch = 0;

export const getVoicePlaybackEpoch = () => epoch;

export function skipVoicePlayback(key: string) {
  consumed.add(key);
  if (consumed.size > 2000) consumed.delete(consumed.values().next().value!);
}

function drain() {
  if (current) return;
  const next = pending.shift();
  if (!next) return;
  skipVoicePlayback(next.key);
  if (!next.owners) {
    drain();
    return;
  }
  current = next;
  void next
    .run(next.controller.signal)
    .catch(() => undefined)
    .finally(() => {
      if (current === next) current = undefined;
      drain();
    });
}

/** Shared by all visible bubbles. Cancelled and completed segments cannot replay. */
export function enqueueVoicePlayback(key: string, run: Playback['run'], expectedEpoch = epoch) {
  if (expectedEpoch !== epoch) {
    skipVoicePlayback(key);
    return () => {};
  }
  let item = current?.key === key ? current : pending.find((entry) => entry.key === key);
  if (!item) {
    if (consumed.has(key)) return () => {};
    item = { key, run, owners: 0, controller: new AbortController() };
    pending.push(item);
  }
  const entry = item;
  entry.owners += 1;
  void Promise.resolve().then(drain);
  return () => {
    entry.owners -= 1;
    // React StrictMode immediately re-registers the same effect; real navigation does not.
    void Promise.resolve().then(() => {
      if (entry.owners) return;
      skipVoicePlayback(key);
      const index = pending.indexOf(entry);
      if (index >= 0) pending.splice(index, 1);
      entry.controller.abort();
    });
  };
}

export function cancelVoicePlayback() {
  epoch += 1;
  pending.splice(0).forEach((item) => {
    skipVoicePlayback(item.key);
    item.controller.abort();
  });
  current?.controller.abort();
}
