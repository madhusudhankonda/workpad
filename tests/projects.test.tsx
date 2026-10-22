import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/db/database";
import { projectsRepository } from "../src/db/repositories/projectsRepository";
import { ProjectsPanel } from "../src/sidepanel/ProjectsPanel";
import type { ResearchSource } from "../src/types";

const source = (projectId: string, id: string, updatedAt: string): ResearchSource => ({
  id, projectId, sourceType: "page", title: "Pricing", url: "https://example.com/pricing", snapshotText: "Plans start at £10.",
  snapshotTruncated: false, contentHash: id, version: 1, capturedAt: updatedAt, createdAt: updatedAt, updatedAt
});

describe("research projects repository", () => {
  beforeEach(async () => { await db.projects.clear(); await db.sources.clear(); });

  it("creates projects with tidy names and rejects duplicates regardless of case", async () => {
    const project = await projectsRepository.create("  CRM   selection ");
    expect(project.name).toBe("CRM selection");
    await expect(projectsRepository.create("crm SELECTION")).rejects.toThrow("already exists");
    await expect(projectsRepository.create("   ")).rejects.toThrow("Give the project a name");
    await expect(projectsRepository.create("x".repeat(81))).rejects.toThrow("up to 80");
  });

  it("renames and describes a project, keeping names unique", async () => {
    const crm = await projectsRepository.create("CRM selection");
    await projectsRepository.create("Laptop shortlist");
    const renamed = await projectsRepository.update(crm.id, { name: "CRM shortlist", description: "Pick a CRM by March" });
    expect(renamed).toMatchObject({ name: "CRM shortlist", description: "Pick a CRM by March" });
    await expect(projectsRepository.update(crm.id, { name: "laptop SHORTLIST" })).rejects.toThrow("already exists");
    await expect(projectsRepository.update(crm.id, { name: "crm shortlist" })).resolves.toMatchObject({ name: "crm shortlist" });
  });

  it("lists projects with source counts, most recently active first", async () => {
    const older = await projectsRepository.create("Older");
    const newer = await projectsRepository.create("Newer");
    await db.projects.update(older.id, { updatedAt: "2026-01-01T00:00:00.000Z" });
    await db.projects.update(newer.id, { updatedAt: "2026-02-01T00:00:00.000Z" });
    await db.sources.bulkAdd([source(older.id, "s1", "2026-03-01T00:00:00.000Z"), source(older.id, "s2", "2026-01-15T00:00:00.000Z")]);

    const projects = await projectsRepository.list();

    expect(projects.map((project) => project.name)).toEqual(["Older", "Newer"]);
    expect(projects[0]).toMatchObject({ sourceCount: 2, lastActivityAt: "2026-03-01T00:00:00.000Z" });
    expect(projects[1]).toMatchObject({ sourceCount: 0, lastActivityAt: "2026-02-01T00:00:00.000Z" });
  });

  it("deletes a project together with its sources only", async () => {
    const crm = await projectsRepository.create("CRM selection");
    const laptop = await projectsRepository.create("Laptop shortlist");
    await db.sources.bulkAdd([source(crm.id, "s1", "2026-03-01T00:00:00.000Z"), source(laptop.id, "s2", "2026-03-01T00:00:00.000Z")]);

    await projectsRepository.delete(crm.id);

    expect(await projectsRepository.getById(crm.id)).toBeUndefined();
    expect((await db.sources.toArray()).map((item) => item.id)).toEqual(["s2"]);
  });
});

describe("projects panel", () => {
  beforeEach(async () => { await db.projects.clear(); await db.sources.clear(); });
  afterEach(() => vi.restoreAllMocks());

  it("creates a project from the empty state and opens it", async () => {
    render(<ProjectsPanel/>);
    expect(await screen.findByText("Start a research project")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "New research project" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Project name" }), { target: { value: "CRM selection" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText("No sources yet")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Project name" })).toHaveValue("CRM selection");
    expect(screen.getAllByText("0 sources", { exact: false }).length).toBeGreaterThan(0);
  });

  it("shows duplicate-name errors without closing the form", async () => {
    await projectsRepository.create("CRM selection");
    render(<ProjectsPanel/>);
    await screen.findByText("CRM selection");

    fireEvent.click(screen.getByRole("button", { name: "New research project" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Project name" }), { target: { value: "crm selection" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("already exists");
    expect(screen.getByRole("textbox", { name: "Project name" })).toBeInTheDocument();
  });

  it("opens the create form when the toolbar asks for a new project", async () => {
    const { rerender } = render(<ProjectsPanel createRequest={0}/>);
    await screen.findByText("Start a research project");
    rerender(<ProjectsPanel createRequest={1}/>);
    expect(screen.getByRole("textbox", { name: "Project name" })).toBeInTheDocument();
  });

  it("renames a project and deletes it after confirmation", async () => {
    await projectsRepository.create("CRM selection");
    render(<ProjectsPanel/>);
    fireEvent.click(await screen.findByText("CRM selection"));

    const name = screen.getByDisplayValue("CRM selection");
    fireEvent.change(name, { target: { value: "CRM shortlist" } });
    fireEvent.blur(name);
    await waitFor(async () => expect((await projectsRepository.list())[0].name).toBe("CRM shortlist"));

    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    await waitFor(async () => expect(await projectsRepository.list()).toHaveLength(0));
    expect(await screen.findByText("Start a research project")).toBeInTheDocument();
  });
});
