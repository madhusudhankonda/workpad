const MAX_CAPTURE_LENGTH = 50_000;
const REMINDER_ALARM_PREFIX = "workpad-reminder:";
const REMINDER_STORAGE_KEY = "workpadReminders";

interface StoredReminder {
  noteId: string;
  title: string;
  reminderAt: string;
  pageUrl?: string;
}

function limit(value: string | undefined): string {
  return (value ?? "").slice(0, MAX_CAPTURE_LENGTH);
}

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "save-selection",
      title: "Save selection to Workpad",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({ id: "save-page-link", title: "Save page link to Workpad", contexts: ["page"] });
    chrome.contextMenus.create({ id: "open-workpad", title: "Open Workpad", contexts: ["page", "selection"] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "open-workpad") {
    if (tab?.windowId) chrome.sidePanel.open({ windowId: tab.windowId }).catch(console.error);
    return;
  }
  if (info.menuItemId === "save-selection" || info.menuItemId === "save-page-link") {
    chrome.storage.local
      .set({
        pendingCapture: {
          kind: info.menuItemId,
          selection: limit(info.selectionText),
          url: limit(info.pageUrl ?? tab?.url),
          title: limit(tab?.title ?? "Untitled page"),
          capturedAt: new Date().toISOString()
        }
      })
      .then(() => {
        if (tab?.windowId) return chrome.sidePanel.open({ windowId: tab.windowId });
      })
      .catch(console.error);
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === "open-workpad") chrome.windows.getLastFocused().then((window) => {
    if (window.id) chrome.sidePanel.open({ windowId: window.id }).catch(console.error);
  });
  else chrome.storage.local.set({ pendingCommand: command }).catch(console.error);
});

chrome.runtime.onMessage.addListener((message: { type?: string; reminder?: StoredReminder; noteId?: string }, _sender, sendResponse) => {
  if (message.type === "SCHEDULE_NOTE_REMINDER" && message.reminder) {
    const reminder = message.reminder;
    void chrome.storage.local.get(REMINDER_STORAGE_KEY).then((stored) => {
      const reminders = (stored[REMINDER_STORAGE_KEY] ?? {}) as Record<string, StoredReminder>;
      reminders[reminder.noteId] = reminder;
      return Promise.all([
        chrome.storage.local.set({ [REMINDER_STORAGE_KEY]: reminders }),
        chrome.alarms.create(`${REMINDER_ALARM_PREFIX}${reminder.noteId}`, { when: new Date(reminder.reminderAt).getTime() })
      ]);
    }).then(() => sendResponse({ ok: true })).catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  if (message.type === "CLEAR_NOTE_REMINDER" && message.noteId) {
    const noteId = message.noteId;
    void chrome.storage.local.get(REMINDER_STORAGE_KEY).then(async (stored) => {
      const reminders = (stored[REMINDER_STORAGE_KEY] ?? {}) as Record<string, StoredReminder>;
      delete reminders[noteId];
      await chrome.storage.local.set({ [REMINDER_STORAGE_KEY]: reminders });
      await chrome.alarms.clear(`${REMINDER_ALARM_PREFIX}${noteId}`);
    }).then(() => sendResponse({ ok: true })).catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }
  return undefined;
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(REMINDER_ALARM_PREFIX)) return;
  const noteId = alarm.name.slice(REMINDER_ALARM_PREFIX.length);
  void chrome.storage.local.get(REMINDER_STORAGE_KEY).then(async (stored) => {
    const reminders = (stored[REMINDER_STORAGE_KEY] ?? {}) as Record<string, StoredReminder>;
    const reminder = reminders[noteId];
    if (!reminder) return;
    await chrome.notifications.create(alarm.name, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
      title: "Workpad reminder",
      message: reminder.title,
      priority: 2
    });
  }).catch(console.error);
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (!notificationId.startsWith(REMINDER_ALARM_PREFIX)) return;
  const noteId = notificationId.slice(REMINDER_ALARM_PREFIX.length);
  void chrome.storage.local.get(REMINDER_STORAGE_KEY).then(async (stored) => {
    const reminders = (stored[REMINDER_STORAGE_KEY] ?? {}) as Record<string, StoredReminder>;
    const reminder = reminders[noteId];
    if (reminder?.pageUrl) {
      const tab = await chrome.tabs.create({ url: reminder.pageUrl });
      if (tab.windowId) await chrome.sidePanel.open({ windowId: tab.windowId });
    } else {
      const window = await chrome.windows.getLastFocused();
      if (window.id) await chrome.sidePanel.open({ windowId: window.id });
    }
    await chrome.notifications.clear(notificationId);
  }).catch(console.error);
});
