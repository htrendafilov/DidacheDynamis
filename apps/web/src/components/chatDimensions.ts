// Pure constants, no React/JSX. App.tsx needs the default width synchronously (before the
// lazy-loaded ChatDrawer is ever mounted), and the whole chat/ module tree must load only
// through that lazy import (plan/chat/m9.2-workspace-and-provider.md §11) — so these live
// outside chat/ entirely, not just outside ChatDrawer.tsx, to keep that boundary a real
// directory boundary rather than a per-file convention.
export const CHAT_MIN_WIDTH = 360;
export const CHAT_MAX_WIDTH = 720;
export const CHAT_DEFAULT_WIDTH = 420;

export const clampChatWidth = (value: number) =>
  Math.min(CHAT_MAX_WIDTH, Math.max(CHAT_MIN_WIDTH, value));
