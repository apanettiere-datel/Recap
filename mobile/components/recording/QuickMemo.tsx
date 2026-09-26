import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, Pressable, Alert, Platform, Animated, Dimensions } from 'react-native';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../../lib/useTheme';
import { Type } from '../../lib/typography';
import { useQueryClient } from '@tanstack/react-query';
import { StopFill } from '../icons';
import { prepareRecordingAudio, RECORDING_OPTIONS, stopAndSave, uploadNow, resetAudioMode } from '../../lib/recorder';

interface QuickMemoProps {
  visible: boolean;
  onClose: () => void;
}

const fmt = (n: number) =>
  `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

export function QuickMemo({ visible, onClose }: QuickMemoProps) {
  const { t } = useTheme();
  const queryClient = useQueryClient();
  const recRef = useRef<Audio.Recording | null>(null);
  const startedAtRef = useRef(new Date().toISOString());

  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  const secondsRef = useRef(0);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

  // Slide-up animation when visible changes
  useEffect(() => {
    if (visible) {
      Animated.spring(slideAnim, {
        toValue: 1,
        useNativeDriver: true,
        damping: 20,
        stiffness: 200,
      }).start();
    } else {
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);

  // Pulsing red dot animation
  useEffect(() => {
    if (visible && recording) {
      pulseLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.3,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ]),
      );
      pulseLoop.current.start();
    } else {
      pulseLoop.current?.stop();
      pulseAnim.setValue(1);
    }

    return () => {
      pulseLoop.current?.stop();
    };
  }, [visible, recording]);

  const startRecording = useCallback(async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Alert.alert('Permission Required', 'Microphone access is needed to record voice memos.');
        onClose();
        return;
      }

      await prepareRecordingAudio();

      const { recording: rec } = await Audio.Recording.createAsync(RECORDING_OPTIONS);
      recRef.current = rec;
      startedAtRef.current = new Date().toISOString();
      setRecording(rec);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      secondsRef.current = 0;
      setSeconds(0);
      timer.current = setInterval(() => {
        secondsRef.current += 1;
        setSeconds(secondsRef.current);
      }, 1000);
    } catch (err) {
      console.error('QuickMemo: failed to start recording:', err);
      Alert.alert('Error', 'Could not start recording.');
      onClose();
    }
  }, [onClose]);

  /** Save the memo to the phone first, then upload; audio is never thrown away here. */
  const stopAndUpload = useCallback(async () => {
    const rec = recRef.current;
    if (!rec) return;
    recRef.current = null;
    setIsUploading(true);
    clearInterval(timer.current);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});

    const item = await stopAndSave(rec, {
      mode: 'voice_memo',
      durationMs: secondsRef.current * 1000,
      startedAt: startedAtRef.current,
    }).catch(() => null);
    setRecording(null);

    if (item) {
      const result = await uploadNow(item);
      queryClient.invalidateQueries({ queryKey: ['notes'] });
      if (result.error) {
        Alert.alert('Saved on your phone', "Your memo couldn't be uploaded yet. Recap will keep retrying automatically.");
      }
    }
    cleanup();
    onClose();
  }, [onClose, queryClient]);

  const cleanup = useCallback(() => {
    clearInterval(timer.current);
    secondsRef.current = 0;
    setSeconds(0);
    setRecording(null);
    setIsUploading(false);
  }, []);

  // Auto-start recording when overlay becomes visible
  useEffect(() => {
    if (visible) {
      startRecording();
    } else {
      // Dismissed externally: keep what was recorded
      if (recRef.current) {
        const rec = recRef.current;
        recRef.current = null;
        stopAndSave(rec, { mode: 'voice_memo', durationMs: secondsRef.current * 1000, startedAt: startedAtRef.current })
          .then((item) => item && uploadNow(item))
          .finally(() => queryClient.invalidateQueries({ queryKey: ['notes'] }));
      }
      cleanup();
    }
  }, [visible]);

  if (!visible) return null;

  const translateY = slideAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [300, 0],
  });

  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        zIndex: 100,
        justifyContent: 'flex-end',
      }}
    >
      {/* Backdrop */}
      <Pressable
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.4)',
        }}
        onPress={() => {
          // A stray tap outside shouldn't lose a memo: save anything longer than 2s
          if (recRef.current && secondsRef.current >= 2) {
            stopAndUpload();
            return;
          }
          if (recRef.current) {
            recRef.current.stopAndUnloadAsync().catch(() => {});
            recRef.current = null;
            resetAudioMode();
          }
          cleanup();
          onClose();
        }}
      />

      {/* Overlay panel */}
      <Animated.View
        style={{
          transform: [{ translateY }],
          backgroundColor: t.bgElevated,
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          paddingTop: 20,
          paddingBottom: Platform.OS === 'ios' ? 50 : 32,
          paddingHorizontal: 24,
          alignItems: 'center',
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.2,
          shadowRadius: 16,
          elevation: 16,
        }}
      >
        {/* Drag handle */}
        <View
          style={{
            width: 36,
            height: 5,
            borderRadius: 2.5,
            backgroundColor: t.fill1,
            marginBottom: 20,
          }}
        />

        {/* Label */}
        <Text style={{ ...Type.caption, color: t.textSecondary, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16 }}>
          Quick Voice Memo
        </Text>

        {/* Red pulsing dot + timer */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <Animated.View
            style={{
              width: 12,
              height: 12,
              borderRadius: 6,
              backgroundColor: t.red,
              opacity: pulseAnim,
            }}
          />
          <Text
            style={{
              fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
              fontSize: 40,
              fontWeight: '200',
              color: t.text,
              letterSpacing: 2,
              fontVariant: ['tabular-nums'],
            }}
          >
            {fmt(seconds)}
          </Text>
        </View>

        {/* Status text */}
        <Text style={{ ...Type.caption, color: t.textTertiary, marginBottom: 24 }}>
          {isUploading ? 'Saving...' : 'Recording'}
        </Text>

        {/* Stop & Save button */}
        <Pressable
          onPress={stopAndUpload}
          disabled={isUploading || !recording}
          style={({ pressed }) => ({
            width: 64,
            height: 64,
            borderRadius: 32,
            backgroundColor: t.red,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.7 : isUploading ? 0.5 : 1,
            shadowColor: t.red,
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.3,
            shadowRadius: 8,
            elevation: 6,
          })}
        >
          <StopFill size={28} color="#fff" />
        </Pressable>

        <Text style={{ ...Type.footnote, color: t.textSecondary, marginTop: 12 }}>
          Stop & Save
        </Text>
      </Animated.View>
    </View>
  );
}
