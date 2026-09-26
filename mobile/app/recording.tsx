import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, Pressable, Alert, Platform, AppState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../lib/useTheme';
import { Type } from '../lib/typography';
import { useRecordingStore } from '../stores/recording';
import { usePreferences } from '../stores/preferences';
import { MicFill, StopFill } from '../components/icons';
import { prepareRecordingAudio, RECORDING_OPTIONS, stopAndSave, uploadNow, resetAudioMode } from '../lib/recorder';
import { processQueue } from '../lib/recordingQueue';

const MAX_RECORDING_SECONDS = 2 * 60 * 60; // 2 hours

const fmt = (n: number) => {
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

const NUM_BARS = 7;

function WaveformBars({ levels }: { levels: number[] }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 120 }}>
      {levels.map((level, i) => {
        const h = Math.max(4, level * 110);
        return (
          <View
            key={i}
            style={{
              width: 4,
              height: h,
              borderRadius: 2,
              backgroundColor: `rgba(255,255,255,${0.4 + level * 0.5})`,
            }}
          />
        );
      })}
    </View>
  );
}

type Phase = 'starting' | 'recording' | 'paused' | 'saving' | 'uploading' | 'error';

export default function RecordingScreen() {
  const { t } = useTheme();
  const params = useLocalSearchParams<{ personId?: string }>();
  const queryClient = useQueryClient();
  const { mode, setMode, setState, reset } = useRecordingStore();
  const defaultMode = usePreferences(s => s.defaultRecordingMode);

  const [phase, setPhase] = useState<Phase>('starting');
  const [seconds, setSeconds] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [meterLevels, setMeterLevels] = useState<number[]>(Array(NUM_BARS).fill(0));

  const recRef = useRef<Audio.Recording | null>(null);
  const phaseRef = useRef<Phase>('starting');
  const finishingRef = useRef(false);
  const userPausedRef = useRef(false);
  const durationMsRef = useRef(0);
  const startedAtRef = useRef(new Date().toISOString());
  const modeRef = useRef(mode);
  const levelsRef = useRef<number[]>(Array(NUM_BARS).fill(0));

  const go = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
    setState(p === 'recording' ? 'recording' : p === 'paused' ? 'paused' : p === 'starting' ? 'idle' : 'processing');
  };

  /** Stop, save to the phone, then try to upload. Audio is never discarded here. */
  const finish = useCallback(async (reason?: string) => {
    const rec = recRef.current;
    if (!rec || finishingRef.current) return;
    finishingRef.current = true;
    recRef.current = null;
    if (reason) setNotice(reason);
    go('saving');
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});

    const item = await stopAndSave(rec, {
      mode: modeRef.current,
      durationMs: durationMsRef.current,
      personId: params.personId ?? null,
      startedAt: startedAtRef.current,
    }).catch(() => null);

    if (!item) {
      go('error');
      Alert.alert('Nothing was recorded', 'No audio was captured. Check that Recap has microphone access and try again.', [
        { text: 'OK', onPress: () => { reset(); router.back(); } },
      ]);
      return;
    }

    go('uploading');
    const result = await uploadNow(item);
    queryClient.invalidateQueries({ queryKey: ['notes'] });
    reset();
    if (result.noteId) {
      router.replace(`/note/${result.noteId}`);
    } else {
      Alert.alert(
        'Saved on your phone',
        "Your recording is safe on this device but couldn't be uploaded yet. Recap will keep retrying automatically — you can also retry from the home screen.",
        [{ text: 'OK', onPress: () => router.back() }],
      );
    }
  }, [params.personId, queryClient, reset]);

  const onStatus = useCallback((status: Audio.RecordingStatus) => {
    if (status.durationMillis) durationMsRef.current = status.durationMillis;
    setSeconds(Math.floor((status.durationMillis || 0) / 1000));

    if (status.isRecording && status.metering !== undefined) {
      const normalized = Math.min(1, Math.max(0, (status.metering + 60) / 60));
      const next = [...levelsRef.current.slice(1), normalized];
      levelsRef.current = next;
      setMeterLevels(next);
    }

    // The OS stopped the recorder (e.g. input device lost): save what we have
    if ((status.isDoneRecording || (status as { mediaServicesDidReset?: boolean }).mediaServicesDidReset) && !finishingRef.current) {
      finish('Recording was interrupted by your phone, so it was stopped and saved.');
      return;
    }
    if ((status.durationMillis || 0) >= MAX_RECORDING_SECONDS * 1000 && !finishingRef.current) {
      finish('You reached the 2-hour limit, so the recording was stopped and saved.');
    }
  }, [finish]);

  const start = useCallback(async () => {
    go('starting');
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        go('error');
        Alert.alert('Microphone access needed', 'Allow microphone access for Recap in Settings to record conversations.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
        return;
      }
      await prepareRecordingAudio();
      const { recording } = await Audio.Recording.createAsync(RECORDING_OPTIONS, onStatus, 250);
      recRef.current = recording;
      startedAtRef.current = new Date().toISOString();
      finishingRef.current = false;
      go('recording');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    } catch (err) {
      console.error('Failed to start recording:', err);
      await resetAudioMode();
      go('error');
      Alert.alert("Couldn't start recording", 'Another app may be using the microphone. Close it and try again.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    }
  }, [onStatus]);

  const pause = async () => {
    const rec = recRef.current;
    if (!rec) return;
    try {
      await rec.pauseAsync();
      userPausedRef.current = true;
      go('paused');
    } catch {
      // ignore
    }
  };

  const resume = async () => {
    const rec = recRef.current;
    if (!rec) return;
    try {
      await rec.startAsync();
      userPausedRef.current = false;
      setNotice(null);
      go('recording');
    } catch {
      finish('The recording could not be resumed, so it was saved.');
    }
  };

  const cancel = () => {
    if (!recRef.current || seconds < 3) {
      discard();
      return;
    }
    Alert.alert('Discard recording?', 'This recording will be deleted and cannot be recovered.', [
      { text: 'Keep recording', style: 'cancel' },
      { text: 'Save it', onPress: () => finish() },
      { text: 'Discard', style: 'destructive', onPress: discard },
    ]);
  };

  const discard = async () => {
    const rec = recRef.current;
    recRef.current = null;
    finishingRef.current = true;
    if (rec) {
      await rec.stopAndUnloadAsync().catch(() => {});
      const uri = rec.getURI();
      if (uri) {
        const FileSystem = await import('expo-file-system/legacy');
        FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
      }
    }
    await resetAudioMode();
    reset();
    router.back();
  };

  useEffect(() => {
    setMode(defaultMode);
    modeRef.current = defaultMode;
    start();

    // Returning to the app: if a phone call or another app paused the recorder, resume it
    const sub = AppState.addEventListener('change', async (state) => {
      const rec = recRef.current;
      if (state !== 'active' || !rec || finishingRef.current || userPausedRef.current) return;
      try {
        const status = await rec.getStatusAsync();
        if (!status.isRecording && !status.isDoneRecording && status.canRecord) {
          await rec.startAsync();
          setNotice('Recording was paused by your phone and has resumed.');
          go('recording');
        }
      } catch {
        finish('Recording was interrupted, so it was stopped and saved.');
      }
    });

    return () => {
      sub.remove();
      // Screen dismissed mid-recording (e.g. swiped away): save instead of losing it
      const rec = recRef.current;
      if (rec && !finishingRef.current) {
        finishingRef.current = true;
        recRef.current = null;
        stopAndSave(rec, {
          mode: modeRef.current,
          durationMs: durationMsRef.current,
          personId: params.personId ?? null,
          startedAt: startedAtRef.current,
        })
          .then(() => processQueue())
          .then(() => queryClient.invalidateQueries({ queryKey: ['notes'] }))
          .catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const recording = phase === 'recording';
  const busy = phase === 'saving' || phase === 'uploading';
  const statusText =
    phase === 'starting' ? 'Starting…'
    : phase === 'recording' ? 'Recording · keeps going if your screen locks'
    : phase === 'paused' ? 'Paused'
    : phase === 'saving' ? 'Saving to your phone…'
    : phase === 'uploading' ? 'Saved on your phone · uploading…'
    : '';

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <SafeAreaView style={{ flex: 1 }}>
        {(recording || phase === 'paused') && (
          <View style={{
            marginHorizontal: 16, marginTop: 8, padding: 12,
            backgroundColor: 'rgba(255,149,0,0.15)', borderRadius: 12,
            flexDirection: 'row', alignItems: 'center', gap: 10,
          }}>
            <Text style={{ fontSize: 16 }}>🔴</Text>
            <Text style={{ ...Type.caption, color: '#ff9f0a', flex: 1 }}>
              Recording in progress. Make sure everyone in the conversation knows.
            </Text>
          </View>
        )}

        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <WaveformBars levels={phase === 'paused' ? Array(NUM_BARS).fill(0) : meterLevels} />
          <Text style={{
            fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
            fontSize: 56, fontWeight: '200', color: '#fff',
            letterSpacing: 2, marginTop: 56,
            fontVariant: ['tabular-nums'],
          }}>
            {fmt(seconds)}
          </Text>
          <Text style={{ ...Type.caption, color: 'rgba(255,255,255,0.35)', marginTop: 12, textAlign: 'center', textTransform: 'uppercase', letterSpacing: 1 }}>
            {mode.replace('_', ' ')}
          </Text>
          <Text style={{ ...Type.caption, color: 'rgba(255,255,255,0.5)', marginTop: 8, textAlign: 'center' }}>
            {statusText}
          </Text>
          {notice && (
            <Text style={{ ...Type.caption, color: '#ff9f0a', marginTop: 12, textAlign: 'center' }}>{notice}</Text>
          )}
        </View>

        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 28, paddingBottom: 40,
        }}>
          <Pressable onPress={cancel} disabled={busy} style={{ padding: 8, width: 72, opacity: busy ? 0.3 : 1 }}>
            <Text style={{ ...Type.body, color: 'rgba(255,255,255,0.7)' }}>Cancel</Text>
          </Pressable>

          <Pressable
            onPress={() => finish()}
            disabled={busy || phase === 'starting' || phase === 'error'}
            accessibilityLabel="Stop and save"
            style={({ pressed }) => ({
              width: 80, height: 80, borderRadius: 40,
              backgroundColor: recording || phase === 'paused' ? 'rgba(255,255,255,0.15)' : t.red,
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 4, borderColor: 'rgba(255,255,255,0.3)',
              opacity: pressed || busy ? 0.6 : 1,
            })}>
            {recording || phase === 'paused' ? <StopFill size={32} color="#fff" /> : <MicFill size={32} color="#fff" />}
          </Pressable>

          <Pressable
            onPress={phase === 'paused' ? resume : pause}
            disabled={!(recording || phase === 'paused')}
            style={{ padding: 8, width: 72, alignItems: 'flex-end', opacity: recording || phase === 'paused' ? 1 : 0.3 }}
          >
            <Text style={{ ...Type.body, color: 'rgba(255,255,255,0.7)' }}>{phase === 'paused' ? 'Resume' : 'Pause'}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}
