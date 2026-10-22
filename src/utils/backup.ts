import type { BriefEvidence, DecisionBrief, Note, ResearchProject, ResearchSource, Settings, WorkpadBackup } from "../types";

const noteTypes = new Set(["scratchpad", "page", "domain", "standalone"]);
const themes = new Set(["light", "dark", "system"]);
const sections = new Set(["page", "scratchpad", "all", "favourites"]);
/** Research snapshots can be up to 50,000 characters each, so backups are allowed to be larger than notes alone. */
export const MAX_BACKUP_BYTES = 40 * 1024 * 1024;
export const MAX_BACKUP_NOTES = 5_000;
export const MAX_BACKUP_PROJECTS = 500;
export const MAX_BACKUP_SOURCES = 5_000;
export const MAX_BACKUP_BRIEFS = 1_000;
const sourceTypes = new Set(["page", "selection", "email", "note", "ai_result"]);
const MAX_TEXT_LENGTH = 200_000;
const MAX_TAGS = 50;
const MAX_TAG_LENGTH = 100;

function isString(value: unknown, maxLength = MAX_TEXT_LENGTH): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || isString(value);
}

function isValidNote(note: unknown): note is Note {
  if (!note || typeof note !== "object") return false;
  const candidate = note as Partial<Note>;
  return (
    isString(candidate.id, 100) &&
    isString(candidate.title) &&
    isString(candidate.content) &&
    noteTypes.has(candidate.type ?? "") &&
    Array.isArray(candidate.tags) &&
    candidate.tags.length <= MAX_TAGS &&
    candidate.tags.every((tag) => isString(tag, MAX_TAG_LENGTH)) &&
    typeof candidate.isFavourite === "boolean" &&
    typeof candidate.isArchived === "boolean" &&
    isString(candidate.createdAt, 100) &&
    isString(candidate.updatedAt, 100) &&
    isOptionalString(candidate.pageUrl) &&
    isOptionalString(candidate.normalizedPageUrl) &&
    isOptionalString(candidate.domain) &&
    isOptionalString(candidate.pageTitle) &&
    isOptionalString(candidate.faviconUrl)
  );
}

function isValidProject(project: unknown): project is ResearchProject {
  if (!project || typeof project !== "object") return false;
  const candidate = project as Partial<ResearchProject>;
  return isString(candidate.id, 100) && isString(candidate.name, 80) && candidate.name.trim() !== "" && isString(candidate.description, 500) && isString(candidate.createdAt, 100) && isString(candidate.updatedAt, 100);
}

function isValidSource(source: unknown): source is ResearchSource {
  if (!source || typeof source !== "object") return false;
  const candidate = source as Partial<ResearchSource>;
  return (
    isString(candidate.id, 100) &&
    isString(candidate.projectId, 100) &&
    sourceTypes.has(candidate.sourceType ?? "") &&
    isString(candidate.title, 2_000) &&
    isString(candidate.snapshotText, 60_000) &&
    typeof candidate.snapshotTruncated === "boolean" &&
    isString(candidate.contentHash, 100) &&
    Number.isInteger(candidate.version) && (candidate.version ?? 0) >= 1 &&
    isString(candidate.capturedAt, 100) &&
    isString(candidate.createdAt, 100) &&
    isString(candidate.updatedAt, 100) &&
    isOptionalString(candidate.url) &&
    isOptionalString(candidate.normalizedUrl) &&
    isOptionalString(candidate.domain) &&
    isOptionalString(candidate.previousVersionId) &&
    isOptionalString(candidate.versionKey)
  );
}

function isValidEvidence(evidence: unknown): evidence is BriefEvidence {
  if (!evidence || typeof evidence !== "object") return false;
  const candidate = evidence as Partial<BriefEvidence>;
  return isString(candidate.label, 10) && isString(candidate.sourceId, 100) && isString(candidate.title, 2_000) && isString(candidate.capturedAt, 100) && isOptionalString(candidate.url) &&
    Array.isArray(candidate.passages) && candidate.passages.length <= 500 &&
    candidate.passages.every((passage) => Boolean(passage) && isString(passage.id, 10) && isString(passage.text, 5_000));
}

function isValidBrief(brief: unknown): brief is DecisionBrief {
  if (!brief || typeof brief !== "object") return false;
  const candidate = brief as Partial<DecisionBrief>;
  return (
    isString(candidate.id, 100) &&
    isString(candidate.projectId, 100) &&
    isString(candidate.title, 500) &&
    isString(candidate.objective, 2_000) &&
    isString(candidate.content) &&
    Array.isArray(candidate.evidence) && candidate.evidence.length <= 50 && candidate.evidence.every(isValidEvidence) &&
    typeof candidate.truncated === "boolean" &&
    isString(candidate.createdAt, 100) &&
    isString(candidate.updatedAt, 100) &&
    isOptionalString(candidate.model)
  );
}

function isValidSettings(settings: unknown): settings is Settings {
  if (!settings || typeof settings !== "object") return false;
  const candidate = settings as Partial<Settings>;
  return candidate.id === "settings" &&
    themes.has(candidate.theme ?? "") &&
    sections.has(candidate.defaultOpeningSection ?? "") &&
    typeof candidate.autoSaveDebounce === "number" &&
    candidate.autoSaveDebounce >= 300 &&
    candidate.autoSaveDebounce <= 2_000 &&
    typeof candidate.removeTrackingParameters === "boolean" &&
    typeof candidate.onboardingCompleted === "boolean";
}

function isOptionalList<T>(value: unknown, max: number, check: (item: unknown) => item is T): boolean {
  return value === undefined || (Array.isArray(value) && value.length <= max && value.every(check));
}

export function validateBackup(value: unknown): value is WorkpadBackup {
  if (!value || typeof value !== "object") return false;
  const backup = value as Partial<WorkpadBackup>;
  const research = backup.version === 1
    ? backup.projects === undefined && backup.sources === undefined && backup.briefs === undefined
    : backup.version === 2 &&
      isOptionalList(backup.projects, MAX_BACKUP_PROJECTS, isValidProject) &&
      isOptionalList(backup.sources, MAX_BACKUP_SOURCES, isValidSource) &&
      isOptionalList(backup.briefs, MAX_BACKUP_BRIEFS, isValidBrief);
  return (
    research &&
    isString(backup.exportedAt, 100) &&
    Array.isArray(backup.notes) &&
    backup.notes.length <= MAX_BACKUP_NOTES &&
    backup.notes.every(isValidNote) &&
    (backup.settings === undefined || isValidSettings(backup.settings))
  );
}

export function createBackup(notes: Note[], settings?: Settings, research: { projects: ResearchProject[]; sources: ResearchSource[]; briefs: DecisionBrief[] } = { projects: [], sources: [], briefs: [] }): WorkpadBackup {
  return { version: 2, exportedAt: new Date().toISOString(), notes, settings, ...research };
}

export function downloadText(filename: string, text: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function noteMarkdown(note: Note): string {
  const context = note.pageUrl ? `\n\nSource: ${note.pageUrl}` : "";
  const tags = note.tags.length ? `\n\nTags: ${note.tags.map((tag) => `#${tag}`).join(" ")}` : "";
  return `# ${note.title || "Untitled note"}\n\n${note.content}${context}${tags}\n`;
}
