import Dexie, { type EntityTable } from "dexie";
import type { Note, Settings } from "../types";

export class WorkpadDatabase extends Dexie {
  notes!: EntityTable<Note, "id">;
  settings!: EntityTable<Settings, "id">;

  constructor() {
    super("workpad");
    this.version(1).stores({
      notes: "id, type, normalizedPageUrl, domain, isFavourite, isArchived, updatedAt, *tags",
      settings: "id"
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
  onboardingCompleted: false
};
