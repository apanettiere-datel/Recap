import React, { useRef } from 'react';
import { View, Text, Pressable, ActivityIndicator, Animated } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { Theme } from '../../lib/theme';
import { Type } from '../../lib/typography';
import { Pill } from '../ui/Pill';
import { ArrowRightCircleFill, PinFill, Trash } from '../icons';
import { Note } from '../../lib/types';

interface NoteCardProps {
  t: Theme;
  note: Note;
  onPress: () => void;
  onDelete?: () => void;
  isPinned?: boolean;
}

export function NoteCard({ t, note, onPress, onDelete, isPinned: isPinnedProp }: NoteCardProps) {
  const isPinned = isPinnedProp ?? note.isPinned;
  const isArchived = note.isArchived;
  const swipeRef = useRef<Swipeable>(null);
  const openCommitments = note.commitments?.filter(c => c.status !== 'completed').length || 0;
  const peopleNames = note.people?.map(p => p.name) || [];
  const date = new Date(note.recordedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const isProcessing = note.isProcessing;
  const title = note.title || (isProcessing ? 'Processing...' : 'Untitled');
  const summary = note.summary || (isProcessing ? 'Transcribing and analyzing your conversation...' : note.processingError ? `Error: ${note.processingError}` : '');

  const renderRightActions = (_progress: Animated.AnimatedInterpolation<number>, dragX: Animated.AnimatedInterpolation<number>) => {
    const scale = dragX.interpolate({ inputRange: [-80, 0], outputRange: [1, 0.5], extrapolate: 'clamp' });
    return (
      <Pressable
        onPress={() => { swipeRef.current?.close(); onDelete?.(); }}
        style={{
          backgroundColor: t.red, borderRadius: 16, marginBottom: 10,
          alignItems: 'center', justifyContent: 'center', width: 80,
        }}>
        <Animated.View style={{ transform: [{ scale }] }}>
          <Trash size={22} color="#fff" />
        </Animated.View>
      </Pressable>
    );
  };

  const card = (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: t.bgCard,
        borderRadius: 16,
        padding: 14,
        paddingHorizontal: 16,
        marginBottom: 10,
        opacity: pressed ? 0.7 : isArchived ? 0.5 : 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
        elevation: 2,
      })}>
      {isPinned && (
        <View style={{ position: 'absolute', top: 14, right: 14 }}>
          <PinFill size={11} color={t.textTertiary} />
        </View>
      )}
      <View style={{
        flexDirection: 'row', alignItems: 'baseline',
        justifyContent: 'space-between', gap: 8,
        paddingRight: isPinned ? 16 : 0,
      }}>
        {isProcessing ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
            <ActivityIndicator size="small" color={t.blue} />
            <Text style={{ ...Type.headline, color: t.textSecondary, flex: 1 }} numberOfLines={1}>
              {title}
            </Text>
          </View>
        ) : (
          <Text style={{ ...Type.headline, color: t.text, flex: 1 }} numberOfLines={1}>
            {title}
          </Text>
        )}
        <Text style={{ ...Type.caption, color: t.textSecondary, flexShrink: 0 }}>
          {date}
        </Text>
      </View>
      <Text style={{ ...Type.subhead, color: t.textSecondary, marginTop: 4 }} numberOfLines={2}>
        {summary}
      </Text>
      {openCommitments > 0 && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
          <ArrowRightCircleFill size={16} color={t.blue} />
          <Text style={{ ...Type.caption, color: t.blue, fontWeight: '600' }}>
            {openCommitments} commitment{openCommitments === 1 ? '' : 's'}
          </Text>
        </View>
      )}
      {peopleNames.length > 0 && (
        <View style={{ flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          {peopleNames.map((name, i) => (
            <Pill key={i} t={t} tone="gray" size="sm">{name}</Pill>
          ))}
        </View>
      )}
    </Pressable>
  );

  if (!onDelete) return card;

  return (
    <Swipeable ref={swipeRef} renderRightActions={renderRightActions} overshootRight={false}>
      {card}
    </Swipeable>
  );
}
