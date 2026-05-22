import React, { useState } from 'react';
import { View, Text, ScrollView, Alert, Share, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { useTheme } from '../../lib/useTheme';
import { Type } from '../../lib/typography';
import { NavBar } from '../../components/ui/NavBar';
import { InsetGroup, InsetRow } from '../../components/ui/InsetGroup';
import { SwitchRow } from '../../components/ui/SwitchRow';
import { useAuthStore } from '../../stores/auth';
import { usePreferences } from '../../stores/preferences';
import { useNotes } from '../../hooks/useNotes';
import { api } from '../../lib/api';
import { PersonCircleFill } from '../../components/icons';

const MODES = [
  { key: 'general', label: 'General' },
  { key: '1-on-1', label: '1-on-1' },
  { key: 'team_meeting', label: 'Team Meeting' },
  { key: 'interview', label: 'Interview' },
  { key: 'brainstorm', label: 'Brainstorm' },
  { key: 'sales_call', label: 'Sales Call' },
];

export default function SettingsScreen() {
  const { t } = useTheme();
  const { email, displayName, clearAuth } = useAuthStore();
  const prefs = usePreferences();
  const { data: notes } = useNotes();
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSignOut = () => {
    Alert.alert('Sign Out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => {
        clearAuth();
        router.replace('/(auth)/signin');
      }},
    ]);
  };

  const handleToggleNotifications = async (enabled: boolean) => {
    if (enabled) {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Enable notifications in your device Settings to receive Recap alerts.');
        return;
      }
    }
    prefs.setNotificationsEnabled(enabled);
  };

  const APPEARANCES = [
    { key: 'system', label: 'System' },
    { key: 'light', label: 'Light' },
    { key: 'dark', label: 'Dark' },
  ] as const;

  const handleAppearance = () => {
    Alert.alert('Appearance', 'Choose your preferred theme.', [
      ...APPEARANCES.map(a => ({
        text: `${a.label}${a.key === prefs.appearance ? ' ✓' : ''}`,
        onPress: () => prefs.setAppearance(a.key),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const appearanceLabel = APPEARANCES.find(a => a.key === prefs.appearance)?.label || 'System';

  const handleRecordingMode = () => {
    Alert.alert('Default Recording Mode', 'Choose the default mode for new recordings.', [
      ...MODES.map(m => ({
        text: `${m.label}${m.key === prefs.defaultRecordingMode ? ' ✓' : ''}`,
        onPress: () => prefs.setDefaultRecordingMode(m.key),
      })),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const handleExport = async () => {
    if (!notes || notes.length === 0) {
      Alert.alert('Nothing to Export', 'Record some conversations first.');
      return;
    }
    setExporting(true);
    try {
      const lines = notes.map(n => {
        const date = new Date(n.recordedAt).toLocaleDateString();
        const people = n.people?.map(p => p.name).join(', ') || 'No one tagged';
        const commitments = n.commitments?.filter(c => c.status === 'open').map(c => `  - ${c.description}`).join('\n') || '  None';
        return `## ${n.title || 'Untitled'} (${date})\nPeople: ${people}\nSentiment: ${n.sentiment || 'N/A'}\n${n.summary || ''}\n\nOpen Commitments:\n${commitments}\n`;
      }).join('\n---\n\n');

      const header = `# Recap Export — ${new Date().toLocaleDateString()}\n${notes.length} conversations\n\n---\n\n`;
      await Share.share({ message: header + lines, title: 'Recap Conversations Export' });
    } catch {
      Alert.alert('Export Failed', 'Could not export conversations.');
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAll = () => {
    Alert.alert(
      'Delete All Data',
      'This will permanently delete all your conversations, commitments, people, and insights. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete Everything', style: 'destructive', onPress: async () => {
          setDeleting(true);
          try {
            await api.delete('/users');
            clearAuth();
            router.replace('/(auth)/signin');
          } catch {
            Alert.alert('Error', 'Could not delete data. Please try again.');
          }
          setDeleting(false);
        }},
      ]
    );
  };

  const modeLabel = MODES.find(m => m.key === prefs.defaultRecordingMode)?.label || 'General';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bgGrouped }} edges={['top']}>
      <NavBar t={t} title="Settings" />
      <ScrollView contentContainerStyle={{ paddingBottom: 100 }}>
        {/* Profile */}
        <View style={{ alignItems: 'center', paddingVertical: 20 }}>
          <PersonCircleFill size={64} color={t.blue} />
          <Text style={{ ...Type.title3, color: t.text, marginTop: 12 }}>
            {displayName || 'User'}
          </Text>
          <Text style={{ ...Type.subhead, color: t.textSecondary, marginTop: 2 }}>
            {email}
          </Text>
        </View>

        {/* Appearance */}
        <InsetGroup t={t} header="Appearance">
          <InsetRow t={t} label="Theme" value={appearanceLabel} chevron onPress={handleAppearance} isLast />
        </InsetGroup>

        {/* Notifications */}
        <InsetGroup t={t} header="Notifications">
          <SwitchRow t={t} label="Enable Notifications" value={prefs.notificationsEnabled} onValueChange={handleToggleNotifications} />
          {prefs.notificationsEnabled && (
            <>
              <View style={{ height: 0.33, backgroundColor: t.separator, marginLeft: 16 }} />
              <SwitchRow t={t} label="Processing Complete" subtitle="When a recording finishes analyzing" value={prefs.notifyOnProcessingDone} onValueChange={prefs.setNotifyOnProcessingDone} />
              <View style={{ height: 0.33, backgroundColor: t.separator, marginLeft: 16 }} />
              <SwitchRow t={t} label="Daily Briefing" subtitle="Morning summary of your day" value={prefs.notifyDailyBriefing} onValueChange={prefs.setNotifyDailyBriefing} />
              <View style={{ height: 0.33, backgroundColor: t.separator, marginLeft: 16 }} />
              <SwitchRow t={t} label="Overdue Commitments" subtitle="Reminders for missed deadlines" value={prefs.notifyOverdueCommitments} onValueChange={prefs.setNotifyOverdueCommitments} />
            </>
          )}
        </InsetGroup>

        {/* Recording */}
        <InsetGroup t={t} header="Recording">
          <InsetRow t={t} label="Default Mode" value={modeLabel} chevron onPress={handleRecordingMode} isLast />
        </InsetGroup>

        {/* Data */}
        <InsetGroup t={t} header="Data">
          <InsetRow t={t} label="Export Conversations" chevron onPress={handleExport} />
          {exporting && <ActivityIndicator style={{ padding: 8 }} color={t.blue} />}
          <InsetRow t={t} label="Delete All Data" danger onPress={handleDeleteAll} isLast />
          {deleting && <ActivityIndicator style={{ padding: 8 }} color={t.red} />}
        </InsetGroup>

        <InsetGroup t={t}>
          <InsetRow t={t} label="Sign Out" danger onPress={handleSignOut} isLast />
        </InsetGroup>

        <Text style={{ ...Type.caption, color: t.textTertiary, textAlign: 'center', marginTop: 24 }}>
          Recap v1.0.0
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
