import React from 'react';
import { View, Text, Pressable, ViewStyle } from 'react-native';
import { Theme } from '../../lib/theme';
import { Type } from '../../lib/typography';
import { ChevronRight } from '../icons';

interface InsetGroupProps {
  t: Theme;
  children: React.ReactNode;
  header?: string;
  footer?: string;
  style?: ViewStyle;
}

export function InsetGroup({ t, children, header, footer, style }: InsetGroupProps) {
  return (
    <View style={[{ marginVertical: 12 }, style]}>
      {header && (
        <Text style={{
          ...Type.footnote, color: t.textSecondary,
          paddingHorizontal: 16, paddingBottom: 6,
          textTransform: 'uppercase', fontSize: 12,
          letterSpacing: 0.4, fontWeight: '500',
        }}>{header}</Text>
      )}
      <View style={{
        marginHorizontal: 16, backgroundColor: t.bgCard,
        borderRadius: 12, overflow: 'hidden',
      }}>
        {children}
      </View>
      {footer && (
        <Text style={{
          ...Type.footnote, color: t.textSecondary,
          paddingHorizontal: 16, paddingTop: 8,
        }}>{footer}</Text>
      )}
    </View>
  );
}

interface InsetRowProps {
  t: Theme;
  label: string;
  value?: string;
  onPress?: () => void;
  color?: string;
  isLast?: boolean;
  danger?: boolean;
  chevron?: boolean;
}

export function InsetRow({ t, label, value, onPress, color, isLast, danger, chevron }: InsetRowProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', minHeight: 44,
        paddingHorizontal: 16, opacity: pressed ? 0.6 : 1,
        borderBottomWidth: isLast ? 0 : 0.33,
        borderBottomColor: t.separator,
      })}>
      <Text style={{ ...Type.body, color: danger ? t.red : color || t.text, flex: 1 }}>
        {label}
      </Text>
      {value && <Text style={{ ...Type.body, color: t.textSecondary }}>{value}</Text>}
      {chevron && <ChevronRight size={14} color={t.textTertiary} />}
    </Pressable>
  );
}
