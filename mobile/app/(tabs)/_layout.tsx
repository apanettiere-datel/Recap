import React from 'react';
import { Tabs } from 'expo-router';
import { Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../../lib/useTheme';
import { ListBullet, PersonTwo, Lightbulb, ChartBar, Gear } from '../../components/icons';

export default function TabLayout() {
  const { t, isDark } = useTheme();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.blue,
        tabBarInactiveTintColor: t.textSecondary,
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
        tabBarStyle: {
          backgroundColor: Platform.OS === 'ios' ? 'transparent' : (isDark ? '#161618' : '#f9f9f9'),
          borderTopWidth: 0.33,
          borderTopColor: t.tabBarBorder,
          paddingBottom: Platform.OS === 'ios' ? 22 : 8,
          paddingTop: 6,
          position: 'absolute',
        },
        tabBarBackground: () =>
          Platform.OS === 'ios' ? (
            <BlurView
              intensity={80}
              tint={isDark ? 'dark' : 'light'}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
            />
          ) : null,
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Feed',
          tabBarIcon: ({ color, focused }) => <ListBullet size={26} color={color} filled={focused} />,
        }}
      />
      <Tabs.Screen
        name="people"
        options={{
          title: 'People',
          tabBarIcon: ({ color, focused }) => <PersonTwo size={26} color={color} filled={focused} />,
        }}
      />
      <Tabs.Screen
        name="insights"
        options={{
          title: 'Insights',
          tabBarIcon: ({ color, focused }) => <Lightbulb size={26} color={color} filled={focused} />,
        }}
      />
      <Tabs.Screen
        name="report"
        options={{
          title: 'Report',
          tabBarIcon: ({ color, focused }) => <ChartBar size={26} color={color} filled={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => <Gear size={26} color={color} filled={focused} />,
        }}
      />
    </Tabs>
  );
}
