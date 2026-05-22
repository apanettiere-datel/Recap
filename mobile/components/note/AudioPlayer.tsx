import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Pressable, Text, Platform } from 'react-native';
import { Audio } from 'expo-av';
import { Theme } from '../../lib/theme';
import { Type } from '../../lib/typography';
import { PlayFill, PauseFill } from '../icons';
import { useAuthStore } from '../../stores/auth';

const BASE_URL = __DEV__ ? 'http://localhost:3000/api' : 'https://api.recap.app/api';

interface AudioPlayerProps {
  t: Theme;
  noteId: string;
  duration: number; // total duration in seconds
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

export function AudioPlayer({ t, noteId, duration }: AudioPlayerProps) {
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [durationMs, setDurationMs] = useState(duration * 1000);
  const barWidth = useRef(0);

  const progress = durationMs > 0 ? positionMs / durationMs : 0;

  useEffect(() => {
    return () => {
      if (sound) {
        sound.unloadAsync();
      }
    };
  }, [sound]);

  const loadAndPlay = useCallback(async () => {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
      });

      const token = useAuthStore.getState().token;
      const audioUrl = `${BASE_URL}/notes/${noteId}/audio`;

      const { sound: newSound } = await Audio.Sound.createAsync(
        { uri: audioUrl, headers: { Authorization: `Bearer ${token}` } },
        { shouldPlay: true }
      );

      newSound.setOnPlaybackStatusUpdate((status) => {
        if (!status.isLoaded) return;
        setPositionMs(status.positionMillis);
        if (status.durationMillis) {
          setDurationMs(status.durationMillis);
        }
        setIsPlaying(status.isPlaying);
        if (status.didJustFinish) {
          setIsPlaying(false);
          setPositionMs(0);
        }
      });

      setSound(newSound);
      setIsPlaying(true);
    } catch (err) {
      console.error('AudioPlayer: failed to load sound', err);
    }
  }, [noteId]);

  const togglePlayPause = useCallback(async () => {
    if (!sound) {
      await loadAndPlay();
      return;
    }

    const status = await sound.getStatusAsync();
    if (!status.isLoaded) return;

    if (status.isPlaying) {
      await sound.pauseAsync();
    } else {
      if (status.didJustFinish || status.positionMillis >= (status.durationMillis ?? 0)) {
        await sound.setPositionAsync(0);
      }
      await sound.playAsync();
    }
  }, [sound, loadAndPlay]);

  const handleSeek = useCallback(
    async (locationX: number) => {
      if (barWidth.current <= 0 || durationMs <= 0) return;
      const fraction = Math.max(0, Math.min(1, locationX / barWidth.current));
      const seekMs = fraction * durationMs;

      if (sound) {
        await sound.setPositionAsync(seekMs);
      } else {
        setPositionMs(seekMs);
      }
    },
    [sound, durationMs],
  );

  const mono = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

  return (
    <View
      style={{
        backgroundColor: t.bgElevated,
        borderRadius: 12,
        padding: 14,
        gap: 10,
      }}
    >
      {/* Controls row */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Pressable
          onPress={togglePlayPause}
          hitSlop={8}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: t.blue,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {isPlaying ? (
            <PauseFill size={16} color="#fff" />
          ) : (
            <PlayFill size={16} color="#fff" />
          )}
        </Pressable>

        <Text style={{ ...Type.caption, color: t.textSecondary, fontFamily: mono }}>
          {formatTime(positionMs / 1000)}
        </Text>

        {/* Progress bar */}
        <View
          style={{ flex: 1, height: 24, justifyContent: 'center' }}
          onLayout={(e) => {
            barWidth.current = e.nativeEvent.layout.width;
          }}
          onStartShouldSetResponder={() => true}
          onResponderRelease={(e) => {
            handleSeek(e.nativeEvent.locationX);
          }}
        >
          <View
            style={{
              height: 4,
              borderRadius: 2,
              backgroundColor: `${t.textTertiary}`,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                height: 4,
                borderRadius: 2,
                backgroundColor: t.blue,
                width: `${Math.min(progress * 100, 100)}%`,
              }}
            />
          </View>
        </View>

        <Text style={{ ...Type.caption, color: t.textSecondary, fontFamily: mono }}>
          {formatTime(durationMs / 1000)}
        </Text>
      </View>
    </View>
  );
}
