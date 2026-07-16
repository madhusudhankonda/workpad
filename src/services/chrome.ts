import type { PageContext } from "../types";
import { extractDomain, isRestrictedUrl, normalizeUrl } from "../utils/url";

export async function getActivePageContext(removeTracking = true): Promise<PageContext> {
  if (!globalThis.chrome?.tabs) throw new Error("Chrome APIs are unavailable outside the extension.");
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const url = tab?.url ?? "";
  const restricted = isRestrictedUrl(url);
  return {
    url,
    normalizedUrl: restricted ? "" : normalizeUrl(url, removeTracking),
    domain: restricted ? "" : extractDomain(url),
    title: tab?.title || "Untitled page",
    faviconUrl: tab?.favIconUrl,
    restricted
  };
}

export async function sendWorkpadCommand(command: string) {
  if (globalThis.chrome?.runtime) await chrome.runtime.sendMessage({ type: "WORKPAD_COMMAND", command });
}
