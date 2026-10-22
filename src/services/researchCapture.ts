import type { Note, ResearchSourceType } from "../types";
import { extractDomain, normalizeContextUrl } from "../utils/url";
import { capturedEmailContent, extractActiveEmail } from "./emailCapture";
import { extractActivePageContent } from "./pageContent";

/** Per-source cap on stored text. Longer sources keep their start and end, with a marker in between. */
export const SNAPSHOT_MAX_CHARACTERS = 50_000;

/** What will be stored if the user confirms. Nothing is saved until then. */
export interface CaptureDraft {
  sourceType: ResearchSourceType;
  title: string;
  url?: string;
  normalizedUrl?: string;
  domain?: string;
  text: string;
  truncated: boolean;
  /** Groups re-captures of the same page, email or note into versions. Selections never version. */
  versionKey?: string;
}

export function normalizeSnapshotText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function limitSnapshot(text: string, max = SNAPSHOT_MAX_CHARACTERS): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  const marker = "\n\n[… content shortened by Workpad …]\n\n";
  const available = Math.max(0, max - marker.length);
  const head = Math.floor(available * .78);
  return { text: `${text.slice(0, head)}${marker}${text.slice(-(available - head))}`, truncated: true };
}

export async function contentHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function urlFields(url: string, removeTracking: boolean) {
  const normalizedUrl = normalizeContextUrl(url, removeTracking);
  return { url, normalizedUrl, domain: extractDomain(url) };
}

/** Reads the active tab only now, after the user chose Add to research. Throws PageAccessError when access is needed. */
export async function capturePageDrafts(removeTracking = true): Promise<{ page: CaptureDraft; selection?: CaptureDraft }> {
  const content = await extractActivePageContent(SNAPSHOT_MAX_CHARACTERS);
  const fields = urlFields(content.url, removeTracking);
  const title = content.title.trim() || fields.domain || "Untitled page";
  const page: CaptureDraft = { sourceType: "page", title, ...fields, text: normalizeSnapshotText(content.text), truncated: content.truncated, versionKey: `page:${fields.normalizedUrl}` };
  const selectionText = normalizeSnapshotText(content.selection);
  const selection: CaptureDraft | undefined = selectionText
    ? { sourceType: "selection", title: `Selection: ${title}`, ...fields, text: selectionText, truncated: content.selection.includes("[… content shortened by Workpad …]") }
    : undefined;
  return { page, selection };
}

export async function captureEmailDraft(removeTracking = true): Promise<CaptureDraft> {
  const email = await extractActiveEmail(SNAPSHOT_MAX_CHARACTERS);
  const fields = urlFields(email.url, removeTracking);
  const limited = limitSnapshot(normalizeSnapshotText(capturedEmailContent(email)));
  return { sourceType: "email", title: email.subject || "Email", ...fields, ...limited, truncated: limited.truncated || email.body.length >= SNAPSHOT_MAX_CHARACTERS, versionKey: `email:${fields.normalizedUrl}` };
}

export function noteDraft(note: Note): CaptureDraft {
  const title = note.title.trim() || note.pageTitle || "Untitled note";
  const body = normalizeSnapshotText(note.title.trim() ? `${note.title.trim()}\n\n${note.content}` : note.content);
  const limited = limitSnapshot(body);
  return {
    sourceType: note.tags.includes("ai") ? "ai_result" : "note",
    title,
    url: note.pageUrl,
    normalizedUrl: note.normalizedPageUrl,
    domain: note.domain,
    ...limited,
    versionKey: `note:${note.id}`
  };
}
