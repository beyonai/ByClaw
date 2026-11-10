import Recorder from 'recorder-core';

export function getMicrophoneAudioContext(): AudioContext | undefined {
  try {
    return Recorder.GetContext?.() || undefined;
  } catch {
    return undefined;
  }
}

export function prepareMicrophoneAudioContext() {
  const context = getMicrophoneAudioContext();
  if (context?.state === 'suspended') void context.resume().catch(() => undefined);
}

export async function openMicrophone(signal: AbortSignal, onEnded: () => void) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone unavailable');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const tracks = stream.getTracks();
  if (signal.aborted) {
    tracks.forEach((track) => track.stop());
    return;
  }
  tracks.forEach((track) => track.addEventListener('ended', onEnded, { once: true, signal }));
  return stream;
}

export function microphoneErrorId(error: unknown) {
  const name = (error as Error | undefined)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'voice.microphoneDenied';
  if (name === 'NotFoundError') return 'voice.microphoneMissing';
  if (name === 'NotReadableError' || name === 'AbortError') return 'voice.microphoneBusy';
  return 'voice.microphoneUnavailable';
}
