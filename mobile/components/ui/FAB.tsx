import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Theme } from '../../lib/theme';
import { MicFill } from '../icons';

interface FABProps {
  t: Theme;
  onPress: () => void;
  onLongPress?: () => void;
}

export function FAB({ t, onPress, onLongPress }: FABProps) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
      style={({ pressed }) => [styles.fab, {
        backgroundColor: t.red,
        opacity: pressed ? 0.85 : 1,
        transform: [{ scale: pressed ? 0.95 : 1 }],
      }]}>
      <MicFill size={26} color="#fff" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 110,
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
    shadowColor: '#ff3b30',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.32,
    shadowRadius: 12,
    elevation: 8,
  },
});
