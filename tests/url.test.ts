import { describe, expect, it } from "vitest";
import { extractDomain, isRestrictedUrl, normalizeUrl, noteMatchesDomain, noteMatchesPage } from "../src/utils/url";

describe("URL context", () => {
  it("removes fragments, trackers and trailing slashes", () => {
    expect(normalizeUrl("https://www.Example.com/path/?utm_source=x&keep=yes#section")).toBe("https://www.example.com/path?keep=yes");
  });
  it("extracts a normalized hostname", () => expect(extractDomain("https://www.example.com/a")).toBe("example.com"));
  it("handles restricted pages", () => expect(isRestrictedUrl("chrome://extensions")).toBe(true));
  it("matches exact pages and domains", () => {
    expect(noteMatchesPage({ type: "page", normalizedPageUrl: "https://a.test/x" }, "https://a.test/x")).toBe(true);
    expect(noteMatchesDomain({ type: "domain", domain: "a.test" }, "a.test")).toBe(true);
  });
});
