import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, Check, FileText, Languages, Lightbulb, ListChecks, LoaderCircle, Save, Share2, Sparkles, Square, X } from "lucide-react";
import { runOpenAIAction } from "../services/ai";
import { buildEvidencePassages, evidenceSource, extractActivePageContent, highlightPageEvidence, PageAccessError, requestPageAccess } from "../services/pageContent";
import { getOpenAIKey, saveOpenAIKey } from "../services/apiKeyStorage";
import type { AIAction, EvidencePassage, ExtractedPageContent, Settings } from "../types";

const actions: { id: AIAction; label: string; description: string; icon: typeof Sparkles }[] = [
  { id: "summary", label: "Summarize", description: "Overview and key points", icon: FileText },
  { id: "translate", label: "Translate", description: "Faithful multilingual translation", icon: Languages },
  { id: "actions", label: "Action points", description: "Tasks, owners, and blockers", icon: ListChecks },
  { id: "explain", label: "Explain", description: "Plain-language walkthrough", icon: Lightbulb },
  { id: "custom", label: "Ask anything", description: "Give Workpad a custom instruction", icon: Sparkles }
];

const actionTitles: Record<AIAction, string> = {
  summary: "Summary",
  translate: "Translation",
  actions: "Action points",
  explain: "Explanation",
  custom: "AI analysis"
};

function inlineMarkdown(text: string, passages: Map<string, EvidencePassage>, onCitation?: (passage: EvidencePassage) => void): ReactNode[] {
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\)|\[P\d+\])/g;
  const output: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) output.push(text.slice(cursor, index));
    const token = match[0];
    if (/^\[P\d+\]$/.test(token)) {
      const passage = passages.get(token.slice(1, -1));
      output.push(passage && onCitation
        ? <button className="evidence-citation" key={`${index}-citation`} title="View supporting passage" onClick={() => onCitation(passage)}>{token}</button>
        : token);
    } else if (token.startsWith("**")) output.push(<strong key={`${index}-strong`}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("`")) output.push(<code key={`${index}-code`}>{token.slice(1, -1)}</code>);
    else {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      output.push(link ? <a key={`${index}-link`} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a> : token);
    }
    cursor = index + token.length;
  }
  if (cursor < text.length) output.push(text.slice(cursor));
  return output;
}

function isMarkdownBlock(line: string): boolean {
  return /^(#{1,3})\s+|^[-*]\s+|^\d+\.\s+|^>\s+|^---+$/.test(line.trim());
}

export function MarkdownResult({ text, evidence = [], onCitation }: { text: string; evidence?: EvidencePassage[]; onCitation?: (passage: EvidencePassage) => void }) {
  const lines = text.split("\n");
  const passages = new Map(evidence.map((passage) => [passage.id, passage]));
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) { index += 1; continue; }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const content = inlineMarkdown(heading[2], passages, onCitation);
      blocks.push(level === 1 ? <h3 key={index}>{content}</h3> : level === 2 ? <h4 key={index}>{content}</h4> : <h5 key={index}>{content}</h5>);
      index += 1; continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(<li key={index}>{inlineMarkdown(lines[index].trim().replace(/^[-*]\s+/, ""), passages, onCitation)}</li>); index += 1;
      }
      blocks.push(<ul key={`ul-${index}`}>{items}</ul>); continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(<li key={index}>{inlineMarkdown(lines[index].trim().replace(/^\d+\.\s+/, ""), passages, onCitation)}</li>); index += 1;
      }
      blocks.push(<ol key={`ol-${index}`}>{items}</ol>); continue;
    }
    if (/^>\s+/.test(line)) { blocks.push(<blockquote key={index}>{inlineMarkdown(line.replace(/^>\s+/, ""), passages, onCitation)}</blockquote>); index += 1; continue; }
    if (/^---+$/.test(line)) { blocks.push(<hr key={index}/>); index += 1; continue; }
    const paragraph: string[] = [line]; index += 1;
    while (index < lines.length && lines[index].trim() && !isMarkdownBlock(lines[index])) { paragraph.push(lines[index].trim()); index += 1; }
    blocks.push(<p key={`p-${index}`}>{inlineMarkdown(paragraph.join(" "), passages, onCitation)}</p>);
  }
  return <div className="markdown-result">{blocks}</div>;
}

export interface SavedAIResult {
  title: string;
  content: string;
  action: AIAction;
}

export function AIWorkspace({ settings, onClose, onSave, initialPrompt = "", socialPlatform, onUseForSocial }: {
  settings: Settings;
  onClose: () => void;
  onSave: (result: SavedAIResult) => Promise<void>;
  initialPrompt?: string;
  socialPlatform?: "x" | "reddit" | "linkedin";
  onUseForSocial?: (result: string, platform: "x" | "reddit" | "linkedin") => void;
}) {
  const [page, setPage] = useState<ExtractedPageContent>();
  const [pageError, setPageError] = useState("");
  const [pageAccessUrl, setPageAccessUrl] = useState("");
  const [loadingPage, setLoadingPage] = useState(true);
  const [sourceMode, setSourceMode] = useState<"selection" | "page">("page");
  const [action, setAction] = useState<AIAction>(initialPrompt ? "custom" : "summary");
  const [targetLanguage, setTargetLanguage] = useState("");
  const [customPrompt, setCustomPrompt] = useState(initialPrompt);
  const [apiKey, setApiKey] = useState("");
  const [safetyIdentifier, setSafetyIdentifier] = useState(() => `workpad_${crypto.randomUUID()}`);
  const [keyDraft, setKeyDraft] = useState("");
  const [rememberKey, setRememberKey] = useState(false);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [evidenceStatus, setEvidenceStatus] = useState("");
  const abortRef = useRef<AbortController | undefined>(undefined);

  const loadPage = async (requestAccess = false) => {
    try {
      if (requestAccess && !await requestPageAccess(pageAccessUrl)) {
        throw new Error("Page access was not granted. Workpad cannot read this website without it.");
      }
      const extracted = await extractActivePageContent(settings.aiMaxSourceCharacters);
      setPage(extracted);
      setSourceMode(extracted.selection ? "selection" : "page");
    } catch (loadError) {
      if (loadError instanceof PageAccessError) setPageAccessUrl(loadError.pageUrl);
      setPageError(loadError instanceof Error ? loadError.message : "Could not read this page.");
    } finally { setLoadingPage(false); }
  };

  const needsPageAccess = /access|permission/i.test(pageError);
  const retryPage = () => { setLoadingPage(true); setPageError(""); void loadPage(needsPageAccess); };

  useEffect(() => {
    void extractActivePageContent(settings.aiMaxSourceCharacters).then((extracted) => {
      setPage(extracted);
      setSourceMode(extracted.selection ? "selection" : "page");
    }).catch((loadError: unknown) => {
      if (loadError instanceof PageAccessError) setPageAccessUrl(loadError.pageUrl);
      setPageError(loadError instanceof Error ? loadError.message : "Could not read this page.");
    }).finally(() => setLoadingPage(false));
    void getOpenAIKey().then(({ key }) => setApiKey(key));
    void chrome.storage.local.get("aiSafetyIdentifier").then(({ aiSafetyIdentifier }) => {
      if (typeof aiSafetyIdentifier === "string") setSafetyIdentifier(aiSafetyIdentifier);
      else void chrome.storage.local.set({ aiSafetyIdentifier: safetyIdentifier });
    });
    return () => abortRef.current?.abort();
  }, [settings.aiMaxSourceCharacters]);

  const source = useMemo(() => sourceMode === "selection" ? page?.selection ?? "" : page?.text ?? "", [page, sourceMode]);
  const passages = useMemo(() => buildEvidencePassages(source), [source]);
  const canRunAction = (requestedAction: AIAction) => Boolean(apiKey && source && !running && (requestedAction !== "custom" || customPrompt.trim()));

  const saveKey = async () => {
    const value = keyDraft.trim();
    if (!value) return;
    try {
      await saveOpenAIKey(value, rememberKey);
      setApiKey(value); setKeyDraft(""); setError("");
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Could not save the API key."); }
  };

  const run = async (requestedAction: AIAction = action, requestedLanguage = targetLanguage) => {
    if (!page || !canRunAction(requestedAction) || (requestedAction === "translate" && !requestedLanguage)) return;
    const controller = new AbortController(); abortRef.current = controller;
    setAction(requestedAction); setRunning(true); setResult(""); setError(""); setSaved(false);
    try {
      setResult(await runOpenAIAction({
        apiKey,
        model: settings.aiModel,
        action: requestedAction,
        source: evidenceSource(passages),
        pageTitle: page.title,
        pageUrl: page.url,
        targetLanguage: requestedLanguage,
        customPrompt,
        safetyIdentifier
      }, controller.signal));
    } catch (runError) {
      if ((runError as Error)?.name !== "AbortError") setError(runError instanceof Error ? runError.message : "The AI request failed.");
    } finally { setRunning(false); abortRef.current = undefined; }
  };

  const save = async () => {
    if (!page || !result) return;
    setSaving(true); setError("");
    try {
      const citedIds = Array.from(new Set(Array.from(result.matchAll(/\[(P\d+)\]/g), (match) => match[1])));
      const citedPassages = citedIds.map((id) => passages.find((passage) => passage.id === id)).filter((passage): passage is EvidencePassage => Boolean(passage));
      const evidence = citedPassages.length
        ? `\n\n## Evidence\n${citedPassages.map((passage) => `- **[${passage.id}]** ${passage.text}`).join("\n")}`
        : "";
      await onSave({
        action,
        title: `${actionTitles[action]}: ${page.title}`,
        content: `${result}${evidence}\n\n---\nSource: [${page.title}](${page.url})\nGenerated by Workpad AI · ${settings.aiModel}`
      });
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the result.");
    } finally { setSaving(false); }
  };

  const inspectEvidence = async (passage: EvidencePassage) => {
    setEvidenceStatus("Finding evidence on the page…");
    try {
      const highlighted = await highlightPageEvidence(passage.text);
      setEvidenceStatus(highlighted ? `${passage.id} highlighted on the page.` : "That passage is no longer visible on the current page.");
    } catch {
      setEvidenceStatus("Workpad could not highlight that passage on the current page.");
    }
  };

  return <div className="ai-backdrop" role="presentation">
    <section className="ai-workspace" role="dialog" aria-modal="true" aria-label="Workpad AI">
      <header className="ai-header"><div><span className="ai-kicker"><Sparkles size={12}/> WORKPAD AI</span><h2>Turn this page into useful work.</h2></div><button aria-label="Close AI workspace" onClick={onClose}><X size={18}/></button></header>

      <div className="ai-scroll">
        {!apiKey && <section className="ai-setup"><div className="ai-setup-icon"><Sparkles size={18}/></div><div><strong>Connect OpenAI</strong><p>Your key is kept for this Chrome session by default. Page text is sent only when you run an AI action.</p></div><div className="ai-key-row"><input type="password" autoComplete="off" placeholder="sk-…" aria-label="OpenAI API key" value={keyDraft} onChange={(event) => setKeyDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveKey(); }}/><button disabled={!keyDraft.trim()} onClick={() => void saveKey()}>Use key</button></div><label className="ai-key-remember"><input type="checkbox" checked={rememberKey} onChange={(event) => setRememberKey(event.target.checked)}/><span>Remember on this device</span></label><small className="ai-key-note">{rememberKey ? "The key remains after Chrome or Workpad reloads. It is excluded from exports and cloud sync." : "Session-only keys are removed when Chrome closes or the unpacked extension is reloaded."}</small></section>}

        <section className="ai-source-section"><div className="ai-section-title"><span>1</span><div><strong>Choose the source</strong><small>Nothing is sent until you choose an AI action.</small></div></div>
          {loadingPage ? <div className="ai-loading"><LoaderCircle size={16}/> Reading the page…</div> : pageError ? <div className="ai-error"><AlertCircle size={15}/><span>{pageError}</span><button onClick={retryPage}>{needsPageAccess ? "Allow access" : "Try again"}</button></div> : page && <>
            <div className="source-switch"><button className={sourceMode === "page" ? "active" : ""} onClick={() => setSourceMode("page")}>Full page <span>{page.text.length.toLocaleString()} chars</span></button><button disabled={!page.selection} className={sourceMode === "selection" ? "active" : ""} onClick={() => setSourceMode("selection")}>Selection <span>{page.selection ? `${page.selection.length.toLocaleString()} chars` : "None"}</span></button></div>
          <div className="source-preview"><strong>{page.title}</strong><p>{source.slice(0, 360)}{source.length > 360 ? "…" : ""}</p><small>{passages.length.toLocaleString()} traceable evidence passages{page.truncated && sourceMode === "page" ? ` · Long page: using ${settings.aiMaxSourceCharacters.toLocaleString()} characters` : ""}</small></div>
          </>}
        </section>

        <section><div className="ai-section-title"><span>2</span><div><strong>Choose an AI action</strong><small>Click a preset to run it, or write your own instruction.</small></div></div><div className="ai-action-grid">{actions.map((item) => <button key={item.id} disabled={!apiKey || !source || running} className={action === item.id ? "active" : ""} onClick={() => { if (item.id === "custom" || (item.id === "translate" && !targetLanguage)) { setAction(item.id); setResult(""); setSaved(false); } else void run(item.id); }}><item.icon size={16}/><span><strong>{item.label}</strong><small>{item.description}</small></span></button>)}</div>
          {action === "translate" && <label className="ai-field">Translate into<select disabled={running} value={targetLanguage} onChange={(event) => { const language = event.target.value; setTargetLanguage(language); void run("translate", language); }}><option value="" disabled>Choose a language…</option><option>English</option><option>Spanish</option><option>French</option><option>German</option><option>Italian</option><option>Portuguese</option><option>Hindi</option><option>Japanese</option><option>Korean</option><option>Chinese (Simplified)</option><option>Arabic</option></select></label>}
          {action === "custom" && <label className="ai-field">Your instruction<textarea rows={3} placeholder="For example: Compare the arguments and identify weak assumptions…" value={customPrompt} onChange={(event) => setCustomPrompt(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void run("custom"); }}/><button className="ai-ask-button" disabled={!canRunAction("custom")} onClick={() => void run("custom")}><Sparkles size={14}/> Ask Workpad</button></label>}
        </section>

        {(running || result || error) && <section className="ai-result-section"><div className="ai-section-title"><span>3</span><div><strong>Review the result</strong><small>Click any [P#] citation to inspect its evidence on the page.</small></div></div>{running ? <div className="ai-generating"><span className="ai-orb"><LoaderCircle className="spinning" size={20}/></span><strong>Working through the source…</strong><p>This can take a moment for longer pages.</p><button onClick={() => abortRef.current?.abort()}><Square size={11}/> Stop</button></div> : result ? <><div className="ai-result"><MarkdownResult text={result} evidence={passages} onCitation={(passage) => void inspectEvidence(passage)}/></div>{evidenceStatus && <p className="evidence-status" role="status">{evidenceStatus}</p>}{onUseForSocial && socialPlatform && <div className="ai-share-results"><div><Share2 size={14}/><span><strong>Use this draft on</strong><small>Written for {socialPlatform === "x" ? "X" : socialPlatform === "reddit" ? "Reddit" : "LinkedIn"}; review it when reusing elsewhere.</small></span></div><div>{(["x", "reddit", "linkedin"] as const).map((platform) => <button className={platform === socialPlatform ? "preferred" : ""} key={platform} onClick={() => onUseForSocial(result, platform)}>{platform === "x" ? "X" : platform === "reddit" ? "Reddit" : "LinkedIn"}</button>)}</div></div>}</> : null}{error && <div className="ai-error"><AlertCircle size={15}/><span>{error}</span></div>}</section>}
      </div>

      <footer className="ai-footer"><span>{apiKey ? `${settings.aiModel} · OpenAI` : "Add an API key to continue"}</span>{result && <button className="secondary" disabled={saving || saved} onClick={() => void save()}>{saved ? <><Check size={15}/> Saved to notes</> : <><Save size={15}/>{saving ? "Saving…" : "Save as note"}</>}</button>}</footer>
    </section>
  </div>;
}
