import React, { useState } from 'react';
import { View, Text, TextInput, FlatList, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTheme } from '../lib/useTheme';
import { Type } from '../lib/typography';
import { useSearchNotes } from '../hooks/useNotes';
import { NavButton } from '../components/ui/NavBar';
import { MagnifyingGlass, Xmark, XmarkCircleFill, Search } from '../components/icons';
import { Note } from '../lib/types';

export default function SearchScreen() {
  const { t } = useTheme();
  const [query, setQuery] = useState('');
  const { data: results, isLoading } = useSearchNotes(query);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      {/* Search bar */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 10,
        paddingHorizontal: 16, paddingVertical: 8,
      }}>
        <View style={{
          flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8,
          backgroundColor: t.bgTinted, borderRadius: 12, paddingHorizontal: 12, height: 40,
        }}>
          <MagnifyingGlass size={16} color={t.textTertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search conversations..."
            placeholderTextColor={t.textTertiary}
            autoFocus
            style={{ flex: 1, color: t.text, ...Type.body, height: 40 }}
          />
          {query.length > 0 && (
            <Pressable onPress={() => setQuery('')}>
              <XmarkCircleFill size={18} color={t.textTertiary} />
            </Pressable>
          )}
        </View>
        <Pressable onPress={() => router.back()}>
          <Text style={{ ...Type.body, color: t.blue }}>Cancel</Text>
        </Pressable>
      </View>

      {/* Results */}
      {query.length < 2 ? (
        <View style={{ flex: 1, alignItems: 'center', paddingTop: 80 }}>
          <Search size={40} color={t.textTertiary} />
          <Text style={{ ...Type.title3, color: t.textSecondary, marginBottom: 8, marginTop: 16 }}>
            Search conversations
          </Text>
          <Text style={{ ...Type.subhead, color: t.textTertiary, textAlign: 'center', maxWidth: 260 }}>
            Search across all your conversations by keyword or topic.
          </Text>
        </View>
      ) : (
        <FlatList
          data={results?.notes || []}
          keyExtractor={(item: Note) => item.id}
          contentContainerStyle={{ paddingHorizontal: 16 }}
          ListHeaderComponent={
            results?.notes?.length ? (
              <Text style={{ ...Type.footnote, color: t.textSecondary, paddingVertical: 8, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                Conversations
              </Text>
            ) : null
          }
          renderItem={({ item }: { item: Note }) => (
            <Pressable
              onPress={() => router.push(`/note/${item.id}`)}
              style={({ pressed }) => ({
                paddingVertical: 12, opacity: pressed ? 0.6 : 1,
                borderBottomWidth: 0.33, borderBottomColor: t.separator,
              })}>
              <Text style={{ ...Type.headline, color: t.text }}>{item.title}</Text>
              <Text style={{ ...Type.subhead, color: t.textSecondary, marginTop: 4 }} numberOfLines={2}>
                {item.summary}
              </Text>
            </Pressable>
          )}
          ListEmptyComponent={
            !isLoading ? (
              <View style={{ alignItems: 'center', paddingTop: 80 }}>
                <MagnifyingGlass size={40} color={t.textTertiary} />
                <Text style={{ ...Type.title3, color: t.textSecondary, marginBottom: 8, marginTop: 16 }}>
                  No results
                </Text>
                <Text style={{ ...Type.subhead, color: t.textTertiary, textAlign: 'center', maxWidth: 260 }}>
                  No conversations match "{query}". Try a different search term.
                </Text>
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}
