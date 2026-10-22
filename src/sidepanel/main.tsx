import React from "react";
import ReactDOM from "react-dom/client";
import "../styles/index.css";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { App } from "./App";
import { DialogProvider } from "./DialogProvider";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary><DialogProvider><App /></DialogProvider></ErrorBoundary>
  </React.StrictMode>
);
