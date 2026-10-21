import { PageAccessError } from "./pageContent";
import { isRestrictedUrl } from "../utils/url";

export type EmailProvider = "gmail" | "outlook";

export interface CapturedEmail {
  provider: EmailProvider;
  subject: string;
  sender: string;
  recipients: string;
  sentAt: string;
  body: string;
  url: string;
}

export function emailProviderForUrl(url: string): EmailProvider | undefined {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname === "mail.google.com") return "gmail";
    if (hostname === "outlook.live.com" || hostname === "outlook.office.com" || hostname === "outlook.office365.com") return "outlook";
  } catch {
    return undefined;
  }
  return undefined;
}

export function emailProviderLabel(provider: EmailProvider): string {
  return provider === "gmail" ? "Gmail" : "Outlook";
}

export async function extractActiveEmail(maxCharacters = 50_000): Promise<CapturedEmail> {
  if (!globalThis.chrome?.tabs || !globalThis.chrome?.scripting) throw new Error("Chrome page access is unavailable.");
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const url = tab?.url ?? "";
  const provider = emailProviderForUrl(url);
  if (!tab?.id || !provider || isRestrictedUrl(url)) throw new Error("Open a Gmail or Outlook message first.");

  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [provider, maxCharacters],
      func: (mailProvider: EmailProvider, limit: number) => {
        const clean = (value: string | null | undefined) => (value ?? "").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
        const visible = (element: Element | null): element is HTMLElement => {
          if (!(element instanceof HTMLElement)) return false;
          const style = getComputedStyle(element);
          return style.display !== "none" && style.visibility !== "hidden" && element.getBoundingClientRect().height > 0;
        };
        const firstVisible = (selectors: string[]) => selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector))).find(visible) as HTMLElement | undefined;
        const lastVisible = (selectors: string[]) => selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector))).filter(visible).at(-1) as HTMLElement | undefined;
        const attributeOrText = (element: Element | undefined, attributes: string[]) => {
          if (!element) return "";
          for (const attribute of attributes) {
            const value = element.getAttribute(attribute);
            if (value) return clean(value);
          }
          return clean((element as HTMLElement).innerText || element.textContent);
        };

        let subject: string;
        let sender: string;
        let recipients: string;
        let sentAt: string;
        let body: string;

        if (mailProvider === "gmail") {
          subject = attributeOrText(firstVisible(["h2.hP", "[data-thread-perm-id] h2", "h2[data-legacy-thread-id]"]), []);
          const messageBody = lastVisible(["div.a3s.aiL", "div.a3s", "[role='listitem'] [dir='ltr']"]);
          const messageRoot = messageBody?.closest(".adn, [role='listitem']");
          const senderElement = (messageRoot?.querySelector("span.gD[email], [data-hovercard-id][email], .gD") as HTMLElement | null) ?? firstVisible(["span.gD[email]", "[data-hovercard-id][email]", ".gD"]);
          sender = attributeOrText(senderElement ?? undefined, ["name", "email", "data-hovercard-id"]);
          const recipientElements = Array.from(document.querySelectorAll("span.g2[email], span[email].g2"));
          recipients = recipientElements.map((element) => attributeOrText(element, ["email", "name"])).filter(Boolean).join(", ");
          sentAt = attributeOrText(firstVisible(["span.g3[title]", "span.g3", "[data-tooltip*='20']"]), ["title", "data-tooltip"]);
          body = attributeOrText(messageBody, []);
        } else {
          subject = attributeOrText(firstVisible(["[data-testid='message-subject']", "[data-testid='conversation-subject']", "[role='heading'][aria-level='2']"]), ["title", "aria-label"]);
          sender = attributeOrText(firstVisible(["[data-testid='message-sender']", "[data-testid='PersonaCard']", "button[aria-label*='From:']"]), ["aria-label", "title"]);
          recipients = attributeOrText(firstVisible(["[data-testid='message-recipients']", "button[aria-label*='To:']", "[aria-label^='To:']"]), ["aria-label", "title"]);
          sentAt = attributeOrText(firstVisible(["[data-testid='message-date']", "time", "[aria-label*='Received']"]), ["datetime", "title", "aria-label"]);
          body = attributeOrText(lastVisible(["[data-testid='message-body']", "[role='document']", ".allowTextSelection"]), []);
        }

        if (!subject) subject = clean(document.title.replace(/\s+-\s+(Gmail|Outlook).*$/i, ""));
        return { provider: mailProvider, subject, sender, recipients, sentAt, body: body.slice(0, limit), url: location.href };
      }
    });

    const captured = injection?.result as CapturedEmail | undefined;
    if (!captured?.body && !captured?.subject) throw new Error("No opened email was found. Open a message, then try again.");
    return captured;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/permission|cannot access|extensions gallery/i.test(message)) throw new PageAccessError(url, error);
    throw error;
  }
}

export function capturedEmailContent(email: CapturedEmail): string {
  const header = [
    email.sender && `From: ${email.sender}`,
    email.recipients && `To: ${email.recipients}`,
    email.sentAt && `Sent: ${email.sentAt}`,
    `Source: ${email.url}`
  ].filter(Boolean).join("\n");
  return `${header}\n\n---\n\n${email.body}`.trim();
}
