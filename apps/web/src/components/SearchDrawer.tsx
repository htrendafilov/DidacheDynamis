import { useRef } from "react";
import { useTranslation } from "react-i18next";

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
  onClose,
}: {
  open: boolean;
  fullscreen: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const dragging = useRef(false);

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

  const mode = fullscreen ? "fullscreen" : "docked";

  return (
    <aside
      className={`search-drawer ${mode} ${open ? "open" : "closed"}`}
      style={fullscreen || !open ? undefined : { width: clampSearchWidth(width) }}
      aria-hidden={!open}
    >
      {!fullscreen && (
        <div
          className="search-drawer-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label={t("search.resize")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
      )}
      <SearchPanel mode={mode} open={open} onClose={onClose} />
    </aside>
  );
}
