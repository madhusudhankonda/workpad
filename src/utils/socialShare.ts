import type { Note } from "../types";
import { displayNoteTitle } from "./noteOrganization";

export type SocialPlatform = "x" | "reddit" | "linkedin";

const plainText = (value: string) => value.replace(/[#*_>`~]/g, "").replace(/\[|\]/g, "").replace(/\s+/g, " ").trim();

export function socialDraft(note: Note, platform: SocialPlatform): string {
  const title = displayNoteTitle(note);
  const content = plainText(note.content);
  const limit = platform === "x" ? 210 : platform === "reddit" ? 500 : 700;
  const excerpt = content.slice(0, limit).trim();
  return excerpt ? `${title}\n\n${excerpt}${content.length > limit ? "…" : ""}` : title;
}

export function socialComposerUrl(platform: SocialPlatform, note: Note, draft: string, includeSource: boolean): string {
  const source = includeSource ? note.pageUrl ?? "" : "";
  if (platform === "x") {
    const text = [draft.trim(), source].filter(Boolean).join("\n\n");
    return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
  }
  if (platform === "reddit") {
    const params = new URLSearchParams({ title: draft.split("\n")[0].slice(0, 300) });
    if (source) params.set("url", source);
    return `https://www.reddit.com/submit?${params.toString()}`;
  }
  return source ? `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(source)}` : "https://www.linkedin.com/feed/";
}

export const shareText = (note: Note, draft: string, includeSource: boolean) => [draft.trim(), includeSource ? note.pageUrl : ""].filter(Boolean).join("\n\n");

export function socialDraftFromAI(value: string): string {
  return value.replace(/\s*\[P\d+\]/g, "").replace(/[**_`~]/g, "").replace(/[ \t]+\n/g, "\n").trim();
}
