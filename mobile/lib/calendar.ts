import * as Calendar from 'expo-calendar';
import { Platform, Alert } from 'react-native';

export async function addToCalendar(title: string, date: Date): Promise<boolean> {
  // Request permission
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert('Permission Required', 'Calendar access is needed to add events.');
    return false;
  }

  // Get or create a calendar
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  let calendarId: string;

  if (Platform.OS === 'ios') {
    const defaultCal = calendars.find(c => c.allowsModifications && c.type === 'local')
      || calendars.find(c => c.allowsModifications);
    calendarId = defaultCal?.id ?? calendars[0]?.id;
  } else {
    const defaultCal = calendars.find(c => c.isPrimary) || calendars[0];
    calendarId = defaultCal?.id ?? '';
  }

  if (!calendarId) {
    Alert.alert('No Calendar', 'No writable calendar found on this device.');
    return false;
  }

  // Create the event
  const startDate = new Date(date);
  startDate.setHours(9, 0, 0, 0); // Default to 9 AM
  const endDate = new Date(startDate);
  endDate.setHours(10, 0, 0, 0); // 1 hour event

  await Calendar.createEventAsync(calendarId, {
    title,
    startDate,
    endDate,
    alarms: [{ relativeOffset: -60 }], // 1 hour before
  });

  return true;
}
