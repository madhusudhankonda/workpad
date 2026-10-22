import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContextBanner, Onboarding, Editor, EmptyState, GroupedNotes, NoteCard, SocialShareModal } from "../src/sidepanel/App";
import { defaultNoteTitle, groupNotesByWebsiteAndDate, isNoteForSiteToday } from "../src/utils/noteOrganization";
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
    expect(screen.getByText("No notes for this site today")).toBeInTheDocument();
  });
  it("shows editor save status and changes title", () => {
    const edit = vi.fn();
    render(<Editor note={note} edit={edit} status="saved" remove={vi.fn()} duplicate={vi.fn()} />);
    expect(screen.getByText("Saved")).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("Meeting notes"), { target: { value: "Updated" } });
    expect(edit).toHaveBeenCalledWith({ title: "Updated" });
  });
  it("makes the captured browser title clear as page context", () => {
    const create = vi.fn();
    const ask = vi.fn();
    render(<ContextBanner context={{ url: "https://example.com/a", normalizedUrl: "https://example.com/a", domain: "example.com", title: "Example", restricted: false }} onCreateNote={create} onAskPage={ask} />);
    expect(screen.getByText("Example")).toBeInTheDocument();
    expect(screen.getByText("Current page")).toBeInTheDocument();
    expect(screen.getByText(/example.com/)).toBeInTheDocument();
    expect(screen.getByText("Summarise, explain, translate or ask anything. Text is sent only when you choose.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));
    fireEvent.click(screen.getByRole("button", { name: "Ask this page" }));
    expect(create).toHaveBeenCalledOnce();
    expect(ask).toHaveBeenCalledOnce();
    expect(screen.queryByText("Domain note")).not.toBeInTheDocument();
  });
  it("offers explicit email capture on supported webmail", () => {
    const saveEmail = vi.fn();
    render(<ContextBanner context={{ url: "https://mail.google.com/mail/u/0/#inbox/abc", normalizedUrl: "https://mail.google.com/mail/u/0#inbox/abc", domain: "mail.google.com", title: "Renewal notice - Gmail", restricted: false }} emailProvider="gmail" onSaveEmail={saveEmail}/>);
    expect(screen.getByText("Gmail message")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save email" }));
    expect(saveEmail).toHaveBeenCalledOnce();
  });
  it("does not repeat Ask this page inside a new note", () => {
    render(<Editor note={{ ...note, title: "", content: "" }} edit={vi.fn()} status="saved" remove={vi.fn()} duplicate={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Ask this/ })).not.toBeInTheDocument();
  });
  it("uses the page headline as a default note title", () => {
    expect(defaultNoteTitle("page", { url: "https://example.com", normalizedUrl: "https://example.com", domain: "example.com", title: "A useful headline", restricted: false })).toBe("A useful headline");
  });
  it("groups all notes by website and date", () => {
    const second = { ...note, id: "2", title: "Another note" };
    expect(groupNotesByWebsiteAndDate([note, second])).toHaveLength(1);
    render(<GroupedNotes notes={[note, second]} select={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "example.com" })).toBeInTheDocument();
    expect(screen.getByText("Meeting notes")).toBeInTheDocument();
    expect(screen.getByText("Another note")).toBeInTheDocument();
  });
  it("keeps same-day notes visible across links on the same website", () => {
    const context = { url: "https://example.com/second", normalizedUrl: "https://example.com/second", domain: "example.com", title: "Second article", restricted: false };
    expect(isNoteForSiteToday(note, context, new Date("2026-01-01T18:00:00"))).toBe(true);
    expect(isNoteForSiteToday(note, { ...context, domain: "other.example" }, new Date("2026-01-01T18:00:00"))).toBe(false);
    expect(isNoteForSiteToday(note, context, new Date("2026-01-02T18:00:00"))).toBe(false);
  });
  it("puts note and research beside the page and one Ask button below", () => {
    const research = vi.fn();
    render(<ContextBanner context={{ url: "https://example.com/a", normalizedUrl: "https://example.com/a", domain: "example.com", title: "Example", restricted: false }} onCreateNote={vi.fn()} onAskPage={vi.fn()} onAddToResearch={research}/>);
    expect(screen.getAllByRole("button").map((button) => button.textContent?.trim())).toEqual(["Add note", "Add to research", "Ask this page"]);
    fireEvent.click(screen.getByRole("button", { name: "Add to research" }));
    expect(research).toHaveBeenCalledOnce();
  });
  it("adapts the banner to webmail", () => {
    render(<ContextBanner context={{ url: "https://mail.google.com/mail/u/0/#inbox/abc", normalizedUrl: "https://mail.google.com/mail/u/0#inbox/abc", domain: "mail.google.com", title: "Renewal", restricted: false }} emailProvider="gmail" onSaveEmail={vi.fn()} onCreateNote={vi.fn()} onAskPage={vi.fn()} onAddToResearch={vi.fn()}/>);
    expect(screen.getAllByRole("button").map((button) => button.textContent?.trim())).toEqual(["Save email", "Add to research", "Ask this email"]);
  });
  it("ends onboarding with a skippable sign-in step", () => {
    const done = vi.fn();
    const { rerender } = render(<Onboarding step={0} setStep={vi.fn()} done={done}/>);
    expect(screen.getByRole("heading", { name: "Your AI research assistant beside every tab." })).toBeInTheDocument();
    rerender(<Onboarding step={2} setStep={vi.fn()} done={done}/>);
    expect(screen.getByRole("heading", { name: "Sign in to switch on Workpad AI." })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skip for now" }));
    expect(done).toHaveBeenCalledOnce();
  });
  it("offers AI writing from the social composer", () => {
    const write = vi.fn();
    render(<SocialShareModal note={note} close={vi.fn()} onWriteWithAI={write}/>);
    fireEvent.click(screen.getByRole("button", { name: "Write with AI" }));
    expect(write).toHaveBeenCalledWith("x");
  });
});
