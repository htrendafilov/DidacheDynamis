import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { CHAT_MAX_WIDTH, CHAT_MIN_WIDTH, clampChatWidth } from "../chatDimensions";

/**
 * The Assistant workspace shell, copied from SearchDrawer's mechanics
 * (plan/chat/m9.2-workspace-and-provider.md §6): docked resizable drawer on desktop,
 * full-screen dialog on mobile, stays mounted while closed so composer state survives
 * collapse. Unlike Search, there is no nested modal to special-case, so the focus trap
 * is simpler, and Escape closes the whole workspace rather than only an inner sheet.
 */
export function ChatDrawer({
  open,
  fullscreen,
  width,
  onWidthChange,
  onClose,
  children,
}: {
  open: boolean;
  fullscreen: boolean;
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
  children: React.ReactNode;
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
    onWidthChange(clampChatWidth(window.innerWidth - event.clientX));
  };
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const onResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = width + 10;
    else if (event.key === "ArrowRight") next = width - 10;
    else if (event.key === "Home") next = CHAT_MIN_WIDTH;
    else if (event.key === "End") next = CHAT_MAX_WIDTH;
    if (next === null) return;
    event.preventDefault();
    onWidthChange(clampChatWidth(next));
  };

  // A full-screen Assistant workspace is modal on mobile. Keep keyboard focus inside it
  // while open. No nested dialog exists in the Assistant workspace, so (unlike
  // SearchDrawer) this trap needs no exception for one.
  useEffect(() => {
    if (!open || !fullscreen) return;
    const drawer = drawerRef.current;
    if (!drawer) return;
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = [
        ...drawer.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((element) => element.offsetParent !== null);
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

  // Escape closes the workspace; the caller's onClose is responsible for returning focus
  // to the TopBar button that opened it (mirrors the existing SearchDrawer onClose contract).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const mode = fullscreen ? "fullscreen" : "docked";

  return (
    <aside
      ref={drawerRef}
      className={`chat-drawer ${mode} ${open ? "open" : "closed"}`}
      style={fullscreen || !open ? undefined : { width: clampChatWidth(width) }}
      aria-hidden={!open}
      aria-label={t("chat.workspace")}
      role={fullscreen ? "dialog" : "complementary"}
      aria-modal={fullscreen && open ? true : undefined}
    >
      {!fullscreen && (
        <div
          className="chat-drawer-handle"
          role="separator"
          tabIndex={0}
          aria-orientation="vertical"
          aria-label={t("chat.resize")}
          aria-valuemin={CHAT_MIN_WIDTH}
          aria-valuemax={CHAT_MAX_WIDTH}
          aria-valuenow={clampChatWidth(width)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            dragging.current = false;
          }}
          onKeyDown={onResizeKeyDown}
        />
      )}
      {children}
    </aside>
  );
}
