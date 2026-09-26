import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { saveRecording, uploadRecording, type PendingRecording } from './recordingQueue';

/**
 * Audio session for recording. `staysActiveInBackground` (plus the "audio" background
 * mode in app.config) keeps recording when the screen locks or you switch apps —
 * without it iOS suspends the recorder mid-conversation.
 */
export async function prepareRecordingAudio() {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: true,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
  });
}

export async function resetAudioMode() {
  await Audio.setAudioModeAsync({ allowsRecordingIOS: false, staysActiveInBackground: false }).catch(() => {});
}

export const RECORDING_OPTIONS: Audio.RecordingOptions = {
  ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
  isMeteringEnabled: true,
};

/**
 * Stop a recording (even one the OS already stopped) and move the audio into the
 * durable outbox. Returns null only if nothing usable was captured.
 */
export async function stopAndSave(
  rec: Audio.Recording,
  meta: { mode: string; durationMs: number; personId?: string | null; startedAt: string },
): Promise<PendingRecording | null> {
  let durationMs = meta.durationMs;
  try {
    const status = await rec.stopAndUnloadAsync();
    if (status?.durationMillis) durationMs = status.durationMillis;
  } catch {
    // Already stopped by an interruption or error — the file is still there
  }
  await resetAudioMode();

  const uri = rec.getURI();
  if (!uri) return null;
  const info = await FileSystem.getInfoAsync(uri).catch(() => null);
  if (!info?.exists || ((info as { size?: number }).size ?? 0) < 1024) return null;

  return saveRecording(uri, {
    mode: meta.mode,
    duration: Math.round(durationMs / 1000),
    personId: meta.personId ?? null,
    recordedAt: meta.startedAt,
  });
}

/** Try to upload right away; on failure the recording stays safely queued. */
export async function uploadNow(item: PendingRecording): Promise<{ noteId?: string; error?: string }> {
  try {
    return { noteId: await uploadRecording(item) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Upload failed' };
  }
}
