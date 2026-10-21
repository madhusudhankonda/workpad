import { describe, expect, it } from "vitest";
import { capturedEmailContent, emailProviderForUrl } from "../src/services/emailCapture";
import { normalizeContextUrl } from "../src/utils/url";

describe("email capture", () => {
  it("recognises supported webmail without treating other pages as email", () => {
    expect(emailProviderForUrl("https://mail.google.com/mail/u/0/#inbox/abc")).toBe("gmail");
    expect(emailProviderForUrl("https://outlook.office.com/mail/inbox/id/abc")).toBe("outlook");
    expect(emailProviderForUrl("https://example.com/mail")).toBeUndefined();
  });

  it("keeps Gmail message hashes distinct for page context", () => {
    expect(normalizeContextUrl("https://mail.google.com/mail/u/0/#inbox/abc"))
      .toBe("https://mail.google.com/mail/u/0#inbox/abc");
    expect(normalizeContextUrl("https://mail.google.com/mail/u/0/#inbox/def"))
      .not.toBe(normalizeContextUrl("https://mail.google.com/mail/u/0/#inbox/abc"));
  });

  it("formats captured email provenance into the saved note", () => {
    const content = capturedEmailContent({
      provider: "gmail",
      subject: "Renewal notice",
      sender: "Supplier <billing@example.com>",
      recipients: "me@example.com",
      sentAt: "21 October 2026",
      body: "Your plan renews next week.",
      url: "https://mail.google.com/mail/u/0/#inbox/abc"
    });
    expect(content).toContain("From: Supplier <billing@example.com>");
    expect(content).toContain("Sent: 21 October 2026");
    expect(content).toContain("Your plan renews next week.");
  });
});
