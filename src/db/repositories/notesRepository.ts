import { db } from "../database";
import type { NewNote, Note } from "../../types";

export interface NotesRepository {
  create(note: NewNote): Promise<Note>;
  update(id: string, changes: Partial<Note>): Promise<Note>;
  delete(id: string): Promise<void>;
  getById(id: string): Promise<Note | undefined>;
  getAll(): Promise<Note[]>;
  getForPage(url: string): Promise<Note[]>;
  getForDomain(domain: string): Promise<Note[]>;
  search(query: string): Promise<Note[]>;
}

const sortByUpdated = (notes: Note[]) => notes.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export const notesRepository: NotesRepository = {
  async create(input) {
    const now = new Date().toISOString();
    const note: Note = {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      tags: input.tags ?? [],
      isFavourite: input.isFavourite ?? false,
      isArchived: input.isArchived ?? false
    };
    await db.notes.add(note);
    return note;
  },
  async update(id, changes) {
    const existing = await db.notes.get(id);
    if (!existing) throw new Error("Note no longer exists.");
    const note = { ...existing, ...changes, id, updatedAt: new Date().toISOString() };
    await db.notes.put(note);
    return note;
  },
  async delete(id) {
    await db.notes.delete(id);
  },
  getById: (id) => db.notes.get(id),
  async getAll() {
    return sortByUpdated((await db.notes.filter((note) => !note.isArchived).toArray()));
  },
  async getForPage(url) {
    return sortByUpdated(await db.notes.where("normalizedPageUrl").equals(url).toArray());
  },
  async getForDomain(domain) {
    return sortByUpdated(await db.notes.where("domain").equals(domain).toArray());
  },
  async search(query) {
    const value = query.trim().toLowerCase();
    const notes = await this.getAll();
    if (!value) return notes;
    return notes.filter((note) =>
      [note.title, note.content, note.domain, note.pageTitle, note.tags.join(" ")]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(value)
    );
  }
};
