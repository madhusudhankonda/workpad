import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db/database";
import { projectsRepository } from "../src/db/repositories/projectsRepository";
import { describeBackup, importBackup } from "../src/services/backupImport";
import type { DecisionBrief, Note, ResearchProject, ResearchSource, WorkpadBackup } from "../src/types";
import { createBackup, validateBackup } from "../src/utils/backup";

const at = "2026-10-20T10:00:00.000Z";
const note: Note = { id: "n1", title: "Note", content: "Text", type: "standalone", tags: [], isFavourite: false, isArchived: false, createdAt: at, updatedAt: at };
const project: ResearchProject = { id: "p1", name: "CRM selection", description: "Pick a CRM", createdAt: at, updatedAt: at };
const source = (id: string, hash: string, extra: Partial<ResearchSource> = {}): ResearchSource => ({
  id, projectId: "p1", sourceType: "page", title: `Source ${id}`, url: "https://example.com", snapshotText: `Text ${id}`, snapshotTruncated: false,
  contentHash: hash, version: 1, capturedAt: at, createdAt: at, updatedAt: at, ...extra
});
const brief: DecisionBrief = {
  id: "b1", projectId: "p1", title: "Brief", objective: "Pick", content: "## Key findings\n- A [S1:P1]", truncated: false, createdAt: at, updatedAt: at,
  evidence: [{ label: "S1", sourceId: "s2", title: "Source s2", capturedAt: at, passages: [{ id: "P1", text: "Text s2" }] }]
};
const backup = (): WorkpadBackup => createBackup([note], undefined, { projects: [project], sources: [source("s1", "h1"), source("s2", "h2", { version: 2, previousVersionId: "s1", versionKey: "page:x" })], briefs: [brief] });

describe("backup format", () => {
  it("exports version 2 with research data and still accepts version 1", () => {
    const value = JSON.parse(JSON.stringify(backup()));
    expect(value.version).toBe(2);
    expect(validateBackup(value)).toBe(true);
    expect(validateBackup({ version: 1, exportedAt: "now", notes: [] })).toBe(true);
    expect(validateBackup({ version: 1, exportedAt: "now", notes: [], projects: [project] })).toBe(false);
    expect(validateBackup({ version: 3, exportedAt: "now", notes: [] })).toBe(false);
  });

  it("rejects malformed research records", () => {
    const value = backup();
    expect(validateBackup({ ...value, sources: [{ ...value.sources![0], sourceType: "video" }] })).toBe(false);
    expect(validateBackup({ ...value, sources: [{ ...value.sources![0], snapshotText: "x".repeat(60_001) }] })).toBe(false);
    expect(validateBackup({ ...value, projects: [{ ...project, name: "  " }] })).toBe(false);
    expect(validateBackup({ ...value, briefs: [{ ...brief, evidence: [{ ...brief.evidence[0], passages: [{ id: 1 }] }] }] })).toBe(false);
  });

  it("describes its contents for the import confirmation", () => {
    expect(describeBackup(backup())).toBe("1 note and 1 research project with 2 sources and 1 briefs");
    expect(describeBackup({ version: 1, exportedAt: at, notes: [] })).toBe("0 notes");
  });
});

describe("backup import", () => {
  beforeEach(async () => { await Promise.all([db.notes.clear(), db.projects.clear(), db.sources.clear(), db.briefs.clear()]); });

  it("restores projects, sources, versions and briefs into an empty device", async () => {
    const summary = await importBackup(backup());
    expect(summary).toEqual({ notes: 1, projectsAdded: 1, projectsMerged: 0, sourcesAdded: 2, sourcesSkipped: 0, briefsAdded: 1, briefsSkipped: 0 });
    expect(await db.sources.get("s2")).toMatchObject({ projectId: "p1", previousVersionId: "s1", version: 2 });
    expect((await db.briefs.get("b1"))?.evidence[0].sourceId).toBe("s2");
  });

  it("adds only what is missing when the same backup is restored twice", async () => {
    await importBackup(backup());
    const again = await importBackup(backup());
    expect(again).toMatchObject({ projectsAdded: 0, projectsMerged: 1, sourcesAdded: 0, sourcesSkipped: 2, briefsAdded: 0, briefsSkipped: 1 });
    expect(await db.projects.count()).toBe(1);
    expect(await db.sources.count()).toBe(2);
    expect(await db.notes.count()).toBe(2);
  });

  it("never overwrites: renames clashing projects and re-ids clashing sources, keeping links intact", async () => {
    await projectsRepository.create("CRM selection");
    await db.sources.add({ ...source("s1", "other"), projectId: "elsewhere" });
    await db.notes.add(note);

    const summary = await importBackup(backup());

    expect(summary.projectsAdded).toBe(1);
    const imported = (await db.projects.toArray()).find((item) => item.id === "p1");
    expect(imported?.name).toBe("CRM selection (imported)");
    expect((await db.sources.get("s1"))?.projectId).toBe("elsewhere");
    const restored = await db.sources.where("projectId").equals("p1").toArray();
    const first = restored.find((item) => item.contentHash === "h1")!;
    expect(first.id).not.toBe("s1");
    expect(restored.find((item) => item.contentHash === "h2")?.previousVersionId).toBe(first.id);
    expect(await db.notes.count()).toBe(2);
  });

  it("merges into an existing project, skipping text it already has", async () => {
    await db.projects.add(project);
    await db.sources.add({ ...source("local", "h1"), projectId: "p1" });
    const summary = await importBackup(backup());
    expect(summary).toMatchObject({ projectsMerged: 1, sourcesAdded: 1, sourcesSkipped: 1, briefsAdded: 1 });
    expect((await db.sources.get("s2"))?.previousVersionId).toBe("local");
  });

  it("skips sources and briefs whose project is not in the backup", async () => {
    const value = { ...backup(), projects: [] };
    const summary = await importBackup(value);
    expect(summary).toMatchObject({ projectsAdded: 0, sourcesAdded: 0, sourcesSkipped: 2, briefsAdded: 0, briefsSkipped: 1 });
  });
});
