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
  aiMaxSourceCharacters: 40_000,
  cloudSyncEnabled: false
};

const usageRow = { plan: "free", period_start: "2026-10-01", period_end: "2026-11-01", credits_limit: 30, credits_used: 4, max_source_characters: 40000 };
const signedInStorage = () => ({
  local: { get: vi.fn().mockResolvedValue({ workpadRefreshToken: "refresh-token" }), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) },
  session: { get: vi.fn().mockResolvedValue({ workpadAccountSession: { accessToken: "access-token", expiresAt: Date.now() + 3_600_000, userId: "user-1" } }), set: vi.fn().mockResolvedValue(undefined), remove: vi.fn().mockResolvedValue(undefined) }
});

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

  it("runs a preset through Workpad AI as soon as its action card is clicked", async () => {
    vi.stubGlobal("chrome", {
      tabs: { query: vi.fn().mockResolvedValue([{ id: 7, url: "https://example.com/article" }]) },
      scripting: { executeScript: vi.fn().mockResolvedValue([{ result: { title: "Article title", url: "https://example.com/article", selection: "", text: "The full article", truncated: false } }]) },
      storage: signedInStorage()
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => String(input).includes("get_my_ai_usage")
      ? new Response(JSON.stringify([usageRow]), { status: 200 })
      : new Response(JSON.stringify({ text: "Instant summary [P1]", model: "gpt-5.6-luna", usage: { plan: "free", creditsCharged: 1, creditsUsed: 5, creditsLimit: 30, creditsRemaining: 25, periodEnd: "2026-11-01T00:00:00.000Z" } }), { status: 200 }));
    const save = vi.fn().mockResolvedValue(undefined);
    render(<AIWorkspace settings={settings} onClose={vi.fn()} onSave={save}/>);
    await screen.findByText("The full article");
    expect(await screen.findByText("Workpad AI · 26 of 30 credits left")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Summarize").closest("button")!);

    expect(await screen.findByText("Instant summary")).toBeInTheDocument();
    const proxyCall = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/functions/v1/ai-proxy"));
    expect(JSON.parse(String((proxyCall![1] as RequestInit).body)).source).toContain("[P1] The full article");
    expect(screen.getByText("Workpad AI · 25 of 30 credits left")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save as note" }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("## Evidence") }));
  });

  it("asks signed-out users to sign in instead of asking for an API key", async () => {
    vi.stubGlobal("chrome", {
      tabs: { query: vi.fn().mockResolvedValue([{ id: 7, url: "https://example.com/article" }]) },
      scripting: { executeScript: vi.fn().mockResolvedValue([{ result: { title: "Article title", url: "https://example.com/article", selection: "", text: "The full article", truncated: false } }]) },
      storage: { local: { get: vi.fn().mockResolvedValue({}) }, session: { get: vi.fn().mockResolvedValue({}) } }
    });
    render(<AIWorkspace settings={settings} onClose={vi.fn()} onSave={vi.fn()}/>);
    expect(await screen.findByText("Sign in to use Workpad AI")).toBeInTheDocument();
    expect(screen.queryByLabelText("OpenAI API key")).not.toBeInTheDocument();
    expect(screen.getByText("Summarize").closest("button")).toBeDisabled();
  });

  it("blocks actions once the monthly credits are used up", async () => {
    vi.stubGlobal("chrome", {
      tabs: { query: vi.fn().mockResolvedValue([{ id: 7, url: "https://example.com/article" }]) },
      scripting: { executeScript: vi.fn().mockResolvedValue([{ result: { title: "Article title", url: "https://example.com/article", selection: "", text: "The full article", truncated: false } }]) },
      storage: signedInStorage()
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify([{ ...usageRow, credits_used: 30 }]), { status: 200 }));
    render(<AIWorkspace settings={settings} onClose={vi.fn()} onSave={vi.fn()}/>);
    expect(await screen.findByText("You have used this month's AI credits")).toBeInTheDocument();
    expect(screen.getByText("Summarize").closest("button")).toBeDisabled();
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
