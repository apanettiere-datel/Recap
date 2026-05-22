import React from 'react';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useTheme } from '../lib/useTheme';
import { Type } from '../lib/typography';
import { usePerson } from '../hooks/usePeople';
import { NavBar, NavButton } from '../components/ui/NavBar';
import { SectionHeader } from '../components/ui/SectionHeader';
import { CommitmentRow } from '../components/ui/CommitmentRow';
import { Pill } from '../components/ui/Pill';
import { Avatar } from '../components/ui/Avatar';
import { ChevronLeft } from '../components/icons';

export default function BriefingScreen() {
  const { personId } = useLocalSearchParams<{ personId: string }>();
  const { t } = useTheme();
  const { data: person, isLoading } = usePerson(personId ?? '');

  if (isLoading || !person) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <NavBar t={t} title="" large={false}
          leading={<NavButton t={t} onPress={() => router.back()}><ChevronLeft size={18} color={t.blue} /></NavButton>}
        />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={t.blue} />
        </View>
      </SafeAreaView>
    );
  }

  const sortedNotes = [...person.notes].sort(
    (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime()
  );
  const mostRecentNote = sortedNotes[0] ?? null;
  const openCommitments = person.commitments.filter((c) => c.status !== 'completed');
  const recentQuotes = sortedNotes
    .flatMap((note) => note.quotes ?? [])
    .slice(0, 5);

  // Derive suggested talking points from open commitments and frequent topics
  const talkingPoints: string[] = [];
  if (openCommitments.length > 0) {
    const overdueItems = openCommitments.filter((c) => c.status === 'overdue');
    if (overdueItems.length > 0) {
      talkingPoints.push(`Follow up on ${overdueItems.length} overdue commitment${overdueItems.length > 1 ? 's' : ''}`);
    }
    const theirOpen = openCommitments.filter((c) => c.owner === 'them');
    if (theirOpen.length > 0) {
      talkingPoints.push(`Check in on ${theirOpen.length} item${theirOpen.length > 1 ? 's' : ''} they owe you`);
    }
    const myOpen = openCommitments.filter((c) => c.owner === 'me');
    if (myOpen.length > 0) {
      talkingPoints.push(`Update them on ${myOpen.length} item${myOpen.length > 1 ? 's' : ''} you committed to`);
    }
  }
  for (const topic of person.insights.frequentTopics.slice(0, 3)) {
    talkingPoints.push(`Discuss ${topic}`);
  }

  const lastContactLabel = mostRecentNote
    ? formatRelativeDate(mostRecentNote.recordedAt)
    : 'No conversations yet';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <NavBar t={t} title="" large={false}
        leading={<NavButton t={t} onPress={() => router.back()}><ChevronLeft size={18} color={t.blue} /></NavButton>}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Header */}
        <View style={{ alignItems: 'center', paddingVertical: 20 }}>
          <Avatar t={t} name={person.name} size={64} />
          <Text style={{ ...Type.title2, color: t.text, marginTop: 12 }}>{person.name}</Text>
          <Text style={{ ...Type.subhead, color: t.textSecondary, marginTop: 2 }}>Quick Recap</Text>
        </View>

        {/* Last Contact */}
        <View style={{ paddingHorizontal: 16, marginBottom: 16 }}>
          <View style={{ backgroundColor: t.bgTinted, borderRadius: 12, padding: 14 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ ...Type.subhead, color: t.textSecondary }}>Last Contact</Text>
              <Text style={{ ...Type.subheadEm, color: t.text }}>{lastContactLabel}</Text>
            </View>
            {person.insights.dominantSentiment && (
              <>
                <View style={{ height: 0.33, backgroundColor: t.separator, marginVertical: 10 }} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ ...Type.subhead, color: t.textSecondary }}>Overall Tone</Text>
                  <Text style={{ ...Type.subheadEm, color: t.text }}>{person.insights.dominantSentiment}</Text>
                </View>
              </>
            )}
          </View>
        </View>

        {/* Open Commitments */}
        {openCommitments.length > 0 && (
          <View style={{ paddingHorizontal: 16 }}>
            <SectionHeader t={t}>Open Commitments</SectionHeader>
            {openCommitments.map((c) => (
              <CommitmentRow
                key={c.id}
                t={t}
                text={c.description}
                owner={c.owner}
                done={false}
                overdue={c.status === 'overdue'}
                due={c.dueDate ? new Date(c.dueDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : null}
                compact
              />
            ))}
          </View>
        )}

        {/* Frequent Topics */}
        {person.insights.frequentTopics.length > 0 && (
          <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
            <SectionHeader t={t}>Frequent Topics</SectionHeader>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              {person.insights.frequentTopics.map((topic, i) => (
                <Pill key={i} t={t} tone="blue" size="md">{topic}</Pill>
              ))}
            </View>
          </View>
        )}

        {/* Recent Conversation Summary */}
        {mostRecentNote?.summary && (
          <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
            <SectionHeader t={t}>Recent Conversation Summary</SectionHeader>
            <View style={{ backgroundColor: t.bgTinted, borderRadius: 12, padding: 14, marginBottom: 16 }}>
              <Text style={{ ...Type.subheadEm, color: t.text, marginBottom: 6 }}>{mostRecentNote.title}</Text>
              <Text style={{ ...Type.subhead, color: t.textSecondary, marginBottom: 4 }}>
                {new Date(mostRecentNote.recordedAt).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
              </Text>
              <Text style={{ ...Type.body, color: t.text, lineHeight: 22 }}>{mostRecentNote.summary}</Text>
            </View>
          </View>
        )}

        {/* Key Quotes */}
        {recentQuotes.length > 0 && (
          <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
            <SectionHeader t={t}>Key Quotes</SectionHeader>
            <View style={{ gap: 10, marginBottom: 16 }}>
              {recentQuotes.map((quote, i) => (
                <View key={quote.id ?? i} style={{
                  backgroundColor: t.bgTinted, borderRadius: 12, padding: 14,
                  borderLeftWidth: 3, borderLeftColor: t.blue,
                }}>
                  <Text style={{ ...Type.body, color: t.text, fontStyle: 'italic' }}>
                    "{quote.text}"
                  </Text>
                  <Text style={{ ...Type.caption, color: t.textSecondary, marginTop: 6 }}>
                    -- {quote.speaker}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Suggested Talking Points */}
        {talkingPoints.length > 0 && (
          <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
            <SectionHeader t={t}>Suggested Talking Points</SectionHeader>
            <View style={{ gap: 8, marginBottom: 16 }}>
              {talkingPoints.map((point, i) => (
                <View key={i} style={{
                  flexDirection: 'row', alignItems: 'flex-start', gap: 10,
                  backgroundColor: t.bgTinted, borderRadius: 12, padding: 14,
                }}>
                  <Text style={{ ...Type.body, color: t.blue }}>{'•'}</Text>
                  <Text style={{ ...Type.body, color: t.text, flex: 1 }}>{point}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
