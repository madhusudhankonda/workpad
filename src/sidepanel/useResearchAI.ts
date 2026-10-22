import { useEffect, useMemo, useState } from "react";
import { isAccountConfigured, signInWithGoogle } from "../services/account";
import { AIRequestError, getAIUsage, type AIUsage } from "../services/ai";
import { buildProjectEvidence, MAX_SOURCES_PER_QUESTION } from "../services/researchEvidence";
import type { ResearchSource } from "../types";

/** Used when the plan's limit is not known yet; matches the free plan. */
const FALLBACK_BUDGET = 40_000;

export type AIAccess = "checking" | "unconfigured" | "signed-out" | "ready";

/** Account, credits and source selection shared by the research question and brief workspaces. */
export function useResearchAI(sources: ResearchSource[]) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(sources.slice(0, MAX_SOURCES_PER_QUESTION).map((source) => source.id)));
  const [access, setAccess] = useState<AIAccess>(isAccountConfigured() ? "checking" : "unconfigured");
  const [usage, setUsage] = useState<AIUsage>();
  const [error, setError] = useState("");

  const applyUsage = (loaded: Promise<AIUsage>) => loaded.then((value) => { setUsage(value); setAccess("ready"); }).catch((accessError: unknown) => {
    setAccess("signed-out");
    if (!(accessError instanceof AIRequestError && accessError.code === "unauthenticated")) setError(accessError instanceof Error ? accessError.message : "Unable to load your Workpad account.");
  });
  useEffect(() => { if (isAccountConfigured()) void applyUsage(getAIUsage()); }, []);

  const signIn = async () => {
    setError("");
    try { await signInWithGoogle(); await applyUsage(getAIUsage()); }
    catch (signInError) { setError(signInError instanceof Error ? signInError.message : "Sign-in failed."); }
  };

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else if (next.size < MAX_SOURCES_PER_QUESTION) next.add(id);
    return next;
  });

  const chosen = useMemo(() => sources.filter((source) => selected.has(source.id)), [sources, selected]);
  const evidence = useMemo(() => buildProjectEvidence(chosen, usage?.maxSourceCharacters ?? FALLBACK_BUDGET), [chosen, usage?.maxSourceCharacters]);
  const outOfCredits = usage ? usage.creditsRemaining <= 0 : false;

  /** Updates credits after a request, or marks them used up / signed out on the matching errors. */
  const afterRequest = (result: { usage?: { creditsUsed: number; creditsLimit: number; creditsRemaining: number; periodEnd: string } } | AIRequestError | unknown) => {
    if (result instanceof AIRequestError) {
      if (result.code === "unauthenticated") setAccess("signed-out");
      if (result.code === "quota_exceeded") setUsage((current) => current && { ...current, creditsRemaining: 0 });
      return;
    }
    const charged = (result as { usage?: AIUsage })?.usage;
    if (charged) setUsage((current) => current && { ...current, creditsUsed: charged.creditsUsed, creditsLimit: charged.creditsLimit, creditsRemaining: charged.creditsRemaining, periodEnd: charged.periodEnd });
  };

  return { access, usage, error, setError, signIn, selected, toggle, chosen, evidence, outOfCredits, afterRequest };
}
