import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Info } from "lucide-react";
import { DialogContext, type DialogOptions, type Dialogs } from "./dialogContext";

interface OpenDialog extends DialogOptions {
  kind: "confirm" | "notify";
  resolve: (confirmed: boolean) => void;
}

/** Renders Workpad's own confirmation and notice dialogs inside the side panel instead of Chrome's native ones. */
export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<OpenDialog[]>([]);
  const current = queue[0];
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const open = useCallback((dialog: Omit<OpenDialog, "resolve">) => new Promise<boolean>((resolve) => setQueue((items) => [...items, { ...dialog, resolve }])), []);
  const dialogs = useMemo<Dialogs>(() => ({
    confirm: (options) => open({ ...options, kind: "confirm" }),
    notify: async (options) => { await open({ ...options, kind: "notify" }); }
  }), [open]);

  const close = useCallback((confirmed: boolean) => {
    setQueue(([first, ...rest]) => { first?.resolve(confirmed); return rest; });
  }, []);

  useEffect(() => {
    if (!current) return;
    (current.tone === "danger" && current.kind === "confirm" ? cancelRef : confirmRef).current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); close(false); } };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [current, close]);

  const danger = current?.tone === "danger";
  return <DialogContext.Provider value={dialogs}>
    {children}
    {current && <div className="modal-backdrop confirm-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) close(false); }}>
      <section className={`modal confirm-modal${danger ? " danger" : ""}`} role="alertdialog" aria-modal="true" aria-labelledby="workpad-dialog-title" aria-describedby="workpad-dialog-message">
        <div className="confirm-icon" aria-hidden="true">{danger ? <AlertTriangle size={18}/> : <Info size={18}/>}</div>
        <h2 id="workpad-dialog-title">{current.title}</h2>
        <p id="workpad-dialog-message">{current.message}</p>
        <footer>
          {current.kind === "confirm" && <button ref={cancelRef} className="secondary" onClick={() => close(false)}>{current.cancelLabel ?? "Cancel"}</button>}
          <button ref={confirmRef} className={danger ? "confirm-danger" : "confirm-primary"} onClick={() => close(true)}>{current.confirmLabel ?? (current.kind === "confirm" ? "Confirm" : "OK")}</button>
        </footer>
      </section>
    </div>}
  </DialogContext.Provider>;
}
