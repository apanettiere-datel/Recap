import React, { useState, useRef } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useTheme } from '../../lib/useTheme';
import { Type } from '../../lib/typography';
import { usePerson, useDeletePerson, useUpdatePerson } from '../../hooks/usePeople';
import { NavBar, NavButton } from '../../components/ui/NavBar';
import { Avatar } from '../../components/ui/Avatar';
import { StatCard } from '../../components/ui/StatCard';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { CommitmentRow } from '../../components/ui/CommitmentRow';
import { Pill } from '../../components/ui/Pill';
import { ChevronLeft, ChevronRight, Trash, Pencil } from '../../components/icons';

export default function PersonDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTheme();
  const { data: person, isLoading } = usePerson(id);
  const deletePerson = useDeletePerson();
  const updatePerson = useUpdatePerson();

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [editingRelationship, setEditingRelationship] = useState(false);
  const [relationshipDraft, setRelationshipDraft] = useState('');
  const nameInputRef = useRef<TextInput>(null);
  const relationshipInputRef = useRef<TextInput>(null);

  const handleStartEditName = () => {
    if (!person) return;
    setNameDraft(person.name);
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.focus(), 100);
  };

  const handleSaveName = () => {
    if (!person) return;
    const trimmed = nameDraft.trim();
    if (trimmed && trimmed !== person.name) {
      updatePerson.mutate({ id: person.id, name: trimmed });
    }
    setEditingName(false);
  };

  const handleStartEditRelationship = () => {
    if (!person) return;
    setRelationshipDraft(person.relationship || '');
    setEditingRelationship(true);
    setTimeout(() => relationshipInputRef.current?.focus(), 100);
  };

  const handleSaveRelationship = () => {
    if (!person) return;
    const trimmed = relationshipDraft.trim();
    if (trimmed !== (person.relationship || '')) {
      updatePerson.mutate({ id: person.id, relationship: trimmed });
    }
    setEditingRelationship(false);
  };

  const handleDelete = () => {
    if (!person) return;
    Alert.alert('Delete Person', `Remove "${person.name}" from your contacts? Their commitments and conversation links will be preserved.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        deletePerson.mutate(person.id);
        router.back();
      }},
    ]);
  };

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

  const stats = person.insights;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <NavBar t={t} title="" large={false}
        leading={<NavButton t={t} onPress={() => router.back()}><ChevronLeft size={18} color={t.blue} /></NavButton>}
        trailing={<NavButton t={t} onPress={handleDelete}><Trash size={20} color={t.red} /></NavButton>}
      />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Profile header */}
        <View style={{ alignItems: 'center', paddingVertical: 20 }}>
          <Avatar t={t} name={person.name} size={72} />
          {editingName ? (
            <TextInput
              ref={nameInputRef}
              style={{ ...Type.title2, color: t.text, marginTop: 12, padding: 0, textAlign: 'center', minWidth: 120 }}
              value={nameDraft}
              onChangeText={setNameDraft}
              onBlur={handleSaveName}
              onSubmitEditing={handleSaveName}
              returnKeyType="done"
              autoFocus
            />
          ) : (
            <Pressable onPress={handleStartEditName} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 }}>
              <Text style={{ ...Type.title2, color: t.text }}>{person.name}</Text>
              <Pencil size={14} color={t.textTertiary} />
            </Pressable>
          )}
          {editingRelationship ? (
            <TextInput
              ref={relationshipInputRef}
              style={{ ...Type.subhead, color: t.textSecondary, marginTop: 2, padding: 0, textAlign: 'center', minWidth: 100 }}
              value={relationshipDraft}
              onChangeText={setRelationshipDraft}
              onBlur={handleSaveRelationship}
              onSubmitEditing={handleSaveRelationship}
              returnKeyType="done"
              placeholder="Add relationship"
              placeholderTextColor={t.textTertiary}
              autoFocus
            />
          ) : (
            <Pressable onPress={handleStartEditRelationship} style={{ marginTop: 2 }}>
              <Text style={{ ...Type.subhead, color: t.textSecondary }}>
                {person.relationship || 'Add relationship'}
              </Text>
            </Pressable>
          )}
          {!!person.organization && (
            <Text style={{ ...Type.caption, color: t.textTertiary, marginTop: 2 }}>
              {person.organization}
            </Text>
          )}
        </View>

        {/* Quick Recap button */}
        <View style={{ paddingHorizontal: 16, marginTop: 4, marginBottom: 16 }}>
          <Pressable
            onPress={() => router.push({ pathname: '/briefing', params: { personId: person.id } })}
            style={{ backgroundColor: t.blue, borderRadius: 12, padding: 14, alignItems: 'center' }}>
            <Text style={{ ...Type.headline, color: '#fff' }}>Quick Recap</Text>
          </Pressable>
        </View>

        {/* Contact info */}
        {(person.phone || person.email) && (
          <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
            <View style={{ backgroundColor: t.bgTinted, borderRadius: 12, padding: 14, gap: 8 }}>
              {!!person.phone && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ ...Type.subhead, color: t.textSecondary }}>Phone</Text>
                  <Text style={{ ...Type.subheadEm, color: t.blue }}>{person.phone}</Text>
                </View>
              )}
              {person.phone && person.email && <View style={{ height: 0.33, backgroundColor: t.separator }} />}
              {!!person.email && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ ...Type.subhead, color: t.textSecondary }}>Email</Text>
                  <Text style={{ ...Type.subheadEm, color: t.blue }}>{person.email}</Text>
                </View>
              )}
            </View>
          </View>
        )}

        {/* Stats */}
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 16 }}>
          <StatCard t={t} value={person.notes.length} label="Convos" tone="blue" />
          <StatCard t={t} value={stats.openCommitments} label="Open" tone="orange" />
          <StatCard t={t} value={`${Math.round(stats.avgDaysBetweenContacts)}d`} label="Frequency" tone="purple" />
        </View>

        {/* Relationship intelligence */}
        <View style={{ paddingHorizontal: 16 }}>
          <SectionHeader t={t}>Relationship Intelligence</SectionHeader>
          <View style={{
            backgroundColor: t.bgTinted, borderRadius: 12, padding: 14, gap: 10,
            marginBottom: 16,
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ ...Type.subhead, color: t.textSecondary }}>Tone</Text>
              <Text style={{ ...Type.subheadEm, color: t.text }}>{stats.dominantSentiment || 'Neutral'}</Text>
            </View>
            <View style={{ height: 0.33, backgroundColor: t.separator }} />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ ...Type.subhead, color: t.textSecondary }}>Frequency</Text>
              <Text style={{ ...Type.subheadEm, color: t.text }}>Every {Math.round(stats.avgDaysBetweenContacts)} days</Text>
            </View>
          </View>
        </View>

        {/* Topics */}
        {stats.frequentTopics.length > 0 && (
          <View style={{ paddingHorizontal: 16 }}>
            <SectionHeader t={t}>Frequent Topics</SectionHeader>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              {stats.frequentTopics.map((topic, i) => (
                <Pill key={i} t={t} tone="gray" size="md">{topic}</Pill>
              ))}
            </View>
          </View>
        )}

        {/* Commitments */}
        {person.commitments.length > 0 && (
          <View style={{ paddingHorizontal: 16 }}>
            <SectionHeader t={t}>Commitments</SectionHeader>
            {person.commitments.map((c) => (
              <CommitmentRow
                key={c.id}
                t={t}
                text={c.description}
                owner={c.owner}
                done={c.status === 'completed'}
                overdue={c.status === 'overdue'}
                due={c.dueDate ? new Date(c.dueDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : null}
                compact
              />
            ))}
          </View>
        )}

        {/* Conversations */}
        {person.notes.length > 0 && (
          <View style={{ paddingHorizontal: 16 }}>
            <SectionHeader t={t}>Conversations</SectionHeader>
            {person.notes.map((note) => (
              <Pressable
                key={note.id}
                onPress={() => router.push(`/note/${note.id}`)}
                style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center',
                  paddingVertical: 12, opacity: pressed ? 0.6 : 1,
                  borderBottomWidth: 0.33, borderBottomColor: t.separator,
                })}>
                <View style={{ flex: 1 }}>
                  <Text style={{ ...Type.subheadEm, color: t.text }}>{note.title}</Text>
                  <Text style={{ ...Type.caption, color: t.textSecondary, marginTop: 2 }}>
                    {new Date(note.recordedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </Text>
                </View>
                <ChevronRight size={14} color={t.textTertiary} />
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
