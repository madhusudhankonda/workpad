import type { BriefEvidence, DecisionBrief, EvidencePassage } from "../types";
import type { ProjectEvidence } from "./researchEvidence";

/** Sections whose factual statements must carry citations. */
export const CITED_SECTIONS = ["Key findings", "Options and comparison"] as const;

const citationPattern = /\[(S\d+:P\d+)\]/g;
const citedIds = (text: string) => new Set(Array.from(text.matchAll(citationPattern), (match) => match[1]));

/** Keeps every source that was sent, with only the passages the brief cites, so citations survive later edits to the project. */
export function briefEvidenceFrom(text: string, sent: ProjectEvidence): BriefEvidence[] {
  const cited = citedIds(text);
  return sent.sources.filter((item) => item.status !== "omitted").map((item) => ({
    label: item.label,
    sourceId: item.source.id,
    title: item.source.title,
    url: item.source.url,
    capturedAt: item.source.capturedAt,
    passages: item.passages.filter((passage) => cited.has(`${item.label}:${passage.id}`))
  }));
}

/** Citation id such as "S2:P4" → the stored passage and its source. */
export function briefPassages(brief: Pick<DecisionBrief, "evidence">): Map<string, { passage: EvidencePassage; evidence: BriefEvidence }> {
  const map = new Map<string, { passage: EvidencePassage; evidence: BriefEvidence }>();
  for (const evidence of brief.evidence) for (const passage of evidence.passages) map.set(`${evidence.label}:${passage.id}`, { passage, evidence });
  return map;
}

/** Citations in the (possibly edited) text that no longer match a stored passage. */
export function unresolvedCitations(brief: Pick<DecisionBrief, "content" | "evidence">): string[] {
  const known = briefPassages(brief);
  return Array.from(citedIds(brief.content)).filter((id) => !known.has(id));
}

function sectionBody(content: string, heading: string): string | undefined {
  const lines = content.split("\n");
  const start = lines.findIndex((line) => /^#{1,3}\s+/.test(line) && line.replace(/^#{1,3}\s+/, "").trim().toLowerCase() === heading.toLowerCase());
  if (start < 0) return undefined;
  const end = lines.findIndex((line, index) => index > start && /^#{1,2}\s+/.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

/** Required-citation sections that are present but cite nothing. */
export function uncitedSections(content: string): string[] {
  return CITED_SECTIONS.filter((heading) => {
    const body = sectionBody(content, heading);
    return body !== undefined && body.trim() !== "" && citedIds(body).size === 0;
  });
}

const date = (value: string) => value.slice(0, 10);

/** The brief as a standalone Markdown document with its sources and cited evidence. */
export function briefMarkdown(brief: DecisionBrief): string {
  const known = briefPassages(brief);
  const cited = Array.from(citedIds(brief.content)).filter((id) => known.has(id)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const sources = brief.evidence.map((evidence) => `- **${evidence.label}** ${evidence.url ? `[${evidence.title}](${evidence.url})` : evidence.title} — captured ${date(evidence.capturedAt)}`);
  const evidence = cited.map((id) => `- **[${id}]** ${known.get(id)!.passage.text}`);
  return [
    `# ${brief.title}`,
    "",
    brief.content.trim(),
    "",
    "## Sources",
    "",
    ...sources,
    ...(evidence.length ? ["", "## Evidence", "", ...evidence] : []),
    "",
    `---`,
    `Generated with Workpad on ${date(brief.createdAt)}${brief.updatedAt !== brief.createdAt ? `, last edited ${date(brief.updatedAt)}` : ""}. Sections marked "Inference:" are AI judgement, not direct statements from the sources.`
  ].join("\n");
}

export function briefFileName(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${slug || "decision-brief"}.md`;
}
