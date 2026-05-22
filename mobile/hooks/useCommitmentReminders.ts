import { useEffect } from 'react';
import { usePreferences } from '../stores/preferences';
import { useCommitments } from './useCommitments';
import { scheduleCommitmentReminders } from '../lib/notifications';

export function useCommitmentReminders() {
  const notificationsEnabled = usePreferences((s) => s.notificationsEnabled);
  const notifyOverdue = usePreferences((s) => s.notifyOverdueCommitments);
  const { data: commitments } = useCommitments('open');

  useEffect(() => {
    if (!notificationsEnabled || !notifyOverdue || !commitments) return;
    scheduleCommitmentReminders(commitments).catch(console.error);
  }, [notificationsEnabled, notifyOverdue, commitments]);
}
