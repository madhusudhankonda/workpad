import { afterEach, describe, expect, it, vi } from "vitest";
import { getOpenAIKey, saveOpenAIKey } from "../src/services/apiKeyStorage";

describe("OpenAI key storage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses session storage by default", async () => {
    const sessionSet = vi.fn().mockResolvedValue(undefined);
    const localRemove = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", { storage: { session: { set: sessionSet, remove: vi.fn(), get: vi.fn() }, local: { remove: localRemove, set: vi.fn(), get: vi.fn() } } });
    await saveOpenAIKey(" key ");
    expect(sessionSet).toHaveBeenCalledWith({ openaiApiKey: "key" });
    expect(localRemove).toHaveBeenCalledWith("openaiApiKey");
  });

  it("prefers a session key over a persistent key", async () => {
    vi.stubGlobal("chrome", { storage: { session: { get: vi.fn().mockResolvedValue({ openaiApiKey: "session" }) }, local: { get: vi.fn().mockResolvedValue({ openaiApiKey: "persistent" }) } } });
    await expect(getOpenAIKey()).resolves.toEqual({ key: "session", persistent: false });
  });

  it("keeps a key across reloads only when the user opts in", async () => {
    const localSet = vi.fn().mockResolvedValue(undefined);
    const sessionRemove = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", { storage: { session: { set: vi.fn(), remove: sessionRemove, get: vi.fn() }, local: { remove: vi.fn(), set: localSet, get: vi.fn() } } });
    await saveOpenAIKey("persistent-key", true);
    expect(localSet).toHaveBeenCalledWith({ openaiApiKey: "persistent-key" });
    expect(sessionRemove).toHaveBeenCalledWith("openaiApiKey");
  });
});
