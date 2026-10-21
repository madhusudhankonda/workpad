import { db, defaultSettings } from "../db/database";
import type { Note, NoteSyncRecord, NoteType, Settings } from "../types";
import { accountConfiguration, currentSession, type AccountSession, type Entitlements } from "./account";

interface CloudNoteRow {
  user_id: string;
  note_id: string;
  title: string;
  content: string;
  note_type: NoteType;
  page_url: string | null;
  normalized_page_url: string | null;
  domain: string | null;
  page_title: string | null;
  favicon_url: string | null;
  tags: string[];
  is_favourite: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface NoteSyncStatus {
  enabled: boolean;
  accountMatches: boolean;
  pending: number;
  lastSyncedAt?: string;
}

export interface NoteSyncResult {
  pushed: number;
  pulled: number;
  conflicts: number;
  syncedAt: string;
}

const freeSyncEnabled = import.meta.env.VITE_ALLOW_FREE_SYNC === "true";
let activeSync: Promise<NoteSyncResult> | undefined;

export const canUseCloudSync = (entitlements?: Entitlements) => entitlements?.plan === "pro" || freeSyncEnabled;
export const isFreeSyncTestingEnabled = () => freeSyncEnabled;

async function storedSettings(): Promise<Settings> {
  return { ...defaultSettings, ...(await db.settings.get("settings")) };
}

function authHeaders(session: AccountSession): Record<string, string> {
  const { key } = accountConfiguration();
  return { apikey: key, authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" };
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const payload = await response.json().catch(() => undefined) as { message?: string; error?: string } | undefined;
  return payload?.message || payload?.error || fallback;
}

function remoteToNote(row: CloudNoteRow): Note {
  return {
    id: row.note_id,
    title: row.title,
    content: row.content,
    type: row.note_type,
    ...(row.page_url ? { pageUrl: row.page_url } : {}),
    ...(row.normalized_page_url ? { normalizedPageUrl: row.normalized_page_url } : {}),
    ...(row.domain ? { domain: row.domain } : {}),
    ...(row.page_title ? { pageTitle: row.page_title } : {}),
    ...(row.favicon_url ? { faviconUrl: row.favicon_url } : {}),
    tags: Array.isArray(row.tags) ? row.tags : [],
    isFavourite: row.is_favourite,
    isArchived: row.is_archived,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function noteToRemote(note: Note, userId: string): CloudNoteRow {
  return {
    user_id: userId,
    note_id: note.id,
    title: note.title,
    content: note.content,
    note_type: note.type,
    page_url: note.pageUrl ?? null,
    normalized_page_url: note.normalizedPageUrl ?? null,
    domain: note.domain ?? null,
    page_title: note.pageTitle ?? null,
    favicon_url: note.faviconUrl ?? null,
    tags: note.tags,
    is_favourite: note.isFavourite,
    is_archived: note.isArchived,
    created_at: note.createdAt,
    updated_at: note.updatedAt,
    deleted_at: null
  };
}

function tombstone(record: NoteSyncRecord): CloudNoteRow {
  return {
    user_id: record.userId,
    note_id: record.noteId,
    title: "",
    content: "",
    note_type: "standalone",
    page_url: null,
    normalized_page_url: null,
    domain: null,
    page_title: null,
    favicon_url: null,
    tags: [],
    is_favourite: false,
    is_archived: false,
    created_at: record.changedAt,
    updated_at: record.changedAt,
    deleted_at: record.changedAt
  };
}

function notesEqual(left: Note, right: Note): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function fetchCloudNotes(session: AccountSession): Promise<CloudNoteRow[]> {
  const { url } = accountConfiguration();
  const rows: CloudNoteRow[] = [];
  const pageSize = 500;
  for (let offset = 0; offset < 5_000; offset += pageSize) {
    const query = new URLSearchParams({ select: "*", user_id: `eq.${session.userId}`, order: "updated_at.asc", limit: String(pageSize), offset: String(offset) });
    const response = await fetch(`${url}/rest/v1/cloud_notes?${query}`, { headers: authHeaders(session) });
    if (!response.ok) throw new Error(await errorMessage(response, "Unable to download cloud notes."));
    const page = await response.json() as CloudNoteRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

async function upsertCloudNotes(session: AccountSession, rows: CloudNoteRow[]): Promise<void> {
  if (!rows.length) return;
  const { url } = accountConfiguration();
  for (let index = 0; index < rows.length; index += 100) {
    const response = await fetch(`${url}/rest/v1/cloud_notes?on_conflict=user_id,note_id`, {
      method: "POST",
      headers: { ...authHeaders(session), Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows.slice(index, index + 100))
    });
    if (!response.ok) throw new Error(await errorMessage(response, "Unable to upload cloud notes."));
  }
}

async function saveConflictCopy(note: Note, userId: string): Promise<void> {
  const now = new Date().toISOString();
  const copy: Note = { ...note, id: crypto.randomUUID(), title: `${note.title || "Untitled note"} (conflict copy)`, createdAt: now, updatedAt: now };
  await db.notes.put(copy);
  await db.noteSync.put({ noteId: copy.id, userId, dirty: true, deleted: false, changedAt: now });
}

async function performSync(session: AccountSession): Promise<NoteSyncResult> {
  const settings = await storedSettings();
  if (!settings.cloudSyncEnabled || settings.cloudSyncUserId !== session.userId) throw new Error("Cloud sync is not enabled for this account.");

  const localNotes = await db.notes.toArray();
  const metadata = await db.noteSync.toArray();
  const metadataById = new Map(metadata.filter((item) => item.userId === session.userId).map((item) => [item.noteId, item]));
  for (const note of localNotes) {
    if (!metadataById.has(note.id)) {
      const record: NoteSyncRecord = { noteId: note.id, userId: session.userId, dirty: true, deleted: false, changedAt: note.updatedAt };
      await db.noteSync.put(record);
      metadataById.set(note.id, record);
    }
  }

  const cloudRows = await fetchCloudNotes(session);
  const localById = new Map((await db.notes.toArray()).map((note) => [note.id, note]));
  let pulled = 0;
  let conflicts = 0;

  for (const row of cloudRows) {
    const remoteChangedAt = row.deleted_at ?? row.updated_at;
    const local = localById.get(row.note_id);
    const meta = metadataById.get(row.note_id);
    if (meta?.dirty) {
      const remoteNote = row.deleted_at ? undefined : remoteToNote(row);
      const differs = Boolean(local && remoteNote && !notesEqual(local, remoteNote)) || Boolean(local) !== Boolean(remoteNote);
      const changedOnBothSides = differs && (!meta.lastSyncedAt || remoteChangedAt > meta.lastSyncedAt);
      if (changedOnBothSides) {
        if (meta.changedAt > remoteChangedAt && remoteNote) await saveConflictCopy(remoteNote, session.userId);
        else if (local) await saveConflictCopy(local, session.userId);
        conflicts += 1;
      }
      if (meta.changedAt > remoteChangedAt) continue;
    }

    if (row.deleted_at) await db.notes.delete(row.note_id);
    else await db.notes.put(remoteToNote(row));
    await db.noteSync.put({ noteId: row.note_id, userId: session.userId, dirty: false, deleted: Boolean(row.deleted_at), changedAt: remoteChangedAt, lastSyncedAt: remoteChangedAt });
    pulled += 1;
  }

  const dirty = (await db.noteSync.toArray()).filter((item) => item.userId === session.userId && item.dirty);
  const notesById = new Map((await db.notes.toArray()).map((note) => [note.id, note]));
  const payload = dirty.map((record) => {
    const note = notesById.get(record.noteId);
    return record.deleted || !note ? tombstone(record) : noteToRemote(note, session.userId);
  });
  await upsertCloudNotes(session, payload);
  for (const record of dirty) await db.noteSync.put({ ...record, dirty: false, lastSyncedAt: record.changedAt });

  const syncedAt = new Date().toISOString();
  await db.settings.put({ ...(await storedSettings()), lastCloudSyncAt: syncedAt });
  return { pushed: dirty.length, pulled, conflicts, syncedAt };
}

export function syncNotes(session: AccountSession): Promise<NoteSyncResult> {
  if (activeSync) return activeSync;
  activeSync = performSync(session).finally(() => { activeSync = undefined; });
  return activeSync;
}

export async function syncCurrentAccountNotes(): Promise<NoteSyncResult | undefined> {
  const session = await currentSession();
  if (!session) return undefined;
  const settings = await storedSettings();
  return settings.cloudSyncEnabled && settings.cloudSyncUserId === session.userId ? syncNotes(session) : undefined;
}

export async function enableNoteSync(session: AccountSession): Promise<NoteSyncResult> {
  const settings = await storedSettings();
  await db.noteSync.clear();
  await db.settings.put({ ...settings, cloudSyncEnabled: true, cloudSyncUserId: session.userId, lastCloudSyncAt: undefined });
  for (const note of await db.notes.toArray()) await db.noteSync.put({ noteId: note.id, userId: session.userId, dirty: true, deleted: false, changedAt: note.updatedAt });
  return syncNotes(session);
}

export async function disableNoteSync(): Promise<void> {
  const settings = await storedSettings();
  await db.settings.put({ ...settings, cloudSyncEnabled: false, cloudSyncUserId: undefined, lastCloudSyncAt: undefined });
  await db.noteSync.clear();
}

export async function markLocalNoteChange(noteId: string, deleted: boolean, changedAt: string): Promise<void> {
  const settings = await storedSettings();
  if (!settings.cloudSyncEnabled || !settings.cloudSyncUserId) return;
  const existing = await db.noteSync.get(noteId);
  await db.noteSync.put({ noteId, userId: settings.cloudSyncUserId, dirty: true, deleted, changedAt, lastSyncedAt: existing?.userId === settings.cloudSyncUserId ? existing.lastSyncedAt : undefined });
}

export async function getNoteSyncStatus(session?: AccountSession): Promise<NoteSyncStatus> {
  const settings = await storedSettings();
  const accountMatches = Boolean(session && settings.cloudSyncUserId === session.userId);
  const pending = accountMatches ? (await db.noteSync.toArray()).filter((item) => item.userId === session!.userId && item.dirty).length : 0;
  return { enabled: settings.cloudSyncEnabled, accountMatches, pending, lastSyncedAt: settings.lastCloudSyncAt };
}
