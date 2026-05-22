import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Theme, ToneColor } from '../../lib/theme';
import { Type } from '../../lib/typography';

interface AvatarProps {
  t: Theme;
  name: string;
  tone?: ToneColor;
  size?: number;
}

export function Avatar({ t, name, tone = 'blue', size = 44 }: AvatarProps) {
  const colorMap: Record<string, string> = {
    blue: t.blue, purple: t.purple, orange: t.orange,
    green: t.green, pink: t.pink, red: t.red,
  };
  const bgMap: Record<string, string> = {
    blue: t.blueSoft, purple: t.purpleSoft, orange: t.orangeSoft,
    green: t.greenSoft, pink: t.purpleSoft, red: t.redSoft,
  };

  return (
    <View style={[styles.container, {
      width: size, height: size, borderRadius: size / 2,
      backgroundColor: bgMap[tone] || t.blueSoft,
    }]}>
      <Text style={{
        color: colorMap[tone] || t.blue,
        fontSize: size * 0.42,
        fontWeight: '600',
      }}>
        {name?.[0]?.toUpperCase() || '?'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
