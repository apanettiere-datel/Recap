import React from 'react';
import { View, Text } from 'react-native';
import { Theme } from '../../lib/theme';
import { Type } from '../../lib/typography';

interface StatCardProps {
  t: Theme;
  value: string | number;
  label: string;
  tone?: 'blue' | 'red' | 'green' | 'orange' | 'purple';
  icon?: React.ReactNode;
}

export function StatCard({ t, value, label, tone = 'blue', icon }: StatCardProps) {
  const map: Record<string, string> = {
    blue: t.blue, red: t.red, green: t.green, orange: t.orange, purple: t.purple,
  };

  return (
    <View style={{
      flex: 1, backgroundColor: t.bgTinted, borderRadius: 12,
      paddingVertical: 10, paddingHorizontal: 8, alignItems: 'center',
    }}>
      {icon && <View style={{ marginBottom: 4 }}>{icon}</View>}
      <Text style={{
        ...Type.title3, color: map[tone] || t.blue, lineHeight: 20,
        fontVariant: ['tabular-nums'],
      }}>{value}</Text>
      <Text style={{
        ...Type.caption2, color: t.textSecondary, marginTop: 4,
        textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '600',
      }}>{label}</Text>
    </View>
  );
}
