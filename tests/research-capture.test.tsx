import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/db/database";
import { projectsRepository } from "../src/db/repositories/projectsRepository";
import { sourcesRepository } from "../src/db/repositories/sourcesRepository";
import { capturePageDrafts, limitSnapshot, normalizeSnapshotText, noteDraft, type CaptureDraft } from "../src/services/researchCapture";
import { AddToResearch } from "../src/sidepanel/AddToResearch";
import { ProjectsPanel } from "../src/sidepanel/ProjectsPanel";
import type { Note } from "../src/types";

const note: Note = {
  id: "note-1", title: "Pricing notes", content: "Basic plan is £10 a month.", type: "page", tags: [], isFavourite: false, isArchived: false,
  pageUrl: "https://example.com/pricing", normalizedPageUrl: "https://example.com/pricing", domain: "example.com", createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z"
};

const pageDraft = (text: string): CaptureDraft => ({ sourceType: "page", title: "Pricing", url: "https://example.com/pricing", normalizedUrl: "https://example.com/pricing", domain: "example.com", text, truncated: false, versionKey: "page:https://example.com/pricing" });

function stubActivePage(result: { title: string; url: string; selection: string; text: string; truncated: boolean }) {
  vi.stubGlobal("chrome", {
    tabs: { query: vi.fn().mockResolvedValue([{ id: 3, url: result.url }]) },
    scripting: { executeScript: vi.fn().mockResolvedValue([{ result }]) }
  });
}

describe("research capture rules", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("normalizes whitespace without changing the words", () => {
    expect(normalizeSnapshotText("  Line one here  \r\n\r\n\r\n\nLine two\t\n")).toBe("Line one here\n\nLine two");
  });

  it("keeps the start and end of long sources and marks them shortened", () => {
    const limited = limitSnapshot(`START${"x".repeat(200)}END`, 100);
    expect(limited.truncated).toBe(true);
    expect(limited.text.length).toBeLessThanOrEqual(100);
    expect(limited.text.startsWith("START")).toBe(true);
    expect(limited.text.endsWith("END")).toBe(true);
    expect(limitSnapshot("short", 100)).toEqual({ text: "short", truncated: false });
  });

  it("snapshots notes, labelling saved AI results", () => {
    expect(noteDraft(note)).toMatchObject({ sourceType: "note", title: "Pricing notes", text: "Pricing notes\n\nBasic plan is £10 a month.", versionKey: "note:note-1", domain: "example.com" });
    expect(noteDraft({ ...note, tags: ["ai", "summary"] }).sourceType).toBe("ai_result");
  });

  it("offers both the full page and the selection, versioning only the page", async () => {
    stubActivePage({ title: "Pricing", url: "https://example.com/pricing?utm_source=x", selection: "Basic plan £10", text: "Pricing page\n\nBasic plan £10", truncated: false });
    const { page, selection } = await capturePageDrafts(true);
    expect(page).toMatchObject({ sourceType: "page", text: "Pricing page\n\nBasic plan £10", domain: "example.com" });
    expect(page.versionKey).toBe(`page:${page.normalizedUrl}`);
    expect(page.normalizedUrl).not.toContain("utm_source");
    expect(selection).toMatchObject({ sourceType: "selection", title: "Selection: Pricing", text: "Basic plan £10" });
    expect(selection?.versionKey).toBeUndefined();
  });
});

describe("sources repository", () => {
  beforeEach(async () => { await db.projects.clear(); await db.sources.clear(); });

  it("adds a source, skips identical text and versions changed re-captures", async () => {
    const project = await projectsRepository.create("CRM selection");
    const first = await sourcesRepository.addToProject(project.id, pageDraft("Plans start at £10."));
    expect(first.status).toBe("added");
    expect(first.source).toMatchObject({ version: 1, snapshotText: "Plans start at £10.", contentHash: expect.stringMatching(/^[0-9a-f]{64}$/) });

    expect((await sourcesRepository.addToProject(project.id, pageDraft("Plans start at £10.  "))).status).toBe("duplicate");

    const second = await sourcesRepository.addToProject(project.id, pageDraft("Plans start at £12."));
    expect(second.status).toBe("new_version");
    expect(second.source).toMatchObject({ version: 2, previousVersionId: first.source.id });
    expect(await sourcesRepository.listForProject(project.id)).toHaveLength(2);
  });

  it("keeps different selections from one page as separate sources", async () => {
    const project = await projectsRepository.create("CRM selection");
    const selection = (text: string): CaptureDraft => ({ ...pageDraft(text), sourceType: "selection", versionKey: undefined });
    await sourcesRepository.addToProject(project.id, selection("First quote"));
    const second = await sourcesRepository.addToProject(project.id, selection("Second quote"));
    expect(second.status).toBe("added");
    expect(second.source.version).toBe(1);
  });

  it("allows the same text in two different projects", async () => {
    const crm = await projectsRepository.create("CRM selection");
    const other = await projectsRepository.create("Vendor review");
    await sourcesRepository.addToProject(crm.id, pageDraft("Same text"));
    expect((await sourcesRepository.addToProject(other.id, pageDraft("Same text"))).status).toBe("added");
  });

  it("rejects empty sources and updates project activity on add and remove", async () => {
    const project = await projectsRepository.create("CRM selection");
    await expect(sourcesRepository.addToProject(project.id, pageDraft("   "))).rejects.toThrow("no text");
    await db.projects.update(project.id, { updatedAt: "2026-01-01T00:00:00.000Z" });
    const { source } = await sourcesRepository.addToProject(project.id, pageDraft("Some text"));
    expect((await projectsRepository.getById(project.id))?.updatedAt).not.toBe("2026-01-01T00:00:00.000Z");
    await sourcesRepository.remove(source.id);
    expect(await sourcesRepository.listForProject(project.id)).toHaveLength(0);
  });
});

describe("Add to research dialog", () => {
  beforeEach(async () => { await db.projects.clear(); await db.sources.clear(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("previews the selection by default and adds it to the chosen project", async () => {
    await projectsRepository.create("CRM selection");
    stubActivePage({ title: "Pricing", url: "https://example.com/pricing", selection: "Basic plan £10", text: "Whole pricing page", truncated: false });
    const openProject = vi.fn();
    render(<AddToResearch request={{ kind: "page" }} removeTracking onClose={vi.fn()} onOpenProject={openProject}/>);

    expect(await screen.findByLabelText("Text that will be stored")).toHaveTextContent("Basic plan £10");
    fireEvent.click(screen.getByRole("button", { name: /Full page/ }));
    expect(screen.getByLabelText("Text that will be stored")).toHaveTextContent("Whole pricing page");
    fireEvent.click(screen.getByRole("button", { name: /Selection/ }));

    fireEvent.click(await screen.findByRole("button", { name: "Add to CRM selection" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Added to CRM selection.");
    const [project] = await projectsRepository.list();
    expect((await sourcesRepository.listForProject(project.id))[0]).toMatchObject({ sourceType: "selection", snapshotText: "Basic plan £10" });

    fireEvent.click(screen.getByRole("button", { name: "Open project" }));
    expect(openProject).toHaveBeenCalledWith(project.id);
  });

  it("creates a project from the dialog when none exist", async () => {
    render(<AddToResearch request={{ kind: "note", note }} removeTracking onClose={vi.fn()} onOpenProject={vi.fn()}/>);
    await screen.findByLabelText("Text that will be stored");
    expect(screen.getByRole("button", { name: "Choose a project" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "New research project" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Project name" }), { target: { value: "Pricing research" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add to Pricing research" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Added to Pricing research.");
  });

  it("asks for site access when Chrome blocks reading the page", async () => {
    vi.stubGlobal("chrome", {
      tabs: { query: vi.fn().mockResolvedValue([{ id: 3, url: "https://example.com/pricing" }]) },
      scripting: { executeScript: vi.fn().mockRejectedValue(new Error("Cannot access contents of the page. Extension manifest must request permission")) },
      permissions: { request: vi.fn().mockResolvedValue(false) }
    });
    render(<AddToResearch request={{ kind: "page" }} removeTracking onClose={vi.fn()} onOpenProject={vi.fn()}/>);
    fireEvent.click(await screen.findByRole("button", { name: "Allow access" }));
    expect(await screen.findByText(/Access was not granted/)).toBeInTheDocument();
    expect(await sourcesRepository.listForProject("any")).toHaveLength(0);
  });
});

describe("project sources and snapshot viewer", () => {
  beforeEach(async () => { await db.projects.clear(); await db.sources.clear(); });
  afterEach(() => vi.restoreAllMocks());

  it("lists captured sources and shows the exact snapshot", async () => {
    const project = await projectsRepository.create("CRM selection");
    await sourcesRepository.addToProject(project.id, pageDraft("Plans start at £10."));
    await sourcesRepository.addToProject(project.id, pageDraft("Plans start at £12."));
    render(<ProjectsPanel initialProjectId={project.id}/>);

    const cards = await screen.findAllByText("Pricing");
    expect(cards).toHaveLength(2);
    expect(screen.getByText("v2")).toBeInTheDocument();

    fireEvent.click(cards[0]);
    const dialog = await screen.findByRole("dialog", { name: "Snapshot: Pricing" });
    expect(dialog).toHaveTextContent("version 2");
    expect(screen.getByLabelText("Captured text")).toHaveTextContent("Plans start at £12.");
    expect(screen.getByRole("link", { name: /example.com/ })).toHaveAttribute("href", "https://example.com/pricing");

    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Remove from project" }));
    await waitFor(async () => expect(await sourcesRepository.listForProject(project.id)).toHaveLength(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
