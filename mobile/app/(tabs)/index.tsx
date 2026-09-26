import React, { useState } from 'react';
import { View, Text, FlatList, Pressable, RefreshControl, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTheme } from '../../lib/useTheme';
import { Type } from '../../lib/typography';
import { useNotes, useDeleteNote } from '../../hooks/useNotes';
import { NoteCard } from '../../components/feed/NoteCard';
import { PendingUploads } from '../../components/feed/PendingUploads';
import { FAB } from '../../components/ui/FAB';
import { QuickMemo } from '../../components/recording/QuickMemo';
import { Bell, BubbleLeftFill, Search as SearchIcon } from '../../components/icons';
import { Note } from '../../lib/types';

export default function FeedScreen() {
  const { t, isDark } = useTheme();
  const [quickMemoVisible, setQuickMemoVisible] = useState(false);
  const { data: notes, isLoading, refetch, isRefetching } = useNotes();
  const deleteNote = useDeleteNote();

  const sortedNotes = [...(notes || [])]
    .filter(n => !n.isArchived)
    .sort((a, b) => {
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      return 0;
    });

  const handleDelete = (note: Note) => {
    Alert.alert('Delete Conversation', `Delete "${note.title || 'this conversation'}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => deleteNote.mutate(note.id),
      },
    ]);
  };

  const renderNote = ({ item }: { item: Note }) => (
    <NoteCard
      t={t}
      note={item}
      isPinned={item.isPinned}
      onPress={() => router.push(`/note/${item.id}`)}
      onDelete={() => handleDelete(item)}
    />
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 36 }}>
          <View style={{ width: 32 }} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable onPress={() => router.push('/search')} hitSlop={8} style={{ padding: 6 }}>
              <SearchIcon size={22} color={t.blue} />
            </Pressable>
            <Pressable onPress={() => router.push('/daily-briefing')} hitSlop={8} style={{ padding: 6, position: 'relative' }}>
              <Bell size={22} color={t.blue} />
              <View style={{
                position: 'absolute', top: 4, right: 4,
                width: 8, height: 8, borderRadius: 4,
                backgroundColor: t.red, borderWidth: 2, borderColor: t.bg,
              }} />
            </Pressable>
          </View>
        </View>
        <View style={{ paddingHorizontal: 4, paddingVertical: 4, paddingBottom: 8 }}>
          <Text style={{ ...Type.largeTitle, color: t.text }}>Recap</Text>
        </View>
      </View>

      {/* Notes list */}
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={t.blue} />
        </View>
      ) : (
        <FlatList
          data={sortedNotes}
          keyExtractor={(item) => item.id}
          renderItem={renderNote}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 130 }}
          ListHeaderComponent={<PendingUploads t={t} />}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={t.blue}
            />
          }
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 80 }}>
              <Text style={{ ...Type.title3, color: t.textSecondary, marginBottom: 8 }}>
                No conversations yet
              </Text>
              <Text style={{ ...Type.subhead, color: t.textTertiary, textAlign: 'center', maxWidth: 260 }}>
                Tap the red mic button to record your first conversation.
              </Text>
            </View>
          }
        />
      )}

      {/* AI Chat FAB */}
      <Pressable
        onPress={() => router.push('/chat')}
        style={({ pressed }) => ({
          position: 'absolute', right: 26, bottom: 184,
          width: 50, height: 50, borderRadius: 25,
          backgroundColor: t.blue, alignItems: 'center', justifyContent: 'center',
          zIndex: 20, opacity: pressed ? 0.85 : 1,
          shadowColor: t.blue, shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.3, shadowRadius: 8, elevation: 6,
        })}>
        <BubbleLeftFill size={22} color="#fff" filled />
      </Pressable>

      {/* Record FAB */}
      <FAB t={t} onPress={() => router.push('/recording')} onLongPress={() => setQuickMemoVisible(true)} />

      {/* Quick voice memo overlay */}
      <QuickMemo visible={quickMemoVisible} onClose={() => setQuickMemoVisible(false)} />
    </SafeAreaView>
  );
}
