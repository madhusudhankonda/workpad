import { adminRpc, authenticatedUser, json, preflight, requiredEnv } from "../_shared/http.ts";
import { buildInput, buildInstructions, creditsFor, MAX_OUTPUT_TOKENS, parseProxyRequest, readResponseText, readUsage, RequestError, reservationCredits } from "../_shared/ai.ts";

const DEFAULT_MODEL = "gpt-5.6-luna";
const REQUEST_TIMEOUT_MS = 55_000;
const MAX_ATTEMPTS = 2;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
/** Largest body accepted before parsing: the biggest plan's source limit plus room for labels and metadata. */
const MAX_BODY_BYTES = 400_000;

interface Reservation {
  reservation_id: string;
  plan: "free" | "pro";
  period_start: string;
  credits_limit: number;
  credits_used: number;
  max_source_characters: number;
}

const quotaErrors: Record<string, { status: number; error: string; message: string }> = {
  ai_quota_exceeded: { status: 402, error: "quota_exceeded", message: "You have used this month's Workpad AI credits." },
  ai_rate_limited: { status: 429, error: "rate_limited", message: "Too many AI requests in a short time. Please wait a minute and try again." },
  ai_too_many_requests: { status: 429, error: "busy", message: "Another AI request is still running. Please wait for it to finish." }
};

function periodEnd(periodStart: string): string {
  const date = new Date(`${periodStart}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString();
}

async function safetyIdentifier(userId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`workpad:${userId}`));
  return `workpad_${Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function callOpenAI(body: string, signal: AbortSignal): Promise<unknown> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      headers: { authorization: `Bearer ${requiredEnv("OPENAI_API_KEY")}`, "content-type": "application/json" },
      body
    });
    const payload: unknown = await response.json().catch(() => undefined);
    if (response.ok) return payload;
    if (RETRYABLE_STATUSES.has(response.status) && attempt < MAX_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, 800));
      continue;
    }
    console.error(`OpenAI request failed (${response.status}) ${response.headers.get("x-request-id") ?? ""}`);
    throw new RequestError("upstream_failed", "Workpad AI is temporarily unavailable. Please try again.", 502);
  }
  throw new RequestError("upstream_failed", "Workpad AI is temporarily unavailable. Please try again.", 502);
}

Deno.serve(async (request: Request) => {
  const options = preflight(request); if (options) return options;
  if (request.method !== "POST") return json({ error: "method_not_allowed", message: "Method not allowed" }, 405);
  if (Deno.env.get("WORKPAD_AI_ENABLED") === "false") return json({ error: "ai_disabled", message: "Workpad AI is paused for maintenance. Please try again later." }, 503);

  let reservation: Reservation | undefined;
  let settled = false;
  try {
    const user = await authenticatedUser(request).catch(() => { throw new RequestError("unauthenticated", "Sign in to use Workpad AI.", 401); });
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > MAX_BODY_BYTES) throw new RequestError("source_too_large", "This source is too large for Workpad AI.", 413);
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) throw new RequestError("source_too_large", "This source is too large for Workpad AI.", 413);
    const payload: unknown = (() => { try { return JSON.parse(raw); } catch { throw new RequestError("invalid_request", "Request body must be valid JSON."); } })();

    // Validate shape against the most generous limit first, then reserve, then apply the user's own plan limit.
    const parsed = parseProxyRequest(payload, MAX_BODY_BYTES);
    const instructions = buildInstructions(parsed);
    const input = buildInput(parsed);
    const requested = reservationCredits(instructions, input);

    try {
      [reservation] = await adminRpc<Reservation[]>("reserve_ai_credits", { target_user: user.id, requested_credits: requested });
    } catch (error) {
      const known = error instanceof Error ? quotaErrors[error.message] : undefined;
      if (known) return json({ error: known.error, message: known.message }, known.status);
      throw error;
    }
    if (!reservation) throw new Error("Credit reservation failed");
    parseProxyRequest(payload, reservation.max_source_characters);

    const model = Deno.env.get("WORKPAD_AI_MODEL") || DEFAULT_MODEL;
    const response = await callOpenAI(JSON.stringify({
      model,
      instructions,
      input,
      reasoning: { effort: "low" },
      max_output_tokens: MAX_OUTPUT_TOKENS,
      store: false,
      safety_identifier: await safetyIdentifier(user.id)
    }), request.signal);

    const text = readResponseText(response);
    const usage = readUsage(response);
    const charged = usage.inputTokens || usage.outputTokens ? creditsFor(usage.inputTokens, usage.outputTokens) : requested;
    await adminRpc("settle_ai_credits", { target_reservation: reservation.reservation_id, actual_credits: charged, used_input_tokens: usage.inputTokens, used_output_tokens: usage.outputTokens });
    settled = true;
    if (!text) throw new RequestError("empty_response", "Workpad AI returned an empty response. Please try again.", 502);

    const creditsUsed = reservation.credits_used + charged;
    return json({
      text,
      model,
      usage: {
        plan: reservation.plan,
        creditsCharged: charged,
        creditsUsed,
        creditsLimit: reservation.credits_limit,
        creditsRemaining: Math.max(0, reservation.credits_limit - creditsUsed),
        periodEnd: periodEnd(reservation.period_start)
      }
    });
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.code, message: error.message }, error.status);
    if (request.signal.aborted) return json({ error: "cancelled", message: "The request was cancelled." }, 499);
    console.error(error instanceof Error ? error.message : "AI proxy failed");
    return json({ error: "server_error", message: "Workpad AI could not complete this request. Please try again." }, 500);
  } finally {
    // Release the reservation without charging when the request failed before usage was recorded.
    if (reservation && !settled) {
      await adminRpc("settle_ai_credits", { target_reservation: reservation.reservation_id, actual_credits: 0, used_input_tokens: 0, used_output_tokens: 0 }).catch(() => undefined);
    }
  }
});
