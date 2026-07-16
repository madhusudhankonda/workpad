import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContextBanner, Editor, EmptyState, NoteCard } from "../src/sidepanel/App";
import type { Note } from "../src/types";

const note: Note = { id: "1", title: "Meeting notes", content: "Discussed launch", type: "page", pageUrl: "https://example.com", normalizedPageUrl: "https://example.com", domain: "example.com", tags: ["launch"], isFavourite: false, isArchived: false, createdAt: "2026-01-01", updatedAt: "2026-01-01" };

describe("side panel components", () => {
  it("renders a selectable note card", () => {
    const click = vi.fn();
    render(<NoteCard note={note} selected={false} onClick={click} />);
    fireEvent.click(screen.getByText("Meeting notes"));
    expect(click).toHaveBeenCalled();
    expect(screen.getByText("#launch")).toBeInTheDocument();
  });
  it("shows meaningful current-page empty state", () => {
    render(<EmptyState section="page" restricted={false} createNote={vi.fn().mockResolvedValue(undefined)} />);
    expect(screen.getByText("No notes for this page")).toBeInTheDocument();
  });
  it("shows editor save status and changes title", () => {
    const edit = vi.fn();
    render(<Editor note={note} edit={edit} status="saved" remove={vi.fn()} duplicate={vi.fn()} />);
    expect(screen.getByText("Saved")).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("Meeting notes"), { target: { value: "Updated" } });
    expect(edit).toHaveBeenCalledWith({ title: "Updated" });
  });
  it("renders page context actions", () => {
    render(<ContextBanner context={{ url: "https://example.com/a", normalizedUrl: "https://example.com/a", domain: "example.com", title: "Example", restricted: false }} createNote={vi.fn().mockResolvedValue(undefined)} copyLink={vi.fn()} />);
    expect(screen.getByText("Page note")).toBeInTheDocument();
    expect(screen.getByText("Domain note")).toBeInTheDocument();
  });
});
