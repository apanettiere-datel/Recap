import * as Contacts from 'expo-contacts';
import { Alert } from 'react-native';

export interface PhoneContact {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  company: string | null;
}

export async function getPhoneContacts(): Promise<PhoneContact[]> {
  const { status } = await Contacts.requestPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert('Permission Required', 'Contacts access is needed to import your contacts.');
    return [];
  }

  const { data } = await Contacts.getContactsAsync({
    fields: [
      Contacts.Fields.Name,
      Contacts.Fields.PhoneNumbers,
      Contacts.Fields.Emails,
      Contacts.Fields.Company,
    ],
    sort: Contacts.SortTypes.FirstName,
  });

  return data
    .filter(c => c.name)
    .map(c => ({
      id: c.id ?? c.name ?? '',
      name: c.name ?? '',
      phone: c.phoneNumbers?.[0]?.number ?? null,
      email: c.emails?.[0]?.email ?? null,
      company: c.company ?? null,
    }));
}
