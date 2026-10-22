import { useEffect, useState } from "react";
import { AlertCircle, Check, FolderPlus, LoaderCircle, X } from "lucide-react";
import { projectsRepository, type ProjectSummary } from "../db/repositories/projectsRepository";
import { sourcesRepository, type AddSourceStatus } from "../db/repositories/sourcesRepository";
import { captureEmailDraft, capturePageDrafts, noteDraft, type CaptureDraft } from "../services/researchCapture";
import { PageAccessError, requestPageAccess } from "../services/pageContent";
import type { Note } from "../types";
import { ProjectPicker } from "./ProjectsPanel";

export type CaptureRequest = { kind: "page" } | { kind: "email" } | { kind: "note"; note: Note };

const typeLabels: Record<CaptureDraft["sourceType"], string> = { page: "Web page", selection: "Selection", email: "Email", note: "Note", ai_result: "AI result" };
const statusMessages: Record<AddSourceStatus, (project: string) => string> = {
  added: (project) => `Added to ${project}.`,
  duplicate: (project) => `${project} already has this exact text, so nothing new was stored.`,
  new_version: (project) => `Added to ${project} as a new version. The earlier capture is kept.`
};

async function loadDrafts(request: CaptureRequest, removeTracking: boolean): Promise<{ primary: CaptureDraft; selection?: CaptureDraft }> {
  if (request.kind === "note") return { primary: noteDraft(request.note) };
  if (request.kind === "email") return { primary: await captureEmailDraft(removeTracking) };
  const { page, selection } = await capturePageDrafts(removeTracking);
  return { primary: page, selection };
}

export function AddToResearch({ request, removeTracking, onClose, onOpenProject, onAdded }: {
  request: CaptureRequest;
  removeTracking: boolean;
  onClose: () => void;
  onOpenProject: (projectId: string) => void;
  /** Called after a source is stored, so open project views can refresh. */
  onAdded?: (projectId: string) => void;
}) {
  const [drafts, setDrafts] = useState<{ primary: CaptureDraft; selection?: CaptureDraft }>();
  const [useSelection, setUseSelection] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState<string>();
  const [error, setError] = useState("");
  const [accessUrl, setAccessUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ status: AddSourceStatus; projectId: string; projectName: string }>();
  const draft = useSelection && drafts?.selection ? drafts.selection : drafts?.primary;

  const read = async (askForAccess = false) => {
    setError("");
    try {
      if (askForAccess && !(await requestPageAccess(accessUrl))) throw new Error("Access was not granted, so Workpad cannot read this page.");
      const loaded = await loadDrafts(request, removeTracking);
      setDrafts(loaded); setAccessUrl(""); setUseSelection(Boolean(loaded.selection));
    } catch (readError) {
      if (readError instanceof PageAccessError) setAccessUrl(readError.pageUrl);
      setError(readError instanceof Error ? readError.message : "Could not read this source.");
    }
  };

  useEffect(() => {
    void loadDrafts(request, removeTracking).then((loaded) => { setDrafts(loaded); setUseSelection(Boolean(loaded.selection)); }).catch((readError: unknown) => {
      if (readError instanceof PageAccessError) setAccessUrl(readError.pageUrl);
      setError(readError instanceof Error ? readError.message : "Could not read this source.");
    });
    void projectsRepository.list().then((list) => { setProjects(list); setProjectId((current) => current ?? list[0]?.id); });
  }, []);

  const createProject = async (name: string) => {
    const project = await projectsRepository.create(name);
    setProjects(await projectsRepository.list());
    setProjectId(project.id);
  };

  const add = async () => {
    if (!draft || !projectId || busy) return;
    setBusy(true); setError("");
    try {
      const { status } = await sourcesRepository.addToProject(projectId, draft);
      const projectName = projects.find((project) => project.id === projectId)?.name ?? "the project";
      setResult({ status, projectId, projectName });
      onAdded?.(projectId);
    } catch (addError) { setError(addError instanceof Error ? addError.message : "Could not add this source."); }
    finally { setBusy(false); }
  };

  return <div className="modal-backdrop" role="presentation">
    <section className="modal research-modal" role="dialog" aria-modal="true" aria-label="Add to research">
      <header><h2>Add to research</h2><button aria-label="Close" onClick={onClose}><X size={18}/></button></header>
      <div className="modal-scroll">
        {result
          ? <div className="research-result" role="status"><Check size={18}/><p>{statusMessages[result.status](result.projectName)}</p><div><button onClick={() => onOpenProject(result.projectId)}>Open project</button><button className="secondary" onClick={onClose}>Done</button></div></div>
          : <>
            <h3 className="research-step">1. Check what will be stored</h3>
            {!drafts && !error && <div className="ai-loading"><LoaderCircle size={15}/> Reading this source…</div>}
            {error && <div className="ai-error"><AlertCircle size={15}/><span>{error}</span>{accessUrl && <button onClick={() => void read(true)}>Allow access</button>}</div>}
            {drafts && draft && <>
              {drafts.selection && <div className="source-switch"><button className={useSelection ? "active" : ""} onClick={() => setUseSelection(true)}>Selection <span>{drafts.selection.text.length.toLocaleString()} chars</span></button><button className={!useSelection ? "active" : ""} onClick={() => setUseSelection(false)}>Full page <span>{drafts.primary.text.length.toLocaleString()} chars</span></button></div>}
              <div className="capture-preview">
                <div className="capture-meta"><span className="type-pill">{typeLabels[draft.sourceType]}</span><strong>{draft.title}</strong>{draft.domain && <small>{draft.domain}</small>}</div>
                <pre aria-label="Text that will be stored">{draft.text || "No readable text was found."}</pre>
                <small>{draft.text.length.toLocaleString()} characters will be stored on this device{draft.truncated ? ". This source was long, so the middle was shortened." : "."}</small>
              </div>
              <h3 className="research-step">2. Choose a project</h3>
              <ProjectPicker projects={projects} selectedId={projectId} onSelect={setProjectId} onCreate={createProject}/>
            </>}
          </>}
      </div>
      {!result && drafts && <footer className="research-footer"><button className="secondary" onClick={onClose}>Cancel</button><button disabled={!projectId || !draft?.text || busy} onClick={() => void add()}><FolderPlus size={14}/>{busy ? "Adding…" : projectId ? `Add to ${projects.find((project) => project.id === projectId)?.name ?? "project"}` : "Choose a project"}</button></footer>}
    </section>
  </div>;
}
