import { beforeEach, describe, expect, it } from "vitest";
import { db, defaultSettings } from "../src/db/database";
import { notesRepository } from "../src/db/repositories/notesRepository";
import { validateBackup } from "../src/utils/backup";

describe("notes repository", () => {
  beforeEach(async () => { await db.notes.clear(); await db.noteSync.clear(); await db.settings.put(defaultSettings); });
  it("creates and searches notes", async () => {
    const note = await notesRepository.create({ title: "Project brief", content: "A useful research note", type: "standalone", tags: ["work"], isFavourite: false, isArchived: false });
    expect(note.id).toBeTruthy();
    expect((await notesRepository.search("research")).map((item) => item.id)).toEqual([note.id]);
  });
  it("validates backup shape", () => {
    expect(validateBackup({ version: 1, exportedAt: "now", notes: [] })).toBe(true);
    expect(validateBackup({ notes: [] })).toBe(false);
    expect(validateBackup({ version: 1, exportedAt: "now", notes: [{ id: "x", title: "x", content: "x", type: "page", tags: [], isFavourite: false, isArchived: false }] })).toBe(false);
  });
});
