import { useEffect, useRef, useState } from "react";
import { FolderOpen, FolderPlus, Plus, Trash2 } from "lucide-react";
import { MAX_PROJECT_DESCRIPTION_LENGTH, MAX_PROJECT_NAME_LENGTH, projectsRepository, type ProjectSummary } from "../db/repositories/projectsRepository";

const shortDate = (value: string) => new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short" });
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
      <div className="note-card-title"><FolderOpen size={13}/>{project.name}</div>
      {project.description && <p>{project.description}</p>}
      <footer><span>{sourceLabel(project.sourceCount)}</span><time dateTime={project.lastActivityAt}>{shortDate(project.lastActivityAt)}</time></footer>
    </button>)}
  </div>;
}

function ProjectDetail({ project, onChanged, onDeleted }: { project: ProjectSummary; onChanged: () => Promise<void>; onDeleted: () => Promise<void> }) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [error, setError] = useState("");

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
    <div className="empty-state project-sources-empty"><FolderOpen size={22}/><strong>No sources yet</strong><p>Soon you’ll add pages, selections and emails here, then ask questions across them.</p></div>
  </div>;
}

export function ProjectsPanel({ createRequest = 0 }: { createRequest?: number }) {
  const [projects, setProjects] = useState<ProjectSummary[]>();
  const [selectedId, setSelectedId] = useState<string>();
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
