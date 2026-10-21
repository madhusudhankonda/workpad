import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteAccount, signInWithGoogle } from "../src/services/account";

describe("Workpad account authentication", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("exchanges a Chrome Google ID token for a Supabase session", async () => {
    const launchWebAuthFlow = vi.fn().mockImplementation(({ url }: { url: string }) => {
      const authorization = new URL(url);
      const payload = btoa(JSON.stringify({
        aud: authorization.searchParams.get("client_id"),
        nonce: authorization.searchParams.get("nonce"),
        exp: Math.floor(Date.now() / 1_000) + 600,
        iss: "https://accounts.google.com"
      })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
      return Promise.resolve(`https://extension.chromiumapp.org/#id_token=header.${payload}.signature&state=${authorization.searchParams.get("state")}`);
    });
    const sessionSet = vi.fn().mockResolvedValue(undefined);
    const localSet = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", {
      runtime: {
        id: "extension",
        getManifest: () => ({ oauth2: { client_id: "google-client.apps.googleusercontent.com", scopes: ["openid", "email", "profile"] } })
      },
      identity: {
        getRedirectURL: vi.fn().mockReturnValue("https://extension.chromiumapp.org/"),
        launchWebAuthFlow
      },
      storage: {
        session: { set: sessionSet },
        local: { set: localSet }
      }
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      access_token: "supabase-access",
      refresh_token: "supabase-refresh",
      expires_in: 3_600,
      user: { id: "user-1", email: "person@example.com" }
    }), { status: 200 }));

    const session = await signInWithGoogle();

    const authUrl = new URL(launchWebAuthFlow.mock.calls[0][0].url);
    expect(authUrl.origin).toBe("https://accounts.google.com");
    expect(authUrl.searchParams.get("client_id")).toBe("google-client.apps.googleusercontent.com");
    expect(authUrl.searchParams.get("response_type")).toBe("id_token");
    expect(authUrl.searchParams.get("redirect_uri")).toBe("https://extension.chromiumapp.org/");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/auth/v1/token?grant_type=id_token"), expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"provider":"google"')
    }));
    expect(session.email).toBe("person@example.com");
    expect(session.userId).toBe("user-1");
    expect(sessionSet).toHaveBeenCalled();
    expect(localSet).toHaveBeenCalledWith({ workpadRefreshToken: "supabase-refresh" });
  });

  it("rejects a Google callback with the wrong OAuth state", async () => {
    vi.stubGlobal("chrome", {
      runtime: { getManifest: () => ({ oauth2: { client_id: "google-client.apps.googleusercontent.com", scopes: ["openid"] } }) },
      identity: {
        getRedirectURL: () => "https://extension.chromiumapp.org/",
        launchWebAuthFlow: vi.fn().mockResolvedValue("https://extension.chromiumapp.org/#id_token=token&state=wrong")
      }
    });
    await expect(signInWithGoogle()).rejects.toThrow("could not be verified");
  });

  it("deletes a signed-in account and clears the local session", async () => {
    const sessionRemove = vi.fn().mockResolvedValue(undefined);
    const localRemove = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("chrome", { storage: { session: { remove: sessionRemove }, local: { remove: localRemove } } });
    vi.stubEnv("VITE_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "publishable-key");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ deleted: true }), { status: 200 }));
    await deleteAccount({ accessToken: "access", refreshToken: "refresh", expiresAt: Date.now() + 60_000, userId: "user-1" });
    expect(sessionRemove).toHaveBeenCalledWith("workpadAccountSession");
    expect(localRemove).toHaveBeenCalledWith("workpadRefreshToken");
  });
});
