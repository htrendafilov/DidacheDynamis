import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import i18n from "../../i18n";
import { CHAT_MAX_WIDTH, CHAT_MIN_WIDTH, clampChatWidth } from "../chatDimensions";
import { ChatDrawer } from "./ChatDrawer";

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

function renderDrawer(props: Partial<ComponentProps<typeof ChatDrawer>> = {}) {
  const onWidthChange = vi.fn();
  const onClose = vi.fn();
  render(
    <ChatDrawer
      open
      fullscreen={false}
      width={420}
      onWidthChange={onWidthChange}
      onClose={onClose}
      {...props}
    >
      <button type="button">first</button>
      <button type="button">last</button>
    </ChatDrawer>,
  );
  return { onWidthChange, onClose };
}

describe("ChatDrawer", () => {
  it("docks with a set width and a resize handle when open on desktop", () => {
    renderDrawer();
    const drawer = document.querySelector(".chat-drawer") as HTMLElement;
    expect(drawer.className).toContain("docked");
    expect(drawer.className).toContain("open");
    expect(drawer.style.width).toBe("420px");
    const separator = screen.getByRole("separator");
    expect(separator).toHaveAttribute("tabindex", "0");
    expect(separator).toHaveAttribute("aria-valuenow", "420");
  });

  it("is hidden but stays mounted when closed, so its children (composer state) survive", () => {
    renderDrawer({ open: false });
    const drawer = document.querySelector(".chat-drawer") as HTMLElement;
    expect(drawer.className).toContain("closed");
    expect(drawer).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("first")).toBeInTheDocument();
  });

  it("becomes a full-screen modal dialog with no resize handle on mobile", () => {
    renderDrawer({ fullscreen: true });
    const drawer = document.querySelector(".chat-drawer") as HTMLElement;
    expect(drawer.className).toContain("fullscreen");
    expect(drawer).toHaveAttribute("role", "dialog");
    expect(drawer).toHaveAttribute("aria-modal", "true");
    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });

  it("clamps the width to [min, max]", () => {
    expect(clampChatWidth(420)).toBe(420);
    expect(clampChatWidth(10)).toBe(CHAT_MIN_WIDTH);
    expect(clampChatWidth(9999)).toBe(CHAT_MAX_WIDTH);
  });

  it("resizes from the keyboard", () => {
    const { onWidthChange } = renderDrawer();
    const handle = screen.getByRole("separator");
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(onWidthChange).toHaveBeenLastCalledWith(430);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(onWidthChange).toHaveBeenLastCalledWith(410);
    fireEvent.keyDown(handle, { key: "Home" });
    expect(onWidthChange).toHaveBeenLastCalledWith(CHAT_MIN_WIDTH);
    fireEvent.keyDown(handle, { key: "End" });
    expect(onWidthChange).toHaveBeenLastCalledWith(CHAT_MAX_WIDTH);
  });

  it("closes on Escape while open", () => {
    const { onClose } = renderDrawer();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not close on Escape while already closed", () => {
    const { onClose } = renderDrawer({ open: false });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("traps Tab focus inside the fullscreen dialog, with no nested-sheet exception", () => {
    renderDrawer({ fullscreen: true });
    const first = screen.getByText("first");
    const last = screen.getByText("last");
    // jsdom never computes layout, so offsetParent (the trap's visibility filter) is
    // always null; stub it on these two elements so the wrap logic is actually exercised.
    for (const el of [first, last]) {
      Object.defineProperty(el, "offsetParent", { get: () => document.body });
    }
    last.focus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
