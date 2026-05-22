import React from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTheme } from '../lib/useTheme';
import { Type } from '../lib/typography';
import { useCommitments } from '../hooks/useCommitments';
import { NavBar, NavButton } from '../components/ui/NavBar';
import { SectionHeader } from '../components/ui/SectionHeader';
import { CommitmentRow } from '../components/ui/CommitmentRow';
import { useUpdateCommitment } from '../hooks/useCommitments';
import { ChevronLeft } from '../components/icons';
import { addToCalendar } from '../lib/calendar';

export default function DailyBriefingScreen() {
  const { t } = useTheme();
  const { data: openCommitments, isLoading } = useCommitments('open');
  const { data: overdueCommitments } = useCommitments('overdue');
  const updateCommitment = useUpdateCommitment();

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <NavBar t={t} title="" large={false}
        leading={<NavButton t={t} onPress={() => router.back()}><ChevronLeft size={18} color={t.blue} /></NavButton>}
      />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
        <Text style={{ ...Type.largeTitle, color: t.text, marginBottom: 4 }}>Today</Text>
        <Text style={{ ...Type.subhead, color: t.textSecondary, marginBottom: 24 }}>{today}</Text>

        {isLoading ? (
          <ActivityIndicator size="large" color={t.blue} style={{ marginTop: 40 }} />
        ) : (
          <>
            {/* Overdue */}
            {overdueCommitments && overdueCommitments.length > 0 && (
              <>
                <SectionHeader t={t} color={t.red}>Overdue</SectionHeader>
                {overdueCommitments.map((c) => (
                  <CommitmentRow
                    key={c.id}
                    t={t}
                    text={c.description}
                    owner={c.owner}
                    done={false}
                    overdue
                    due={c.dueDate ? new Date(c.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : undefined}
                    personName={c.person?.name}
                    addedToCalendar={c.addedToCalendar}
                    onToggleDone={() => updateCommitment.mutate({ id: c.id, status: 'completed' })}
                    onAddCal={c.dueDate ? async () => {
                      const success = await addToCalendar(c.description, new Date(c.dueDate!));
                      if (success) {
                        updateCommitment.mutate({ id: c.id, addedToCalendar: true });
                      }
                    } : undefined}
                    compact
                  />
                ))}
              </>
            )}

            {/* Open commitments */}
            {openCommitments && openCommitments.length > 0 && (
              <>
                <SectionHeader t={t}>Open Commitments</SectionHeader>
                {openCommitments.map((c) => (
                  <CommitmentRow
                    key={c.id}
                    t={t}
                    text={c.description}
                    owner={c.owner}
                    done={false}
                    due={c.dueDate ? new Date(c.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : undefined}
                    personName={c.person?.name}
                    addedToCalendar={c.addedToCalendar}
                    onToggleDone={() => updateCommitment.mutate({ id: c.id, status: 'completed' })}
                    onAddCal={c.dueDate ? async () => {
                      const success = await addToCalendar(c.description, new Date(c.dueDate!));
                      if (success) {
                        updateCommitment.mutate({ id: c.id, addedToCalendar: true });
                      }
                    } : undefined}
                    compact
                  />
                ))}
              </>
            )}

            {(!openCommitments || openCommitments.length === 0) && (!overdueCommitments || overdueCommitments.length === 0) && (
              <View style={{ alignItems: 'center', paddingTop: 40 }}>
                <Text style={{ ...Type.title3, color: t.textSecondary }}>All clear!</Text>
                <Text style={{ ...Type.subhead, color: t.textTertiary, marginTop: 8, textAlign: 'center' }}>
                  No commitments due today. Enjoy your day.
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
