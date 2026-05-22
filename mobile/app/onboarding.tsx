import React, { useState, useRef } from 'react';
import { View, Text, Pressable, FlatList, Dimensions, Switch, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Audio } from 'expo-av';
import * as Notifications from 'expo-notifications';
import { useTheme } from '../lib/useTheme';
import { Type } from '../lib/typography';
import { useUIStore } from '../stores/ui';
import { WaveformCircleFill, MicFill, Sparkles, Bell } from '../components/icons';

const { width } = Dimensions.get('window');

const PAGES = [
  {
    id: 'record',
    title: 'Capture any conversation',
    sub: 'Tap record before meetings, calls, or coffee chats. Recap handles the rest.',
  },
  {
    id: 'understand',
    title: 'AI breaks it down instantly',
    sub: 'Every conversation becomes a searchable, structured note — with commitments, people, and topics extracted automatically.',
  },
  {
    id: 'remember',
    title: 'Never drop a promise again',
    sub: 'Recap tracks what you owe, what others owe you, and nudges you when things slip.',
  },
  {
    id: 'permissions',
    title: "Let's get you set up",
    sub: '',
  },
];

export default function OnboardingScreen() {
  const { t } = useTheme();
  const [page, setPage] = useState(0);
  const [micGranted, setMicGranted] = useState(false);
  const [notifGranted, setNotifGranted] = useState(false);
  const listRef = useRef<FlatList>(null);
  const setOnboardingComplete = useUIStore((s) => s.setOnboardingComplete);

  const goNext = () => {
    if (page < PAGES.length - 1) {
      const next = page + 1;
      setPage(next);
      listRef.current?.scrollToIndex({ index: next, animated: true });
    } else {
      setOnboardingComplete();
      router.replace('/(tabs)');
    }
  };

  const requestMic = async () => {
    const { granted } = await Audio.requestPermissionsAsync();
    setMicGranted(granted);
    if (!granted) Alert.alert('Microphone access is needed to record conversations.');
  };

  const requestNotif = async () => {
    const { status } = await Notifications.requestPermissionsAsync();
    setNotifGranted(status === 'granted');
  };

  const renderPage = ({ item, index }: { item: typeof PAGES[0]; index: number }) => {
    const isPermissions = item.id === 'permissions';

    return (
      <View style={{ width, paddingHorizontal: 32, justifyContent: 'center', flex: 1 }}>
        {!isPermissions && (
          <View style={{ alignItems: 'center', marginBottom: 32 }}>
            {index === 0 && <MicFill size={72} color={t.red} />}
            {index === 1 && <Sparkles size={72} color={t.blue} />}
            {index === 2 && <Bell size={72} color={t.green} />}
          </View>
        )}
        <Text style={{ ...Type.title1, color: t.text, textAlign: 'center', marginBottom: 12 }}>
          {item.title}
        </Text>
        {item.sub ? (
          <Text style={{ ...Type.body, color: t.textSecondary, textAlign: 'center', lineHeight: 24 }}>
            {item.sub}
          </Text>
        ) : null}

        {isPermissions && (
          <View style={{ marginTop: 32, gap: 16 }}>
            <View style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              backgroundColor: t.bgTinted, borderRadius: 12, padding: 16,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <MicFill size={22} color={t.red} />
                <Text style={{ ...Type.body, color: t.text }}>Microphone</Text>
              </View>
              <Switch
                value={micGranted}
                onValueChange={requestMic}
                trackColor={{ false: t.fill2, true: t.green }}
              />
            </View>
            <View style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              backgroundColor: t.bgTinted, borderRadius: 12, padding: 16,
            }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Bell size={22} color={t.blue} />
                <Text style={{ ...Type.body, color: t.text }}>Notifications</Text>
              </View>
              <Switch
                value={notifGranted}
                onValueChange={requestNotif}
                trackColor={{ false: t.fill2, true: t.green }}
              />
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        ref={listRef}
        data={PAGES}
        renderItem={renderPage}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={false}
        style={{ flex: 1 }}
      />

      {/* Page dots */}
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 16 }}>
        {PAGES.map((_, i) => (
          <View key={i} style={{
            width: i === page ? 24 : 8, height: 8,
            borderRadius: 4, backgroundColor: i === page ? t.blue : t.fill2,
          }} />
        ))}
      </View>

      {/* Continue button */}
      <View style={{ paddingHorizontal: 32, paddingBottom: 20 }}>
        <Pressable
          onPress={goNext}
          style={({ pressed }) => ({
            height: 52, borderRadius: 14, backgroundColor: t.blue,
            alignItems: 'center', justifyContent: 'center',
            opacity: pressed ? 0.85 : 1,
          })}>
          <Text style={{ ...Type.bodyEm, color: '#fff', fontWeight: '600' }}>
            {page === PAGES.length - 1 ? 'Get Started' : 'Continue'}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
