import React, { useState, useRef } from 'react';
import { View, Text, ScrollView, Pressable, ActivityIndicator, Platform, Share, Alert, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, router } from 'expo-router';
import { useTheme } from '../../lib/useTheme';
import { Type } from '../../lib/typography';
import { useNote, useUpdateNote } from '../../hooks/useNotes';
import { useUpdateCommitment } from '../../hooks/useCommitments';
import { NavBar, NavButton } from '../../components/ui/NavBar';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { CommitmentRow } from '../../components/ui/CommitmentRow';
import { Pill } from '../../components/ui/Pill';
import { Avatar } from '../../components/ui/Avatar';
import { ChevronLeft, ShareSquare, EllipsisCircle, Pencil, TextQuote } from '../../components/icons';
import { AudioPlayer } from '../../components/note/AudioPlayer';
import { addToCalendar } from '../../lib/calendar';

export default function NoteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTheme();
  const { data: note, isLoading } = useNote(id);
  const updateCommitment = useUpdateCommitment();
  const updateNote = useUpdateNote();
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const titleInputRef = useRef<TextInput>(null);

  const handleShare = async () => {
    if (!note) return;
    const shareDate = new Date(note.recordedAt).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
    const people = note.people?.map(p => p.name).join(', ');
    const commitmentsList = note.commitments?.filter(c => c.status === 'open')
      .map(c => `• ${c.description}`).join('\n') || 'None';

    const message = `${note.title}\n${shareDate}\n\n${note.summary}\n\nPeople: ${people || 'None'}\n\nOpen Commitments:\n${commitmentsList}`;

    await Share.share({ message, title: note.title });
  };

  const handleActions = () => {
    if (!note) return;
    Alert.alert('Actions', undefined, [
      {
        text: note.isPinned ? 'Unpin' : 'Pin',
        onPress: () => updateNote.mutate({ id: note.id, isPinned: !note.isPinned }),
      },
      {
        text: note.isArchived ? 'Unarchive' : 'Archive',
        onPress: () => updateNote.mutate({ id: note.id, isArchived: !note.isArchived }),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleEditCommitment = (commitmentId: string, currentDescription: string) => {
    Alert.prompt(
      'Edit Commitment',
      'Update the commitment description:',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: (newDescription?: string) => {
            const trimmed = newDescription?.trim();
            if (trimmed && trimmed !== currentDescription) {
              updateCommitment.mutate({ id: commitmentId, description: trimmed });
            }
          },
        },
      ],
      'plain-text',
      currentDescription,
    );
  };

  const handleStartEditTitle = () => {
    if (!note) return;
    setTitleDraft(note.title);
    setEditingTitle(true);
    setTimeout(() => titleInputRef.current?.focus(), 100);
  };

  const handleSaveTitle = () => {
    if (!note) return;
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== note.title) {
      updateNote.mutate({ id: note.id, title: trimmed });
    }
    setEditingTitle(false);
  };

  if (isLoading || !note) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <NavBar t={t} title="" large={false}
          leading={
            <NavButton t={t} onPress={() => router.back()}>
              <ChevronLeft size={18} color={t.blue} />
            </NavButton>
          }
        />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={t.blue} />
        </View>
      </SafeAreaView>
    );
  }

  const sentimentTone = note.sentiment?.toLowerCase().includes('cautious') ? 'orange'
    : note.sentiment?.toLowerCase().includes('tense') ? 'red'
    : note.sentiment?.toLowerCase().includes('warm') || note.sentiment?.toLowerCase().includes('positive') ? 'green'
    : 'blue';

  const date = new Date(note.recordedAt).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
  const time = new Date(note.recordedAt).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });
  const mins = Math.floor((note.duration || 0) / 60);
  const secs = Math.floor((note.duration || 0) % 60);
  const durationStr = `${mins}m ${secs.toString().padStart(2, '0')}s`;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <NavBar t={t} title="" large={false}
        leading={
          <NavButton t={t} onPress={() => router.back()}>
            <ChevronLeft size={18} color={t.blue} />
          </NavButton>
        }
        trailing={
          <View style={{ flexDirection: 'row', gap: 4 }}>
            <NavButton t={t} onPress={handleShare}>
              <ShareSquare size={20} color={t.blue} />
            </NavButton>
            <NavButton t={t} onPress={handleActions}>
              <EllipsisCircle size={22} color={t.blue} />
            </NavButton>
          </View>
        }
      />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40 }}>
        {/* Title & meta */}
        {editingTitle ? (
          <TextInput
            ref={titleInputRef}
            style={{ ...Type.title1, color: t.text, marginBottom: 6, padding: 0 }}
            value={titleDraft}
            onChangeText={setTitleDraft}
            onBlur={handleSaveTitle}
            onSubmitEditing={handleSaveTitle}
            returnKeyType="done"
            autoFocus
          />
        ) : (
          <Pressable onPress={handleStartEditTitle} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <Text style={{ ...Type.title1, color: t.text, flex: 1 }}>{note.title}</Text>
            <Pencil size={14} color={t.textTertiary} />
          </Pressable>
        )}
        <Text style={{ ...Type.footnote, color: t.textSecondary }}>{date} · {time}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <Pill t={t} tone={sentimentTone as any} size="sm">{note.sentiment || 'Neutral'}</Pill>
          <Pill t={t} tone="gray" size="sm">{durationStr}</Pill>
          <Pill t={t} tone="gray" size="sm">{note.conversationMode || 'General'}</Pill>
        </View>

        {note.audioUrl && !note.isProcessing && (
          <View style={{ marginTop: 16 }}>
            <AudioPlayer t={t} noteId={note.id} duration={note.duration} />
          </View>
        )}

        {/* Summary */}
        <SectionHeader t={t}>Summary</SectionHeader>
        <Text style={{ ...Type.body, color: t.text, lineHeight: 24 }}>{note.summary}</Text>

        {/* People */}
        {note.people.length > 0 && (
          <>
            <SectionHeader t={t}>People</SectionHeader>
            <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
              {note.people.map((person) => (
                <Pressable
                  key={person.id}
                  onPress={() => router.push(`/person/${person.id}`)}
                  style={{ alignItems: 'center', gap: 6 }}>
                  <Avatar t={t} name={person.name} size={40} />
                  <Text style={{ ...Type.caption, color: t.text }}>{person.name}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {/* Commitments */}
        {note.commitments.length > 0 && (
          <>
            <SectionHeader t={t}>Commitments</SectionHeader>
            {note.commitments.map((c) => (
              <CommitmentRow
                key={c.id}
                t={t}
                text={c.description}
                owner={c.owner}
                done={c.status === 'completed'}
                overdue={c.status === 'overdue'}
                due={c.dueDate ? new Date(c.dueDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : null}
                personName={c.person?.name}
                addedToCalendar={c.addedToCalendar}
                onToggleDone={() => updateCommitment.mutate({
                  id: c.id,
                  status: c.status === 'completed' ? 'open' : 'completed',
                })}
                onEdit={() => handleEditCommitment(c.id, c.description)}
                onAddCal={c.dueDate ? async () => {
                  const success = await addToCalendar(c.description, new Date(c.dueDate!));
                  if (success) {
                    updateCommitment.mutate({ id: c.id, addedToCalendar: true });
                  }
                } : undefined}
              />
            ))}
          </>
        )}

        {/* Quotes */}
        {note.quotes.length > 0 && (
          <>
            <SectionHeader t={t}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <TextQuote size={16} color={t.text} />
                <Text style={{ ...Type.headline, color: t.text }}>Key Quotes</Text>
              </View>
            </SectionHeader>
            {note.quotes.map((q) => (
              <View key={q.id} style={{
                borderLeftWidth: 3, borderLeftColor: t.blue,
                paddingLeft: 14, paddingVertical: 8, marginBottom: 12,
              }}>
                <Text style={{ ...Type.body, color: t.text, fontStyle: 'italic' }}>
                  "{q.text}"
                </Text>
                <Text style={{ ...Type.caption, color: t.textSecondary, marginTop: 4 }}>
                  — {q.speaker}
                </Text>
              </View>
            ))}
          </>
        )}

        {/* Topics */}
        {note.topics.length > 0 && (
          <>
            <SectionHeader t={t}>Topics</SectionHeader>
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {note.topics.map((topic: any, i: number) => (
                <Pill key={i} t={t} tone="gray" size="md">{typeof topic === 'string' ? topic : topic.label}</Pill>
              ))}
            </View>
          </>
        )}

        {/* Transcript */}
        {note.transcript && (
          <>
            <SectionHeader t={t}>Transcript</SectionHeader>
            <Text style={{
              ...Type.subhead, color: t.textSecondary, lineHeight: 22,
              fontFamily: Platform.OS === 'ios' ? undefined : undefined,
            }}>
              {note.transcript}
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
