import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Check, Copy, Download, Eye, FileText, LoaderCircle, PencilLine, Square, Trash2, X } from "lucide-react";
import { briefsRepository } from "../db/repositories/briefsRepository";
import { runAIAction } from "../services/ai";
import { briefEvidenceFrom, briefFileName, briefMarkdown, briefPassages, unresolvedCitations, uncitedSections } from "../services/briefs";
import { MAX_SOURCES_PER_QUESTION } from "../services/researchEvidence";
import type { DecisionBrief, EvidencePassage, ResearchProject, ResearchSource } from "../types";
import { downloadText } from "../utils/backup";
import { MarkdownResult } from "./AIWorkspace";
import { SnapshotViewer } from "./ProjectsPanel";
import { AIAccessNotice, SourceChecklist } from "./SourceChecklist";
import { useResearchAI } from "./useResearchAI";

function BriefGenerator({ project, sources, onCreated }: { project: ResearchProject; sources: ResearchSource[]; onCreated: (brief: DecisionBrief) => void }) {
  const { access, usage, error, setError, signIn, selected, toggle, evidence, outOfCredits, afterRequest } = useResearchAI(sources);
  const [objective, setObjective] = useState(project.description);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => abortRef.current?.abort(), []);
  const canGenerate = access === "ready" && !outOfCredits && !running && evidence.passages.size > 0;

  const generate = async () => {
    if (!canGenerate) return;
    const controller = new AbortController(); abortRef.current = controller;
    const sent = evidence;
    const goal = objective.trim();
    setRunning(true); setError("");
    try {
      const response = await runAIAction({ action: "decision_brief", source: sent.text, pageTitle: project.name, pageUrl: "", customPrompt: goal }, controller.signal);
      afterRequest(response);
      onCreated(await briefsRepository.create({
        projectId: project.id,
        title: `Decision brief: ${project.name}`,
        objective: goal,
        content: response.text,
        evidence: briefEvidenceFrom(response.text, sent),
        truncated: response.truncated,
        model: response.model
      }));
    } catch (generateError) {
      afterRequest(generateError);
      if ((generateError as Error)?.name !== "AbortError") setError(generateError instanceof Error ? generateError.message : "Could not create the brief.");
    } finally { setRunning(false); abortRef.current = undefined; }
  };

  return <>
    <div className="ai-scroll">
      <AIAccessNotice access={access} onSignIn={() => void signIn()} purpose="Briefs use your monthly Workpad AI credits, more than a single question."/>
      <section><div className="ai-section-title"><span>1</span><div><strong>Choose sources</strong><small>Up to {MAX_SOURCES_PER_QUESTION}. Labels like S1 are used in citations.</small></div></div>
        <SourceChecklist sources={sources} selected={selected} evidence={evidence} onToggle={toggle} disabled={running}/>
      </section>
      <section><div className="ai-section-title"><span>2</span><div><strong>State the decision</strong><small>The brief compares options against this objective.</small></div></div>
        <label className="ai-field">Objective<textarea aria-label="Objective" rows={3} placeholder="e.g. Choose a CRM for a 10-person sales team within £500 a month" value={objective} onChange={(event) => setObjective(event.target.value)}/></label>
      </section>
      <section><div className="ai-section-title"><span>3</span><div><strong>Create the brief</strong><small>Objective, findings, options table, risks, recommendation and next actions, each finding cited.</small></div></div>
        {running
          ? <div className="ai-generating"><span className="ai-orb"><LoaderCircle className="spinning" size={20}/></span><strong>Writing your brief…</strong><p>This takes longer than a question.</p><button onClick={() => abortRef.current?.abort()}><Square size={11}/> Stop</button></div>
          : <button className="ai-ask-button brief-generate" disabled={!canGenerate} onClick={() => void generate()}><FileText size={14}/> Create decision brief</button>}
        {error && <div className="ai-error"><AlertCircle size={15}/><span>{error}</span></div>}
      </section>
    </div>
    <footer className="ai-footer"><span>{access === "ready" && usage ? `Workpad AI · ${usage.creditsRemaining.toLocaleString()} of ${usage.creditsLimit.toLocaleString()} credits left` : access === "checking" ? "Checking your account…" : "Workpad AI · not signed in"}</span></footer>
  </>;
}

function BriefEditor({ brief: initial, sources, onChanged, onDeleted }: { brief: DecisionBrief; sources: ResearchSource[]; onChanged: () => Promise<void>; onDeleted: () => Promise<void> }) {
  const [brief, setBrief] = useState(initial);
  const [mode, setMode] = useState<"preview" | "edit">("preview");
  const [status, setStatus] = useState("");
  const [viewing, setViewing] = useState<{ source: ResearchSource; highlight: string; label: string }>();
  const lastSaved = useRef({ title: initial.title, content: initial.content });
  const passages = useMemo(() => briefPassages(brief), [brief]);
  const citationPassages: EvidencePassage[] = useMemo(() => Array.from(passages, ([id, entry]) => ({ id, text: entry.passage.text })), [passages]);
  const uncited = uncitedSections(brief.content);
  const broken = unresolvedCitations(brief);

  const save = async (changes: Partial<Pick<DecisionBrief, "title" | "content">>) => {
    if ((changes.title ?? lastSaved.current.title) === lastSaved.current.title && (changes.content ?? lastSaved.current.content) === lastSaved.current.content) return;
    try {
      const updated = await briefsRepository.update(brief.id, changes);
      lastSaved.current = { title: updated.title, content: updated.content };
      setBrief(updated); setStatus("Saved"); await onChanged();
    }
    catch (saveError) { setStatus(saveError instanceof Error ? saveError.message : "Could not save the brief."); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(briefMarkdown(brief)); setStatus("Copied as Markdown"); }
    catch { setStatus("Copy failed. Use Download instead."); }
  };
  const remove = async () => {
    if (!confirm(`Delete “${brief.title}”? Its sources stay in the project. This cannot be undone.`)) return;
    await briefsRepository.delete(brief.id);
    await onDeleted();
  };
  const openCitation = (passage: EvidencePassage) => {
    const entry = passages.get(passage.id);
    if (!entry) return;
    const source = sources.find((item) => item.id === entry.evidence.sourceId);
    // The source may have been removed since; fall back to the passage stored with the brief.
    setViewing({
      source: source ?? { id: entry.evidence.sourceId, projectId: brief.projectId, sourceType: "page", title: `${entry.evidence.title} (removed from project)`, url: entry.evidence.url, snapshotText: entry.passage.text, snapshotTruncated: false, contentHash: "", version: 1, capturedAt: entry.evidence.capturedAt, createdAt: entry.evidence.capturedAt, updatedAt: entry.evidence.capturedAt },
      highlight: entry.passage.text,
      label: passage.id
    });
  };

  return <>
    <div className="ai-scroll">
      <input className="brief-title" aria-label="Brief title" value={brief.title} onChange={(event) => setBrief({ ...brief, title: event.target.value })} onBlur={() => void save({ title: brief.title })}/>
      <p className="brief-meta">{brief.objective ? <>Objective: {brief.objective} · </> : null}Created {new Date(brief.createdAt).toLocaleDateString()} from {brief.evidence.length} {brief.evidence.length === 1 ? "source" : "sources"}</p>
      <div className="brief-toolbar" role="toolbar" aria-label="Brief actions">
        <button className={mode === "preview" ? "active" : ""} onClick={() => setMode("preview")}><Eye size={14}/>Preview</button>
        <button className={mode === "edit" ? "active" : ""} onClick={() => setMode("edit")}><PencilLine size={14}/>Edit</button>
        <span/>
        <button aria-label="Copy as Markdown" title="Copy as Markdown" onClick={() => void copy()}><Copy size={14}/></button>
        <button aria-label="Download Markdown" title="Download Markdown" onClick={() => downloadText(briefFileName(brief.title), briefMarkdown(brief), "text/markdown")}><Download size={14}/></button>
        <button className="danger" aria-label="Delete brief" title="Delete brief" onClick={() => void remove()}><Trash2 size={14}/></button>
      </div>
      {brief.truncated && <div className="ai-warning" role="status"><AlertCircle size={15}/><span>This brief was cut short at Workpad AI's length limit. Try fewer sources, or finish the last section yourself.</span></div>}
      {uncited.length > 0 && <div className="ai-warning" role="status"><AlertCircle size={15}/><span>{uncited.join(" and ")} {uncited.length === 1 ? "has" : "have"} no citations. Check these statements against your sources before relying on them.</span></div>}
      {broken.length > 0 && <div className="ai-warning" role="status"><AlertCircle size={15}/><span>{broken.length} {broken.length === 1 ? "citation no longer matches" : "citations no longer match"} a stored passage ({broken.map((id) => `[${id}]`).join(", ")}).</span></div>}
      {mode === "preview"
        ? <div className="ai-result brief-preview"><MarkdownResult text={brief.content} evidence={citationPassages} onCitation={openCitation}/></div>
        : <textarea className="brief-editor" aria-label="Brief Markdown" value={brief.content} onChange={(event) => setBrief({ ...brief, content: event.target.value })} onBlur={() => void save({ content: brief.content })}/>}
      <p className="evidence-status">Sections marked “Inference:” are AI judgement. Click a citation to read the stored passage.</p>
    </div>
    <footer className="ai-footer"><span>{status ? <><Check size={11}/> {status}</> : `Last edited ${new Date(brief.updatedAt).toLocaleString()}`}</span></footer>
    {viewing && <SnapshotViewer source={viewing.source} highlight={viewing.highlight} heading={`${viewing.label} · ${viewing.source.title}`} onClose={() => setViewing(undefined)}/>}
  </>;
}

/** Creates a new decision brief, or opens an existing one for review and editing. */
export function BriefWorkspace({ project, sources, brief, onClose, onChanged }: {
  project: ResearchProject;
  sources: ResearchSource[];
  brief?: DecisionBrief;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [current, setCurrent] = useState(brief);
  return <div className="ai-backdrop" role="presentation">
    <section className="ai-workspace" role="dialog" aria-modal="true" aria-label="Decision brief">
      <header className="ai-header"><div><span className="ai-kicker"><FileText size={12}/> {project.name.toUpperCase()}</span><h2>{current ? "Review your decision brief." : "Create a decision brief."}</h2></div><button aria-label="Close" onClick={onClose}><X size={18}/></button></header>
      {current
        ? <BriefEditor brief={current} sources={sources} onChanged={onChanged} onDeleted={async () => { await onChanged(); onClose(); }}/>
        : <BriefGenerator project={project} sources={sources} onCreated={(created) => { setCurrent(created); void onChanged(); }}/>}
    </section>
  </div>;
}
