import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import type { SearchKind } from "../data/api";
import { SearchPanel } from "./SearchPanel";

export const SEARCH_MIN_WIDTH = 320;
export const SEARCH_MAX_WIDTH = 680;
export const SEARCH_DEFAULT_WIDTH = 380;

export const clampSearchWidth = (value: number) =>
  Math.min(SEARCH_MAX_WIDTH, Math.max(SEARCH_MIN_WIDTH, value));

/**
 * The persistent Search Workspace. Desktop: a resizable drawer docked to the right of the reading
 * panes that stays open while results are read. Mobile: a full-screen view. The drawer stays mounted
 * while closed (display:none) so the query, filters, results, and scroll survive collapse/restore.
 */
export function SearchDrawer({
  open,
  fullscreen,
  width,
  onWidthChange,
  onNavigate,
  onClose,
  restoreResultFocus = false,
}: {
  open: boolean;
  fullscreen: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  onNavigate?: (kind: SearchKind) => void;
  onClose: () => void;
  restoreResultFocus?: boolean;
}) {
  const { t } = useTranslation();
  const dragging = useRef(false);
  const drawerRef = useRef<HTMLElement>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    onWidthChange(clampSearchWidth(window.innerWidth - event.clientX));
  };
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const onResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = width + 10;
    else if (event.key === "ArrowRight") next = width - 10;
    else if (event.key === "Home") next = SEARCH_MIN_WIDTH;
    else if (event.key === "End") next = SEARCH_MAX_WIDTH;
    if (next === null) return;
    event.preventDefault();
    onWidthChange(clampSearchWidth(next));
  };

  // A full-screen Search workspace is modal on mobile. Keep keyboard focus inside it while open;
  // the nested filter dialog applies its own, narrower focus trap when present.
  useEffect(() => {
    if (!open || !fullscreen) return;
    const drawer = drawerRef.current;
    if (!drawer) return;
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      // The nested mobile filter dialog owns focus while it is open.
      if (drawer.querySelector('.search-filter-sheet[aria-modal="true"]')) return;
      const focusable = [...drawer.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex]:not([tabindex="-1"])',
      )].filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    drawer.addEventListener("keydown", trapFocus);
    return () => drawer.removeEventListener("keydown", trapFocus);
  }, [open, fullscreen]);

  const mode = fullscreen ? "fullscreen" : "docked";

  return (
    <aside
      ref={drawerRef}
      className={`search-drawer ${mode} ${open ? "open" : "closed"}`}
      style={fullscreen || !open ? undefined : { width: clampSearchWidth(width) }}
      aria-hidden={!open}
      aria-label={t("search.workspace")}
      role={fullscreen ? "dialog" : "complementary"}
      aria-modal={fullscreen && open ? true : undefined}
    >
      {!fullscreen && (
        <div
          className="search-drawer-handle"
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label={t("search.resize")}
          aria-valuemin={SEARCH_MIN_WIDTH}
          aria-valuemax={SEARCH_MAX_WIDTH}
          aria-valuenow={clampSearchWidth(width)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            dragging.current = false;
          }}
          onKeyDown={onResizeKeyDown}
        />
      )}
      <SearchPanel
        mode={mode}
        open={open}
        onNavigate={onNavigate}
        onClose={onClose}
        restoreResultFocus={restoreResultFocus}
      />
    </aside>
  );
}
