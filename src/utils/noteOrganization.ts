import type { Note, NoteType, PageContext } from "../types";

const formattedDay = (value = new Date()) => new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).format(value);

export function defaultNoteTitle(type: NoteType, context?: PageContext | null): string {
  if (type === "page" && context) return (context.title.trim() || `${context.domain} note`).slice(0, 160);
  if (type === "domain" && context) return `${context.domain} notes`;
  if (type === "scratchpad") return "Scratchpad";
  return `Note · ${formattedDay()}`;
}

export function displayNoteTitle(note: Note): string {
  return note.title.trim() || note.pageTitle?.trim() || (note.domain ? `${note.domain} note` : `Note · ${formattedDay(new Date(note.createdAt))}`);
}

export function isNoteForSiteToday(note: Note, context: PageContext | null, today = new Date()): boolean {
  if (!context || context.restricted || note.type !== "page" || note.domain !== context.domain) return false;
  return new Date(note.createdAt).toDateString() === today.toDateString();
}

type NoteDateGroup = { key: string; label: string; notes: Note[] };
export type NoteWebsiteGroup = { website: string; dates: NoteDateGroup[] };

export function groupNotesByWebsiteAndDate(items: Note[]): NoteWebsiteGroup[] {
  const websites = new Map<string, Map<string, Note[]>>();
  for (const note of items) {
    const website = note.domain || "General notes";
    const date = note.createdAt.slice(0, 10);
    const dates = websites.get(website) ?? new Map<string, Note[]>();
    const notesForDate = dates.get(date) ?? [];
    notesForDate.push(note);
    dates.set(date, notesForDate);
    websites.set(website, dates);
  }
  return [...websites].map(([website, dates]) => ({
    website,
    dates: [...dates].map(([key, notes]) => ({ key, label: formattedDay(new Date(`${key}T12:00:00`)), notes }))
  }));
}
