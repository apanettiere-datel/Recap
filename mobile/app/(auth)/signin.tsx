import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, KeyboardAvoidingView,
  Platform, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTheme } from '../../lib/useTheme';
import { Type } from '../../lib/typography';
import { useAuthStore } from '../../stores/auth';
import { api } from '../../lib/api';
import { WaveformCircleFill } from '../../components/icons';
import { User } from '../../lib/types';

export default function SignInScreen() {
  const { t, isDark } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignup, setIsSignup] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Missing fields', 'Please enter email and password.');
      return;
    }
    setLoading(true);
    try {
      // Dev mode: use dev-token to bypass Firebase
      const token = 'dev-token';
      useAuthStore.getState().setAuth(token, '', email, email.split('@')[0]);

      // Sync user with backend
      const res = await fetch(`${__DEV__ ? 'http://localhost:3000' : 'https://api.recap.app'}/api/users/sync`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const user = await res.json();
        useAuthStore.getState().setAuth(token, user.id, user.email || email, user.displayName || email.split('@')[0]);
      }

      router.replace('/(tabs)');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 32 }}>
          {/* Hero */}
          <View style={{ alignItems: 'center', marginBottom: 36 }}>
            <View style={{ marginBottom: 18 }}>
              <WaveformCircleFill size={72} color={t.red} />
            </View>
            <Text style={{ ...Type.largeTitle, color: t.text }}>Recap</Text>
            <Text style={{
              ...Type.subhead, color: t.textSecondary,
              textAlign: 'center', marginTop: 6, maxWidth: 280,
            }}>
              Remember every conversation.{'\n'}Keep every promise.
            </Text>
          </View>

          {/* Apple Sign In */}
          <Pressable style={{
            height: 52, borderRadius: 12,
            backgroundColor: isDark ? '#fff' : '#000',
            alignItems: 'center', justifyContent: 'center',
            flexDirection: 'row', gap: 8,
          }}>
            <Text style={{
              ...Type.bodyEm, fontWeight: '600',
              color: isDark ? '#000' : '#fff',
            }}>Sign in with Apple</Text>
          </Pressable>

          {/* Divider */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 22 }}>
            <View style={{ flex: 1, height: 0.5, backgroundColor: t.separator }} />
            <Text style={{ ...Type.footnote, color: t.textSecondary }}>or</Text>
            <View style={{ flex: 1, height: 0.5, backgroundColor: t.separator }} />
          </View>

          {/* Email */}
          <TextInput
            placeholder="Email"
            placeholderTextColor={t.textTertiary}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            style={{
              height: 50, borderRadius: 12, backgroundColor: t.bgTinted,
              paddingHorizontal: 14, color: t.text, ...Type.body, marginBottom: 10,
            }}
          />

          {/* Password */}
          <TextInput
            placeholder="Password"
            placeholderTextColor={t.textTertiary}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            style={{
              height: 50, borderRadius: 12, backgroundColor: t.bgTinted,
              paddingHorizontal: 14, color: t.text, ...Type.body, marginBottom: 18,
            }}
          />

          {/* Submit */}
          <Pressable
            onPress={handleSubmit}
            disabled={loading}
            style={({ pressed }) => ({
              height: 52, borderRadius: 12, backgroundColor: t.blue,
              alignItems: 'center', justifyContent: 'center',
              opacity: pressed ? 0.85 : 1,
            })}>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={{ ...Type.bodyEm, color: '#fff', fontWeight: '600' }}>
                {isSignup ? 'Create Account' : 'Sign In'}
              </Text>
            )}
          </Pressable>

          {/* Toggle mode */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 18, paddingHorizontal: 4 }}>
            <Pressable onPress={() => setIsSignup(!isSignup)}>
              <Text style={{ ...Type.footnote, color: t.blue }}>
                {isSignup ? 'Already have an account?' : 'Create an account'}
              </Text>
            </Pressable>
            {!isSignup && (
              <Pressable>
                <Text style={{ ...Type.footnote, color: t.textSecondary }}>Forgot password?</Text>
              </Pressable>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
