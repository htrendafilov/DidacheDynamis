import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./i18n";
import "./styles/app.css";

// If a lazy chunk (e.g. the notes editor) fails to load because a deploy replaced the hashed
// assets while this tab was open, reload to pick up the new build. Throttled to at most once
// per 10s so a persistent failure can't cause a reload loop, while a later deploy can still
// trigger a fresh reload.
window.addEventListener("vite:preloadError", () => {
  const KEY = "bible-chunk-reload-at";
  const last = Number(sessionStorage.getItem(KEY) ?? "0");
  if (Date.now() - last < 10_000) return;
  sessionStorage.setItem(KEY, String(Date.now()));
  window.location.reload();
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
