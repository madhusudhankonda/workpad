import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, defaultSettings } from "../src/db/database";
import type { Note } from "../src/types";
import { enableNoteSync, syncNotes } from "../src/services/noteSync";
import type { AccountSession } from "../src/services/account";

const session: AccountSession = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresAt: Date.now() + 3_600_000,
  userId: "user-1",
  email: "person@example.com"
};

const note: Note = {
  id: "note-1",
  title: "Research",
  content: "Useful material",
  type: "standalone",
  tags: ["work"],
  isFavourite: false,
  isArchived: false,
  createdAt: "2026-08-05T10:00:00.000Z",
  updatedAt: "2026-08-05T10:00:00.000Z"
};

describe("cloud note sync", () => {
  beforeEach(async () => {
    await db.notes.clear();
    await db.noteSync.clear();
    await db.settings.put(defaultSettings);
  });
  afterEach(() => vi.restoreAllMocks());

  it("uploads existing local notes only after sync is enabled", async () => {
    await db.notes.put(note);
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("[]", { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await enableNoteSync(session);

    expect(result.pushed).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const upload = fetchMock.mock.calls[1][1];
    const body = JSON.parse(String(upload?.body)) as Array<Record<string, unknown>>;
    expect(body[0]).toMatchObject({ user_id: "user-1", note_id: "note-1", title: "Research", deleted_at: null });
    expect((await db.noteSync.get("note-1"))?.dirty).toBe(false);
  });

  it("downloads a remote note into the local database", async () => {
    await db.settings.put({ ...defaultSettings, cloudSyncEnabled: true, cloudSyncUserId: "user-1" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([{
      user_id: "user-1",
      note_id: "remote-1",
      title: "From another device",
      content: "Cloud content",
      note_type: "standalone",
      page_url: null,
      normalized_page_url: null,
      domain: null,
      page_title: null,
      favicon_url: null,
      tags: [],
      is_favourite: false,
      is_archived: false,
      created_at: "2026-08-05T11:00:00.000Z",
      updated_at: "2026-08-05T11:00:00.000Z",
      deleted_at: null
    }]), { status: 200 }));

    const result = await syncNotes(session);

    expect(result.pulled).toBe(1);
    expect((await db.notes.get("remote-1"))?.content).toBe("Cloud content");
  });

  it("uploads deletions without retaining note content", async () => {
    await db.settings.put({ ...defaultSettings, cloudSyncEnabled: true, cloudSyncUserId: "user-1" });
    await db.noteSync.put({ noteId: "deleted-1", userId: "user-1", dirty: true, deleted: true, changedAt: "2026-08-05T12:00:00.000Z" });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("[]", { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await syncNotes(session);

    const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as Array<Record<string, unknown>>;
    expect(body[0]).toMatchObject({ note_id: "deleted-1", title: "", content: "", deleted_at: "2026-08-05T12:00:00.000Z" });
  });

  it("keeps local changes queued while offline", async () => {
    await db.notes.put(note);
    await db.settings.put({ ...defaultSettings, cloudSyncEnabled: true, cloudSyncUserId: "user-1" });
    await db.noteSync.put({ noteId: note.id, userId: "user-1", dirty: true, deleted: false, changedAt: note.updatedAt });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("offline"));

    await expect(syncNotes(session)).rejects.toThrow("offline");

    expect((await db.noteSync.get(note.id))?.dirty).toBe(true);
  });

  it("retains a conflict copy when both devices changed", async () => {
    const local = { ...note, content: "Local edit", updatedAt: "2026-08-05T12:00:00.000Z" };
    await db.notes.put(local);
    await db.settings.put({ ...defaultSettings, cloudSyncEnabled: true, cloudSyncUserId: "user-1" });
    await db.noteSync.put({ noteId: note.id, userId: "user-1", dirty: true, deleted: false, changedAt: local.updatedAt, lastSyncedAt: "2026-08-05T11:00:00.000Z" });
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify([{
        user_id: "user-1",
        note_id: note.id,
        title: note.title,
        content: "Newer cloud edit",
        note_type: note.type,
        page_url: null,
        normalized_page_url: null,
        domain: null,
        page_title: null,
        favicon_url: null,
        tags: note.tags,
        is_favourite: false,
        is_archived: false,
        created_at: note.createdAt,
        updated_at: "2026-08-05T13:00:00.000Z",
        deleted_at: null
      }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await syncNotes(session);

    expect(result.conflicts).toBe(1);
    expect((await db.notes.get(note.id))?.content).toBe("Newer cloud edit");
    const copies = await db.notes.filter((item) => item.id !== note.id).toArray();
    expect(copies).toHaveLength(1);
    expect(copies[0].content).toBe("Local edit");
    expect(copies[0].title).toContain("conflict copy");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
