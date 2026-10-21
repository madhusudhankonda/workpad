import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AIWorkspace, MarkdownResult } from "../src/sidepanel/AIWorkspace";
import type { Settings } from "../src/types";

const settings: Settings = {
  id: "settings",
  theme: "light",
  defaultOpeningSection: "page",
  autoSaveDebounce: 650,
  removeTrackingParameters: true,
  onboardingCompleted: true,
  aiModel: "gpt-5.6-luna",
  aiMaxSourceCharacters: 40_000,
  cloudSyncEnabled: false
};

describe("AI workspace", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("prefers selected text and exposes all AI actions", async () => {
    vi.stubGlobal("chrome", {
      tabs: { query: vi.fn().mockResolvedValue([{ id: 7, url: "https://example.com/article" }]) },
      scripting: { executeScript: vi.fn().mockResolvedValue([{ result: { title: "Article title", url: "https://example.com/article", selection: "Selected phrase", text: "The full article", truncated: false } }]) },
      storage: { local: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) }, session: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) } }
    });

    render(<AIWorkspace settings={settings} onClose={vi.fn()} onSave={vi.fn().mockResolvedValue(undefined)}/>);

    expect(await screen.findByText("Selected phrase")).toBeInTheDocument();
    expect(screen.getByText("Summarize")).toBeInTheDocument();
    expect(screen.getByText("Translate")).toBeInTheDocument();
    expect(screen.getByText("Action points")).toBeInTheDocument();
    expect(screen.getByText("Explain")).toBeInTheDocument();
    expect(screen.getByText("Ask anything")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Generate" })).not.toBeInTheDocument();
    expect(screen.getByText("Summarize").closest("button")).toBeDisabled();
  });

  it("runs a preset as soon as its action card is clicked", async () => {
    vi.stubGlobal("chrome", {
      tabs: { query: vi.fn().mockResolvedValue([{ id: 7, url: "https://example.com/article" }]) },
      scripting: { executeScript: vi.fn().mockResolvedValue([{ result: { title: "Article title", url: "https://example.com/article", selection: "", text: "The full article", truncated: false } }]) },
      storage: { local: { get: vi.fn().mockResolvedValue({ openaiApiKey: "test-key" }), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) }, session: { get: vi.fn().mockResolvedValue({}), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) } }
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ output_text: "Instant summary [P1]" }), { status: 200 }));
    const save = vi.fn().mockResolvedValue(undefined);
    render(<AIWorkspace settings={settings} onClose={vi.fn()} onSave={save}/>);
    await screen.findByText("The full article");

    fireEvent.click(screen.getByText("Summarize").closest("button")!);

    expect(await screen.findByText("Instant summary")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body)).input).toContain("[P1] The full article");
    expect(screen.queryByRole("button", { name: "Generate" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save as note" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("## Evidence") }));
  });

  it("renders AI Markdown as structured content", () => {
    render(<MarkdownResult text={"# Translated headline\n\n**Source:** PA Media\n\n- First point\n- Second point"}/>);

    expect(screen.getByRole("heading", { name: "Translated headline" })).toBeInTheDocument();
    expect(screen.getByText("Source:").tagName).toBe("STRONG");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("renders valid evidence citations as inspectable controls", () => {
    const inspect = vi.fn();
    render(<MarkdownResult text={"The plan costs 30p [P1]."} evidence={[{ id: "P1", text: "The entry plan costs 30p." }]} onCitation={inspect}/>);
    fireEvent.click(screen.getByRole("button", { name: "[P1]" }));
    expect(inspect).toHaveBeenCalledWith({ id: "P1", text: "The entry plan costs 30p." });
  });
});
