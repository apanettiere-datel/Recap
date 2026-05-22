import React from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../lib/useTheme';
import { Type } from '../../lib/typography';
import { useWeeklyReports, useGenerateReport } from '../../hooks/useInsights';
import { NavBar, NavButton } from '../../components/ui/NavBar';
import { StatCard } from '../../components/ui/StatCard';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { Sparkles, ArrowClockwise } from '../../components/icons';
import { WeeklyReport } from '../../lib/types';

function BulletList({ items, color, t }: { items: string[]; color: string; t: any }) {
  return (
    <View style={{ gap: 8 }}>
      {items.map((item, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
          <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color, marginTop: 7 }} />
          <Text style={{ ...Type.subhead, color: t.text, flex: 1 }}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

export default function ReportScreen() {
  const { t } = useTheme();
  const { data: reports, isLoading, refetch, isRefetching } = useWeeklyReports();
  const generateMutation = useGenerateReport();
  const report = reports?.[0];

  if (isLoading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
        <NavBar t={t} title="Report" />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={t.blue} />
        </View>
      </SafeAreaView>
    );
  }

  if (!report) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
        <NavBar t={t} title="Report" />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
          <View style={{ marginBottom: 24 }}>
            <Sparkles size={48} color={t.blue} />
          </View>
          <Text style={{ ...Type.title2, color: t.text, textAlign: 'center', marginBottom: 12 }}>
            Weekly Report
          </Text>
          <Text style={{ ...Type.subhead, color: t.textSecondary, textAlign: 'center', marginBottom: 32 }}>
            Get an AI-written summary of your week — commitments, patterns, and what to focus on.
          </Text>
          <Pressable
            onPress={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            style={({ pressed }) => ({
              height: 50, paddingHorizontal: 32, borderRadius: 12,
              backgroundColor: t.blue, alignItems: 'center', justifyContent: 'center',
              opacity: pressed ? 0.85 : 1,
            })}>
            {generateMutation.isPending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ ...Type.bodyEm, color: '#fff', fontWeight: '600' }}>Generate Report</Text>
            )}
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <NavBar t={t} title="Report" subtitle={`Week of ${new Date(report.weekStarting).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
        trailing={
          <NavButton t={t} onPress={() => generateMutation.mutate()}>
            {generateMutation.isPending ? (
              <ActivityIndicator size="small" color={t.blue} />
            ) : (
              <ArrowClockwise size={20} color={t.blue} />
            )}
          </NavButton>
        }
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={t.blue} />
        }
      >
        {/* Stats row */}
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
          <StatCard t={t} value={report.conversationCount} label="Convos" tone="blue" />
          <StatCard t={t} value={report.uniquePeopleCount} label="People" tone="purple" />
          <StatCard t={t} value={report.commitmentsMade} label="New" tone="green" />
          <StatCard t={t} value={report.commitmentsCompleted} label="Done" tone="green" />
          <StatCard t={t} value={report.commitmentsOverdue} label="Overdue" tone="red" />
        </View>

        {/* Narrative */}
        <SectionHeader t={t}>The Week</SectionHeader>
        <Text style={{ ...Type.body, color: t.text, lineHeight: 24, marginBottom: 20 }}>
          {report.narrative}
        </Text>

        {/* Dropped threads */}
        {report.droppedThreads.length > 0 && (
          <>
            <SectionHeader t={t} color={t.orange}>Dropped Threads</SectionHeader>
            <BulletList items={report.droppedThreads} color={t.orange} t={t} />
            <View style={{ height: 20 }} />
          </>
        )}

        {/* Avoiding */}
        {report.avoidedTopics.length > 0 && (
          <>
            <SectionHeader t={t} color={t.red}>You Might Be Avoiding</SectionHeader>
            <BulletList items={report.avoidedTopics} color={t.red} t={t} />
            <View style={{ height: 20 }} />
          </>
        )}

        {/* Suggested focus */}
        {report.suggestedFocus.length > 0 && (
          <>
            <SectionHeader t={t} color={t.green}>Suggested Focus</SectionHeader>
            <BulletList items={report.suggestedFocus} color={t.green} t={t} />
            <View style={{ height: 20 }} />
          </>
        )}

        {/* Topics */}
        {report.topTopics.length > 0 && (
          <>
            <SectionHeader t={t}>Topics This Week</SectionHeader>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {report.topTopics.map((topic, i) => (
                <View key={i} style={{
                  backgroundColor: t.bgTinted, borderRadius: 999,
                  paddingHorizontal: 12, paddingVertical: 5,
                }}>
                  <Text style={{ ...Type.caption, color: t.text, fontWeight: '600' }}>{topic}</Text>
                </View>
              ))}
            </View>
          </>
        )}

        <Text style={{ ...Type.caption, color: t.textTertiary, marginTop: 32, textAlign: 'center' }}>
          Generated {new Date(report.generatedAt).toLocaleString()}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
