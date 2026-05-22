import React from 'react';
import { View, Text } from 'react-native';
import { Theme, ToneColor } from '../../lib/theme';

interface PillProps {
  t: Theme;
  tone?: ToneColor;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
}

export function Pill({ t, tone = 'gray', children, size = 'sm', icon }: PillProps) {
  const map: Record<string, { bg: string; fg: string }> = {
    gray: { bg: t.bgTinted, fg: t.text },
    blue: { bg: t.blueSoft, fg: t.blue },
    red: { bg: t.redSoft, fg: t.red },
    orange: { bg: t.orangeSoft, fg: t.orange },
    green: { bg: t.greenSoft, fg: t.green },
    yellow: { bg: t.yellowSoft, fg: t.yellow },
    purple: { bg: t.purpleSoft, fg: t.purple },
    pink: { bg: t.purpleSoft, fg: t.pink },
  };
  const c = map[tone] || map.gray;
  const pv = size === 'lg' ? 6 : size === 'md' ? 4 : 3;
  const ph = size === 'lg' ? 12 : size === 'md' ? 10 : 9;
  const fs = size === 'lg' ? 13 : 12;

  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 4,
      paddingVertical: pv, paddingHorizontal: ph,
      backgroundColor: c.bg, borderRadius: 999,
    }}>
      {icon}
      <Text style={{
        color: c.fg, fontSize: fs, fontWeight: '600', letterSpacing: -0.08,
      }}>
        {children}
      </Text>
    </View>
  );
}
