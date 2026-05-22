import React, { useState, useRef, useMemo } from 'react';
import { View, Text, TextInput, FlatList, Pressable, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTheme } from '../lib/useTheme';
import { Type } from '../lib/typography';
import { useChat } from '../hooks/useInsights';
import { usePeople } from '../hooks/usePeople';
import { NavBar, NavButton } from '../components/ui/NavBar';
import { Xmark, ArrowUpCircleFill, Sparkles } from '../components/icons';
import { ChatMessage } from '../lib/types';

const GENERIC_EXAMPLES = [
  'What commitments do I have this week?',
  'What topics keep coming up in my conversations?',
  'Do I have any overdue commitments?',
  'Summarize my most recent conversation',
];

export default function ChatScreen() {
  const { t, isDark } = useTheme();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const chatMutation = useChat();
  const { data: peopleList } = usePeople();
  const listRef = useRef<FlatList>(null);

  const examples = useMemo(() => {
    if (!peopleList || peopleList.length === 0) return GENERIC_EXAMPLES;
    const names = peopleList.slice(0, 3).map(p => p.name);
    const personalized: string[] = [
      'What commitments do I have this week?',
    ];
    if (names[0]) personalized.push(`Summarize my conversations with ${names[0]}`);
    if (names[1]) personalized.push(`What topics come up with ${names[1]}?`);
    else personalized.push('What topics keep coming up in my conversations?');
    if (names[2]) personalized.push(`When did I last talk to ${names[2]}?`);
    else personalized.push('Summarize my most recent conversation');
    return personalized;
  }, [peopleList]);

  const send = async (text: string) => {
    if (!text.trim()) return;
    const userMsg: ChatMessage = { from: 'user', text: text.trim() };
    setMessages((m) => [...m, userMsg]);
    setInput('');

    try {
      const res = await chatMutation.mutateAsync(text.trim());
      const aiMsg: ChatMessage = { from: 'ai', text: res.reply };
      setMessages((m) => [...m, aiMsg]);
    } catch {
      setMessages((m) => [...m, { from: 'ai', text: 'Sorry, something went wrong. Try again.' }]);
    }
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => {
    const isUser = item.from === 'user';
    return (
      <View style={{
        alignSelf: isUser ? 'flex-end' : 'flex-start',
        maxWidth: '80%',
        marginBottom: 12,
        backgroundColor: isUser ? t.blue : t.bgTinted,
        borderRadius: 18,
        borderBottomRightRadius: isUser ? 4 : 18,
        borderBottomLeftRadius: isUser ? 18 : 4,
        paddingHorizontal: 16,
        paddingVertical: 10,
      }}>
        <Text style={{ ...Type.body, color: isUser ? '#fff' : t.text, lineHeight: 22 }}>
          {item.text}
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <NavBar t={t} title="Ask Recap" large={false}
        leading={
          <NavButton t={t} onPress={() => router.back()}>
            <Xmark size={16} color={t.textSecondary} />
          </NavButton>
        }
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}>
        {messages.length === 0 ? (
          <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 24 }}>
            <View style={{ alignItems: 'center', marginBottom: 32 }}>
              <Sparkles size={36} color={t.blue} />
              <Text style={{ ...Type.title3, color: t.text, marginTop: 12 }}>Ask anything about your conversations</Text>
            </View>
            <View style={{ gap: 10 }}>
              {examples.map((ex, i) => (
                <Pressable
                  key={i}
                  onPress={() => send(ex)}
                  style={({ pressed }) => ({
                    backgroundColor: t.bgTinted, borderRadius: 12,
                    padding: 14, opacity: pressed ? 0.7 : 1,
                  })}>
                  <Text style={{ ...Type.subhead, color: t.blue }}>{ex}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(_, i) => i.toString()}
            renderItem={renderMessage}
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, paddingTop: 8 }}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          />
        )}

        {/* Input bar */}
        <View style={{
          flexDirection: 'row', alignItems: 'flex-end', gap: 8,
          paddingHorizontal: 16, paddingVertical: 12,
          borderTopWidth: 0.33, borderTopColor: t.separator,
        }}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Ask about your conversations..."
            placeholderTextColor={t.textTertiary}
            multiline
            style={{
              flex: 1, maxHeight: 120, minHeight: 40,
              backgroundColor: t.bgTinted, borderRadius: 20,
              paddingHorizontal: 16, paddingVertical: 10,
              color: t.text, ...Type.body,
            }}
          />
          <Pressable
            onPress={() => send(input)}
            disabled={!input.trim() || chatMutation.isPending}
            hitSlop={12}
            style={{ opacity: input.trim() ? 1 : 0.3, padding: 4 }}>
            <ArrowUpCircleFill size={36} color={t.blue} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
