import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, Pressable, ActivityIndicator, Modal, TextInput, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useTheme } from '../../lib/useTheme';
import { Type } from '../../lib/typography';
import { usePeople, useCreatePerson } from '../../hooks/usePeople';
import { Avatar } from '../../components/ui/Avatar';
import { NavBar, NavButton } from '../../components/ui/NavBar';
import { ChevronRight, Plus, Xmark, PersonBadgePlus, CheckmarkCircleFill, CircleIcon, MagnifyingGlass, PersonTwo } from '../../components/icons';
import { PersonListItem } from '../../lib/types';
import { getPhoneContacts, PhoneContact } from '../../lib/contacts';

function toneForRelationship(rel: string): 'blue' | 'purple' | 'orange' | 'green' | 'pink' {
  if (!rel) return 'blue';
  const r = rel.toLowerCase();
  if (r.includes('family')) return 'orange';
  if (r.includes('friend') || r.includes('date')) return 'pink';
  if (r.includes('doctor') || r.includes('dentist') || r.includes('health')) return 'green';
  if (r.includes('engineer') || r.includes('design')) return 'purple';
  return 'blue';
}

function AddPersonModal({ visible, onClose, t }: { visible: boolean; onClose: () => void; t: any }) {
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [organization, setOrganization] = useState('');
  const [keywordsText, setKeywordsText] = useState('');
  const createPerson = useCreatePerson();

  const handleSave = async () => {
    if (!name.trim()) { Alert.alert('Name required'); return; }
    const keywords = keywordsText.split(',').map(k => k.trim()).filter(Boolean);
    try {
      await createPerson.mutateAsync({
        name: name.trim(),
        relationship: relationship.trim(),
        keywords,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        organization: organization.trim() || undefined,
      });
      setName(''); setRelationship(''); setPhone(''); setEmail('');
      setOrganization(''); setKeywordsText('');
      onClose();
    } catch {
      Alert.alert('Error', 'Could not add person.');
    }
  };

  const inputStyle = {
    height: 48, borderRadius: 12, backgroundColor: t.bgTinted,
    paddingHorizontal: 14, color: t.text, ...Type.body,
  };
  const labelStyle = { ...Type.caption, color: t.textSecondary, marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: 0.5 };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 }}>
          <Pressable onPress={onClose} hitSlop={8}>
            <Xmark size={16} color={t.textSecondary} />
          </Pressable>
          <Text style={{ ...Type.headline, color: t.text }}>Add Person</Text>
          <Pressable onPress={handleSave} disabled={createPerson.isPending} hitSlop={8}>
            <Text style={{ ...Type.bodyEm, color: !name.trim() ? t.textTertiary : t.blue }}>Save</Text>
          </Pressable>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 16, paddingTop: 16, paddingBottom: 40 }}>
          <View>
            <Text style={labelStyle}>Name</Text>
            <TextInput value={name} onChangeText={setName} placeholder="e.g. Mom, Dr. Smith, Sarah"
              placeholderTextColor={t.textTertiary} autoFocus style={inputStyle} />
          </View>
          <View>
            <Text style={labelStyle}>Relationship</Text>
            <TextInput value={relationship} onChangeText={setRelationship} placeholder="e.g. Family, Coworker, Client"
              placeholderTextColor={t.textTertiary} style={inputStyle} />
          </View>
          <View>
            <Text style={labelStyle}>Organization</Text>
            <TextInput value={organization} onChangeText={setOrganization} placeholder="e.g. Datel Software Solutions"
              placeholderTextColor={t.textTertiary} style={inputStyle} />
          </View>
          <View>
            <Text style={labelStyle}>Phone</Text>
            <TextInput value={phone} onChangeText={setPhone} placeholder="(555) 123-4567"
              placeholderTextColor={t.textTertiary} keyboardType="phone-pad" style={inputStyle} />
          </View>
          <View>
            <Text style={labelStyle}>Email</Text>
            <TextInput value={email} onChangeText={setEmail} placeholder="name@example.com"
              placeholderTextColor={t.textTertiary} keyboardType="email-address" autoCapitalize="none" style={inputStyle} />
          </View>
          <View>
            <Text style={labelStyle}>Keywords / Aliases</Text>
            <TextInput value={keywordsText} onChangeText={setKeywordsText} placeholder="e.g. mama, mother (comma separated)"
              placeholderTextColor={t.textTertiary} style={inputStyle} />
            <Text style={{ ...Type.caption2, color: t.textTertiary, marginTop: 6 }}>
              Recap will match these words in transcripts to identify this person.
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function ImportContactsModal({ visible, onClose, onImport }: { visible: boolean; onClose: () => void; onImport: (contacts: PhoneContact[]) => void }) {
  const [contacts, setContacts] = useState<PhoneContact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const { t } = useTheme();

  useEffect(() => {
    if (visible) {
      setLoading(true);
      setSelected(new Set());
      setSearch('');
      getPhoneContacts().then(c => { setContacts(c); setLoading(false); });
    }
  }, [visible]);

  const filtered = contacts.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleImport = () => {
    const chosen = contacts.filter(c => selected.has(c.id));
    if (chosen.length === 0) return;
    setImporting(true);
    onImport(chosen);
  };

  const selectedCount = selected.size;

  const renderContact = ({ item }: { item: PhoneContact }) => {
    const isSelected = selected.has(item.id);
    return (
      <Pressable
        onPress={() => toggleSelect(item.id)}
        style={({ pressed }) => ({
          flexDirection: 'row', alignItems: 'center', gap: 12,
          paddingVertical: 11, paddingHorizontal: 16,
          opacity: pressed ? 0.6 : 1,
          backgroundColor: isSelected ? t.blueTintBg : 'transparent',
          borderBottomWidth: 0.33, borderBottomColor: t.separator,
        })}>
        {isSelected
          ? <CheckmarkCircleFill size={22} color={t.blue} />
          : <CircleIcon size={22} color={t.fill1} />
        }
        <View style={{ flex: 1 }}>
          <Text style={{ ...Type.body, color: t.text }}>{item.name}</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
            {item.phone && (
              <Text style={{ ...Type.caption, color: t.textSecondary }} numberOfLines={1}>{item.phone}</Text>
            )}
            {item.company && (
              <Text style={{ ...Type.caption, color: t.textTertiary }} numberOfLines={1}>{item.company}</Text>
            )}
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 }}>
          <Pressable onPress={onClose} hitSlop={8}>
            <Xmark size={16} color={t.textSecondary} />
          </Pressable>
          <Text style={{ ...Type.headline, color: t.text }}>Import Contacts</Text>
          <View style={{ minWidth: 32 }} />
        </View>

        {/* Search bar */}
        <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            height: 40, borderRadius: 10, backgroundColor: t.bgTinted,
            paddingHorizontal: 10,
          }}>
            <MagnifyingGlass size={14} color={t.textTertiary} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search contacts"
              placeholderTextColor={t.textTertiary}
              style={{ flex: 1, color: t.text, ...Type.body, paddingVertical: 0 }}
              autoCorrect={false}
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch('')} hitSlop={8}>
                <Xmark size={12} color={t.textTertiary} />
              </Pressable>
            )}
          </View>
        </View>

        {/* Contact list */}
        {loading ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" color={t.blue} />
            <Text style={{ ...Type.subhead, color: t.textSecondary, marginTop: 12 }}>Loading contacts...</Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={item => item.id}
            renderItem={renderContact}
            contentContainerStyle={{ paddingBottom: 100 }}
            ListEmptyComponent={
              <View style={{ alignItems: 'center', paddingTop: 60 }}>
                <Text style={{ ...Type.subhead, color: t.textSecondary }}>
                  {search ? 'No contacts match your search' : 'No contacts found'}
                </Text>
              </View>
            }
          />
        )}

        {/* Import button */}
        {!loading && (
          <View style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            paddingHorizontal: 16, paddingTop: 12, paddingBottom: 36,
            backgroundColor: t.bg,
            borderTopWidth: 0.33, borderTopColor: t.separator,
          }}>
            <Pressable
              onPress={handleImport}
              disabled={selectedCount === 0 || importing}
              style={({ pressed }) => ({
                height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
                backgroundColor: selectedCount === 0 ? t.fill3 : t.blue,
                opacity: pressed ? 0.8 : 1,
              })}>
              {importing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={{ ...Type.headline, color: selectedCount === 0 ? t.textTertiary : '#fff' }}>
                  {selectedCount === 0 ? 'Select Contacts' : `Import ${selectedCount} Contact${selectedCount === 1 ? '' : 's'}`}
                </Text>
              )}
            </Pressable>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

export default function PeopleScreen() {
  const { t } = useTheme();
  const { data: people, isLoading } = usePeople();
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const createPerson = useCreatePerson();

  const handleImportContacts = async (contacts: PhoneContact[]) => {
    let succeeded = 0;
    let failed = 0;
    for (const c of contacts) {
      try {
        await createPerson.mutateAsync({
          name: c.name,
          phone: c.phone ?? undefined,
          email: c.email ?? undefined,
          organization: c.company ?? undefined,
        });
        succeeded++;
      } catch {
        failed++;
      }
    }
    setShowImport(false);
    if (failed > 0) {
      Alert.alert('Import Complete', `Imported ${succeeded} contact${succeeded === 1 ? '' : 's'}. ${failed} failed.`);
    } else {
      Alert.alert('Import Complete', `Successfully imported ${succeeded} contact${succeeded === 1 ? '' : 's'}.`);
    }
  };

  const renderPerson = ({ item }: { item: PersonListItem }) => {
    const daysSince = item.lastContactDate
      ? Math.floor((Date.now() - new Date(item.lastContactDate).getTime()) / 86400000)
      : null;
    const lastText = daysSince === null ? 'Never'
      : daysSince === 0 ? 'Today'
      : daysSince === 1 ? 'Yesterday'
      : `${daysSince} days ago`;

    return (
      <Pressable
        onPress={() => router.push(`/person/${item.id}`)}
        style={({ pressed }) => ({
          flexDirection: 'row', alignItems: 'center', gap: 14,
          paddingVertical: 12, paddingHorizontal: 16,
          opacity: pressed ? 0.6 : 1,
          borderBottomWidth: 0.33, borderBottomColor: t.separator,
        })}>
        <Avatar t={t} name={item.name} tone={toneForRelationship(item.relationship)} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={{ ...Type.headline, color: t.text }}>{item.name}</Text>
          <Text style={{ ...Type.caption, color: t.textSecondary, marginTop: 2 }}>
            {item.totalConversations} conversation{item.totalConversations === 1 ? '' : 's'} · Last {lastText}
          </Text>
        </View>
        {item.openCommitments > 0 && (
          <View style={{
            backgroundColor: t.blueSoft, borderRadius: 10,
            paddingHorizontal: 8, paddingVertical: 2,
          }}>
            <Text style={{ ...Type.caption, color: t.blue, fontWeight: '600' }}>
              {item.openCommitments}
            </Text>
          </View>
        )}
        <ChevronRight size={14} color={t.textTertiary} />
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <NavBar t={t} title="People"
        trailing={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <NavButton t={t} onPress={() => setShowImport(true)}>
              <PersonBadgePlus size={22} color={t.blue} />
            </NavButton>
            <NavButton t={t} onPress={() => setShowAdd(true)}>
              <Plus size={20} color={t.blue} />
            </NavButton>
          </View>
        }
      />
      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={t.blue} />
        </View>
      ) : (
        <FlatList
          data={people || []}
          keyExtractor={(item) => item.id}
          renderItem={renderPerson}
          contentContainerStyle={{ paddingBottom: 100 }}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 80 }}>
              <PersonTwo size={40} color={t.textTertiary} />
              <Text style={{ ...Type.title3, color: t.textSecondary, marginBottom: 8, marginTop: 16 }}>
                No people yet
              </Text>
              <Text style={{ ...Type.subhead, color: t.textTertiary, textAlign: 'center', maxWidth: 260 }}>
                People mentioned in your conversations will appear here, or tap + to add someone.
              </Text>
            </View>
          }
        />
      )}
      <AddPersonModal visible={showAdd} onClose={() => setShowAdd(false)} t={t} />
      <ImportContactsModal visible={showImport} onClose={() => setShowImport(false)} onImport={handleImportContacts} />
    </SafeAreaView>
  );
}
