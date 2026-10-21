import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, Bell, CalendarClock, Check, ChevronLeft, Copy, CreditCard, Download, FilePlus2, Heart, ListTodo, Mail, MessageSquareReply, PanelRight, Plus, RefreshCw, Search, Settings as SettingsIcon, Share2, Sparkles, Star, Trash2, Upload, X } from "lucide-react";
import { db, defaultSettings } from "../db/database";
import { notesRepository } from "../db/repositories/notesRepository";
import { getActivePageContext, subscribeToActivePageChanges } from "../services/chrome";
import type { NewNote, Note, NoteType, PageContext, Settings } from "../types";
import { createBackup, downloadText, MAX_BACKUP_BYTES, noteMarkdown, validateBackup } from "../utils/backup";
import { extractDomain, normalizeContextUrl, normalizeUrl } from "../utils/url";
import { defaultNoteTitle, displayNoteTitle, groupNotesByWebsiteAndDate, isNoteForSiteToday } from "../utils/noteOrganization";
import { shareText, socialComposerUrl, socialDraft, socialDraftFromAI, type SocialPlatform } from "../utils/socialShare";
import { AIWorkspace, type SavedAIResult } from "./AIWorkspace";
import { createCheckout, createCustomerPortal, currentSession, deleteAccount, getEntitlements, isAccountConfigured, signInWithGoogle, signOut, type AccountSession, type Entitlements } from "../services/account";
import { getOpenAIKey, removeOpenAIKey, saveOpenAIKey } from "../services/apiKeyStorage";
import { canUseCloudSync, disableNoteSync, enableNoteSync, getNoteSyncStatus, syncCurrentAccountNotes, syncNotes, type NoteSyncStatus } from "../services/noteSync";
import { isFreeSyncTestingEnabled } from "../services/noteSync";
import { PRO_PRICE } from "../config/pricing";
import { capturedEmailContent, emailProviderForUrl, emailProviderLabel, extractActiveEmail, type EmailProvider } from "../services/emailCapture";
import { PageAccessError, requestPageAccess } from "../services/pageContent";
import { clearNoteReminder, reminderFromTags, scheduleNoteReminder, withReminderTag } from "../services/reminders";

type Section = "page" | "all";
type PendingCapture = { kind: string; selection: string; url: string; title: string; capturedAt: string };
const labels: Record<Section, string> = { page: "This Site Today", all: "All Notes" };
const blank = (type: NoteType = "standalone"): NewNote => ({ title: "", content: "", type, tags: [], isFavourite: false, isArchived: false });
const noteScopeLabel = (type: NoteType) => type === "page" ? "This page" : type === "domain" ? "Domain" : type === "scratchpad" ? "Scratchpad" : "Note";

export function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [context, setContext] = useState<PageContext | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [section, setSection] = useState<Section>("page");
  const [selectedId, setSelectedId] = useState<string>();
  const [query, setQuery] = useState("");
  const [favouritesOnly, setFavouritesOnly] = useState(false);
  const [subscriptionsOnly, setSubscriptionsOnly] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "failed">("saved");
  const [showSettings, setShowSettings] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [visibleAINudgeKey, setVisibleAINudgeKey] = useState<string>();
  const [shareNote, setShareNote] = useState<Note>();
  const [shareInitialDraft, setShareInitialDraft] = useState("");
  const [shareInitialPlatform, setShareInitialPlatform] = useState<SocialPlatform>("x");
  const [aiShareNote, setAIShareNote] = useState<Note>();
  const [aiSocialPlatform, setAISocialPlatform] = useState<SocialPlatform>();
  const [aiStarterPrompt, setAIStarterPrompt] = useState("");
  const [onboarding, setOnboarding] = useState(0);
  const [emailCaptureBusy, setEmailCaptureBusy] = useState(false);
  const [emailCaptureStatus, setEmailCaptureStatus] = useState("");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const contextRequest = useRef(0);
  const contextUrl = useRef<string | undefined>(undefined);
  const sectionRef = useRef(section);
  sectionRef.current = section;
  const selected = notes.find((note) => note.id === selectedId);
  const now = new Date();
  const aiNudgeKey = context && !context.restricted ? `${context.domain}|${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}` : undefined;
  const emailProvider = context ? emailProviderForUrl(context.url) : undefined;

  const refresh = async () => {
    try {
      setNotes(await notesRepository.getAll());
      void syncCurrentAccountNotes().then(async (result) => { if (result) setNotes(await notesRepository.getAll()); }).catch((error: unknown) => console.warn("Cloud note sync is pending", error));
    } catch (error) { console.error(error); setSaveStatus("failed"); }
  };
  useEffect(() => {
    void (async () => {
      try {
        const savedSettings = await db.settings.get("settings");
        const stored = { ...defaultSettings, ...savedSettings };
        await db.settings.put(stored);
        setSettings(stored); setSection(stored.defaultOpeningSection === "page" ? "page" : "all");
        await refresh();
        const { pendingCapture, pendingCommand } = await chrome.storage.local.get(["pendingCapture", "pendingCommand"]);
        if (pendingCapture) {
          const capture = pendingCapture as PendingCapture;
          const source = `\n\nSource: ${capture.url}\nCaptured: ${new Date(capture.capturedAt).toLocaleString()}`;
          const content = capture.selection ? `> ${capture.selection}${source}` : `Source: ${capture.url}`;
          const note = await notesRepository.create({ ...blank("page"), title: capture.selection ? `Capture: ${capture.title}` : capture.title, content, pageUrl: capture.url, normalizedPageUrl: normalizeUrl(capture.url, stored.removeTrackingParameters), pageTitle: capture.title, domain: extractDomain(capture.url) });
          setSelectedId(note.id); await chrome.storage.local.remove("pendingCapture"); await refresh();
        }
        if (pendingCommand) { setSection("all"); await chrome.storage.local.remove("pendingCommand"); }
      } catch (error) { console.error("Unable to initialise Workpad", error); }
    })();
  }, []);
  useEffect(() => {
    let active = true;
    const updateContext = async () => {
      const request = ++contextRequest.current;
      try {
        const next = await getActivePageContext(settings.removeTrackingParameters);
        if (active && request === contextRequest.current) {
          const navigated = contextUrl.current !== undefined && contextUrl.current !== next.normalizedUrl;
          contextUrl.current = next.normalizedUrl;
          if (navigated && sectionRef.current === "page") setSelectedId(undefined);
          setContext(next);
        }
      } catch (error) { console.error("Unable to update the current page", error); }
    };
    void updateContext();
    const unsubscribe = subscribeToActivePageChanges(() => void updateContext());
    return () => { active = false; unsubscribe(); };
  }, [settings.removeTrackingParameters]);
  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);
  useEffect(() => {
    if (!settings.onboardingCompleted || !aiNudgeKey || showAI || showSettings) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void chrome.storage.local.get("aiNudgeSeen").then(({ aiNudgeSeen }) => {
      if (!active || aiNudgeSeen === aiNudgeKey) return;
      timer = setTimeout(() => {
        if (!active) return;
        setVisibleAINudgeKey(aiNudgeKey);
        void chrome.storage.local.set({ aiNudgeSeen: aiNudgeKey });
      }, 8_000);
    });
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [aiNudgeKey, settings.onboardingCompleted, showAI, showSettings]);
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "n") { event.preventDefault(); void createForCurrentView(); }
      if (event.key.toLowerCase() === "k") { event.preventDefault(); document.getElementById("workpad-search")?.focus(); }
      if (event.key.toLowerCase() === "s") { event.preventDefault(); if (selected) void persist(selected); }
      if (event.shiftKey && event.key.toLowerCase() === "p") { event.preventDefault(); void createNote("page"); }
    };
    addEventListener("keydown", listener); return () => removeEventListener("keydown", listener);
  });

  const createNote = async (type: NoteType) => {
    if ((type === "page" || type === "domain") && (!context || context.restricted)) return;
    if (type === "page") {
      const reusable = notes.find((note) => note.type === "page" && note.normalizedPageUrl === context!.normalizedUrl && !note.content.trim() && (!note.title.trim() || note.title === defaultNoteTitle("page", context)));
      if (reusable) { setSelectedId(reusable.id); setSection("page"); return; }
    }
    const note = await notesRepository.create({
      ...blank(type), title: defaultNoteTitle(type, context),
      ...(type === "page" ? { pageUrl: context!.url, normalizedPageUrl: context!.normalizedUrl, domain: context!.domain, pageTitle: context!.title } : {}),
      ...(type === "domain" ? { domain: context!.domain, pageTitle: context!.title } : {})
    });
    setSelectedId(note.id); setSection(type === "page" ? "page" : "all"); await refresh();
  };
  function createForCurrentView() { return createNote(section === "page" && context && !context.restricted ? "page" : "standalone"); }
  const persist = async (note: Note) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus("saving");
    try { const saved = await notesRepository.update(note.id, note); setNotes((items) => items.map((item) => item.id === note.id ? saved : item)); setSaveStatus("saved"); void syncCurrentAccountNotes().catch((error: unknown) => console.warn("Cloud note sync is pending", error)); }
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
    const matchesSection = section === "page" ? isNoteForSiteToday(note, context) : true;
    const text = [note.title, note.content, note.domain, note.pageTitle, ...note.tags].join(" ").toLowerCase();
    return matchesSection && (!favouritesOnly || note.isFavourite) && (!subscriptionsOnly || note.tags.includes("subscription")) && text.includes(query.toLowerCase());
  }), [notes, section, context, favouritesOnly, subscriptionsOnly, query]);
  const completeOnboarding = async () => { const next = { ...settings, onboardingCompleted: true }; await db.settings.put(next); setSettings(next); };
  const updateSettings = async (changes: Partial<Settings>) => { const next = { ...settings, ...changes }; await db.settings.put(next); setSettings(next); if (changes.removeTrackingParameters !== undefined) setContext(await getActivePageContext(next.removeTrackingParameters)); };
  const saveAIResult = async (result: SavedAIResult) => {
    const canLinkToPage = context && !context.restricted;
    const note = await notesRepository.create({
      ...blank(canLinkToPage ? "page" : "standalone"),
      title: result.title,
      content: result.content,
      tags: ["ai", result.action],
      ...(canLinkToPage ? { pageUrl: context.url, normalizedPageUrl: context.normalizedUrl, domain: context.domain, pageTitle: context.title } : {})
    });
    setSelectedId(note.id); setSection(canLinkToPage ? "page" : "all"); await refresh();
  };
  const saveOpenedEmail = async () => {
    if (!context || !emailProvider || emailCaptureBusy) return;
    const existing = notes.find((note) => note.normalizedPageUrl === context.normalizedUrl && note.tags.includes("email"));
    if (existing) { setSelectedId(existing.id); setSection("page"); setEmailCaptureStatus("This email is already saved."); return; }
    setEmailCaptureBusy(true); setEmailCaptureStatus("");
    try {
      let email;
      try { email = await extractActiveEmail(); }
      catch (error) {
        if (!(error instanceof PageAccessError) || !(await requestPageAccess(error.pageUrl))) throw error;
        email = await extractActiveEmail();
      }
      const note = await notesRepository.create({
        ...blank("page"),
        title: email.subject || `${emailProviderLabel(email.provider)} email`,
        content: capturedEmailContent(email),
        tags: ["email", email.provider],
        pageUrl: email.url,
        normalizedPageUrl: normalizeContextUrl(email.url, settings.removeTrackingParameters),
        domain: extractDomain(email.url),
        pageTitle: email.subject || context.title
      });
      setSelectedId(note.id); setSection("page"); setEmailCaptureStatus("Email saved to Workpad."); await refresh();
    } catch (error) {
      setEmailCaptureStatus(error instanceof Error ? error.message : "Could not save this email.");
    } finally { setEmailCaptureBusy(false); }
  };

  const openEmailAI = (kind: "actions" | "reply") => {
    if (!selected) return;
    const instruction = kind === "actions"
      ? "Identify the action items, deadlines, renewal or cancellation dates, prices, and decisions in this saved email. Return a concise checklist."
      : "Draft a clear, concise reply to this saved email. Do not invent facts. Leave placeholders where I need to provide information.";
    setAIStarterPrompt(`${instruction}\n\nSaved email:\n${selected.content.slice(0, 20_000)}`);
    setShowAI(true);
  };

  if (!settings.onboardingCompleted) return <Onboarding step={onboarding} setStep={setOnboarding} done={() => void completeOnboarding()} />;
  return <main className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark"><PanelRight size={16}/></span>Workpad</div><div className="top-actions"><button className="primary-create" aria-label={section === "page" ? "New note for this page" : "New note"} title={section === "page" ? "New note for this page" : "New note"} onClick={() => void createForCurrentView()}><Plus size={18}/></button><button className="ai-entry-button" aria-label="Ask this page" title="Summarize, translate, explain, or ask about this page" onClick={() => setShowAI(true)}><Sparkles size={16}/><span>Ask this page</span></button><button aria-label="Settings" onClick={() => setShowSettings(true)}><SettingsIcon size={17}/></button></div></header>
    <ContextBanner context={context} onCreateNote={() => void createNote("page")} onAskPage={() => setShowAI(true)} emailProvider={emailProvider} onSaveEmail={() => void saveOpenedEmail()} emailBusy={emailCaptureBusy} emailStatus={emailCaptureStatus}/>
    <nav className="tabs">{(Object.keys(labels) as Section[]).map((key) => <button className={section === key ? "active" : ""} onClick={() => { setSection(key); if (key === "page") { setFavouritesOnly(false); if (selected?.type !== "page" || selected.normalizedPageUrl !== context?.normalizedUrl) setSelectedId(undefined); } }} key={key}>{labels[key]}</button>)}</nav>
    <div className="search-tools"><div className="search-wrap"><Search size={16}/><input id="workpad-search" placeholder={section === "page" ? "Search this site today…" : "Search all notes…"} value={query} onChange={(e) => setQuery(e.target.value)}/>{query && <button aria-label="Clear search" onClick={() => setQuery("")}><X size={14}/></button>}</div>{section === "all" && <><button className={`favourites-filter ${subscriptionsOnly ? "active" : ""}`} aria-pressed={subscriptionsOnly} onClick={() => setSubscriptionsOnly((value) => !value)}><CreditCard size={14}/> Subscriptions</button><button className={`favourites-filter ${favouritesOnly ? "active" : ""}`} aria-pressed={favouritesOnly} onClick={() => setFavouritesOnly((value) => !value)}><Star size={14} fill={favouritesOnly ? "currentColor" : "none"}/> Favourites</button></>}</div>
    <section className="content">
      <aside className="notes-list"><div className="list-heading"><span>{query || favouritesOnly ? "Results" : labels[section]}</span>{section === "page" && context && !context.restricted && <small>{context.domain} · {new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" })}</small>}</div>
        {filtered.length ? section === "all"
          ? <GroupedNotes notes={filtered} selectedId={selectedId} select={setSelectedId}/>
          : filtered.map((note) => <NoteCard key={note.id} note={note} selected={selectedId === note.id} onClick={() => setSelectedId(note.id)}/>)
          : <EmptyState section={section} restricted={context?.restricted ?? false} filtered={Boolean(query || favouritesOnly || subscriptionsOnly)} createNote={createNote}/>}
      </aside>
      <section className="editor-panel">{selected ? <Editor note={selected} edit={edit} status={saveStatus} onAskPage={() => setShowAI(true)} onExtractActions={selected.tags.includes("email") ? () => openEmailAI("actions") : undefined} onDraftReply={selected.tags.includes("email") ? () => openEmailAI("reply") : undefined} onShare={() => { setShareInitialDraft(""); setShareInitialPlatform("x"); setShareNote(selected); }} remove={deleteNote} duplicate={async () => { const copy = await notesRepository.create({ ...selected, id: undefined, title: `${selected.title || "Untitled"} (copy)` }); setSelectedId(copy.id); await refresh(); }} /> : <div className="editor-empty"><Archive size={24}/><h2>Select a note</h2><p>Choose a note from the list, or use + to create one.</p><button className="editor-empty-ai" onClick={() => setShowAI(true)}><Sparkles size={14}/> Ask this page</button></div>}</section>
    </section>
    {showSettings && <SettingsModal settings={settings} update={updateSettings} close={() => setShowSettings(false)} notes={notes}/>}
    {showAI && <AIWorkspace settings={settings} initialPrompt={aiStarterPrompt} socialPlatform={aiSocialPlatform} onUseForSocial={aiShareNote && aiSocialPlatform ? (result, platform) => { setShareInitialDraft(socialDraftFromAI(result)); setShareInitialPlatform(platform); setShareNote(aiShareNote); setShowAI(false); setAIStarterPrompt(""); setAIShareNote(undefined); setAISocialPlatform(undefined); } : undefined} onClose={() => { setShowAI(false); setAIStarterPrompt(""); setAIShareNote(undefined); setAISocialPlatform(undefined); setVisibleAINudgeKey(undefined); }} onSave={saveAIResult}/>}
    {visibleAINudgeKey === aiNudgeKey && !showAI && !showSettings && <AINudge onTry={() => { setVisibleAINudgeKey(undefined); setShowAI(true); }} onDismiss={() => setVisibleAINudgeKey(undefined)}/>}
    {shareNote && <SocialShareModal note={shareNote} initialDraft={shareInitialDraft} initialPlatform={shareInitialPlatform} close={() => setShareNote(undefined)} onWriteWithAI={(platform) => {
      const tone = platform === "x" ? "a concise, engaging X post within 280 characters" : platform === "reddit" ? "an authentic, discussion-oriented Reddit post with a clear title and no clickbait" : "a thoughtful LinkedIn post with a strong opening, professional insight, and a closing question";
      setAIStarterPrompt(`Write ${tone} based on this page and my note. Preserve factual accuracy and cite the supplied evidence passages. My note title is: ${displayNoteTitle(shareNote)}. My note says: ${shareNote.content || "Use the page as the source."}`);
      setAIShareNote(shareNote); setAISocialPlatform(platform); setShareNote(undefined); setShowAI(true);
    }}/>}
  </main>;
}

export function ContextBanner({ context, onCreateNote, onAskPage, emailProvider, onSaveEmail, emailBusy = false, emailStatus = "" }: { context: PageContext | null; onCreateNote?: () => void; onAskPage?: () => void; emailProvider?: EmailProvider; onSaveEmail?: () => void; emailBusy?: boolean; emailStatus?: string }) {
  if (!context) return <div className="context-banner loading">Finding your current page…</div>;
  if (context.restricted) return <div className="context-banner restricted"><strong>This browser page is restricted.</strong><span>Workpad cannot read page details here.</span></div>;
  return <div className={`context-banner ${emailProvider ? "email-context" : ""}`}><div className="context-title"><span className="domain-mark" aria-hidden="true">{emailProvider ? <Mail size={11}/> : context.domain.slice(0, 1).toUpperCase()}</span><div><small>{emailProvider ? `${emailProviderLabel(emailProvider)} message` : "Current page"}</small><strong>{context.title}</strong><span>{context.domain} · {context.url}</span></div></div><div className="context-actions"><span>{emailProvider ? "Save this email, then turn it into action." : "What would you like to do?"}</span><div>{emailProvider && onSaveEmail && <button className="save-email" disabled={emailBusy} onClick={onSaveEmail}><Mail size={13}/> {emailBusy ? "Saving…" : "Save email"}</button>}{onCreateNote && <button onClick={onCreateNote}><FilePlus2 size={13}/> Add note</button>}{onAskPage && <button className="ask" onClick={onAskPage}><Sparkles size={13}/> Ask this page</button>}</div></div>{emailStatus && <small className="email-capture-status" role="status">{emailStatus}</small>}</div>;
}

export function NoteCard({ note, selected, onClick }: { note: Note; selected: boolean; onClick: () => void }) {
  return <button className={`note-card ${selected ? "selected" : ""}`} onClick={onClick}><div className="note-card-title">{note.isFavourite && <Star size={13} fill="currentColor"/>}{displayNoteTitle(note)}</div><p>{note.content || "No content yet"}</p><footer><span className={`type-pill ${note.type}`}>{noteScopeLabel(note.type)}</span>{note.domain && <span>{note.domain}</span>}<time>{new Date(note.updatedAt).toLocaleDateString()}</time></footer>{note.tags.length > 0 && <div className="tags">{note.tags.slice(0, 3).map((tag) => <span key={tag}>#{tag}</span>)}</div>}</button>;
}

export function GroupedNotes({ notes, selectedId, select }: { notes: Note[]; selectedId?: string; select: (id: string) => void }) {
  return <div className="note-groups">{groupNotesByWebsiteAndDate(notes).map((website) => <section className="website-group" key={website.website}><h3>{website.website}</h3>{website.dates.map((date) => <div className="date-group" key={date.key}><h4>{date.label}</h4>{date.notes.map((note) => <NoteCard key={note.id} note={note} selected={selectedId === note.id} onClick={() => select(note.id)}/>)}</div>)}</section>)}</div>;
}

export function AINudge({ onTry, onDismiss }: { onTry: () => void; onDismiss: () => void }) {
  return <aside className="ai-nudge" role="status" aria-label="Workpad AI suggestion"><button className="ai-nudge-close" aria-label="Dismiss AI suggestion" onClick={onDismiss}><X size={13}/></button><span className="ai-nudge-icon"><Sparkles size={16}/></span><div><strong>Want a faster way through this page?</strong><p>Summarise it, explain it, or pull out action points with Workpad AI.</p><button className="ai-nudge-action" onClick={onTry}><Sparkles size={13}/> Try AI on this page</button></div></aside>;
}

export function Editor({ note, edit, status, onAskPage, onExtractActions, onDraftReply, onShare, remove, duplicate }: { note: Note; edit: (changes: Partial<Note>) => void; status: string; onAskPage?: () => void; onExtractActions?: () => void; onDraftReply?: () => void; onShare?: () => void; remove: () => void; duplicate: () => void }) {
  const [tagValue, setTagValue] = useState("");
  const addTag = () => { const tag = tagValue.trim().replace(/^#/, ""); if (tag && !note.tags.includes(tag)) edit({ tags: [...note.tags, tag] }); setTagValue(""); };
  return <div className="editor"><div className="editor-toolbar"><span className="context-pill">{note.tags.includes("email") ? "Email" : noteScopeLabel(note.type)}{note.domain ? ` · ${note.domain}` : ""}</span><span className={`save-status ${status}`}>{status === "saving" ? "Saving…" : status === "failed" ? "Save failed" : <><Check size={13}/> Saved</>}</span><button title="Favourite" onClick={() => edit({ isFavourite: !note.isFavourite })}><Heart size={17} fill={note.isFavourite ? "currentColor" : "none"}/></button><button title="Duplicate" onClick={duplicate}><Copy size={16}/></button>{onShare && <button title="Create social post" aria-label="Create social post" onClick={onShare}><Share2 size={16}/></button>}<button title="Export markdown" onClick={() => downloadText(`${note.title || "workpad-note"}.md`, noteMarkdown(note), "text/markdown")}><Download size={16}/></button><button title="Delete" className="danger" onClick={remove}><Trash2 size={16}/></button></div><input className="title-input" placeholder={displayNoteTitle(note)} value={note.title} onChange={(e) => edit({ title: e.target.value })}/>{note.tags.includes("email") && <EmailNoteActions note={note} edit={edit} onExtractActions={onExtractActions} onDraftReply={onDraftReply}/>} {!note.content && onAskPage && <div className="note-start"><div><strong>Write your own note, or work with this page</strong><span>Summarize, translate, explain, extract actions, or ask anything.</span></div><button onClick={onAskPage}><Sparkles size={14}/> Ask this page</button></div>}<textarea className="content-input" aria-label="Note content" placeholder="Start writing…" value={note.content} onChange={(e) => edit({ content: e.target.value })}/><div className="tag-editor">{note.tags.filter((tag) => !tag.startsWith("reminder:")).map((tag) => <button key={tag} onClick={() => edit({ tags: note.tags.filter((item) => item !== tag) })}>#{tag} <X size={12}/></button>)}<input value={tagValue} placeholder="Add tag" onChange={(e) => setTagValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}/></div></div>;
}

function defaultReminderInput(): string {
  const date = new Date(Date.now() + 5 * 24 * 60 * 60 * 1_000);
  date.setSeconds(0, 0);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function EmailNoteActions({ note, edit, onExtractActions, onDraftReply }: { note: Note; edit: (changes: Partial<Note>) => void; onExtractActions?: () => void; onDraftReply?: () => void }) {
  const [mode, setMode] = useState<"reminder" | "subscription">();
  const [reminderAt, setReminderAt] = useState(defaultReminderInput);
  const [minimumReminder] = useState(() => new Date().toISOString().slice(0, 16));
  const [provider, setProvider] = useState(note.title.replace(/\s+[-–—].*$/, "").slice(0, 80));
  const [price, setPrice] = useState("");
  const [cycle, setCycle] = useState("Monthly");
  const [renewalDate, setRenewalDate] = useState("");
  const savedReminder = reminderFromTags(note.tags);
  const setReminder = async () => {
    const iso = new Date(reminderAt).toISOString();
    const tags = withReminderTag(note.tags, iso);
    edit({ tags });
    await scheduleNoteReminder({ ...note, tags }, iso);
    setMode(undefined);
  };
  const removeReminder = async () => {
    edit({ tags: withReminderTag(note.tags) });
    await clearNoteReminder(note.id);
  };
  const addSubscription = () => {
    const details = ["## Subscription", `Provider: ${provider || note.title}`, price && `Price: ${price}`, `Billing cycle: ${cycle}`, renewalDate && `Renewal date: ${renewalDate}`].filter(Boolean).join("\n");
    edit({ content: `${note.content.trim()}\n\n${details}`.trim(), tags: [...new Set([...note.tags, "subscription"])] });
    setMode(undefined);
  };
  const reminderValid = Boolean(reminderAt && reminderAt > minimumReminder);
  return <section className="email-actions" aria-label="Email actions"><div className="email-action-grid">{onExtractActions && <button onClick={onExtractActions}><ListTodo size={14}/><span><strong>Extract actions</strong><small>Find dates and next steps</small></span></button>}{onDraftReply && <button onClick={onDraftReply}><MessageSquareReply size={14}/><span><strong>Draft reply</strong><small>Write with AI</small></span></button>}<button onClick={() => setMode(mode === "reminder" ? undefined : "reminder")}><Bell size={14}/><span><strong>{savedReminder ? "Change reminder" : "Remind me"}</strong><small>{savedReminder ? new Date(savedReminder).toLocaleString() : "Defaults to five days"}</small></span></button><button onClick={() => setMode(mode === "subscription" ? undefined : "subscription")}><CreditCard size={14}/><span><strong>{note.tags.includes("subscription") ? "Subscription saved" : "Add subscription"}</strong><small>Track renewal details</small></span></button></div>{mode === "reminder" && <div className="email-action-form"><label>Reminder date and time<input type="datetime-local" value={reminderAt} min={minimumReminder} onChange={(event) => setReminderAt(event.target.value)}/></label><div><button className="primary" disabled={!reminderValid} onClick={() => void setReminder()}><CalendarClock size={13}/> Save reminder</button>{savedReminder && <button onClick={() => void removeReminder()}>Remove</button>}</div></div>}{mode === "subscription" && <div className="email-action-form subscription-form"><label>Provider<input value={provider} onChange={(event) => setProvider(event.target.value)}/></label><label>Price<input placeholder="e.g. £12.99" value={price} onChange={(event) => setPrice(event.target.value)}/></label><label>Billing cycle<select value={cycle} onChange={(event) => setCycle(event.target.value)}><option>Monthly</option><option>Yearly</option><option>Quarterly</option><option>One-off</option></select></label><label>Renewal date<input type="date" value={renewalDate} onChange={(event) => setRenewalDate(event.target.value)}/></label><button className="primary" onClick={addSubscription}><CreditCard size={13}/> Add to subscriptions</button></div>}</section>;
}

export function SocialShareModal({ note, close, onWriteWithAI, initialPlatform = "x", initialDraft = "" }: { note: Note; close: () => void; onWriteWithAI?: (platform: SocialPlatform) => void; initialPlatform?: SocialPlatform; initialDraft?: string }) {
  const [platform, setPlatform] = useState<SocialPlatform>(initialPlatform);
  const [draft, setDraft] = useState(() => initialDraft || socialDraft(note, initialPlatform));
  const [includeSource, setIncludeSource] = useState(Boolean(note.pageUrl));
  const [status, setStatus] = useState("");
  const choose = (next: SocialPlatform) => { setPlatform(next); setDraft(socialDraft(note, next)); setStatus(""); };
  const copyDraft = async () => { await navigator.clipboard.writeText(shareText(note, draft, includeSource)); setStatus("Draft copied."); };
  const openComposer = async () => {
    await copyDraft();
    await chrome.tabs.create({ url: socialComposerUrl(platform, note, draft, includeSource) });
    setStatus(platform === "x" ? "Opened X with your draft." : `Opened ${platform === "reddit" ? "Reddit" : "LinkedIn"}. Your draft is copied and ready to paste.`);
  };
  return <div className="modal-backdrop social-backdrop" role="presentation"><section className="modal social-modal" role="dialog" aria-modal="true" aria-label="Create social post"><header><div><small>SHARE NOTE</small><h2>Create a social post</h2></div><button aria-label="Close social composer" onClick={close}><X size={18}/></button></header><p className="social-intro">Turn this note into a draft. Review it before opening the platform—nothing is posted automatically.</p>{onWriteWithAI && <div className="social-ai-offer"><span><Sparkles size={16}/></span><div><strong>Want AI to write it with you?</strong><p>Workpad AI can create a stronger {platform === "x" ? "X" : platform === "reddit" ? "Reddit" : "LinkedIn"} draft from this page and your note.</p></div><button onClick={() => onWriteWithAI(platform)}><Sparkles size={13}/> Write with AI</button></div>}<div className="social-platforms">{(["x", "reddit", "linkedin"] as SocialPlatform[]).map((item) => <button key={item} className={platform === item ? "active" : ""} onClick={() => choose(item)}>{item === "x" ? "X" : item === "reddit" ? "Reddit" : "LinkedIn"}</button>)}</div><label className="social-draft">Draft<textarea aria-label="Social post draft" value={draft} onChange={(event) => setDraft(event.target.value)} rows={8}/></label>{note.pageUrl && <label className="social-source"><input type="checkbox" checked={includeSource} onChange={(event) => setIncludeSource(event.target.checked)}/><span>Include the source article</span></label>}<div className="social-actions"><button className="secondary" onClick={() => void copyDraft()}><Copy size={14}/> Copy draft</button><button className="primary" onClick={() => void openComposer()}><Share2 size={14}/> Open {platform === "x" ? "X" : platform === "reddit" ? "Reddit" : "LinkedIn"}</button></div>{status && <small className="social-status" role="status">{status}</small>}</section></div>;
}

export function EmptyState({ section, restricted, filtered = false, createNote }: { section: Section; restricted: boolean; filtered?: boolean; createNote: (type: NoteType) => Promise<void> }) {
  const page = section === "page"; return <div className="empty-state"><FilePlus2 size={22}/><strong>{filtered ? "No matching notes" : restricted && page ? "No page context available" : page ? "No notes for this site today" : "Nothing here yet"}</strong><p>{filtered ? "Try changing your search or filters." : restricted && page ? "Open a regular website to create linked notes." : page ? "Notes from this website will stay together for the day." : "Create a note to get started."}</p>{!filtered && !restricted && <button onClick={() => void createNote(page ? "page" : "standalone")}>{page ? "Add a note for this page" : "Create a note"}</button>}</div>;
}

function Onboarding({ step, setStep, done }: { step: number; setStep: (step: number) => void; done: () => void }) {
  const copy = [["Your notebook beside every browser tab.", "Keep ideas, research and decisions in one calm place."], ["Create notes for the page you're viewing.", "Workpad remembers the context, so your notes are ready when you return."], ["Select text on any webpage and save it directly to Workpad.", "Use the right-click menu when something is worth keeping."]][step];
  return <main className="onboarding"><span className="brand-mark"><PanelRight size={24}/></span><div><span className="eyebrow">WORKPAD · {step + 1}/3</span><h1>{copy[0]}</h1><p>{copy[1]}</p></div><div className="onboarding-actions">{step > 0 && <button className="secondary" onClick={() => setStep(step - 1)}><ChevronLeft size={16}/>Back</button>}<button className="text-button" onClick={done}>Skip</button><button onClick={step === 2 ? done : () => setStep(step + 1)}>{step === 2 ? "Start using Workpad" : "Next"}</button></div></main>;
}

function SettingsModal({ settings, update, close, notes }: { settings: Settings; update: (value: Partial<Settings>) => Promise<void>; close: () => void; notes: Note[] }) {
  const importRef = useRef<HTMLInputElement>(null);
  const exportAll = () => downloadText("workpad-backup.json", JSON.stringify(createBackup(notes, settings), null, 2), "application/json");
  const importFile = async (file?: File) => { if (!file) return; try { if (file.size > MAX_BACKUP_BYTES) throw new Error("Backups must be 5 MB or smaller."); const value: unknown = JSON.parse(await file.text()); if (!validateBackup(value)) throw new Error("This is not a valid Workpad backup."); if (!confirm(`Merge ${value.notes.length} notes into Workpad? Existing notes will never be overwritten.`)) return; const usedIds = new Set((await db.notes.toCollection().primaryKeys()).map(String)); const imported = value.notes.map((note) => { const id = usedIds.has(note.id) ? crypto.randomUUID() : note.id; usedIds.add(id); return { ...note, id }; }); await db.notes.bulkAdd(imported); location.reload(); } catch (error) { alert(error instanceof Error ? error.message : "Could not import backup."); } };
  return <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true"><header><h2>Settings</h2><button onClick={close}><X size={18}/></button></header><div className="modal-scroll"><AccountSettings/><label>Theme<select value={settings.theme} onChange={(e) => void update({ theme: e.target.value as Settings["theme"] })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label><label>Open Workpad to<select value={settings.defaultOpeningSection === "page" ? "page" : "all"} onChange={(e) => void update({ defaultOpeningSection: e.target.value as Settings["defaultOpeningSection"] })}>{Object.entries(labels).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label><label>Auto-save delay<select value={settings.autoSaveDebounce} onChange={(e) => void update({ autoSaveDebounce: Number(e.target.value) })}><option value={500}>0.5 seconds</option><option value={650}>0.65 seconds</option><option value={800}>0.8 seconds</option></select></label><label className="toggle"><input type="checkbox" checked={settings.removeTrackingParameters} onChange={(e) => void update({ removeTrackingParameters: e.target.checked })}/><span>Remove common tracking parameters</span></label><div className="settings-divider"><span>AI</span></div><label>OpenAI model<select value={settings.aiModel} onChange={(e) => void update({ aiModel: e.target.value as Settings["aiModel"] })}><option value="gpt-5.6-luna">GPT-5.6 Luna · efficient</option><option value="gpt-5.6-terra">GPT-5.6 Terra · balanced</option><option value="gpt-5.6-sol">GPT-5.6 Sol · highest quality</option></select></label><label>Maximum page text<select value={settings.aiMaxSourceCharacters} onChange={(e) => void update({ aiMaxSourceCharacters: Number(e.target.value) })}><option value={20000}>20,000 characters</option><option value={40000}>40,000 characters</option><option value={80000}>80,000 characters</option></select></label><APIKeySettings/><div className="settings-actions"><button onClick={exportAll}><Download size={16}/>Export all notes</button><button onClick={() => importRef.current?.click()}><Upload size={16}/>Import backup</button><input hidden ref={importRef} type="file" accept="application/json" onChange={(e) => void importFile(e.target.files?.[0])}/><button className="danger-button" onClick={async () => { if (confirm("Reset all local Workpad data? This cannot be undone.")) { await removeOpenAIKey(); await chrome.storage.local.remove("aiSafetyIdentifier"); await db.delete(); location.reload(); } }}><Trash2 size={16}/>Reset local data</button></div></div></section></div>;
}

function AccountSettings() {
  const [session, setSession] = useState<AccountSession>();
  const [entitlements, setEntitlements] = useState<Entitlements>();
  const [syncStatus, setSyncStatus] = useState<NoteSyncStatus>();
  const [busy, setBusy] = useState(true);
  const [billingBusy, setBillingBusy] = useState(false);
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [error, setError] = useState("");
  const billingPoll = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const load = async (nextSession?: AccountSession) => {
    setBusy(true); setError("");
    try {
      const active = nextSession ?? await currentSession();
      setSession(active);
      setEntitlements(active ? await getEntitlements(active) : undefined);
      setSyncStatus(await getNoteSyncStatus(active));
    }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Unable to load account."); }
    finally { setBusy(false); }
  };
  useEffect(() => { void currentSession().then((active) => load(active)); }, []);
  useEffect(() => () => { if (billingPoll.current) clearInterval(billingPoll.current); }, []);
  if (!isAccountConfigured()) return <div className="account-setting disabled"><div><strong>Workpad account</strong><span>Local mode</span></div><p>Account and billing services are not configured in this build.</p></div>;
  const refreshPlan = async () => {
    if (!session) return;
    const next = await getEntitlements(session);
    setEntitlements(next);
    if (next.plan === "pro") {
      setCheckoutPending(false);
      setError("");
      if (billingPoll.current) clearInterval(billingPoll.current);
    }
  };
  const watchForPro = () => {
    if (billingPoll.current) clearInterval(billingPoll.current);
    let attempts = 0;
    billingPoll.current = setInterval(() => {
      attempts += 1;
      void refreshPlan().catch(() => undefined);
      if (attempts >= 40 && billingPoll.current) clearInterval(billingPoll.current);
    }, 3_000);
  };
  const openBilling = async (kind: "checkout" | "portal") => { if (!session) return; setBillingBusy(true); setError(""); try { const url = kind === "checkout" ? await createCheckout(session) : await createCustomerPortal(session); await chrome.tabs.create({ url }); if (kind === "checkout") { setCheckoutPending(true); watchForPro(); } } catch (billingError) { setError(billingError instanceof Error ? billingError.message : "Unable to open billing."); } finally { setBillingBusy(false); } };
  const runSyncAction = async (action: "enable" | "disable" | "sync") => {
    if (!session) return;
    const firstSyncNotice = "Enable Workpad Cloud sync? Your saved note titles, content, tags, page sources and timestamps will be uploaded to your private Workpad account hosted on Supabase and merged with any notes already there. Cloud notes are protected per account, but are not end-to-end encrypted.";
    const switchedAccountNotice = "This device was previously linked to another Workpad account. Enabling sync will upload the notes currently stored on this device to this private Workpad Cloud account, hosted on Supabase. Cloud notes are not end-to-end encrypted. Continue?";
    if (action === "enable" && !confirm(syncStatus?.enabled && !syncStatus.accountMatches ? switchedAccountNotice : firstSyncNotice)) return;
    if (action === "disable" && !confirm("Stop syncing notes on this device? Local and cloud copies will remain available.")) return;
    setSyncBusy(true); setError("");
    try {
      if (action === "enable") await enableNoteSync(session);
      else if (action === "disable") await disableNoteSync();
      else await syncNotes(session);
      setSyncStatus(await getNoteSyncStatus(session));
      if (action !== "disable") location.reload();
    } catch (syncError) { setError(syncError instanceof Error ? syncError.message : "Unable to sync notes."); }
    finally { setSyncBusy(false); }
  };
  const removeAccount = async () => {
    if (!session || !confirm("Permanently delete your Workpad account? This cancels any Pro subscription and deletes cloud notes and account data. Notes stored locally on this device will remain. This cannot be undone.")) return;
    setBusy(true); setError("");
    try { await deleteAccount(session); await disableNoteSync(); setSession(undefined); setEntitlements(undefined); setSyncStatus(await getNoteSyncStatus()); }
    catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "Unable to delete your account."); }
    finally { setBusy(false); }
  };
  const syncAvailable = canUseCloudSync(entitlements);
  const developmentAccess = entitlements?.plan !== "pro" && isFreeSyncTestingEnabled();
  const syncLabel = syncStatus?.enabled && syncStatus.accountMatches ? syncStatus.pending ? `${syncStatus.pending} pending` : "On" : entitlements?.plan === "pro" ? "Off" : "Pro feature";
  return <div className="account-setting">
    <div><strong>Workpad account</strong><span>{entitlements?.plan === "pro" ? "Pro" : session ? "Free" : "Signed out"}</span></div>
    {busy ? <p>Checking your account…</p> : session ? <>
      <p>{session.email || "Signed in"}</p>
      {entitlements?.plan === "pro" ? <div className="account-actions"><button disabled={billingBusy} onClick={() => void openBilling("portal")}>{billingBusy ? "Opening billing…" : "Manage billing"}</button><button className="secondary" onClick={() => void signOut().then(() => load())}>Sign out</button></div> : <div className="pro-offer">
        <strong>Keep every note available when you need it</strong>
        <ul><li><Check size={12}/>Sync notes across your Chrome installations</li><li><Check size={12}/>Keep a private cloud copy if a device is lost or replaced</li><li><Check size={12}/>Queue edits offline and reconcile them when you reconnect</li><li><Check size={12}/>Preserve a conflict copy when two devices edit the same note</li></ul>
        <button disabled={billingBusy} onClick={() => void openBilling("checkout")}>{billingBusy ? "Opening secure checkout…" : `Upgrade to Pro · ${PRO_PRICE.label}`}</button>
        <small>£1.99 billed monthly. Cancel anytime. AI continues to use your own OpenAI key.</small>
        {checkoutPending && <div className="checkout-pending"><span>Payment completed? Your plan will refresh automatically.</span><button disabled={billingBusy} onClick={() => void refreshPlan().catch((refreshError: unknown) => setError(refreshError instanceof Error ? refreshError.message : "Unable to refresh your plan."))}>Refresh plan</button></div>}
        <button className="sign-out-link" onClick={() => void signOut().then(() => load())}>Sign out</button>
      </div>}
      <div className="cloud-sync-setting">
        <div><strong>Workpad Cloud sync</strong><span>{syncLabel}</span></div>
        <p>{syncAvailable ? "Your notes stay current across signed-in Chrome installations, with offline changes automatically caught up later." : "Cloud sync and backup are included with Workpad Pro."}</p>
        <small>Sync is optional. Note content is encrypted in transit and protected per account, but is not end-to-end encrypted. Google is used only to sign in; notes are not stored in Google Drive.</small>
        {developmentAccess && <small className="development-access">Development preview: paid access is bypassed in this build.</small>}
        {syncAvailable && <div className="account-actions">{syncStatus?.enabled && syncStatus.accountMatches ? <><button disabled={syncBusy} onClick={() => void runSyncAction("sync")}><RefreshCw size={13}/>{syncBusy ? "Syncing…" : "Sync now"}</button><button className="secondary" disabled={syncBusy} onClick={() => void runSyncAction("disable")}>Turn off</button></> : <button disabled={syncBusy} onClick={() => void runSyncAction("enable")}>{syncBusy ? "Enabling…" : "Enable sync"}</button>}</div>}
        {syncStatus?.lastSyncedAt && syncStatus.accountMatches && <small>Last synced {new Date(syncStatus.lastSyncedAt).toLocaleString()}</small>}
      </div>
      <button className="delete-account-link" disabled={busy} onClick={() => void removeAccount()}>Delete account</button>
    </> : <><p>Sign in to use your plan. Workpad Pro includes optional cloud note sync for {PRO_PRICE.label}.</p><button onClick={() => void signInWithGoogle().then((active) => load(active)).catch((signInError: unknown) => { setBusy(false); setError(signInError instanceof Error ? signInError.message : "Sign-in failed."); })}>Sign in with Google</button></>}
    {error && <small className="account-error" role="alert">{error}</small>}
  </div>;
}

function APIKeySettings() {
  const [configured, setConfigured] = useState(false);
  const [persistent, setPersistent] = useState(false);
  const [value, setValue] = useState("");
  useEffect(() => { void getOpenAIKey().then(({ key, persistent: savedPersistently }) => { setConfigured(Boolean(key)); setPersistent(savedPersistently); }); }, []);
  const save = async () => { if (!value.trim()) return; await saveOpenAIKey(value, persistent); setConfigured(true); setValue(""); };
  const remove = async () => { await removeOpenAIKey(); setConfigured(false); setPersistent(false); setValue(""); };
  return <div className="api-key-setting"><div><strong>OpenAI API key</strong><span>{configured ? persistent ? "Saved on this device" : "Saved for this session" : "Required for BYOK AI"}</span></div><div><input type="password" autoComplete="off" placeholder={configured ? "Replace existing key" : "sk-…"} value={value} onChange={(event) => setValue(event.target.value)}/><button disabled={!value.trim()} onClick={() => void save()}>{configured ? "Replace" : "Save"}</button>{configured && <button className="key-remove" onClick={() => void remove()}>Remove</button>}</div><label className="key-persistence"><input type="checkbox" checked={persistent} onChange={(event) => setPersistent(event.target.checked)}/><span>Remember key after Chrome closes</span></label><small>Session storage is safer. Persistent keys remain excluded from backups.</small></div>;
}
