import { db } from "../database";
import type { ResearchProject } from "../../types";

export const MAX_PROJECT_NAME_LENGTH = 80;
export const MAX_PROJECT_DESCRIPTION_LENGTH = 500;

export interface ProjectSummary extends ResearchProject {
  sourceCount: number;
  /** Latest change to the project or any of its sources. */
  lastActivityAt: string;
}

function cleanName(name: string): string {
  const value = name.replace(/\s+/g, " ").trim();
  if (!value) throw new Error("Give the project a name.");
  if (value.length > MAX_PROJECT_NAME_LENGTH) throw new Error(`Project names can be up to ${MAX_PROJECT_NAME_LENGTH} characters.`);
  return value;
}

function cleanDescription(description: string): string {
  const value = description.trim();
  if (value.length > MAX_PROJECT_DESCRIPTION_LENGTH) throw new Error(`Descriptions can be up to ${MAX_PROJECT_DESCRIPTION_LENGTH} characters.`);
  return value;
}

async function assertUniqueName(name: string, exceptId?: string): Promise<void> {
  const lower = name.toLowerCase();
  const clash = await db.projects.filter((project) => project.id !== exceptId && project.name.toLowerCase() === lower).first();
  if (clash) throw new Error(`A project called “${clash.name}” already exists.`);
}

export const projectsRepository = {
  async create(name: string, description = ""): Promise<ResearchProject> {
    const now = new Date().toISOString();
    const project: ResearchProject = { id: crypto.randomUUID(), name: cleanName(name), description: cleanDescription(description), createdAt: now, updatedAt: now };
    await db.transaction("rw", db.projects, async () => {
      await assertUniqueName(project.name);
      await db.projects.add(project);
    });
    return project;
  },

  async update(id: string, changes: { name?: string; description?: string }): Promise<ResearchProject> {
    return db.transaction("rw", db.projects, async () => {
      const existing = await db.projects.get(id);
      if (!existing) throw new Error("This project no longer exists.");
      const name = changes.name === undefined ? existing.name : cleanName(changes.name);
      if (name.toLowerCase() !== existing.name.toLowerCase()) await assertUniqueName(name, id);
      const project = {
        ...existing,
        name,
        description: changes.description === undefined ? existing.description : cleanDescription(changes.description),
        updatedAt: new Date().toISOString()
      };
      await db.projects.put(project);
      return project;
    });
  },

  /** Deletes the project and every source and brief in it. */
  async delete(id: string): Promise<void> {
    await db.transaction("rw", db.projects, db.sources, db.briefs, async () => {
      await db.sources.where("projectId").equals(id).delete();
      await db.briefs.where("projectId").equals(id).delete();
      await db.projects.delete(id);
    });
  },

  getById: (id: string) => db.projects.get(id),

  /** Projects with source counts, most recently active first. */
  async list(): Promise<ProjectSummary[]> {
    const [projects, sources] = await Promise.all([db.projects.toArray(), db.sources.toArray()]);
    const stats = new Map<string, { count: number; latest: string }>();
    for (const source of sources) {
      const current = stats.get(source.projectId) ?? { count: 0, latest: "" };
      stats.set(source.projectId, { count: current.count + 1, latest: source.updatedAt > current.latest ? source.updatedAt : current.latest });
    }
    return projects
      .map((project) => {
        const stat = stats.get(project.id);
        return {
          ...project,
          sourceCount: stat?.count ?? 0,
          lastActivityAt: stat && stat.latest > project.updatedAt ? stat.latest : project.updatedAt
        };
      })
      .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  }
};
