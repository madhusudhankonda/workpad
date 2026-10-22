import { useEffect, useRef, useState } from "react";
import { ExternalLink, FileText, FolderOpen, FolderPlus, Mail, MessagesSquare, NotebookPen, Plus, Sparkles, TextSelect, Trash2, X } from "lucide-react";
import { MAX_PROJECT_DESCRIPTION_LENGTH, MAX_PROJECT_NAME_LENGTH, projectsRepository, type ProjectSummary } from "../db/repositories/projectsRepository";
import { sourcesRepository } from "../db/repositories/sourcesRepository";
import type { ResearchSource, ResearchSourceType } from "../types";
import { ResearchQuestion } from "./ResearchQuestion";
import { splitAtPassage } from "../utils/passages";

const shortDate = (value: string) => new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const sourceTypes: Record<ResearchSourceType, { label: string; icon: typeof FileText }> = {
  page: { label: "Web page", icon: FileText },
  selection: { label: "Selection", icon: TextSelect },
  email: { label: "Email", icon: Mail },
  note: { label: "Note", icon: NotebookPen },
  ai_result: { label: "AI result", icon: Sparkles }
};
const isWebUrl = (url?: string) => Boolean(url && /^https?:\/\//i.test(url));
const sourceLabel = (count: number) => `${count} ${count === 1 ? "source" : "sources"}`;

/** Lists research projects and creates new ones. Reused by "Add to research" in phase 2. */
export function ProjectPicker({ projects, selectedId, onSelect, onCreate, createRequest = 0 }: {
  projects: ProjectSummary[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onCreate: (name: string) => Promise<void>;
  /** Increment to open the "New research project" form from outside. */
  createRequest?: number;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [seenRequest, setSeenRequest] = useState(createRequest);
  const inputRef = useRef<HTMLInputElement>(null);

  // Open the form when the parent asks (toolbar "+" or Cmd/Ctrl+N), adjusting state during render.
  if (createRequest !== seenRequest) { setSeenRequest(createRequest); setCreating(true); }
  useEffect(() => { if (creating) inputRef.current?.focus(); }, [creating]);

  const submit = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try { await onCreate(name); setName(""); setCreating(false); }
    catch (createError) { setError(createError instanceof Error ? createError.message : "Could not create the project."); }
    finally { setBusy(false); }
  };
  const cancel = () => { setCreating(false); setName(""); setError(""); };

  return <div className="project-picker">
    {creating
      ? <form className="project-create" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <input ref={inputRef} aria-label="Project name" placeholder="e.g. CRM selection" maxLength={MAX_PROJECT_NAME_LENGTH} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") cancel(); }}/>
          <div><button type="submit" disabled={busy || !name.trim()}>Create</button><button type="button" className="secondary" onClick={cancel}>Cancel</button></div>
          {error && <small role="alert">{error}</small>}
        </form>
      : <button className="project-new" onClick={() => setCreating(true)}><Plus size={14}/>New research project</button>}
    {projects.map((project) => <button key={project.id} className={`note-card${selectedId === project.id ? " selected" : ""}`} aria-current={selectedId === project.id ? "true" : undefined} onClick={() => onSelect(project.id)}>
      <div className="note-card-title wrap-title"><FolderOpen size={13}/><span>{project.name}</span></div>
      {project.description && <p>{project.description}</p>}
      <footer><span>{sourceLabel(project.sourceCount)}</span><time dateTime={project.lastActivityAt}>{shortDate(project.lastActivityAt)}</time></footer>
    </button>)}
  </div>;
}

function ProjectDetail({ project, onChanged, onDeleted }: { project: ProjectSummary; onChanged: () => Promise<void>; onDeleted: () => Promise<void> }) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [error, setError] = useState("");
  const [sources, setSources] = useState<ResearchSource[]>();
  const [viewing, setViewing] = useState<ResearchSource>();
  const [asking, setAsking] = useState(false);

  useEffect(() => { void sourcesRepository.listForProject(project.id).then(setSources); }, [project.id]);
  const removeSource = async (source: ResearchSource) => {
    if (!confirm(`Remove “${source.title}” from ${project.name}? The original page, email or note is not affected.`)) return;
    await sourcesRepository.remove(source.id);
    setViewing(undefined);
    setSources(await sourcesRepository.listForProject(project.id));
    await onChanged();
  };

  const save = async (changes: { name?: string; description?: string }) => {
    if ((changes.name ?? project.name) === project.name && (changes.description ?? project.description) === project.description) return;
    try { await projectsRepository.update(project.id, changes); setError(""); await onChanged(); }
    catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the project.");
      setName(project.name);
    }
  };
  const remove = async () => {
    const sources = project.sourceCount ? ` and its ${sourceLabel(project.sourceCount)}` : "";
    if (!confirm(`Delete “${project.name}”${sources}? Your notes are not affected. This cannot be undone.`)) return;
    await projectsRepository.delete(project.id);
    await onDeleted();
  };

  return <div className="editor project-detail">
    <div className="editor-toolbar"><span className="project-meta">{sourceLabel(project.sourceCount)} · Updated {shortDate(project.lastActivityAt)}</span><button className="danger" aria-label="Delete project" title="Delete project" onClick={() => void remove()}><Trash2 size={16}/></button></div>
    <input className="title-input" aria-label="Project name" maxLength={MAX_PROJECT_NAME_LENGTH} value={name} onChange={(event) => setName(event.target.value)} onBlur={() => void save({ name })} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }}/>
    <textarea className="project-description" aria-label="Project description" placeholder="What decision is this research for?" rows={3} maxLength={MAX_PROJECT_DESCRIPTION_LENGTH} value={description} onChange={(event) => setDescription(event.target.value)} onBlur={() => void save({ description })}/>
    {error && <small className="project-error" role="alert">{error}</small>}
    {sources && sources.length > 0 && <button className="ask-sources" onClick={() => setAsking(true)}><MessagesSquare size={14}/>Ask across sources</button>}
    {sources && (sources.length
      ? <div className="source-list" aria-label="Sources">{sources.map((source) => {
          const type = sourceTypes[source.sourceType];
          return <button key={source.id} className="note-card source-card" onClick={() => setViewing(source)}>
            <div className="note-card-title wrap-title"><type.icon size={13}/><span>{source.title}</span></div>
            <footer><span className="type-pill">{type.label}</span>{source.version > 1 && <span className="type-pill">v{source.version}</span>}{source.domain && <span>{source.domain}</span>}<time dateTime={source.capturedAt}>{shortDate(source.capturedAt)}</time></footer>
          </button>;
        })}</div>
      : <div className="empty-state project-sources-empty"><FolderOpen size={22}/><strong>No sources yet</strong><p>Use Research on a page, email or note to add it here.</p></div>)}
    {viewing && <SnapshotViewer source={viewing} onClose={() => setViewing(undefined)} onRemove={() => void removeSource(viewing)}/>}
    {asking && sources && <ResearchQuestion project={project} sources={sources} onClose={() => setAsking(false)} onSaved={async () => { setSources(await sourcesRepository.listForProject(project.id)); await onChanged(); }}/>}
  </div>;
}

/** Shows exactly what was captured, when, and from where. */
export function SnapshotViewer({ source, onClose, onRemove, highlight, heading }: { source: ResearchSource; onClose: () => void; onRemove?: () => void; highlight?: string; heading?: string }) {
  const type = sourceTypes[source.sourceType];
  const parts = highlight ? splitAtPassage(source.snapshotText, highlight) : undefined;
  const markRef = useRef<HTMLElement>(null);
  useEffect(() => { markRef.current?.scrollIntoView?.({ block: "center" }); }, [highlight]);
  return <div className="modal-backdrop" role="presentation">
    <section className="modal research-modal" role="dialog" aria-modal="true" aria-label={`Snapshot: ${source.title}`}>
      <header><h2>{heading ?? source.title}</h2><button aria-label="Close snapshot" onClick={onClose}><X size={18}/></button></header>
      <div className="modal-scroll">
        <dl className="snapshot-meta">
          <div><dt>Type</dt><dd>{type.label}{source.version > 1 ? ` · version ${source.version}` : ""}</dd></div>
          <div><dt>Captured</dt><dd>{new Date(source.capturedAt).toLocaleString()}</dd></div>
          {source.url && <div><dt>From</dt><dd>{isWebUrl(source.url) ? <a href={source.url} target="_blank" rel="noreferrer">{source.domain || source.url} <ExternalLink size={11}/></a> : source.domain || source.url}</dd></div>}
        </dl>
        {source.snapshotTruncated && <p className="snapshot-note">This source was long, so Workpad stored its start and end and shortened the middle.</p>}
        <pre className="snapshot-text" aria-label="Captured text">{parts ? <>{parts[0]}<mark ref={markRef} className="snapshot-highlight">{parts[1]}</mark>{parts[2]}</> : source.snapshotText}</pre>
        <p className="snapshot-note">This is the text as captured. Later changes to the original are not reflected here.</p>
      </div>
      {onRemove && <footer className="research-footer"><button className="danger-button" onClick={onRemove}><Trash2 size={14}/>Remove from project</button><button className="secondary" onClick={onClose}>Close</button></footer>}
    </section>
  </div>;
}

export function ProjectsPanel({ createRequest = 0, initialProjectId }: { createRequest?: number; initialProjectId?: string }) {
  const [projects, setProjects] = useState<ProjectSummary[]>();
  const [selectedId, setSelectedId] = useState<string | undefined>(initialProjectId);
  const selected = projects?.find((project) => project.id === selectedId);

  const load = async () => setProjects(await projectsRepository.list());
  useEffect(() => { void projectsRepository.list().then(setProjects); }, []);

  const create = async (name: string) => {
    const project = await projectsRepository.create(name);
    await load();
    setSelectedId(project.id);
  };

  return <section className="content">
    <aside className="notes-list">
      <div className="list-heading"><span>Research projects</span></div>
      {projects && <ProjectPicker projects={projects} selectedId={selectedId} onSelect={setSelectedId} onCreate={create} createRequest={createRequest}/>}
    </aside>
    <section className="editor-panel">
      {selected
        ? <ProjectDetail key={selected.id} project={selected} onChanged={load} onDeleted={async () => { setSelectedId(undefined); await load(); }}/>
        : projects && <div className="editor-empty"><FolderPlus size={24}/><h2>{projects?.length ? "Choose a project" : "Start a research project"}</h2><p>Collect the sources behind a decision in one place, such as “CRM selection” or “Laptop shortlist”.</p></div>}
    </section>
  </section>;
}
