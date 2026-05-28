import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, Pressable, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../lib/useTheme';
import { Type } from '../lib/typography';
import { useRecordingStore } from '../stores/recording';
import { usePreferences } from '../stores/preferences';
import { useUploadNote } from '../hooks/useNotes';
import { MicFill, StopFill, Xmark } from '../components/icons';

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

export default function RecordingScreen() {
  const { t } = useTheme();
  const { state, seconds, mode, setState, setSeconds, setMode, setUri, reset } = useRecordingStore();
  const defaultMode = usePreferences(s => s.defaultRecordingMode);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [meterLevels, setMeterLevels] = useState<number[]>(Array(NUM_BARS).fill(0));
  const uploadNote = useUploadNote();
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  const meterTimer = useRef<ReturnType<typeof setInterval>>(undefined);
  const levelsRef = useRef<number[]>(Array(NUM_BARS).fill(0));

  const startMetering = useCallback((rec: Audio.Recording) => {
    meterTimer.current = setInterval(async () => {
      try {
        const status = await rec.getStatusAsync();
        if (status.isRecording && status.metering !== undefined) {
          const db = status.metering;
          const normalized = Math.min(1, Math.max(0, (db + 60) / 60));
          const newLevels = [...levelsRef.current.slice(1), normalized];
          levelsRef.current = newLevels;
          setMeterLevels(newLevels);
        }
      } catch {}
    }, 100);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission Required', 'Microphone access is needed to record conversations.');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording: rec } = await Audio.Recording.createAsync({
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      });
      setRecording(rec);
      setState('recording');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      startMetering(rec);
      timer.current = setInterval(() => setSeconds(useRecordingStore.getState().seconds + 1), 1000);
    } catch (err) {
      console.error('Failed to start recording:', err);
      Alert.alert('Error', 'Could not start recording.');
    }
  }, []);

  const stopRecording = useCallback(async () => {
    if (!recording) return;
    setState('processing');
    clearInterval(timer.current);
    clearInterval(meterTimer.current);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    try {
      await recording.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = recording.getURI();
      setUri(uri);
      setRecording(null);

      if (uri) {
        const formData = new FormData();
        formData.append('audio', {
          uri,
          name: 'recording.m4a',
          type: 'audio/m4a',
        } as any);
        formData.append('mode', mode);
        formData.append('duration', String(seconds));
        await uploadNote.mutateAsync(formData);
      }

      reset();
      router.back();
    } catch (err) {
      console.error('Failed to stop recording:', err);
      setState('idle');
    }
  }, [recording, mode]);

  useEffect(() => {
    setMode(defaultMode);
    startRecording();
    return () => {
      clearInterval(timer.current);
      clearInterval(meterTimer.current);
      if (recording) {
        recording.stopAndUnloadAsync().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    if (seconds >= MAX_RECORDING_SECONDS && state === 'recording') {
      Alert.alert('Recording Limit', 'Maximum recording length (2 hours) reached. Your recording is being saved and processed.');
      stopRecording();
    }
  }, [seconds, state, stopRecording]);

  const handleCancel = async () => {
    clearInterval(timer.current);
    if (recording) {
      await recording.stopAndUnloadAsync().catch(() => {});
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
    }
    reset();
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <SafeAreaView style={{ flex: 1 }}>
        {/* Consent banner */}
        {state === 'recording' && (
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

        {/* Center content */}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <WaveformBars levels={meterLevels} />
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
            {state === 'recording' ? 'Recording · tap to stop' : state === 'processing' ? 'Processing...' : 'Tap to record'}
          </Text>
        </View>

        {/* Bottom controls */}
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
          paddingHorizontal: 28, paddingBottom: 40,
        }}>
          <Pressable onPress={handleCancel} style={{ padding: 8 }}>
            <Text style={{ ...Type.body, color: 'rgba(255,255,255,0.7)' }}>Cancel</Text>
          </Pressable>

          <Pressable
            onPress={state === 'recording' ? stopRecording : startRecording}
            disabled={state === 'processing'}
            style={({ pressed }) => ({
              width: 80, height: 80, borderRadius: 40,
              backgroundColor: state === 'recording' ? 'rgba(255,255,255,0.15)' : t.red,
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 4, borderColor: 'rgba(255,255,255,0.3)',
              opacity: pressed ? 0.7 : 1,
            })}>
            {state === 'recording' ? (
              <StopFill size={32} color="#fff" />
            ) : (
              <MicFill size={32} color="#fff" />
            )}
          </Pressable>

          <View style={{ width: 60 }} />
        </View>
      </SafeAreaView>
    </View>
  );
}
