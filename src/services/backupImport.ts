import { db } from "../db/database";
import { MAX_PROJECT_NAME_LENGTH } from "../db/repositories/projectsRepository";
import type { DecisionBrief, Note, ResearchProject, ResearchSource, WorkpadBackup } from "../types";

export interface ImportSummary {
  notes: number;
  projectsAdded: number;
  projectsMerged: number;
  sourcesAdded: number;
  sourcesSkipped: number;
  briefsAdded: number;
  briefsSkipped: number;
}

/** Describes what a backup contains, for the confirmation before importing. */
export function describeBackup(backup: WorkpadBackup): string {
  const parts = [`${backup.notes.length} ${backup.notes.length === 1 ? "note" : "notes"}`];
  const projects = backup.projects?.length ?? 0;
  if (projects) parts.push(`${projects} research ${projects === 1 ? "project" : "projects"} with ${backup.sources?.length ?? 0} sources and ${backup.briefs?.length ?? 0} briefs`);
  return parts.join(" and ");
}

function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name.toLowerCase())) return name;
  for (let attempt = 1; ; attempt += 1) {
    const suffix = attempt === 1 ? " (imported)" : ` (imported ${attempt})`;
    const candidate = `${name.slice(0, MAX_PROJECT_NAME_LENGTH - suffix.length)}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * Merges a backup into this device without overwriting anything.
 * Notes and projects whose ids are taken get new ids. A project with the same id as one here is treated as the
 * same project, so restoring a backup twice adds only what is missing. Sources whose text a project already has
 * and briefs already present are skipped. Links between sources, versions and briefs follow any new ids.
 */
export async function importBackup(backup: WorkpadBackup): Promise<ImportSummary> {
  const summary: ImportSummary = { notes: 0, projectsAdded: 0, projectsMerged: 0, sourcesAdded: 0, sourcesSkipped: 0, briefsAdded: 0, briefsSkipped: 0 };

  await db.transaction("rw", [db.notes, db.projects, db.sources, db.briefs], async () => {
    const usedNoteIds = new Set((await db.notes.toCollection().primaryKeys()).map(String));
    const notes: Note[] = backup.notes.map((note) => {
      const id = usedNoteIds.has(note.id) ? crypto.randomUUID() : note.id;
      usedNoteIds.add(id);
      return { ...note, id };
    });
    await db.notes.bulkAdd(notes);
    summary.notes = notes.length;

    const existingProjects = await db.projects.toArray();
    const existingIds = new Set(existingProjects.map((project) => project.id));
    const takenNames = new Set(existingProjects.map((project) => project.name.toLowerCase()));
    const projectIds = new Map<string, string>();
    const newProjects: ResearchProject[] = [];
    for (const project of backup.projects ?? []) {
      if (existingIds.has(project.id)) { projectIds.set(project.id, project.id); summary.projectsMerged += 1; continue; }
      const name = uniqueName(project.name, takenNames);
      takenNames.add(name.toLowerCase());
      existingIds.add(project.id);
      projectIds.set(project.id, project.id);
      newProjects.push({ ...project, name });
    }
    await db.projects.bulkAdd(newProjects);
    summary.projectsAdded = newProjects.length;

    const usedSourceIds = new Set((await db.sources.toCollection().primaryKeys()).map(String));
    const hashes = new Map<string, string>();
    for (const source of await db.sources.where("projectId").anyOf(Array.from(projectIds.values())).toArray()) hashes.set(`${source.projectId}|${source.contentHash}`, source.id);
    const sourceIds = new Map<string, string>();
    const newSources: ResearchSource[] = [];
    for (const source of backup.sources ?? []) {
      const projectId = projectIds.get(source.projectId);
      if (!projectId) { summary.sourcesSkipped += 1; continue; }
      const duplicate = hashes.get(`${projectId}|${source.contentHash}`);
      if (duplicate) { sourceIds.set(source.id, duplicate); summary.sourcesSkipped += 1; continue; }
      const id = usedSourceIds.has(source.id) ? crypto.randomUUID() : source.id;
      usedSourceIds.add(id);
      sourceIds.set(source.id, id);
      hashes.set(`${projectId}|${source.contentHash}`, id);
      newSources.push({ ...source, id, projectId });
    }
    for (const source of newSources) if (source.previousVersionId) source.previousVersionId = sourceIds.get(source.previousVersionId) ?? source.previousVersionId;
    await db.sources.bulkAdd(newSources);
    summary.sourcesAdded = newSources.length;

    const existingBriefIds = new Set((await db.briefs.toCollection().primaryKeys()).map(String));
    const newBriefs: DecisionBrief[] = [];
    for (const brief of backup.briefs ?? []) {
      const projectId = projectIds.get(brief.projectId);
      if (!projectId || existingBriefIds.has(brief.id)) { summary.briefsSkipped += 1; continue; }
      existingBriefIds.add(brief.id);
      newBriefs.push({ ...brief, projectId, evidence: brief.evidence.map((item) => ({ ...item, sourceId: sourceIds.get(item.sourceId) ?? item.sourceId })) });
    }
    await db.briefs.bulkAdd(newBriefs);
    summary.briefsAdded = newBriefs.length;
  });

  return summary;
}
