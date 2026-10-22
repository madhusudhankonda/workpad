import Dexie, { type EntityTable } from "dexie";
import type { Note, NoteSyncRecord, ResearchProject, ResearchSource, Settings } from "../types";

export class WorkpadDatabase extends Dexie {
  notes!: EntityTable<Note, "id">;
  settings!: EntityTable<Settings, "id">;
  noteSync!: EntityTable<NoteSyncRecord, "noteId">;
  projects!: EntityTable<ResearchProject, "id">;
  sources!: EntityTable<ResearchSource, "id">;

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
    // Research projects. Additive: existing notes are untouched. Sources are filled in by capture (phase 2).
    this.version(3).stores({
      notes: "id, type, normalizedPageUrl, domain, isFavourite, isArchived, updatedAt, *tags",
      settings: "id",
      noteSync: "noteId, userId, changedAt",
      projects: "id, updatedAt",
      sources: "id, projectId, [projectId+contentHash], updatedAt"
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
  aiMaxSourceCharacters: 40_000,
  cloudSyncEnabled: false
};
