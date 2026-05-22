import React, { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Notifications from 'expo-notifications';
import { useAuthStore } from '../stores/auth';
import { useTheme } from '../lib/useTheme';
import { useCommitmentReminders } from '../hooks/useCommitmentReminders';
import '../lib/notifications';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 2 },
  },
});

function AppContent() {
  const { isDark } = useTheme();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  useCommitmentReminders();

  useEffect(() => {
    useAuthStore.getState().setLoading(false);
  }, []);

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data;
      if (data?.noteId) {
        router.push(`/note/${data.noteId}`);
      } else {
        router.push('/daily-briefing');
      }
    });
    return () => subscription.remove();
  }, []);

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        {!isAuthenticated ? (
          <Stack.Screen name="(auth)" />
        ) : (
          <>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="recording" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="note/[id]" options={{ presentation: 'card' }} />
            <Stack.Screen name="person/[id]" options={{ presentation: 'card' }} />
            <Stack.Screen name="chat" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
            <Stack.Screen name="search" options={{ presentation: 'fullScreenModal', animation: 'fade' }} />
            <Stack.Screen name="daily-briefing" options={{ presentation: 'card' }} />
            <Stack.Screen name="briefing" options={{ presentation: 'card' }} />
            <Stack.Screen name="onboarding" options={{ presentation: 'fullScreenModal' }} />
          </>
        )}
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <AppContent />
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
