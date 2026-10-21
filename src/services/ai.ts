import type { AIAction } from "../types";
import { accountConfiguration, currentSession, type AccountSession } from "./account";

export interface AIRequest {
  action: AIAction;
  source: string;
  pageTitle: string;
  pageUrl: string;
  targetLanguage?: string;
  customPrompt?: string;
}

export interface AIUsage {
  plan: "free" | "pro";
  creditsUsed: number;
  creditsLimit: number;
  creditsRemaining: number;
  maxSourceCharacters: number;
  periodEnd: string;
}

export interface AIResult {
  text: string;
  model: string;
  usage?: Omit<AIUsage, "maxSourceCharacters"> & { creditsCharged: number };
}

export type AIErrorCode = "unauthenticated" | "quota_exceeded" | "rate_limited" | "busy" | "source_too_large" | "ai_disabled" | "unavailable";

export class AIRequestError extends Error {
  constructor(public readonly code: AIErrorCode, message: string) {
    super(message);
    this.name = "AIRequestError";
  }
}

const REQUEST_TIMEOUT_MS = 70_000;
const knownCodes = new Set<AIErrorCode>(["unauthenticated", "quota_exceeded", "rate_limited", "busy", "source_too_large", "ai_disabled"]);

export function validateEvidenceCitations(result: string, source: string): string {
  const available = new Set(Array.from(source.matchAll(/^\[(P\d+)\]\s/gm), (match) => match[1]));
  if (!available.size) throw new Error("No traceable evidence passages were available for this page.");
  const cited = Array.from(result.matchAll(/\[(P\d+)\]/g), (match) => match[1]);
  if (!cited.length) throw new Error("The answer did not cite its evidence. Please try again.");
  const unknown = Array.from(new Set(cited.filter((id) => !available.has(id))));
  if (unknown.length) throw new Error(`The answer cited evidence that was not in the page (${unknown.map((id) => `[${id}]`).join(", ")}). Please try again.`);
  return result;
}

async function requireSession(): Promise<AccountSession> {
  const session = await currentSession();
  if (!session) throw new AIRequestError("unauthenticated", "Sign in to use Workpad AI.");
  return session;
}

export async function getAIUsage(session?: AccountSession): Promise<AIUsage> {
  const active = session ?? await requireSession();
  const { url, key } = accountConfiguration();
  const response = await fetch(`${url}/rest/v1/rpc/get_my_ai_usage`, {
    method: "POST",
    headers: { authorization: `Bearer ${active.accessToken}`, apikey: key, "content-type": "application/json" },
    body: "{}"
  });
  if (!response.ok) throw new Error("Unable to load your Workpad AI credits.");
  const rows = await response.json() as Array<{ plan: "free" | "pro"; period_end: string; credits_limit: number; credits_used: number; max_source_characters: number }>;
  const row = rows[0];
  if (!row) throw new Error("Unable to load your Workpad AI credits.");
  return {
    plan: row.plan,
    creditsUsed: row.credits_used,
    creditsLimit: row.credits_limit,
    creditsRemaining: Math.max(0, row.credits_limit - row.credits_used),
    maxSourceCharacters: row.max_source_characters,
    periodEnd: row.period_end
  };
}

export async function runAIAction(request: AIRequest, signal?: AbortSignal): Promise<AIResult> {
  const session = await requireSession();
  const { url, key } = accountConfiguration();
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${url}/functions/v1/ai-proxy`, {
      method: "POST",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { authorization: `Bearer ${session.accessToken}`, apikey: key, "content-type": "application/json" },
      body: JSON.stringify(request)
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.aborted) throw new AIRequestError("unavailable", "Workpad AI took too long to respond. Please try again.");
    throw new AIRequestError("unavailable", "Workpad AI could not be reached. Check your connection and try again.");
  }
  const payload = await response.json().catch(() => undefined) as { text?: unknown; model?: unknown; usage?: AIResult["usage"]; error?: unknown; message?: unknown } | undefined;
  if (!response.ok) {
    const code = typeof payload?.error === "string" && knownCodes.has(payload.error as AIErrorCode) ? payload.error as AIErrorCode : response.status === 401 ? "unauthenticated" : "unavailable";
    throw new AIRequestError(code, typeof payload?.message === "string" ? payload.message : `Workpad AI request failed (${response.status}).`);
  }
  const text = typeof payload?.text === "string" ? payload.text.trim() : "";
  if (!text) throw new AIRequestError("unavailable", "Workpad AI returned an empty response. Please try again.");
  return {
    text: validateEvidenceCitations(text, request.source),
    model: typeof payload?.model === "string" ? payload.model : "Workpad AI",
    usage: payload?.usage
  };
}
