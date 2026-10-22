import type { EvidencePassage, ExtractedPageContent } from "../types";
import { isRestrictedUrl } from "../utils/url";

function permissionPattern(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? `${parsed.origin}/*` : undefined;
  } catch {
    return undefined;
  }
}

export function requestPageAccess(url: string): Promise<boolean> {
  if (!globalThis.chrome?.permissions) return Promise.resolve(false);
  const origin = permissionPattern(url);
  if (!origin) return Promise.resolve(false);
  return chrome.permissions.request({ origins: [origin] });
}

export class PageAccessError extends Error {
  constructor(public readonly pageUrl: string, cause: unknown) {
    super("Workpad needs access to this website before it can read the page text.", { cause });
    this.name = "PageAccessError";
  }
}

export function buildEvidencePassages(source: string, maxPassageCharacters = 700): EvidencePassage[] {
  const clean = (value: string) => value.replace(/\s+/g, " ").trim();
  const passages: string[] = [];
  const seen = new Set<string>();

  for (const rawBlock of source.split(/\n+/)) {
    let block = clean(rawBlock);
    while (block) {
      let passage = block;
      if (passage.length > maxPassageCharacters) {
        const candidate = passage.slice(0, maxPassageCharacters);
        const sentenceBreak = Math.max(candidate.lastIndexOf(". "), candidate.lastIndexOf("? "), candidate.lastIndexOf("! "));
        const wordBreak = candidate.lastIndexOf(" ");
        const splitAt = sentenceBreak > maxPassageCharacters * .55 ? sentenceBreak + 1 : wordBreak > 0 ? wordBreak : maxPassageCharacters;
        passage = block.slice(0, splitAt);
        block = block.slice(splitAt).trim();
      } else block = "";
      passage = clean(passage);
      if (passage.length >= 8 && !seen.has(passage)) {
        seen.add(passage);
        passages.push(passage);
      }
    }
  }
  return passages.map((text, index) => ({ id: `P${index + 1}`, text }));
}

export function evidenceSource(passages: EvidencePassage[]): string {
  return passages.map((passage) => `[${passage.id}] ${passage.text}`).join("\n\n");
}

export async function highlightPageEvidence(text: string): Promise<boolean> {
  if (!globalThis.chrome?.tabs || !globalThis.chrome?.scripting) return false;
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || isRestrictedUrl(tab.url ?? "")) return false;
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    args: [text],
    func: (evidence: string) => {
      const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();
      const needle = normalize(evidence);
      const elements = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, td"))
        .filter((element): element is HTMLElement => element instanceof HTMLElement)
        .map((element) => ({ element, text: normalize(element.innerText ?? "") }))
        .filter((candidate) => candidate.text && (candidate.text.includes(needle) || needle.includes(candidate.text)))
        .sort((left, right) => left.text.length - right.text.length);
      const match = elements[0]?.element;
      if (!match) return false;
      match.scrollIntoView({ behavior: "smooth", block: "center" });
      const previousOutline = match.style.outline;
      const previousBackground = match.style.backgroundColor;
      const previousRadius = match.style.borderRadius;
      const previousTransition = match.style.transition;
      match.style.transition = "outline-color .2s ease, background-color .2s ease";
      match.style.outline = "3px solid #6b5cda";
      match.style.backgroundColor = "#fff3a8";
      match.style.borderRadius = "4px";
      window.setTimeout(() => {
        match.style.outline = previousOutline;
        match.style.backgroundColor = previousBackground;
        match.style.borderRadius = previousRadius;
        match.style.transition = previousTransition;
      }, 4_000);
      return true;
    }
  });
  return injection?.result === true;
}

export async function extractActivePageContent(maxCharacters = 40_000): Promise<ExtractedPageContent> {
  if (!globalThis.chrome?.tabs || !globalThis.chrome?.scripting) {
    throw new Error("Chrome page access is unavailable.");
  }

  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || isRestrictedUrl(tab.url ?? "")) {
    throw new Error("Workpad cannot read this browser page.");
  }

  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [maxCharacters],
      func: (limit: number) => {
        const clean = (value: string) => value
          .replace(/\u00a0/g, " ")
          .replace(/[ \t]+\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
        const selection = clean(window.getSelection()?.toString() ?? "");
        const semantic = Array.from(document.querySelectorAll("article, main, [role='main']"))
          .filter((element): element is HTMLElement => element instanceof HTMLElement)
          .map((element) => ({ element, length: clean(element.innerText ?? "").length }))
          .sort((left, right) => right.length - left.length)[0];
        const root = semantic && semantic.length >= 500 ? semantic.element : document.body ?? document.documentElement;
        const clone = root?.cloneNode(true) as HTMLElement | undefined;
        clone?.querySelectorAll("script, style, noscript, nav, header, footer, aside, form, dialog, iframe, canvas, svg").forEach((element) => element.remove());
        clone?.querySelectorAll("h1, h2, h3, h4, h5, h6, p, li, blockquote, pre, br, section, article, div").forEach((element) => element.append("\n"));
        const pageText = clean(clone?.textContent ?? root?.innerText ?? "");
        const clip = (value: string) => {
          if (value.length <= limit) return value;
          const marker = "\n\n[… content shortened by Workpad …]\n\n";
          const available = Math.max(0, limit - marker.length);
          const head = Math.floor(available * .78);
          return `${value.slice(0, head)}${marker}${value.slice(-(available - head))}`;
        };
        return {
          title: document.title,
          url: location.href,
          selection: clip(selection),
          text: clip(pageText),
          truncated: pageText.length > limit
        };
      }
    });

    if (!injection?.result) throw new Error("No readable page content was found.");
    return injection.result as ExtractedPageContent;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/permission|cannot access|extensions gallery/i.test(message)) {
      throw new PageAccessError(tab.url ?? "", error);
    }
    throw error;
  }
}

/** Text currently selected in the active tab, or "" when there is none or the page cannot be read. Reads nothing else. */
export async function readActiveSelection(maxCharacters = 10_000): Promise<string> {
  if (!globalThis.chrome?.tabs || !globalThis.chrome?.scripting) return "";
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id || isRestrictedUrl(tab.url ?? "")) return "";
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [maxCharacters],
      func: (limit: number) => (window.getSelection()?.toString() ?? "").replace(/\u00a0/g, " ").trim().slice(0, limit)
    });
    return typeof injection?.result === "string" ? injection.result : "";
  } catch {
    return "";
  }
}
