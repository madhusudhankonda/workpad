export type NoteType = "scratchpad" | "page" | "domain" | "standalone";
export type Theme = "light" | "dark" | "system";
export type OpeningSection = "page" | "scratchpad" | "all" | "favourites";

export interface Note {
  id: string;
  title: string;
  content: string;
  type: NoteType;
  pageUrl?: string;
  normalizedPageUrl?: string;
  domain?: string;
  pageTitle?: string;
  faviconUrl?: string;
  tags: string[];
  isFavourite: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export type NewNote = Omit<Note, "id" | "createdAt" | "updatedAt"> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
};

export interface Settings {
  id: "settings";
  theme: Theme;
  defaultOpeningSection: OpeningSection;
  autoSaveDebounce: number;
  removeTrackingParameters: boolean;
  onboardingCompleted: boolean;
}

export interface PageContext {
  url: string;
  normalizedUrl: string;
  domain: string;
  title: string;
  faviconUrl?: string;
  restricted: boolean;
}

export interface WorkpadBackup {
  version: 1;
  exportedAt: string;
  notes: Note[];
  settings?: Settings;
}
