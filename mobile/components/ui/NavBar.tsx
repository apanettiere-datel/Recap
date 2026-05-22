import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Theme } from '../../lib/theme';
import { Type } from '../../lib/typography';

interface NavBarProps {
  t: Theme;
  title: string;
  trailing?: React.ReactNode;
  leading?: React.ReactNode;
  large?: boolean;
  subtitle?: string;
}

export function NavBar({ t, title, trailing, leading, large = true, subtitle }: NavBarProps) {
  return (
    <View style={{ paddingHorizontal: large ? 16 : 8, paddingTop: large ? 8 : 6, paddingBottom: large ? 8 : 6 }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center',
        justifyContent: 'space-between', minHeight: 44,
        paddingHorizontal: large ? 4 : 0,
      }}>
        <View style={{ minWidth: 32 }}>{leading}</View>
        {!large && (
          <Text style={{ ...Type.headline, color: t.text, flex: 1, textAlign: 'center' }}>
            {title}
          </Text>
        )}
        <View style={{ minWidth: 32 }}>{trailing}</View>
      </View>
      {large && (
        <View style={{ paddingHorizontal: 4, paddingTop: 4 }}>
          <Text style={{ ...Type.largeTitle, color: t.text }}>{title}</Text>
          {subtitle && (
            <Text style={{ ...Type.subhead, color: t.textSecondary, marginTop: 2 }}>
              {subtitle}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

interface NavButtonProps {
  t: Theme;
  children: React.ReactNode;
  onPress?: () => void;
  color?: string;
}

export function NavButton({ t, children, onPress, color }: NavButtonProps) {
  return (
    <Pressable onPress={onPress} hitSlop={8} style={{ padding: 6 }}>
      {children}
    </Pressable>
  );
}
