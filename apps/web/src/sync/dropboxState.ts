import { create } from "zustand";

import { db, NOTES_CHANGED_EVENT } from "../data/notes";
import {
  beginDropboxAuthorization,
  clearDropboxSession,
  completeDropboxAuthorization,
  getDropboxSession,
  isDropboxConfigured,
} from "./dropboxAuth";
import { syncDropboxNotes } from "./dropboxSync";
import { DropboxSdkTransport } from "./dropboxTransport";

type SyncPhase = "idle" | "authenticating" | "syncing" | "error";
type SyncError = "auth" | "expired" | "sync" | null;

interface DropboxSyncState {
  configured: boolean;
  connected: boolean;
  phase: SyncPhase;
  error: SyncError;
  lastSyncAt: number | null;
  conflicts: number;
  initialize: () => Promise<void>;
  connect: () => Promise<void>;
  syncNow: () => Promise<void>;
  disconnect: () => void;
  clearConflicts: () => void;
}

let initialization: Promise<void> | null = null;
let activeSync: Promise<void> | null = null;
let resyncRequested = false;

export const useDropboxSync = create<DropboxSyncState>((set, get) => ({
  configured: isDropboxConfigured(),
  connected: false,
  phase: "idle",
  error: null,
  lastSyncAt: null,
  conflicts: 0,
  initialize: async () => {
    if (initialization) return initialization;
    initialization = (async () => {
      try {
        const callbackSession = await completeDropboxAuthorization();
        const session = callbackSession ?? getDropboxSession();
        if (!session) {
          set({ connected: false, phase: "idle" });
          return;
        }
        const meta = await db.syncMeta.get("dropbox");
        set({
          connected: true,
          phase: "idle",
          error: null,
          lastSyncAt: meta?.accountId === session.accountId ? (meta.lastSyncAt ?? null) : null,
        });
        await get().syncNow();
      } catch {
        clearDropboxSession();
        set({ connected: false, phase: "error", error: "auth" });
      }
    })();
    return initialization;
  },
  connect: async () => {
    set({ phase: "authenticating", error: null });
    try {
      await beginDropboxAuthorization();
    } catch {
      set({ phase: "error", error: "auth" });
    }
  },
  syncNow: async () => {
    if (activeSync) {
      resyncRequested = true;
      return activeSync;
    }
    const session = getDropboxSession();
    if (!session) {
      set({ connected: false, phase: "error", error: "expired" });
      return;
    }
    activeSync = (async () => {
      set({ connected: true, phase: "syncing", error: null });
      try {
        const result = await syncDropboxNotes(
          session.accountId,
          new DropboxSdkTransport(session.accessToken),
        );
        set({
          connected: true,
          phase: "idle",
          error: null,
          lastSyncAt: result.syncedAt,
          conflicts: result.conflicts || get().conflicts,
        });
      } catch (error) {
        const status = (error as { status?: unknown })?.status;
        if (status === 401) {
          clearDropboxSession();
          set({ connected: false, phase: "error", error: "expired" });
        } else set({ phase: "error", error: "sync" });
      } finally {
        activeSync = null;
        if (resyncRequested) {
          resyncRequested = false;
          queueMicrotask(() => void get().syncNow());
        }
      }
    })();
    return activeSync;
  },
  disconnect: () => {
    clearDropboxSession();
    set({ connected: false, phase: "idle", error: null, conflicts: 0 });
  },
  clearConflicts: () => set({ conflicts: 0 }),
}));

export function installDropboxAutoSync(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (delay = 4_000) => {
    if (!useDropboxSync.getState().connected) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void useDropboxSync.getState().syncNow(), delay);
  };
  const onNotesChanged = () => schedule();
  const onOnline = () => schedule(250);
  const onFocus = () => schedule(500);
  const onVisibility = () => {
    if (document.visibilityState === "visible") schedule(500);
  };
  window.addEventListener(NOTES_CHANGED_EVENT, onNotesChanged);
  window.addEventListener("online", onOnline);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    if (timer) clearTimeout(timer);
    window.removeEventListener(NOTES_CHANGED_EVENT, onNotesChanged);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
