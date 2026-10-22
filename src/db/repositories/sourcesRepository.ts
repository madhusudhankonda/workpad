import { db } from "../database";
import type { ResearchSource } from "../../types";
import { contentHash, normalizeSnapshotText, type CaptureDraft } from "../../services/researchCapture";

export type AddSourceStatus = "added" | "duplicate" | "new_version";

const byNewest = (a: ResearchSource, b: ResearchSource) => b.capturedAt.localeCompare(a.capturedAt);

export const sourcesRepository = {
  /**
   * Stores a frozen snapshot in a project. Identical text already in the project is not stored twice.
   * Re-capturing a page, email or note whose text changed adds a new version and keeps the old one.
   */
  async addToProject(projectId: string, draft: CaptureDraft): Promise<{ source: ResearchSource; status: AddSourceStatus }> {
    const text = normalizeSnapshotText(draft.text);
    if (!text) throw new Error("There is no text to add from this source.");
    const hash = await contentHash(text);

    return db.transaction("rw", db.projects, db.sources, async () => {
      const project = await db.projects.get(projectId);
      if (!project) throw new Error("This project no longer exists.");

      const duplicate = await db.sources.where("[projectId+contentHash]").equals([projectId, hash]).first();
      if (duplicate) return { source: duplicate, status: "duplicate" as const };

      const previous = draft.versionKey
        ? (await db.sources.where("projectId").equals(projectId).filter((source) => source.versionKey === draft.versionKey).toArray()).sort((a, b) => b.version - a.version)[0]
        : undefined;
      const now = new Date().toISOString();
      const source: ResearchSource = {
        id: crypto.randomUUID(),
        projectId,
        sourceType: draft.sourceType,
        title: draft.title,
        url: draft.url,
        normalizedUrl: draft.normalizedUrl,
        domain: draft.domain,
        snapshotText: text,
        snapshotTruncated: draft.truncated,
        contentHash: hash,
        version: previous ? previous.version + 1 : 1,
        previousVersionId: previous?.id,
        versionKey: draft.versionKey,
        capturedAt: now,
        createdAt: now,
        updatedAt: now
      };
      await db.sources.add(source);
      await db.projects.update(projectId, { updatedAt: now });
      return { source, status: previous ? "new_version" as const : "added" as const };
    });
  },

  async listForProject(projectId: string): Promise<ResearchSource[]> {
    return (await db.sources.where("projectId").equals(projectId).toArray()).sort(byNewest);
  },

  getById: (id: string) => db.sources.get(id),

  async remove(id: string): Promise<void> {
    await db.transaction("rw", db.projects, db.sources, async () => {
      const source = await db.sources.get(id);
      if (!source) return;
      await db.sources.delete(id);
      await db.projects.update(source.projectId, { updatedAt: new Date().toISOString() });
    });
  }
};
