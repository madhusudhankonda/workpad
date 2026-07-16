import { Component, type ErrorInfo, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Workpad UI failed", error, info);
  }
  render() {
    return this.state.failed ? (
      <main className="error-state">
        <h1>Workpad needs a refresh</h1>
        <p>Your notes are safe in local storage. Reload the extension side panel to continue.</p>
        <button onClick={() => location.reload()}>Reload Workpad</button>
      </main>
    ) : this.props.children;
  }
}
