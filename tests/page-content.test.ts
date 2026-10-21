import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEvidencePassages, evidenceSource, highlightPageEvidence, requestPageAccess } from "../src/services/pageContent";

describe("page access", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("requests optional access only for the active website", async () => {
    const request = vi.fn().mockResolvedValue(true);
    vi.stubGlobal("chrome", {
      permissions: { request }
    });

    await expect(requestPageAccess("https://example.com/article")).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith({ origins: ["https://example.com/*"] });
  });

  it("does not request access for restricted browser pages", async () => {
    const request = vi.fn();
    vi.stubGlobal("chrome", {
      permissions: { request }
    });

    await expect(requestPageAccess("chrome://extensions")).resolves.toBe(false);
    expect(request).not.toHaveBeenCalled();
  });

  it("turns page text into numbered, bounded evidence passages", () => {
    const passages = buildEvidencePassages(`First supporting paragraph.\n\nSecond supporting paragraph.\n\nFirst supporting paragraph.`, 40);
    expect(passages).toEqual([
      { id: "P1", text: "First supporting paragraph." },
      { id: "P2", text: "Second supporting paragraph." }
    ]);
    expect(evidenceSource(passages)).toBe("[P1] First supporting paragraph.\n\n[P2] Second supporting paragraph.");
  });

  it("asks Chrome to highlight a supporting passage on the active page", async () => {
    const executeScript = vi.fn().mockResolvedValue([{ result: true }]);
    vi.stubGlobal("chrome", {
      tabs: { query: vi.fn().mockResolvedValue([{ id: 7, url: "https://example.com/article" }]) },
      scripting: { executeScript }
    });
    await expect(highlightPageEvidence("Supporting sentence")).resolves.toBe(true);
    expect(executeScript).toHaveBeenCalledWith(expect.objectContaining({ target: { tabId: 7 }, args: ["Supporting sentence"] }));
  });
});
