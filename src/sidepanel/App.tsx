import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, Check, ChevronLeft, Copy, Download, FilePlus2, Heart, PanelRight, Plus, Search, Settings as SettingsIcon, Star, Trash2, Upload, X } from "lucide-react";
import { db, defaultSettings } from "../db/database";
import { notesRepository } from "../db/repositories/notesRepository";
import { getActivePageContext } from "../services/chrome";
import type { NewNote, Note, NoteType, PageContext, Settings } from "../types";
import { createBackup, downloadText, MAX_BACKUP_BYTES, noteMarkdown, validateBackup } from "../utils/backup";
import { extractDomain, normalizeUrl } from "../utils/url";

type Section = "page" | "scratchpad" | "all" | "favourites";
type PendingCapture = { kind: string; selection: string; url: string; title: string; capturedAt: string };
const labels: Record<Section, string> = { page: "Current Page", scratchpad: "Scratchpad", all: "All Notes", favourites: "Favourites" };
const blank = (type: NoteType = "standalone"): NewNote => ({ title: "", content: "", type, tags: [], isFavourite: false, isArchived: false });

export function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [context, setContext] = useState<PageContext | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [section, setSection] = useState<Section>("page");
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState("");
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "failed">("saved");
  const [showSettings, setShowSettings] = useState(false);
  const [onboarding, setOnboarding] = useState(0);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const selected = notes.find((note) => note.id === selectedId);

  const refresh = async () => {
    try { setNotes(await notesRepository.getAll()); } catch (error) { console.error(error); setSaveStatus("failed"); }
  };
  useEffect(() => {
    void (async () => {
      try {
        const stored = (await db.settings.get("settings")) ?? defaultSettings;
        if (!await db.settings.get("settings")) await db.settings.put(stored);
        setSettings(stored); setSection(stored.defaultOpeningSection);
        const activeContext = await getActivePageContext(stored.removeTrackingParameters);
        setContext(activeContext);
        await refresh();
        const { pendingCapture, pendingCommand } = await chrome.storage.local.get(["pendingCapture", "pendingCommand"]);
        if (pendingCapture) {
          const capture = pendingCapture as PendingCapture;
          const source = `\n\nSource: ${capture.url}\nCaptured: ${new Date(capture.capturedAt).toLocaleString()}`;
          const content = capture.selection ? `> ${capture.selection}${source}` : `Source: ${capture.url}`;
          const note = await notesRepository.create({ ...blank("page"), title: capture.selection ? `Capture: ${capture.title}` : capture.title, content, pageUrl: capture.url, normalizedPageUrl: normalizeUrl(capture.url, stored.removeTrackingParameters), pageTitle: capture.title, domain: extractDomain(capture.url) });
          setSelectedId(note.id); await chrome.storage.local.remove("pendingCapture"); await refresh();
        }
        if (pendingCommand) { setSection(pendingCommand === "open-scratchpad" ? "scratchpad" : "all"); await chrome.storage.local.remove("pendingCommand"); }
      } catch (error) { console.error("Unable to initialise Workpad", error); }
    })();
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "n") { event.preventDefault(); void createNote("standalone"); }
      if (event.key.toLowerCase() === "k") { event.preventDefault(); document.getElementById("workpad-search")?.focus(); }
      if (event.key.toLowerCase() === "s") { event.preventDefault(); if (selected) void persist(selected); }
      if (event.shiftKey && event.key.toLowerCase() === "p") { event.preventDefault(); void createNote("page"); }
    };
    addEventListener("keydown", listener); return () => removeEventListener("keydown", listener);
  });

  const createNote = async (type: NoteType) => {
    if ((type === "page" || type === "domain") && (!context || context.restricted)) return;
    if (type === "scratchpad") {
      const scratchpad = notes.find((note) => note.type === "scratchpad");
      if (scratchpad) { setSelectedId(scratchpad.id); setSection("scratchpad"); return; }
    }
    const note = await notesRepository.create({
      ...blank(type), title: type === "scratchpad" ? "Scratchpad" : "",
      ...(type === "page" ? { pageUrl: context!.url, normalizedPageUrl: context!.normalizedUrl, domain: context!.domain, pageTitle: context!.title } : {}),
      ...(type === "domain" ? { domain: context!.domain, pageTitle: context!.title } : {})
    });
    setSelectedId(note.id); setSection(type === "scratchpad" ? "scratchpad" : type === "page" ? "page" : "all"); await refresh();
  };
  const persist = async (note: Note) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus("saving");
    try { const saved = await notesRepository.update(note.id, note); setNotes((items) => items.map((item) => item.id === note.id ? saved : item)); setSaveStatus("saved"); }
    catch (error) { console.error(error); setSaveStatus("failed"); }
  };
  const edit = (changes: Partial<Note>) => {
    if (!selected) return;
    const next = { ...selected, ...changes };
    setNotes((items) => items.map((item) => item.id === next.id ? next : item));
    setSaveStatus("saving"); if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void persist(next), settings.autoSaveDebounce);
  };
  const deleteNote = async () => {
    if (!selected || !confirm("Delete this note? This cannot be undone.")) return;
    await notesRepository.delete(selected.id); setSelectedId(undefined); await refresh();
  };
  const filtered = useMemo(() => notes.filter((note) => {
    const matchesSection = section === "page" ? (note.type === "page" && note.normalizedPageUrl === context?.normalizedUrl) || (note.type === "domain" && note.domain === context?.domain) : section === "scratchpad" ? note.type === "scratchpad" : section === "favourites" ? note.isFavourite : true;
    const text = [note.title, note.content, note.domain, note.pageTitle, ...note.tags].join(" ").toLowerCase();
    return matchesSection && text.includes(query.toLowerCase());
  }), [notes, section, context, query]);
  const completeOnboarding = async () => { const next = { ...settings, onboardingCompleted: true }; await db.settings.put(next); setSettings(next); };
  const updateSettings = async (changes: Partial<Settings>) => { const next = { ...settings, ...changes }; await db.settings.put(next); setSettings(next); if (changes.removeTrackingParameters !== undefined) setContext(await getActivePageContext(next.removeTrackingParameters)); };

  if (!settings.onboardingCompleted) return <Onboarding step={onboarding} setStep={setOnboarding} done={() => void completeOnboarding()} />;
  return <main className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark"><PanelRight size={16}/></span>Workpad</div><div className="top-actions"><button aria-label="Search" onClick={() => document.getElementById("workpad-search")?.focus()}><Search size={17}/></button><button aria-label="New note" onClick={() => void createNote("standalone")}><Plus size={18}/></button><button aria-label="Settings" onClick={() => setShowSettings(true)}><SettingsIcon size={17}/></button></div></header>
    <ContextBanner context={context} createNote={createNote} copyLink={() => selected && edit({ content: `${selected.content}${selected.content ? "\n\n" : ""}${context?.url}` })}/>
    <nav className="tabs">{(Object.keys(labels) as Section[]).map((key) => <button className={section === key ? "active" : ""} onClick={() => setSection(key)} key={key}>{labels[key]}</button>)}</nav>
    <div className="search-wrap"><Search size={16}/><input id="workpad-search" placeholder="Search notes…" value={query} onChange={(e) => setQuery(e.target.value)}/>{query && <button onClick={() => setQuery("")}><X size={14}/></button>}</div>
    <section className="content">
      <aside className="notes-list"><div className="list-heading"><span>{query ? "Results" : labels[section]}</span><button onClick={() => void createNote(section === "scratchpad" ? "scratchpad" : "standalone")}><FilePlus2 size={16}/></button></div>
        {filtered.length ? filtered.map((note) => <NoteCard key={note.id} note={note} selected={selectedId === note.id} onClick={() => setSelectedId(note.id)}/>) : <EmptyState section={section} restricted={context?.restricted ?? false} createNote={createNote}/>}
      </aside>
      <section className="editor-panel">{selected ? <Editor note={selected} edit={edit} status={saveStatus} remove={deleteNote} duplicate={async () => { const copy = await notesRepository.create({ ...selected, id: undefined, title: `${selected.title || "Untitled"} (copy)` }); setSelectedId(copy.id); await refresh(); }} /> : <div className="editor-empty"><Archive size={24}/><h2>Select a note</h2><p>Choose a note from the list, or create a new one.</p><button onClick={() => void createNote("standalone")}>Create a note</button></div>}</section>
    </section>
    {showSettings && <SettingsModal settings={settings} update={updateSettings} close={() => setShowSettings(false)} notes={notes}/>}
  </main>;
}

export function ContextBanner({ context, createNote, copyLink }: { context: PageContext | null; createNote: (type: NoteType) => Promise<void>; copyLink: () => void }) {
  if (!context) return <div className="context-banner loading">Finding your current page…</div>;
  if (context.restricted) return <div className="context-banner restricted"><strong>This browser page is restricted.</strong><span>Workpad cannot read page details here.</span></div>;
  return <div className="context-banner"><div className="context-title"><span className="domain-mark" aria-hidden="true">{context.domain.slice(0, 1).toUpperCase()}</span><div><strong>{context.title}</strong><span>{context.domain} · {context.url}</span></div></div><div className="context-actions"><button onClick={() => void createNote("page")}>Page note</button><button onClick={() => void createNote("domain")}>Domain note</button><button title="Copy page link to note" onClick={copyLink}><Copy size={14}/></button></div></div>;
}

export function NoteCard({ note, selected, onClick }: { note: Note; selected: boolean; onClick: () => void }) {
  return <button className={`note-card ${selected ? "selected" : ""}`} onClick={onClick}><div className="note-card-title">{note.isFavourite && <Star size={13} fill="currentColor"/>}{note.title || "Untitled note"}</div><p>{note.content || "No content yet"}</p><footer><span className={`type-pill ${note.type}`}>{note.type}</span>{note.domain && <span>{note.domain}</span>}<time>{new Date(note.updatedAt).toLocaleDateString()}</time></footer>{note.tags.length > 0 && <div className="tags">{note.tags.slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}</div>}</button>;
}

export function Editor({ note, edit, status, remove, duplicate }: { note: Note; edit: (changes: Partial<Note>) => void; status: string; remove: () => void; duplicate: () => void }) {
  const [tagValue, setTagValue] = useState("");
  const addTag = () => { const tag = tagValue.trim().replace(/^#/, ""); if (tag && !note.tags.includes(tag)) edit({ tags: [...note.tags, tag] }); setTagValue(""); };
  return <div className="editor"><div className="editor-toolbar"><span className="context-pill">{note.type}{note.domain ? ` · ${note.domain}` : ""}</span><span className={`save-status ${status}`}>{status === "saving" ? "Saving…" : status === "failed" ? "Save failed" : <><Check size={13}/> Saved</>}</span><button title="Favourite" onClick={() => edit({ isFavourite: !note.isFavourite })}><Heart size={17} fill={note.isFavourite ? "currentColor" : "none"}/></button><button title="Duplicate" onClick={duplicate}><Copy size={16}/></button><button title="Export markdown" onClick={() => downloadText(`${note.title || "workpad-note"}.md`, noteMarkdown(note), "text/markdown")}><Download size={16}/></button><button title="Delete" className="danger" onClick={remove}><Trash2 size={16}/></button></div><input className="title-input" placeholder="Untitled note" value={note.title} onChange={(e) => edit({ title: e.target.value })}/><textarea className="content-input" placeholder="Start writing…" value={note.content} onChange={(e) => edit({ content: e.target.value })}/><div className="tag-editor">{note.tags.map((tag) => <button key={tag} onClick={() => edit({ tags: note.tags.filter((item) => item !== tag) })}>#{tag} <X size={12}/></button>)}<input value={tagValue} placeholder="Add tag" onChange={(e) => setTagValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}/></div></div>;
}

export function EmptyState({ section, restricted, createNote }: { section: Section; restricted: boolean; createNote: (type: NoteType) => Promise<void> }) {
  const page = section === "page"; return <div className="empty-state"><FilePlus2 size={22}/><strong>{restricted && page ? "No page context available" : page ? "No notes for this page" : section === "favourites" ? "No favourites yet" : "Nothing here yet"}</strong><p>{restricted && page ? "Open a regular website to create linked notes." : page ? "Keep your thinking beside your work." : "Create a note to get started."}</p>{!restricted && <button onClick={() => void createNote(page ? "page" : section === "scratchpad" ? "scratchpad" : "standalone")}>{page ? "Create a page note" : "Create a note"}</button>}</div>;
}

function Onboarding({ step, setStep, done }: { step: number; setStep: (step: number) => void; done: () => void }) {
  const copy = [["Your notebook beside every browser tab.", "Keep ideas, research and decisions in one calm place."], ["Create notes linked to a page, a domain or your entire browser.", "Workpad remembers the context, so your notes are ready when you return."], ["Select text on any webpage and save it directly to Workpad.", "Use the right-click menu when something is worth keeping."]][step];
  return <main className="onboarding"><span className="brand-mark"><PanelRight size={24}/></span><div><span className="eyebrow">WORKPAD · {step + 1}/3</span><h1>{copy[0]}</h1><p>{copy[1]}</p></div><div className="onboarding-actions">{step > 0 && <button className="secondary" onClick={() => setStep(step - 1)}><ChevronLeft size={16}/>Back</button>}<button className="text-button" onClick={done}>Skip</button><button onClick={step === 2 ? done : () => setStep(step + 1)}>{step === 2 ? "Start using Workpad" : "Next"}</button></div></main>;
}

function SettingsModal({ settings, update, close, notes }: { settings: Settings; update: (value: Partial<Settings>) => Promise<void>; close: () => void; notes: Note[] }) {
  const importRef = useRef<HTMLInputElement>(null);
  const exportAll = () => downloadText("workpad-backup.json", JSON.stringify(createBackup(notes, settings), null, 2), "application/json");
  const importFile = async (file?: File) => { if (!file) return; try { if (file.size > MAX_BACKUP_BYTES) throw new Error("Backups must be 5 MB or smaller."); const value: unknown = JSON.parse(await file.text()); if (!validateBackup(value)) throw new Error("This is not a valid Workpad backup."); if (!confirm(`Merge ${value.notes.length} notes into Workpad? Existing notes will never be overwritten.`)) return; const usedIds = new Set((await db.notes.toCollection().primaryKeys()).map(String)); const imported = value.notes.map((note) => { const id = usedIds.has(note.id) ? crypto.randomUUID() : note.id; usedIds.add(id); return { ...note, id }; }); await db.notes.bulkAdd(imported); location.reload(); } catch (error) { alert(error instanceof Error ? error.message : "Could not import backup."); } };
  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true"><header><h2>Settings</h2><button onClick={close}><X size={18}/></button></header><label>Theme<select value={settings.theme} onChange={(e) => void update({ theme: e.target.value as Settings["theme"] })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label><label>Default opening section<select value={settings.defaultOpeningSection} onChange={(e) => void update({ defaultOpeningSection: e.target.value as Section })}>{Object.entries(labels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><label>Auto-save delay<select value={settings.autoSaveDebounce} onChange={(e) => void update({ autoSaveDebounce: Number(e.target.value) })}><option value={500}>0.5 seconds</option><option value={650}>0.65 seconds</option><option value={800}>0.8 seconds</option></select></label><label className="toggle"><input type="checkbox" checked={settings.removeTrackingParameters} onChange={(e) => void update({ removeTrackingParameters: e.target.checked })}/><span>Remove common tracking parameters</span></label><div className="settings-actions"><button onClick={exportAll}><Download size={16}/>Export all notes</button><button onClick={() => importRef.current?.click()}><Upload size={16}/>Import backup</button><input hidden ref={importRef} type="file" accept="application/json" onChange={(e) => void importFile(e.target.files?.[0])}/><button className="danger-button" onClick={async () => { if (confirm("Reset all local Workpad data? This cannot be undone.")) { await db.delete(); location.reload(); } }}><Trash2 size={16}/>Reset local data</button></div></section></div>;
}
