import React from 'react';
import { View, Text } from 'react-native';
import { Theme } from '../../lib/theme';
import { Type } from '../../lib/typography';

interface SectionHeaderProps {
  t: Theme;
  children: React.ReactNode;
  action?: React.ReactNode;
  color?: string;
}

export function SectionHeader({ t, children, action, color }: SectionHeaderProps) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 6, paddingHorizontal: 4,
      paddingBottom: 8,
    }}>
      <Text style={{ ...Type.headline, color: color || t.text }}>
        {children}
      </Text>
      {action}
    </View>
  );
}
