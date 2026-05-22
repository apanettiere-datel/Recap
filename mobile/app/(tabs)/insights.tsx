import React from 'react';
import { View, Text, FlatList, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../lib/useTheme';
import { Type } from '../../lib/typography';
import { useInsights, useRefreshInsights, useDismissInsight } from '../../hooks/useInsights';
import { NavBar, NavButton } from '../../components/ui/NavBar';
import { Card } from '../../components/ui/Card';
import { ArrowClockwise, Xmark, ExclamationTriangle, Target, Sparkles, Lightbulb } from '../../components/icons';
import { Insight } from '../../lib/types';

function iconForType(type: string, color: string) {
  switch (type) {
    case 'overdue_commitment': return <ExclamationTriangle size={18} color={color} />;
    case 'recurring_topic': return <ArrowClockwise size={18} color={color} />;
    case 'avoidance_pattern': return <Target size={18} color={color} />;
    default: return <Sparkles size={18} color={color} />;
  }
}

function toneForPriority(priority: string): 'red' | 'orange' | 'blue' | undefined {
  switch (priority) {
    case 'urgent': case 'high': return 'red';
    case 'medium': return 'orange';
    default: return undefined;
  }
}

export default function InsightsScreen() {
  const { t } = useTheme();
  const { data: insights, isLoading, refetch, isRefetching } = useInsights();
  const refreshMutation = useRefreshInsights();
  const dismissMutation = useDismissInsight();

  const handleRefresh = async () => {
    await refreshMutation.mutateAsync();
    refetch();
  };

  const renderInsight = ({ item }: { item: Insight }) => {
    const tone = toneForPriority(item.priority);
    const color = tone === 'red' ? t.red : tone === 'orange' ? t.orange : t.blue;

    return (
      <Card t={t} tone={tone} style={{ marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ flexDirection: 'row', gap: 10, flex: 1 }}>
            {iconForType(item.type, color)}
            <View style={{ flex: 1 }}>
              <Text style={{ ...Type.subheadEm, color: t.text }}>{item.title}</Text>
              <Text style={{ ...Type.subhead, color: t.textSecondary, marginTop: 4 }}>
                {item.body}
              </Text>
              {item.relatedPersonName && (
                <Text style={{ ...Type.caption, color, fontWeight: '600', marginTop: 6 }}>
                  {item.relatedPersonName}
                </Text>
              )}
            </View>
          </View>
          <Pressable
            onPress={() => dismissMutation.mutate(item.id)}
            hitSlop={8}
            style={{ padding: 4 }}>
            <Xmark size={14} color={t.textTertiary} />
          </Pressable>
        </View>
      </Card>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <NavBar
        t={t}
        title="Insights"
        trailing={
          <NavButton t={t} onPress={handleRefresh}>
            <ArrowClockwise size={20} color={t.blue} />
          </NavButton>
        }
      />
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={t.blue} />
        </View>
      ) : (
        <FlatList
          data={insights || []}
          keyExtractor={(item) => item.id}
          renderItem={renderInsight}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 100 }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={t.blue} />
          }
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 80 }}>
              <Lightbulb size={40} color={t.textTertiary} />
              <Text style={{ ...Type.title3, color: t.textSecondary, marginBottom: 8, marginTop: 16 }}>
                No insights yet
              </Text>
              <Text style={{ ...Type.subhead, color: t.textTertiary, textAlign: 'center', maxWidth: 260 }}>
                Record a few conversations and insights will be generated automatically.
              </Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}
