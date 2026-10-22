import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BRIEF_OUTPUT_TOKENS, buildInstructions, MAX_OUTPUT_TOKENS, outputLimitFor, parseProxyRequest, reservationCredits } from "../supabase/functions/_shared/ai";
import { db } from "../src/db/database";
import { briefsRepository } from "../src/db/repositories/briefsRepository";
import { projectsRepository } from "../src/db/repositories/projectsRepository";
import { sourcesRepository } from "../src/db/repositories/sourcesRepository";
import { briefEvidenceFrom, briefFileName, briefMarkdown, unresolvedCitations, uncitedSections } from "../src/services/briefs";
import { buildProjectEvidence } from "../src/services/researchEvidence";
import { MarkdownResult } from "../src/sidepanel/AIWorkspace";
import { BriefWorkspace } from "../src/sidepanel/BriefWorkspace";
import type { DecisionBrief, ResearchSource } from "../src/types";

const source = (id: string, title: string, text: string): ResearchSource => ({
  id, projectId: "p1", sourceType: "page", title, url: `https://example.com/${id}`, snapshotText: text, snapshotTruncated: false,
  contentHash: id, version: 1, capturedAt: "2026-10-20T10:00:00.000Z", createdAt: "2026-10-20T10:00:00.000Z", updatedAt: "2026-10-20T10:00:00.000Z"
});

const briefText = [
  "## Objective", "Choose a CRM.",
  "## Key findings", "- Acme costs £12 per user [S1:P1].",
  "## Options and comparison", "| Option | Price |", "| --- | --- |", "| Acme | £12 [S1:P1] |", "| Beta | £9 [S2:P1] |",
  "## Recommendation", "Inference: Beta is cheaper [S2:P1]."
].join("\n");

describe("decision brief on the proxy", () => {
  it("asks for the brief structure with a larger output limit", () => {
    const request = parseProxyRequest({ action: "decision_brief", source: '<SOURCE id="S1">\n[S1:P1] x\n</SOURCE>', pageTitle: "CRM", customPrompt: "Pick a CRM" }, 40_000);
    const instructions = buildInstructions(request);
    for (const heading of ["## Objective", "## Executive summary", "## Decision criteria", "## Key findings", "## Options and comparison", "## Risks, uncertainties and open questions", "## Recommendation", "## Next actions"]) expect(instructions).toContain(heading);
    expect(instructions).toContain("Markdown table");
    expect(instructions).toContain("Do not add a Sources section");
    expect(instructions.endsWith("Objective: Pick a CRM")).toBe(true);
    expect(buildInstructions({ ...request, customPrompt: "" })).toContain("Objective: Recommend the best option");
    expect(outputLimitFor("decision_brief")).toBe(BRIEF_OUTPUT_TOKENS);
    expect(outputLimitFor("summary")).toBe(MAX_OUTPUT_TOKENS);
    expect(reservationCredits("i", "x", BRIEF_OUTPUT_TOKENS)).toBeGreaterThan(reservationCredits("i", "x"));
  });
});

describe("brief helpers", () => {
  const sources = [source("a", "Acme pricing", "Acme costs £12 per user per month."), source("b", "Beta pricing", "Beta costs £9 per user per month.")];
  const evidence = buildProjectEvidence(sources, 10_000);
  const brief: DecisionBrief = { id: "b1", projectId: "p1", title: "Decision brief: CRM", objective: "Choose a CRM", content: briefText, evidence: briefEvidenceFrom(briefText, evidence), truncated: false, createdAt: "2026-10-22T09:00:00.000Z", updatedAt: "2026-10-22T09:00:00.000Z" };

  it("stores sent sources with only their cited passages", () => {
    expect(brief.evidence.map((item) => [item.label, item.title, item.passages.map((passage) => passage.id)])).toEqual([["S1", "Acme pricing", ["P1"]], ["S2", "Beta pricing", ["P1"]]]);
  });

  it("flags required sections without citations and citations that no longer resolve", () => {
    expect(uncitedSections(briefText)).toEqual([]);
    expect(uncitedSections("## Key findings\n- Acme is cheap.\n## Recommendation\nBuy it.")).toEqual(["Key findings"]);
    expect(unresolvedCitations(brief)).toEqual([]);
    expect(unresolvedCitations({ ...brief, content: `${briefText}\nAlso [S3:P9].` })).toEqual(["S3:P9"]);
  });

  it("exports Markdown with sources, cited evidence and an inference note", () => {
    const markdown = briefMarkdown(brief);
    expect(markdown.startsWith("# Decision brief: CRM\n\n## Objective")).toBe(true);
    expect(markdown).toContain("## Sources\n\n- **S1** [Acme pricing](https://example.com/a) — captured 2026-10-20");
    expect(markdown).toContain("- **[S2:P1]** Beta costs £9 per user per month.");
    expect(markdown).toContain('Sections marked "Inference:" are AI judgement');
    expect(briefFileName("Decision brief: CRM / 2026")).toBe("decision-brief-crm-2026.md");
  });
});

describe("Markdown rendering for briefs", () => {
  it("renders tables with clickable citations and marks unknown citations as broken", () => {
    const open = vi.fn();
    render(<MarkdownResult text={"| Option | Price |\n| --- | --- |\n| Acme | £12 [S1:P1] |\n\nGone [S9:P9]."} evidence={[{ id: "S1:P1", text: "Acme costs £12." }]} onCitation={open}/>);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Option", "Price"]);
    fireEvent.click(within(table).getByRole("button", { name: "[S1:P1]" }));
    expect(open).toHaveBeenCalledWith({ id: "S1:P1", text: "Acme costs £12." });
    expect(screen.getByText("[S9:P9]")).toHaveClass("broken-citation");
  });
});

describe("briefs repository", () => {
  beforeEach(async () => { await db.projects.clear(); await db.sources.clear(); await db.briefs.clear(); });

  it("creates, edits and lists briefs, and deletes them with their project", async () => {
    const project = await projectsRepository.create("CRM selection");
    const created = await briefsRepository.create({ projectId: project.id, title: "Brief", objective: "", content: "Draft", evidence: [], truncated: false });
    const updated = await briefsRepository.update(created.id, { content: "Edited", title: "  " });
    expect(updated).toMatchObject({ content: "Edited", title: "Brief" });
    expect(await briefsRepository.listForProject(project.id)).toHaveLength(1);
    await projectsRepository.delete(project.id);
    expect(await db.briefs.count()).toBe(0);
  });
});

describe("brief workspace", () => {
  beforeEach(async () => { await db.projects.clear(); await db.sources.clear(); await db.briefs.clear(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("generates a brief from selected sources, then previews, edits, copies and opens citations", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    vi.stubGlobal("chrome", {
      storage: {
        local: { get: vi.fn().mockResolvedValue({ workpadRefreshToken: "refresh-token" }) },
        session: { get: vi.fn().mockResolvedValue({ workpadAccountSession: { accessToken: "access-token", expiresAt: Date.now() + 3_600_000, userId: "user-1" } }) }
      }
    });
    const project = await projectsRepository.update((await projectsRepository.create("CRM selection")).id, { description: "Choose a CRM for 10 users" });
    await sourcesRepository.addToProject(project.id, { sourceType: "page", title: "Acme pricing", url: "https://acme.example", text: "Acme costs £12 per user.", truncated: false });
    await sourcesRepository.addToProject(project.id, { sourceType: "page", title: "Beta pricing", url: "https://beta.example", text: "Beta costs £9 per user.", truncated: false });
    const sources = await sourcesRepository.listForProject(project.id);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("get_my_ai_usage")) return new Response(JSON.stringify([{ plan: "pro", period_end: "2026-11-01", credits_limit: 600, credits_used: 4, max_source_characters: 80_000 }]), { status: 200 });
      const body = JSON.parse(String((init as RequestInit).body)) as { source: string };
      const beta = body.source.includes('id="S1" title="Beta pricing"') ? "S1" : "S2";
      const acme = beta === "S1" ? "S2" : "S1";
      const text = `## Objective\nChoose a CRM.\n## Key findings\n- Beta is £9 [${beta}:P1].\n## Options and comparison\n| Option | Price |\n| --- | --- |\n| Acme | £12 [${acme}:P1] |\n| Beta | £9 [${beta}:P1] |\n## Recommendation\nInference: choose Beta [${beta}:P1].`;
      return new Response(JSON.stringify({ text, model: "m", truncated: false, usage: { plan: "pro", creditsCharged: 3, creditsUsed: 7, creditsLimit: 600, creditsRemaining: 593, periodEnd: "2026-11-01T00:00:00.000Z" } }), { status: 200 });
    });
    const onChanged = vi.fn().mockResolvedValue(undefined);
    render(<BriefWorkspace project={project} sources={sources} onClose={vi.fn()} onChanged={onChanged}/>);

    expect(await screen.findByText("Workpad AI · 596 of 600 credits left")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Objective" })).toHaveValue("Choose a CRM for 10 users");
    fireEvent.click(screen.getByRole("button", { name: "Create decision brief" }));

    expect(await screen.findByRole("table")).toBeInTheDocument();
    const proxyBody = JSON.parse(String((fetchMock.mock.calls.find(([input]) => String(input).endsWith("/ai-proxy"))![1] as RequestInit).body));
    expect(proxyBody).toMatchObject({ action: "decision_brief", pageTitle: "CRM selection", customPrompt: "Choose a CRM for 10 users" });
    const [stored] = await briefsRepository.listForProject(project.id);
    expect(stored).toMatchObject({ title: "Decision brief: CRM selection", objective: "Choose a CRM for 10 users" });
    expect(stored.evidence).toHaveLength(2);

    fireEvent.click(within(screen.getByRole("table")).getAllByRole("button")[1]);
    const viewer = await screen.findByRole("dialog", { name: "Snapshot: Beta pricing" });
    expect(within(viewer).getByText("Beta costs £9 per user.").tagName).toBe("MARK");
    fireEvent.click(within(viewer).getByRole("button", { name: "Close snapshot" }));

    fireEvent.click(screen.getByRole("button", { name: "Copy as Markdown" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("## Sources")));

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const editor = screen.getByRole("textbox", { name: "Brief Markdown" });
    fireEvent.change(editor, { target: { value: `${stored.content}\nSee also [S7:P1].` } });
    fireEvent.blur(editor);
    await waitFor(async () => expect((await briefsRepository.getById(stored.id))?.content).toContain("[S7:P1]"));
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByText(/1 citation no longer matches a stored passage \(\[S7:P1\]\)/)).toBeInTheDocument();
  });
});
