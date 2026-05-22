import { View, Text } from 'react-native';
import { router } from 'expo-router';
import { useTheme } from '../lib/useTheme';
import { Type } from '../lib/typography';

export default function NotFoundScreen() {
  const { t } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ ...Type.title2, color: t.text }}>Not Found</Text>
    </View>
  );
}
