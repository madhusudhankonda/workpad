import type { PageContext } from "../types";
import { extractDomain, isRestrictedUrl, normalizeContextUrl } from "../utils/url";

export async function getActivePageContext(removeTracking = true): Promise<PageContext> {
  if (!globalThis.chrome?.tabs) throw new Error("Chrome APIs are unavailable outside the extension.");
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const url = tab?.url ?? "";
  const restricted = isRestrictedUrl(url);
  return {
    url,
    normalizedUrl: restricted ? "" : normalizeContextUrl(url, removeTracking),
    domain: restricted ? "" : extractDomain(url),
    title: tab?.title || "Untitled page",
    faviconUrl: tab?.favIconUrl,
    restricted
  };
}

export function subscribeToActivePageChanges(onChange: () => void): () => void {
  if (!globalThis.chrome?.tabs) return () => undefined;
  const onActivated = () => onChange();
  const onUpdated = (_tabId: number, changeInfo: { url?: string; title?: string; status?: string }, tab: chrome.tabs.Tab) => {
    if (tab.active && (changeInfo.url !== undefined || changeInfo.title !== undefined || changeInfo.status === "complete")) onChange();
  };
  const onFocusChanged = (windowId: number) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) onChange();
  };
  chrome.tabs.onActivated.addListener(onActivated);
  chrome.tabs.onUpdated.addListener(onUpdated);
  chrome.windows.onFocusChanged.addListener(onFocusChanged);
  return () => {
    chrome.tabs.onActivated.removeListener(onActivated);
    chrome.tabs.onUpdated.removeListener(onUpdated);
    chrome.windows.onFocusChanged.removeListener(onFocusChanged);
  };
}

export async function sendWorkpadCommand(command: string) {
  if (globalThis.chrome?.runtime) await chrome.runtime.sendMessage({ type: "WORKPAD_COMMAND", command });
}
