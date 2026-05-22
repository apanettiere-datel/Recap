import React from 'react';
import { Pressable, ViewStyle } from 'react-native';
import { Theme } from '../../lib/theme';

interface CardProps {
  t: Theme;
  children: React.ReactNode;
  tone?: 'red' | 'orange' | 'blue' | 'green' | 'gray';
  onPress?: () => void;
  style?: ViewStyle;
}

export function Card({ t, children, tone, onPress, style }: CardProps) {
  const bg = tone === 'red' ? t.redTintBg
    : tone === 'orange' ? t.orangeTintBg
    : tone === 'blue' ? t.blueTintBg
    : tone === 'green' ? t.greenTintBg
    : tone === 'gray' ? t.bgTinted
    : t.bgCard;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [{
        backgroundColor: bg,
        borderRadius: 14,
        padding: 14,
        opacity: pressed && onPress ? 0.7 : 1,
      }, style]}>
      {children}
    </Pressable>
  );
}
