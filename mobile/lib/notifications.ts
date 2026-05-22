import * as Notifications from 'expo-notifications';
import { Commitment } from './types';

// Configure how notifications appear when app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function requestNotificationPermissions(): Promise<boolean> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  return finalStatus === 'granted';
}

export async function scheduleCommitmentReminders(commitments: Commitment[]) {
  // Cancel all existing scheduled notifications first
  await Notifications.cancelAllScheduledNotificationsAsync();

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);

  for (const c of commitments) {
    if (!c.dueDate || c.status === 'completed') continue;

    const due = new Date(c.dueDate);
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());

    // Due today
    if (dueDay.getTime() === todayStart.getTime()) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Commitment Due Today',
          body: c.description,
          data: { commitmentId: c.id, noteId: c.noteId },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: 5,
        },
      });
    }

    // Due tomorrow - schedule for 9 AM tomorrow
    if (dueDay.getTime() === tomorrowStart.getTime()) {
      const tomorrowAt9 = new Date(tomorrowStart);
      tomorrowAt9.setHours(9, 0, 0, 0);
      const secondsUntil = Math.max(
        60,
        Math.floor((tomorrowAt9.getTime() - now.getTime()) / 1000)
      );

      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Commitment Due Tomorrow',
          body: c.description,
          data: { commitmentId: c.id, noteId: c.noteId },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: secondsUntil,
        },
      });
    }

    // Already overdue
    if (dueDay.getTime() < todayStart.getTime() && c.status === 'overdue') {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Overdue Commitment',
          body: c.description,
          data: { commitmentId: c.id, noteId: c.noteId },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
          seconds: 10,
        },
      });
    }
  }
}
