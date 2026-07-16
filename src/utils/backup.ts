import type { Note, Settings, WorkpadBackup } from "../types";

const noteTypes = new Set(["scratchpad", "page", "domain", "standalone"]);
const themes = new Set(["light", "dark", "system"]);
const sections = new Set(["page", "scratchpad", "all", "favourites"]);
export const MAX_BACKUP_BYTES = 5 * 1024 * 1024;
export const MAX_BACKUP_NOTES = 5_000;
const MAX_TEXT_LENGTH = 200_000;
const MAX_TAGS = 50;
const MAX_TAG_LENGTH = 100;

function isString(value: unknown, maxLength = MAX_TEXT_LENGTH): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || isString(value);
}

function isValidNote(note: unknown): note is Note {
  if (!note || typeof note !== "object") return false;
  const candidate = note as Partial<Note>;
  return (
    isString(candidate.id, 100) &&
    isString(candidate.title) &&
    isString(candidate.content) &&
    noteTypes.has(candidate.type ?? "") &&
    Array.isArray(candidate.tags) &&
    candidate.tags.length <= MAX_TAGS &&
    candidate.tags.every((tag) => isString(tag, MAX_TAG_LENGTH)) &&
    typeof candidate.isFavourite === "boolean" &&
    typeof candidate.isArchived === "boolean" &&
    isString(candidate.createdAt, 100) &&
    isString(candidate.updatedAt, 100) &&
    isOptionalString(candidate.pageUrl) &&
    isOptionalString(candidate.normalizedPageUrl) &&
    isOptionalString(candidate.domain) &&
    isOptionalString(candidate.pageTitle) &&
    isOptionalString(candidate.faviconUrl)
  );
}

function isValidSettings(settings: unknown): settings is Settings {
  if (!settings || typeof settings !== "object") return false;
  const candidate = settings as Partial<Settings>;
  return candidate.id === "settings" &&
    themes.has(candidate.theme ?? "") &&
    sections.has(candidate.defaultOpeningSection ?? "") &&
    typeof candidate.autoSaveDebounce === "number" &&
    candidate.autoSaveDebounce >= 300 &&
    candidate.autoSaveDebounce <= 2_000 &&
    typeof candidate.removeTrackingParameters === "boolean" &&
    typeof candidate.onboardingCompleted === "boolean";
}

export function validateBackup(value: unknown): value is WorkpadBackup {
  if (!value || typeof value !== "object") return false;
  const backup = value as Partial<WorkpadBackup>;
  return (
    backup.version === 1 &&
    isString(backup.exportedAt, 100) &&
    Array.isArray(backup.notes) &&
    backup.notes.length <= MAX_BACKUP_NOTES &&
    backup.notes.every(isValidNote) &&
    (backup.settings === undefined || isValidSettings(backup.settings))
  );
}

export function createBackup(notes: Note[], settings?: Settings): WorkpadBackup {
  return { version: 1, exportedAt: new Date().toISOString(), notes, settings };
}

export function downloadText(filename: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function noteMarkdown(note: Note): string {
  const context = note.pageUrl ? `\n\nSource: ${note.pageUrl}` : "";
  const tags = note.tags.length ? `\n\nTags: ${note.tags.map((tag) => `#${tag}`).join(" ")}` : "";
  return `# ${note.title || "Untitled note"}\n\n${note.content}${context}${tags}\n`;
}
