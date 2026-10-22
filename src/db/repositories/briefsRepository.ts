import { db } from "../database";
import type { DecisionBrief } from "../../types";

export type NewBrief = Omit<DecisionBrief, "id" | "createdAt" | "updatedAt">;

export const briefsRepository = {
  async create(input: NewBrief): Promise<DecisionBrief> {
    const now = new Date().toISOString();
    const brief: DecisionBrief = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
    await db.transaction("rw", db.projects, db.briefs, async () => {
      if (!(await db.projects.get(input.projectId))) throw new Error("This project no longer exists.");
      await db.briefs.add(brief);
      await db.projects.update(input.projectId, { updatedAt: now });
    });
    return brief;
  },

  async update(id: string, changes: Partial<Pick<DecisionBrief, "title" | "content">>): Promise<DecisionBrief> {
    return db.transaction("rw", db.briefs, async () => {
      const existing = await db.briefs.get(id);
      if (!existing) throw new Error("This brief no longer exists.");
      const brief = { ...existing, ...changes, title: (changes.title ?? existing.title).trim() || existing.title, updatedAt: new Date().toISOString() };
      await db.briefs.put(brief);
      return brief;
    });
  },

  async listForProject(projectId: string): Promise<DecisionBrief[]> {
    return (await db.briefs.where("projectId").equals(projectId).toArray()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  getById: (id: string) => db.briefs.get(id),

  delete: (id: string) => db.briefs.delete(id)
};
