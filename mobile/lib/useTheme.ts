import { useColorScheme } from 'react-native';
import { light, dark, Theme } from './theme';
import { usePreferences } from '../stores/preferences';

export function useTheme(): { t: Theme; isDark: boolean } {
  const systemScheme = useColorScheme();
  const appearance = usePreferences(s => s.appearance);

  const isDark = appearance === 'system'
    ? systemScheme === 'dark'
    : appearance === 'dark';

  return { t: isDark ? dark : light, isDark };
}
