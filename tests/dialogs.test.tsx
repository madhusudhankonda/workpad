import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/db/database";
import { projectsRepository } from "../src/db/repositories/projectsRepository";
import { useDialogs } from "../src/sidepanel/dialogContext";
import { DialogProvider } from "../src/sidepanel/DialogProvider";
import { ProjectsPanel } from "../src/sidepanel/ProjectsPanel";

function Harness({ onResult }: { onResult: (value: unknown) => void }) {
  const dialogs = useDialogs();
  return <>
    <button onClick={async () => onResult(await dialogs.confirm({ title: "Delete this note?", message: "This cannot be undone.", confirmLabel: "Delete note", tone: "danger" }))}>Ask danger</button>
    <button onClick={async () => onResult(await dialogs.confirm({ title: "Import this backup?", message: "Merge it.", confirmLabel: "Import" }))}>Ask default</button>
    <button onClick={async () => { await dialogs.notify({ title: "Backup imported", message: "Imported 3 notes." }); onResult("closed"); }}>Notify</button>
  </>;
}

describe("in-panel dialogs", () => {
  afterEach(() => vi.restoreAllMocks());

  it("never falls back to Chrome's native dialogs inside the provider", async () => {
    const native = vi.spyOn(window, "confirm");
    const result = vi.fn();
    render(<DialogProvider><Harness onResult={result}/></DialogProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Ask default" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Import this backup?" });
    expect(dialog).toHaveTextContent("Merge it.");
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(result).toHaveBeenCalledWith(true));
    expect(native).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("focuses Cancel for destructive actions and cancels on Escape", async () => {
    const result = vi.fn();
    render(<DialogProvider><Harness onResult={result}/></DialogProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Ask danger" }));
    await screen.findByRole("alertdialog", { name: "Delete this note?" });
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Delete note" })).toHaveClass("confirm-danger");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(result).toHaveBeenCalledWith(false));
  });

  it("shows notices with a single button", async () => {
    const result = vi.fn();
    render(<DialogProvider><Harness onResult={result}/></DialogProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Notify" }));
    await screen.findByRole("alertdialog", { name: "Backup imported" });
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await waitFor(() => expect(result).toHaveBeenCalledWith("closed"));
  });
});

describe("deleting with the in-panel dialog", () => {
  beforeEach(async () => { await db.projects.clear(); await db.sources.clear(); await db.briefs.clear(); });

  it("deletes a project only after confirming in Workpad's own dialog", async () => {
    const project = await projectsRepository.create("CRM selection");
    render(<DialogProvider><ProjectsPanel initialProjectId={project.id}/></DialogProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Delete project" }));
    expect(await screen.findByRole("alertdialog", { name: "Delete this project?" })).toHaveTextContent("“CRM selection” will be deleted");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(await projectsRepository.getById(project.id)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete project" }));
    await waitFor(async () => expect(await projectsRepository.getById(project.id)).toBeUndefined());
  });
});
