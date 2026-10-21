import { afterEach, describe, expect, it, vi } from "vitest";
import { subscribeToActivePageChanges } from "../src/services/chrome";

describe("active page changes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("notifies Workpad when the active tab navigates in place", () => {
    let updated: ((tabId: number, change: { url?: string; title?: string; status?: string }, tab: chrome.tabs.Tab) => void) | undefined;
    const removeUpdated = vi.fn();
    vi.stubGlobal("chrome", {
      tabs: {
        onActivated: { addListener: vi.fn(), removeListener: vi.fn() },
        onUpdated: { addListener: vi.fn((listener) => { updated = listener; }), removeListener: removeUpdated }
      },
      windows: { WINDOW_ID_NONE: -1, onFocusChanged: { addListener: vi.fn(), removeListener: vi.fn() } }
    });
    const changed = vi.fn();
    const unsubscribe = subscribeToActivePageChanges(changed);

    updated?.(7, { url: "https://huggingface.co" }, { active: true } as chrome.tabs.Tab);
    expect(changed).toHaveBeenCalledOnce();
    updated?.(7, { url: "https://example.com" }, { active: false } as chrome.tabs.Tab);
    expect(changed).toHaveBeenCalledOnce();

    unsubscribe();
    expect(removeUpdated).toHaveBeenCalledOnce();
  });
});
