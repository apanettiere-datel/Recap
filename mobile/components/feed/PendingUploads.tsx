import React from 'react';
import { View, Text, Pressable, Alert, ActivityIndicator } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Type } from '../../lib/typography';
import { useRecordingQueue, processQueue, removeRecording } from '../../lib/recordingQueue';

/** Recordings saved on the phone that haven't reached the server yet. */
export function PendingUploads({ t }: { t: any }) {
  const items = useRecordingQueue((s) => s.items);
  const uploading = useRecordingQueue((s) => s.uploading);
  const queryClient = useQueryClient();
  if (items.length === 0) return null;

  const retry = () => {
    processQueue().finally(() => queryClient.invalidateQueries({ queryKey: ['notes'] }));
  };

  const confirmDelete = () => {
    Alert.alert(
      'Delete unsent recordings?',
      `${items.length} recording${items.length === 1 ? '' : 's'} will be permanently deleted from this phone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => items.forEach((i) => removeRecording(i.id)) },
      ],
    );
  };

  const lastError = items.find((i) => i.lastError)?.lastError;

  return (
    <View style={{
      marginBottom: 12, padding: 14, borderRadius: 16,
      backgroundColor: 'rgba(255,159,10,0.12)', borderWidth: 1, borderColor: 'rgba(255,159,10,0.3)',
    }}>
      <Text style={{ ...Type.headline, color: t.text }}>
        {items.length} recording{items.length === 1 ? '' : 's'} waiting to upload
      </Text>
      <Text style={{ ...Type.caption, color: t.textSecondary, marginTop: 4 }}>
        Safely saved on this phone. Recap retries automatically when you open the app.
        {lastError ? ` Last error: ${lastError}` : ''}
      </Text>
      <View style={{ flexDirection: 'row', gap: 16, marginTop: 10, alignItems: 'center' }}>
        {uploading ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <ActivityIndicator size="small" color="#ff9f0a" />
            <Text style={{ ...Type.subhead, color: '#ff9f0a' }}>Uploading…</Text>
          </View>
        ) : (
          <Pressable onPress={retry} hitSlop={8}>
            <Text style={{ ...Type.subhead, color: '#ff9f0a', fontWeight: '600' }}>Upload now</Text>
          </Pressable>
        )}
        <Pressable onPress={confirmDelete} hitSlop={8} disabled={!!uploading}>
          <Text style={{ ...Type.subhead, color: t.textTertiary }}>Delete</Text>
        </Pressable>
      </View>
    </View>
  );
}
