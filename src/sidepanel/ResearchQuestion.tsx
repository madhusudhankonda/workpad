import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check, FolderPlus, LoaderCircle, MessagesSquare, Sparkles, Square, X } from "lucide-react";
import { sourcesRepository } from "../db/repositories/sourcesRepository";
import { runAIAction } from "../services/ai";
import { MAX_SOURCES_PER_QUESTION, type ProjectEvidence } from "../services/researchEvidence";
import type { EvidencePassage, ResearchProject, ResearchSource } from "../types";
import { MarkdownResult } from "./AIWorkspace";
import { SnapshotViewer } from "./ProjectsPanel";
import { AIAccessNotice, SourceChecklist } from "./SourceChecklist";
import { useResearchAI } from "./useResearchAI";

export function ResearchQuestion({ project, sources, initialQuestion = "", onClose, onSaved }: {
  project: ResearchProject;
  sources: ResearchSource[];
  /** Question typed in the project view, so it does not need retyping here. */
  initialQuestion?: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { access, usage, error, setError, signIn, selected, toggle, chosen, evidence, outOfCredits, afterRequest } = useResearchAI(sources);
  const [question, setQuestion] = useState(initialQuestion);
  const [running, setRunning] = useState(false);
  const [answer, setAnswer] = useState<{ text: string; truncated: boolean; question: string; evidence: ProjectEvidence }>();
  const [saved, setSaved] = useState("");
  const [viewing, setViewing] = useState<{ source: ResearchSource; highlight: string; label: string }>();
  const abortRef = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => abortRef.current?.abort(), []);

  const canAsk = access === "ready" && !outOfCredits && !running && Boolean(question.trim()) && evidence.passages.size > 0;

  const ask = async () => {
    if (!canAsk) return;
    const controller = new AbortController(); abortRef.current = controller;
    const asked = question.trim();
    const sent = evidence;
    setRunning(true); setError(""); setAnswer(undefined); setSaved("");
    try {
      const response = await runAIAction({ action: "research_question", source: sent.text, pageTitle: project.name, pageUrl: "", customPrompt: asked }, controller.signal);
      setAnswer({ text: response.text, truncated: response.truncated, question: asked, evidence: sent });
      afterRequest(response);
    } catch (askError) {
      afterRequest(askError);
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

  const answerPassages: EvidencePassage[] = answer ? Array.from(answer.evidence.passages, ([id, entry]) => ({ id, text: entry.passage.text })) : [];
  const openCitation = (passage: EvidencePassage) => {
    const entry = answer?.evidence.passages.get(passage.id);
    if (entry) setViewing({ source: entry.evidence.source, highlight: entry.passage.text, label: passage.id });
  };

  return <div className="ai-backdrop" role="presentation">
    <section className="ai-workspace" role="dialog" aria-modal="true" aria-label="Ask across sources">
      <header className="ai-header"><div><span className="ai-kicker"><MessagesSquare size={12}/> {project.name.toUpperCase()}</span><h2>Ask across your sources.</h2></div><button aria-label="Close" onClick={onClose}><X size={18}/></button></header>
      <div className="ai-scroll">
        <AIAccessNotice access={access} onSignIn={() => void signIn()} purpose="Questions use your monthly Workpad AI credits."/>

        <section><div className="ai-section-title"><span>1</span><div><strong>Choose sources</strong><small>Up to {MAX_SOURCES_PER_QUESTION}. Labels like S1 are used in citations.</small></div></div>
          <SourceChecklist sources={sources} selected={selected} evidence={evidence} onToggle={toggle} disabled={running}/>
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
