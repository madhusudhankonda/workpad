import { AlertCircle, Sparkles } from "lucide-react";
import { describeBudget, MAX_SOURCES_PER_QUESTION, type ProjectEvidence } from "../services/researchEvidence";
import type { ResearchSource } from "../types";
import type { AIAccess } from "./useResearchAI";

const statusLabels = { full: "Included", shortened: "Shortened", omitted: "Left out" } as const;

export function SourceChecklist({ sources, selected, evidence, onToggle, disabled = false }: {
  sources: ResearchSource[];
  selected: Set<string>;
  evidence: ProjectEvidence;
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  const budgetNote = describeBudget(evidence.sources);
  return <>
    <ul className="research-source-picks">{sources.map((source) => {
      const item = evidence.sources.find((entry) => entry.source.id === source.id);
      return <li key={source.id}><label><input type="checkbox" checked={selected.has(source.id)} disabled={disabled || (!selected.has(source.id) && selected.size >= MAX_SOURCES_PER_QUESTION)} onChange={() => onToggle(source.id)}/><span className="source-pick-label">{item?.label ?? "–"}</span><span className="source-pick-title">{source.title}</span>{item && <small className={`budget-${item.status}`}>{statusLabels[item.status]}</small>}</label></li>;
    })}</ul>
    {budgetNote && <p className="ai-warning budget-note" role="status"><AlertCircle size={14}/><span>{budgetNote}</span></p>}
  </>;
}

export function AIAccessNotice({ access, onSignIn, purpose }: { access: AIAccess; onSignIn: () => void; purpose: string }) {
  if (access === "unconfigured") return <section className="ai-setup"><div className="ai-setup-icon"><Sparkles size={18}/></div><div><strong>Workpad AI is unavailable</strong><p>Accounts are not configured in this build.</p></div></section>;
  if (access !== "signed-out") return null;
  return <section className="ai-setup"><div className="ai-setup-icon"><Sparkles size={18}/></div><div><strong>Sign in to use Workpad AI</strong><p>{purpose} Selected source text is sent only when you start.</p></div><div className="ai-key-row"><button onClick={onSignIn}>Sign in with Google</button></div></section>;
}
