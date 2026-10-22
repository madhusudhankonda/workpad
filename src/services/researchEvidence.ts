import type { EvidencePassage, ResearchSource } from "../types";
import { buildEvidencePassages } from "./pageContent";

/** Most sources one question can use, so every source still gets a meaningful share of the budget. */
export const MAX_SOURCES_PER_QUESTION = 12;

export type BudgetStatus = "full" | "shortened" | "omitted";

export interface SourceEvidence {
  /** Request-local label such as S1, in the order the user listed the sources. */
  label: string;
  source: ResearchSource;
  passages: EvidencePassage[];
  totalPassages: number;
  includedCharacters: number;
  totalCharacters: number;
  status: BudgetStatus;
}

export interface ProjectEvidence {
  /** Text sent to Workpad AI: one <SOURCE> block per included source. */
  text: string;
  sources: SourceEvidence[];
  /** Every included passage, keyed by its citation id such as "S2:P4". */
  passages: Map<string, { passage: EvidencePassage; evidence: SourceEvidence }>;
}

const escapeAttribute = (value: string) => value.replace(/[\n\r"<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);

function sourceHeader(label: string, source: ResearchSource): string {
  const attributes = [`id="${label}"`, `title="${escapeAttribute(source.title)}"`];
  if (source.url) attributes.push(`url="${escapeAttribute(source.url)}"`);
  attributes.push(`captured="${source.capturedAt.slice(0, 10)}"`);
  return `<SOURCE ${attributes.join(" ")}>`;
}

const passageLine = (label: string, passage: EvidencePassage) => `[${label}:${passage.id}] ${passage.text}`;

/**
 * Shares a character budget across sources deterministically: each source is offered an equal share,
 * sources that need less than their share give the rest back, and every source keeps its passages
 * from the start until its share runs out. Sources whose share cannot fit one passage are omitted.
 */
export function buildProjectEvidence(sources: ResearchSource[], budgetCharacters: number): ProjectEvidence {
  const prepared = sources.map((source, index) => {
    const label = `S${index + 1}`;
    const all = buildEvidencePassages(source.snapshotText);
    const header = sourceHeader(label, source);
    const lines = all.map((passage) => passageLine(label, passage));
    // Header, closing tag and newlines between lines.
    const overhead = header.length + "</SOURCE>".length + 2 + lines.length;
    const fullSize = overhead + lines.reduce((total, line) => total + line.length, 0);
    return { label, source, all, header, lines, fullSize };
  });

  const allocation = new Map<string, number>();
  let remaining = Math.max(0, budgetCharacters - Math.max(0, prepared.length - 1) * 2);
  const pending = [...prepared].sort((a, b) => a.fullSize - b.fullSize || a.label.localeCompare(b.label, undefined, { numeric: true }));
  while (pending.length) {
    const share = Math.floor(remaining / pending.length);
    const item = pending.shift()!;
    const granted = Math.min(item.fullSize, share);
    allocation.set(item.label, granted);
    remaining -= granted;
  }

  const sourceEvidence: SourceEvidence[] = [];
  const blocks: string[] = [];
  const passages = new Map<string, { passage: EvidencePassage; evidence: SourceEvidence }>();
  for (const item of prepared) {
    const allowed = allocation.get(item.label) ?? 0;
    let used = item.header.length + "</SOURCE>".length + 2;
    const kept: EvidencePassage[] = [];
    for (let index = 0; index < item.all.length; index += 1) {
      const cost = item.lines[index].length + 1;
      if (used + cost > allowed) break;
      used += cost;
      kept.push(item.all[index]);
    }
    const totalCharacters = item.all.reduce((total, passage) => total + passage.text.length, 0);
    const includedCharacters = kept.reduce((total, passage) => total + passage.text.length, 0);
    const evidence: SourceEvidence = {
      label: item.label,
      source: item.source,
      passages: kept,
      totalPassages: item.all.length,
      includedCharacters,
      totalCharacters,
      status: !kept.length ? "omitted" : kept.length < item.all.length ? "shortened" : "full"
    };
    sourceEvidence.push(evidence);
    if (!kept.length) continue;
    blocks.push([item.header, ...kept.map((passage) => passageLine(item.label, passage)), "</SOURCE>"].join("\n"));
    for (const passage of kept) passages.set(`${item.label}:${passage.id}`, { passage, evidence });
  }

  return { text: blocks.join("\n\n"), sources: sourceEvidence, passages };
}

/** Plain-language summary of what was shortened or left out, or undefined when everything fit. */
export function describeBudget(sources: SourceEvidence[]): string | undefined {
  const shortened = sources.filter((source) => source.status === "shortened");
  const omitted = sources.filter((source) => source.status === "omitted");
  if (!shortened.length && !omitted.length) return undefined;
  const parts: string[] = [];
  if (shortened.length) parts.push(`${shortened.map((source) => `${source.label} (${Math.round(source.includedCharacters / Math.max(1, source.totalCharacters) * 100)}% used)`).join(", ")} ${shortened.length === 1 ? "was" : "were"} shortened`);
  if (omitted.length) parts.push(`${omitted.map((source) => source.label).join(", ")} ${omitted.length === 1 ? "was" : "were"} left out`);
  return `${parts.join("; ")} to fit your plan's limit. Select fewer sources to include more of each.`;
}
