import { describe, expect, it } from "vitest";
import type { Note } from "../src/types";
import { shareText, socialComposerUrl, socialDraft, socialDraftFromAI } from "../src/utils/socialShare";

const note: Note = { id: "n1", title: "AI copyright ruling", content: "A concise explanation with **markdown**.", type: "page", pageUrl: "https://example.com/story", normalizedPageUrl: "https://example.com/story", domain: "example.com", tags: [], isFavourite: false, isArchived: false, createdAt: "2026-08-24T10:00:00Z", updatedAt: "2026-08-24T10:00:00Z" };

describe("social sharing", () => {
  it("creates an editable plain-text draft", () => {
    expect(socialDraft(note, "x")).toBe("AI copyright ruling\n\nA concise explanation with markdown.");
  });
  it("opens an X composer with the draft and source", () => {
    const url = socialComposerUrl("x", note, "My take", true);
    expect(url).toContain("https://x.com/intent/post?");
    expect(decodeURIComponent(url)).toContain("My take\n\nhttps://example.com/story");
  });
  it("lets users omit the source", () => {
    expect(shareText(note, "My take", false)).toBe("My take");
  });
  it("removes private evidence markers from an AI social draft", () => {
    expect(socialDraftFromAI("A strong claim. [P1] [P3]")).toBe("A strong claim.");
  });
});
