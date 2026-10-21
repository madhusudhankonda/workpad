import Dexie, { type EntityTable } from "dexie";
import type { Note, NoteSyncRecord, Settings } from "../types";

export class WorkpadDatabase extends Dexie {
  notes!: EntityTable<Note, "id">;
  settings!: EntityTable<Settings, "id">;
  noteSync!: EntityTable<NoteSyncRecord, "noteId">;

  constructor() {
    super("workpad");
    this.version(1).stores({
      notes: "id, type, normalizedPageUrl, domain, isFavourite, isArchived, updatedAt, *tags",
      settings: "id"
    });
    this.version(2).stores({
      notes: "id, type, normalizedPageUrl, domain, isFavourite, isArchived, updatedAt, *tags",
      settings: "id",
      noteSync: "noteId, userId, changedAt"
    });
  }
}

export const db = new WorkpadDatabase();

export const defaultSettings: Settings = {
  id: "settings",
  theme: "system",
  defaultOpeningSection: "page",
  autoSaveDebounce: 650,
  removeTrackingParameters: true,
  onboardingCompleted: false,
  aiModel: "gpt-5.6-luna",
  aiMaxSourceCharacters: 40_000,
  cloudSyncEnabled: false
};
