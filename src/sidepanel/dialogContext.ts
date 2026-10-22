import { createContext, useContext } from "react";

export interface DialogOptions {
  title: string;
  message: string;
  /** Label of the main button. Defaults to "OK" for notices and "Confirm" for confirmations. */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive actions get a red button and start with Cancel focused. */
  tone?: "default" | "danger";
}

export interface Dialogs {
  /** Resolves true when the user confirms, false when they cancel or press Escape. */
  confirm: (options: DialogOptions) => Promise<boolean>;
  /** Shows a message with a single button. */
  notify: (options: Omit<DialogOptions, "cancelLabel" | "tone">) => Promise<void>;
}

/** Outside DialogProvider (only isolated component tests) fall back to the browser's own dialogs. */
export const DialogContext = createContext<Dialogs>({
  confirm: async ({ title, message }) => window.confirm(`${title}\n\n${message}`),
  notify: async ({ title, message }) => window.alert(`${title}\n\n${message}`)
});

export const useDialogs = () => useContext(DialogContext);
