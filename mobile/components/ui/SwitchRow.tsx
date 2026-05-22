import React from 'react';
import { View, Text, Switch } from 'react-native';
import { Theme } from '../../lib/theme';
import { Type } from '../../lib/typography';

interface SwitchRowProps {
  t: Theme;
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  subtitle?: string;
}

export function SwitchRow({ t, label, value, onValueChange, subtitle }: SwitchRowProps) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', minHeight: 44,
      paddingHorizontal: 16, paddingVertical: 8,
    }}>
      <View style={{ flex: 1 }}>
        <Text style={{ ...Type.body, color: t.text }}>{label}</Text>
        {subtitle && (
          <Text style={{ ...Type.caption, color: t.textSecondary, marginTop: 2 }}>
            {subtitle}
          </Text>
        )}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: t.fill2, true: t.green }}
        thumbColor="#fff"
      />
    </View>
  );
}
