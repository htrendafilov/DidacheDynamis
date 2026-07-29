// Pure constants, no React/JSX. App.tsx needs the default width synchronously (before the
// chat/ tree is ever lazy-loaded), so these live outside ChatDrawer.tsx — importing a
// component module just to read a number would pull its whole dependency tree into
// whatever chunk does the importing, defeating the lazy-load requirement (§11).
export const CHAT_MIN_WIDTH = 360;
export const CHAT_MAX_WIDTH = 720;
export const CHAT_DEFAULT_WIDTH = 420;

export const clampChatWidth = (value: number) =>
  Math.min(CHAT_MAX_WIDTH, Math.max(CHAT_MIN_WIDTH, value));
