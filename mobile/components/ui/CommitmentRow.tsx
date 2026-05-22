import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Theme } from '../../lib/theme';
import { Type } from '../../lib/typography';
import { Pill } from './Pill';
import { CheckmarkCircleFill, CircleIcon, CalendarBadgeCheck, CalendarBadgePlus } from '../icons';

interface CommitmentRowProps {
  t: Theme;
  text: string;
  owner: 'me' | 'them';
  done: boolean;
  overdue?: boolean;
  due?: string | null;
  personName?: string | null;
  addedToCalendar?: boolean;
  onToggleDone?: () => void;
  onAddCal?: () => void;
  onEdit?: () => void;
  compact?: boolean;
}

export function CommitmentRow({
  t, text, owner, done, overdue, due, personName,
  addedToCalendar, onToggleDone, onAddCal, onEdit, compact,
}: CommitmentRowProps) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'flex-start', gap: 12,
      paddingVertical: compact ? 10 : 12, paddingHorizontal: 4,
    }}>
      <Pressable onPress={onToggleDone} hitSlop={8} style={{ marginTop: 1 }}>
        {done
          ? <CheckmarkCircleFill size={22} color={t.green} />
          : <CircleIcon size={22} color={t.textTertiary} />
        }
      </Pressable>
      <Pressable onLongPress={onEdit} style={{ flex: 1 }}>
        <Text style={{
          ...Type.subheadEm, color: t.text,
          textDecorationLine: done ? 'line-through' : 'none',
          textDecorationColor: t.textTertiary,
          opacity: done ? 0.55 : 1,
        }}>{text}</Text>
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
          <Pill t={t} tone={owner === 'me' ? 'blue' : 'orange'} size="sm">
            {owner === 'me' ? 'You' : 'Them'}
          </Pill>
          {personName && <Pill t={t} tone="purple" size="sm">{personName}</Pill>}
          {due && (
            <Text style={{
              ...Type.caption,
              color: overdue ? t.red : t.textSecondary,
              fontWeight: overdue ? '600' : '500',
            }}>
              {overdue ? 'Overdue · ' : ''}{due}
            </Text>
          )}
        </View>
      </Pressable>
      {onAddCal && (
        <Pressable onPress={onAddCal} hitSlop={8} style={{ padding: 8, marginTop: -4 }}>
          {addedToCalendar
            ? <CalendarBadgeCheck size={24} color={t.green} />
            : <CalendarBadgePlus size={24} color={t.blue} />
          }
        </Pressable>
      )}
    </View>
  );
}
