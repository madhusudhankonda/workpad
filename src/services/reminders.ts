import type { Note } from "../types";

const REMINDER_PREFIX = "reminder:";

export function reminderFromTags(tags: string[]): string | undefined {
  return tags.find((tag) => tag.startsWith(REMINDER_PREFIX))?.slice(REMINDER_PREFIX.length);
}

export function withReminderTag(tags: string[], reminderAt?: string): string[] {
  const rest = tags.filter((tag) => !tag.startsWith(REMINDER_PREFIX));
  return reminderAt ? [...rest, `${REMINDER_PREFIX}${reminderAt}`] : rest;
}

export async function scheduleNoteReminder(note: Note, reminderAt: string): Promise<void> {
  if (!globalThis.chrome?.runtime) return;
  await chrome.runtime.sendMessage({
    type: "SCHEDULE_NOTE_REMINDER",
    reminder: { noteId: note.id, title: note.title || note.pageTitle || "Workpad reminder", reminderAt, pageUrl: note.pageUrl }
  });
}

export async function clearNoteReminder(noteId: string): Promise<void> {
  if (!globalThis.chrome?.runtime) return;
  await chrome.runtime.sendMessage({ type: "CLEAR_NOTE_REMINDER", noteId });
}
