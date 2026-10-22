import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, FolderPlus, LoaderCircle, MessagesSquare, Sparkles, Square, X } from "lucide-react";
import { sourcesRepository } from "../db/repositories/sourcesRepository";
import { isAccountConfigured, signInWithGoogle } from "../services/account";
import { AIRequestError, getAIUsage, runAIAction, type AIUsage } from "../services/ai";
import { buildProjectEvidence, describeBudget, MAX_SOURCES_PER_QUESTION, type ProjectEvidence } from "../services/researchEvidence";
import type { EvidencePassage, ResearchProject, ResearchSource } from "../types";
import { MarkdownResult } from "./AIWorkspace";
import { SnapshotViewer } from "./ProjectsPanel";

/** Used when the plan's limit is not known yet; matches the free plan. */
const FALLBACK_BUDGET = 40_000;
const statusLabels = { full: "Included", shortened: "Shortened", omitted: "Left out" } as const;

export function ResearchQuestion({ project, sources, onClose, onSaved }: {
  project: ResearchProject;
  sources: ResearchSource[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(sources.slice(0, MAX_SOURCES_PER_QUESTION).map((source) => source.id)));
  const [question, setQuestion] = useState("");
  const [access, setAccess] = useState<"checking" | "unconfigured" | "signed-out" | "ready">(isAccountConfigured() ? "checking" : "unconfigured");
  const [usage, setUsage] = useState<AIUsage>();
  const [running, setRunning] = useState(false);
  const [answer, setAnswer] = useState<{ text: string; truncated: boolean; question: string; evidence: ProjectEvidence }>();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [viewing, setViewing] = useState<{ source: ResearchSource; highlight: string; label: string }>();
  const abortRef = useRef<AbortController | undefined>(undefined);

  const loadAccess = async () => {
    try { setUsage(await getAIUsage()); setAccess("ready"); }
    catch (accessError) {
      setAccess("signed-out");
      if (!(accessError instanceof AIRequestError && accessError.code === "unauthenticated")) setError(accessError instanceof Error ? accessError.message : "Unable to load your Workpad account.");
    }
  };
  useEffect(() => {
    if (isAccountConfigured()) void getAIUsage().then((loaded) => { setUsage(loaded); setAccess("ready"); }).catch((accessError: unknown) => {
      setAccess("signed-out");
      if (!(accessError instanceof AIRequestError && accessError.code === "unauthenticated")) setError(accessError instanceof Error ? accessError.message : "Unable to load your Workpad account.");
    });
    return () => abortRef.current?.abort();
  }, []);

  const chosen = useMemo(() => sources.filter((source) => selected.has(source.id)), [sources, selected]);
  const evidence = useMemo(() => buildProjectEvidence(chosen, usage?.maxSourceCharacters ?? FALLBACK_BUDGET), [chosen, usage?.maxSourceCharacters]);
  const budgetNote = describeBudget(evidence.sources);
  const outOfCredits = usage ? usage.creditsRemaining <= 0 : false;
  const canAsk = access === "ready" && !outOfCredits && !running && Boolean(question.trim()) && evidence.passages.size > 0;

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else if (next.size < MAX_SOURCES_PER_QUESTION) next.add(id);
    return next;
  });

  const ask = async () => {
    if (!canAsk) return;
    const controller = new AbortController(); abortRef.current = controller;
    const asked = question.trim();
    const sent = evidence;
    setRunning(true); setError(""); setAnswer(undefined); setSaved("");
    try {
      const response = await runAIAction({ action: "research_question", source: sent.text, pageTitle: project.name, pageUrl: "", customPrompt: asked }, controller.signal);
      setAnswer({ text: response.text, truncated: response.truncated, question: asked, evidence: sent });
      const charged = response.usage;
      if (charged) setUsage((current) => current && { ...current, creditsUsed: charged.creditsUsed, creditsLimit: charged.creditsLimit, creditsRemaining: charged.creditsRemaining, periodEnd: charged.periodEnd });
    } catch (askError) {
      if (askError instanceof AIRequestError && askError.code === "unauthenticated") setAccess("signed-out");
      if (askError instanceof AIRequestError && askError.code === "quota_exceeded") setUsage((current) => current && { ...current, creditsRemaining: 0 });
      if ((askError as Error)?.name !== "AbortError") setError(askError instanceof Error ? askError.message : "The AI request failed.");
    } finally { setRunning(false); abortRef.current = undefined; }
  };

  const citedPassages = (text: string, from: ProjectEvidence) => Array.from(new Set(Array.from(text.matchAll(/\[(S\d+:P\d+)\]/g), (match) => match[1])))
    .map((id) => ({ id, entry: from.passages.get(id) }))
    .filter((item): item is { id: string; entry: NonNullable<typeof item.entry> } => Boolean(item.entry));

  const saveToProject = async () => {
    if (!answer) return;
    const evidenceLines = citedPassages(answer.text, answer.evidence).map(({ id, entry }) => `- [${id}] ${entry.evidence.source.title}: ${entry.passage.text}`);
    const text = `Question: ${answer.question}\n\n${answer.text}${answer.truncated ? "\n\n(This answer was cut short at Workpad AI's length limit.)" : ""}\n\nEvidence\n${evidenceLines.join("\n")}`;
    try {
      const { status } = await sourcesRepository.addToProject(project.id, { sourceType: "ai_result", title: `Answer: ${answer.question.slice(0, 90)}`, text, truncated: false });
      setSaved(status === "duplicate" ? "This answer is already saved in the project." : "Saved to the project as an AI result.");
      await onSaved();
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not save the answer."); }
  };

  const signIn = async () => {
    setError("");
    try { await signInWithGoogle(); await loadAccess(); }
    catch (signInError) { setError(signInError instanceof Error ? signInError.message : "Sign-in failed."); }
  };

  const answerPassages: EvidencePassage[] = answer ? Array.from(answer.evidence.passages, ([id, entry]) => ({ id, text: entry.passage.text })) : [];
  const openCitation = (passage: EvidencePassage) => {
    const entry = answer?.evidence.passages.get(passage.id);
    if (entry) setViewing({ source: entry.evidence.source, highlight: entry.passage.text, label: passage.id });
  };

  return <div className="ai-backdrop" role="presentation">
    <section className="ai-workspace" role="dialog" aria-modal="true" aria-label="Ask across sources">
      <header className="ai-header"><div><span className="ai-kicker"><MessagesSquare size={12}/> {project.name.toUpperCase()}</span><h2>Ask across your sources.</h2></div><button aria-label="Close" onClick={onClose}><X size={18}/></button></header>
      <div className="ai-scroll">
        {access === "unconfigured" && <section className="ai-setup"><div className="ai-setup-icon"><Sparkles size={18}/></div><div><strong>Workpad AI is unavailable</strong><p>Accounts are not configured in this build.</p></div></section>}
        {access === "signed-out" && <section className="ai-setup"><div className="ai-setup-icon"><Sparkles size={18}/></div><div><strong>Sign in to use Workpad AI</strong><p>Questions use your monthly Workpad AI credits. Selected source text is sent only when you ask.</p></div><div className="ai-key-row"><button onClick={() => void signIn()}>Sign in with Google</button></div></section>}

        <section><div className="ai-section-title"><span>1</span><div><strong>Choose sources</strong><small>Up to {MAX_SOURCES_PER_QUESTION}. Labels like S1 are used in citations.</small></div></div>
          <ul className="research-source-picks">{sources.map((source) => {
            const item = evidence.sources.find((entry) => entry.source.id === source.id);
            return <li key={source.id}><label><input type="checkbox" checked={selected.has(source.id)} disabled={running || (!selected.has(source.id) && selected.size >= MAX_SOURCES_PER_QUESTION)} onChange={() => toggle(source.id)}/><span className="source-pick-label">{item?.label ?? "–"}</span><span className="source-pick-title">{source.title}</span>{item && <small className={`budget-${item.status}`}>{statusLabels[item.status]}</small>}</label></li>;
          })}</ul>
          {budgetNote && <p className="ai-warning budget-note" role="status"><AlertCircle size={14}/><span>{budgetNote}</span></p>}
        </section>

        <section><div className="ai-section-title"><span>2</span><div><strong>Ask a question</strong><small>Workpad answers only from the selected sources and cites each claim.</small></div></div>
          <label className="ai-field">Your question<textarea aria-label="Your question" rows={3} placeholder="For example: Which option is cheapest for 10 users, and what are the hidden costs?" value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void ask(); }}/><button className="ai-ask-button" disabled={!canAsk} onClick={() => void ask()}><Sparkles size={14}/> Ask across {chosen.length} {chosen.length === 1 ? "source" : "sources"}</button></label>
        </section>

        {(running || answer || error) && <section className="ai-result-section"><div className="ai-section-title"><span>3</span><div><strong>Review the answer</strong><small>Click any [S#:P#] citation to read the stored passage.</small></div></div>
          {running ? <div className="ai-generating"><span className="ai-orb"><LoaderCircle className="spinning" size={20}/></span><strong>Reading your sources…</strong><p>Several sources can take a little longer.</p><button onClick={() => abortRef.current?.abort()}><Square size={11}/> Stop</button></div>
            : answer && <><div className="ai-result"><MarkdownResult text={answer.text} evidence={answerPassages} onCitation={openCitation}/></div>
              {answer.truncated && <div className="ai-warning" role="status"><AlertCircle size={15}/><span>This answer was cut short because it reached Workpad AI's length limit. Try fewer sources or a narrower question.</span></div>}</>}
          {error && <div className="ai-error"><AlertCircle size={15}/><span>{error}</span></div>}
          {saved && <p className="evidence-status" role="status">{saved}</p>}
        </section>}
      </div>
      <footer className="ai-footer"><span>{access === "ready" && usage ? `Workpad AI · ${usage.creditsRemaining.toLocaleString()} of ${usage.creditsLimit.toLocaleString()} credits left` : access === "checking" ? "Checking your account…" : "Workpad AI · not signed in"}</span>{answer && <button className="secondary" disabled={Boolean(saved)} onClick={() => void saveToProject()}>{saved ? <><Check size={15}/> Saved</> : <><FolderPlus size={15}/> Save to project</>}</button>}</footer>
    </section>
    {viewing && <SnapshotViewer source={viewing.source} highlight={viewing.highlight} heading={`${viewing.label} · ${viewing.source.title}`} onClose={() => setViewing(undefined)}/>}
  </div>;
}
