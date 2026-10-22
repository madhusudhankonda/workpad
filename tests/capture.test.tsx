import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, defaultSettings } from "../src/db/database";

type Listener = (...args: unknown[]) => void;

function chromeStub(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  const storageListeners: Listener[] = [];
  const menuListeners: Listener[] = [];
  const order: string[] = [];
  const event = () => ({ addListener: vi.fn(), removeListener: vi.fn() });
  const chrome = {
    storage: {
      local: {
        get: vi.fn(async (keys?: string | string[]) => {
          const list = keys === undefined ? Object.keys(store) : Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.filter((key) => key in store).map((key) => [key, store[key]]));
        }),
        set: vi.fn(async (values: Record<string, unknown>) => {
          order.push("storage.set");
          const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { newValue: value }]));
          Object.assign(store, values);
          storageListeners.forEach((listener) => listener(changes, "local"));
        }),
        remove: vi.fn(async (keys: string | string[]) => { (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete store[key]); })
      },
      session: { get: vi.fn(async () => ({})), set: vi.fn(), remove: vi.fn(async () => undefined) },
      onChanged: { addListener: (listener: Listener) => storageListeners.push(listener), removeListener: vi.fn() }
    },
    tabs: { query: vi.fn(async () => [{ id: 1, url: "https://example.com/article", title: "Article" }]), onActivated: event(), onUpdated: event(), create: vi.fn() },
    windows: { onFocusChanged: event(), WINDOW_ID_NONE: -1 },
    runtime: { onInstalled: event(), onMessage: event(), sendMessage: vi.fn(), getManifest: () => ({}), id: "test" },
    sidePanel: { setPanelBehavior: vi.fn(async () => undefined), open: vi.fn(async () => { order.push("sidePanel.open"); }) },
    contextMenus: { onClicked: { addListener: (listener: Listener) => menuListeners.push(listener) }, removeAll: vi.fn(), create: vi.fn() },
    commands: { onCommand: event() },
    alarms: { onAlarm: event(), create: vi.fn(), clear: vi.fn() },
    notifications: { onClicked: event(), create: vi.fn(), clear: vi.fn() },
    scripting: { executeScript: vi.fn(async () => [{ result: "" }]) }
  };
  return { chrome, store, menuListeners, order };
}

describe("right-click capture", () => {
  beforeEach(async () => { await db.notes.clear(); await db.settings.put({ ...defaultSettings, onboardingCompleted: true }); });
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); });

  it("opens the side panel within the click, before saving the capture", async () => {
    const stub = chromeStub();
    vi.stubGlobal("chrome", stub.chrome);
    // @ts-expect-error -- the background script has no exports; importing it registers its listeners.
    await import("../src/background/index");
    stub.menuListeners[0]({ menuItemId: "save-selection", selectionText: "Quoted line", pageUrl: "https://example.com/a" }, { windowId: 7, title: "Example" });
    expect(stub.chrome.sidePanel.open).toHaveBeenCalledWith({ windowId: 7 });
    await waitFor(() => expect(stub.order).toEqual(["sidePanel.open", "storage.set"]));
    expect(stub.store.pendingCapture).toMatchObject({ kind: "save-selection", selection: "Quoted line", url: "https://example.com/a" });
  });

  it("turns a capture into a note while the panel is already open", async () => {
    const stub = chromeStub();
    vi.stubGlobal("chrome", stub.chrome);
    const { App } = await import("../src/sidepanel/App");
    const { unmount } = render(<App/>);
    await screen.findByRole("button", { name: "Ask this page" });

    await act(async () => {
      await stub.chrome.storage.local.set({ pendingCapture: { kind: "save-selection", selection: "First line\nSecond line", url: "https://example.com/article", title: "Article", capturedAt: "2026-10-22T09:00:00.000Z" } });
    });

    await waitFor(async () => expect(await db.notes.count()).toBe(1));
    const [note] = await db.notes.toArray();
    expect(note).toMatchObject({ title: "Capture: Article", type: "page" });
    expect(note.content.startsWith("> First line\n> Second line\n\nSource: https://example.com/article")).toBe(true);
    expect(stub.store.pendingCapture).toBeUndefined();
    unmount();
  });
});
