const STORAGE_KEY = 'recap-notifications'
const CHECK_INTERVAL = 15 * 60 * 1000

function getPrefs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

function setPrefs(prefs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
}

export function areNotificationsEnabled() {
  return getPrefs().enabled === true && Notification.permission === 'granted'
}

export function getNotificationSettings() {
  return {
    supported: 'Notification' in window,
    permission: 'Notification' in window ? Notification.permission : 'denied',
    ...getPrefs(),
  }
}

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return false
  const result = await Notification.requestPermission()
  if (result === 'granted') {
    setPrefs({ ...getPrefs(), enabled: true })
    return true
  }
  return false
}

export function disableNotifications() {
  setPrefs({ ...getPrefs(), enabled: false })
}

export function enableNotifications() {
  setPrefs({ ...getPrefs(), enabled: true })
}

export function showNotification(title, body, options = {}) {
  if (!areNotificationsEnabled()) return
  try {
    const n = new Notification(title, {
      body,
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: options.tag || 'recap',
      ...options,
    })
    if (options.onClick) {
      n.onclick = options.onClick
    }
    return n
  } catch {
    return null
  }
}

let checkInterval = null

export function startNotificationChecks(apiFn) {
  if (checkInterval) return
  if (!areNotificationsEnabled()) return

  const check = async () => {
    if (!areNotificationsEnabled()) return
    try {
      const data = await apiFn()
      const lastCheck = getPrefs().lastCheck || 0
      const now = Date.now()
      setPrefs({ ...getPrefs(), lastCheck: now })

      if (lastCheck === 0) return

      if (data.overdue?.length > 0) {
        const count = data.overdue.length
        showNotification(
          `${count} Overdue Commitment${count > 1 ? 's' : ''}`,
          data.overdue.slice(0, 3).map((c) => c.description).join(', '),
          { tag: 'overdue' }
        )
      }

      if (data.staleContacts?.length > 0) {
        const person = data.staleContacts[0]
        showNotification(
          'Time to reconnect',
          `You haven't talked to ${person.name} in ${person.daysSinceContact} days`,
          { tag: 'reconnect' }
        )
      }
    } catch {
      // silently fail
    }
  }

  check()
  checkInterval = setInterval(check, CHECK_INTERVAL)
}

export function stopNotificationChecks() {
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
}
