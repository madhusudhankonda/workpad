const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid"
]);

export function isRestrictedUrl(url?: string): boolean {
  return !url || /^(chrome|edge|about|devtools|chrome-extension):/i.test(url);
}

export function extractDomain(url?: string): string {
  if (!url || isRestrictedUrl(url)) return "";
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

export function normalizeUrl(url: string, removeTracking = true): string {
  if (isRestrictedUrl(url)) return "";
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    if (removeTracking) {
      [...parsed.searchParams.keys()].forEach((key) => {
        if (TRACKING_PARAMS.has(key.toLowerCase())) parsed.searchParams.delete(key);
      });
    }
    if (parsed.pathname.length > 1) parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString();
  } catch {
    return "";
  }
}

export function normalizeContextUrl(url: string, removeTracking = true): string {
  const normalized = normalizeUrl(url, removeTracking);
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "mail.google.com" && parsed.hash) return `${normalized}${parsed.hash}`;
  } catch {
    return normalized;
  }
  return normalized;
}

export function noteMatchesPage(note: { type: string; normalizedPageUrl?: string }, url: string): boolean {
  return note.type === "page" && note.normalizedPageUrl === url;
}

export function noteMatchesDomain(note: { type: string; domain?: string }, domain: string): boolean {
  return note.type === "domain" && Boolean(domain) && note.domain === domain;
}
